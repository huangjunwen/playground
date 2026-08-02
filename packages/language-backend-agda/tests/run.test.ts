/**
 * Integration tests for `runAls` — the two-phase lifecycle (setup → main LSP
 * service), option resolution, sentinel gating, transport/onSetup hooks, and
 * the LSP initialize handshake — driven through {@link FakeRunEnv}.
 *
 * `@playground/vendor-assets` is mocked so default resolution is hermetic and
 * does not depend on the ~90 MB wasm being vendored locally.
 */

import type { LspTransport } from '@playground/lsp';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@playground/vendor-assets', () => ({
  resolveAssetUrl: (family: string, asset: string) => `mock-url:${family}/${asset}`,
  resolveAssetPath: (family: string, asset: string) => `/mock/path/${family}/${asset}`,
  getAssetInfo: (family: string, asset: string) => ({
    family,
    version: 'vMOCK',
    asset,
    filename: 'mock.wasm',
  }),
}));

import { DEFAULT_ALS_CLIENT_CAPABILITIES, DEFAULT_ALS_WORKSPACE } from '../src/defaults';
import { type AlsHandle, runAls } from '../src/run';
import { AlsSession } from '../src/session';
import { FakeRunEnv } from './fake-run-env';

const isNode = typeof process !== 'undefined';

describe('runAls — default resolution by env.name', () => {
  let env: FakeRunEnv;
  afterEach(() => env?.closeAll());

  it('derives program / Agda_datadir / HOME from web-wasi defaults', async () => {
    env = new FakeRunEnv('web-wasi');
    await runAls(env);

    expect(env.ranSetup).toBe(true); // sentinel absent → setup runs
    const main = env.mainHandle!;
    const cmd = env.commands.find(c => c.args.includes('--raw'))!;
    expect(cmd.program).toBe('mock-url:als-wasm/opt');
    expect(cmd.env).toMatchObject({
      Agda_datadir: '/data/builtins/als-wasm-vMOCK-opt',
      HOME: '/root',
    });
    // the initialize handshake reached the fake server
    expect(main.sent.some(m => m.method === 'initialize')).toBe(true);
  });

  it.skipIf(!isNode)('node-native defaults: bare binary, fixed data dir, host HOME', async () => {
    const saved = process.env.HOME;
    process.env.HOME = '/users/test';
    try {
      env = new FakeRunEnv('node-native');
      await runAls(env);
      const cmd = env.commands.find(c => c.args.includes('--raw'))!;
      expect(cmd.program).toBe('als');
      expect(cmd.env).toMatchObject({ Agda_datadir: '/tmp/als-builtin', HOME: '/users/test' });
    } finally {
      process.env.HOME = saved;
    }
  });
});

describe('runAls — option overrides', () => {
  let env: FakeRunEnv;
  afterEach(() => env?.closeAll());

  it('honours explicit program / agdaDataDir / home and merges extra env', async () => {
    env = new FakeRunEnv('web-wasi');
    await runAls(env, {
      program: '/custom/als',
      agdaDataDir: '/custom/data',
      home: '/custom/home',
      env: { EXTRA: '1', Agda_datadir: '/overridden/data' },
    });

    const cmd = env.commands.find(c => c.args.includes('--raw'))!;
    expect(cmd.program).toBe('/custom/als');
    // caller env overrides defaults (spread last)
    expect(cmd.env).toMatchObject({
      Agda_datadir: '/overridden/data',
      HOME: '/custom/home',
      EXTRA: '1',
    });
  });
});

describe('runAls — setup sentinel gating', () => {
  let env: FakeRunEnv;
  afterEach(() => env?.closeAll());

  it('skips setup when the sentinel already exists', async () => {
    env = new FakeRunEnv('web-wasi');
    const dataDir = '/data/builtins/als-wasm-vMOCK-opt';
    await env.fs.writeFile(`${dataDir}/.setup-done`, new Uint8Array(0));

    await runAls(env);

    expect(env.ranSetup).toBe(false);
    expect(env.commands.filter(c => c.args.includes('--setup'))).toHaveLength(0);
    expect(env.commands.filter(c => c.args.includes('--raw'))).toHaveLength(1);
  });

  it('runs setup then writes the sentinel when it is missing', async () => {
    env = new FakeRunEnv('web-wasi');
    await runAls(env);

    expect(env.ranSetup).toBe(true);
    const setupCmd = env.commands.find(c => c.args.includes('--setup'));
    expect(setupCmd?.args).toEqual(['als', '--setup']);
    const sentinel = '/data/builtins/als-wasm-vMOCK-opt/.setup-done';
    const stat = await env.fs.stat(sentinel);
    expect(stat.isDirectory).toBe(false);
    expect(stat.size).toBe(0);
  });

  it('setup and main share the same program + env', async () => {
    env = new FakeRunEnv('web-wasi');
    await runAls(env);
    const setup = env.commands.find(c => c.args.includes('--setup'))!;
    const main = env.commands.find(c => c.args.includes('--raw'))!;
    expect(setup.program).toBe(main.program);
    expect(setup.env).toEqual(main.env);
  });
});

describe('runAls — handle shape + hooks', () => {
  let env: FakeRunEnv;
  afterEach(() => env?.closeAll());

  it('returns a handle with session/log/exit and no terminate', async () => {
    env = new FakeRunEnv('web-wasi');
    const handle = await runAls(env);
    expect(handle.session).toBeInstanceOf(AlsSession);
    expect(handle.log).toBeInstanceOf(ReadableStream);
    expect(handle.exit).toBeInstanceOf(Promise);
    // AlsHandle intentionally owns no lifecycle control
    expect('terminate' in handle).toBe(false);
  });

  it('invokes onSetup with the handle before the initialize handshake', async () => {
    env = new FakeRunEnv('web-wasi');
    let captured: AlsHandle | undefined;
    const order: string[] = [];
    await runAls(env, {
      onSetup: h => {
        captured = h;
        order.push('setup');
      },
    });
    expect(captured).toBeInstanceOf(Object);
    expect(captured?.session).toBeInstanceOf(AlsSession);
    expect(order).toEqual(['setup']);
    // handshake completed afterwards
    expect(env.mainHandle!.sent.some(m => m.method === 'initialize')).toBe(true);
  });

  it('wraps the base transport via onCreateLspTransport', async () => {
    env = new FakeRunEnv('web-wasi');
    const calls: LspTransport[] = [];
    const sentThroughWrap: Record<string, unknown>[] = [];
    await runAls(env, {
      onCreateLspTransport: inner => {
        calls.push(inner);
        const wrapped: LspTransport = {
          send: msg => {
            sentThroughWrap.push(msg);
            inner.send(msg);
          },
          onMessage: inner.onMessage.bind(inner),
        };
        return wrapped;
      },
    });
    expect(calls).toHaveLength(1);
    // initialize must flow through the wrapper, not bypass it
    expect(sentThroughWrap.some(m => m.method === 'initialize')).toBe(true);
  });
});

describe('runAls — initialize handshake params', () => {
  let env: FakeRunEnv;
  afterEach(() => env?.closeAll());

  it('sends rootUri built from lspWorkspace and the default capabilities', async () => {
    env = new FakeRunEnv('web-wasi');
    await runAls(env);
    const init = env.mainHandle!.sent.find(m => m.method === 'initialize') as {
      params?: { rootUri?: string; capabilities?: Record<string, unknown> };
    };
    expect(init?.params?.rootUri).toBe(`file://${DEFAULT_ALS_WORKSPACE}`);
    expect(init?.params?.capabilities).toEqual(DEFAULT_ALS_CLIENT_CAPABILITIES);
  });

  it('lets lspWorkspace / lspCapabilities override the handshake', async () => {
    env = new FakeRunEnv('web-wasi');
    const caps = { textDocument: { synchronization: { dynamicRegistration: true } } };
    await runAls(env, { lspWorkspace: '/custom/ws', lspCapabilities: caps });
    const init = env.mainHandle!.sent.find(m => m.method === 'initialize') as {
      params?: { rootUri?: string; capabilities?: Record<string, unknown> };
    };
    expect(init?.params?.rootUri).toBe('file:///custom/ws');
    expect(init?.params?.capabilities).toEqual(caps);
  });
});
