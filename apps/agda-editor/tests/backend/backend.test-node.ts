/**
 * Backend (backend/backend.ts) — VFS sync + command forwarding, the
 * in-backend wire taps, and the real-ALS boot through create().
 *
 */

import { mkdirSync, rmSync } from 'node:fs';
import { NodeWasiRunEnv } from '@playground/run-env/node';
import { describe, expect, it, vi } from 'vitest';
import { Backend, lspTapMiddleware, stderrLines } from '../../src/backend/backend';

const HOST = '/tmp/opencode/bridge';

interface WriteCall {
  path: string;
  data: Uint8Array;
}

function makeFakeEnv() {
  const writes: WriteCall[] = [];
  const env = {
    name: 'fake',
    fs: {
      readFile: vi.fn(),
      writeFile: vi.fn(async (path: string, data: Uint8Array) => {
        writes.push({ path, data });
      }),
      mkdir: vi.fn(),
      stat: vi.fn(),
      remove: vi.fn(),
      listDir: vi.fn(),
      rename: vi.fn(),
    },
    run: vi.fn(),
    terminate: vi.fn(),
  };
  return { env, writes };
}

function makeFakeSession() {
  return {
    stream: vi.fn(),
    request: vi.fn(async () => []),
  };
}

describe('Backend.vfsWrite (VFS sync)', () => {
  it('writes the text to the given path', async () => {
    const { env, writes } = makeFakeEnv();
    const backend = new Backend(env, { session: makeFakeSession() });

    await backend.vfsWrite('/root/workspace/Main.agda', 'module Main where');

    expect(env.fs.writeFile).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe('/root/workspace/Main.agda');
    expect(new TextDecoder().decode(writes[0]?.data ?? new Uint8Array())).toBe('module Main where');
  });

  it('writes on every sync', async () => {
    const { env, writes } = makeFakeEnv();
    const backend = new Backend(env, { session: makeFakeSession() });

    await backend.vfsWrite('/p', 'same');
    await backend.vfsWrite('/p', 'same');

    expect(env.fs.writeFile).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(2);
  });

  it('forwards to the session stream', async () => {
    const env = makeFakeEnv().env;
    const session = makeFakeSession();
    const backend = new Backend(env, { session });

    backend.stream({ raw: 'cmd' } as never);

    expect(session.stream).toHaveBeenCalledWith({ raw: 'cmd' });
  });
});

describe('Backend.create (real ALS boot via injected run-env)', () => {
  it('boots ALS with a real NodeWasiRunEnv and exposes filePath/session', {
    timeout: 120_000,
  }, async () => {
    rmSync(HOST, { recursive: true, force: true });
    const preopens: Record<string, string> = {
      '/': HOST,
      '/tmp': `${HOST}/tmp`,
      '/data/builtins/als-wasm-v6-opt': `${HOST}/data/builtins`,
    };
    for (const d of [`${HOST}/tmp`, `${HOST}/data/builtins`, `${HOST}/root/workspace`]) {
      mkdirSync(d, { recursive: true });
    }

    let env: NodeWasiRunEnv | undefined;
    const backend = await Backend.create({
      envFactory: async () => {
        env = new NodeWasiRunEnv({ preopens });
        return env;
      },
    });

    await backend.vfsWrite('/root/workspace/Main.agda', 'module Main where\n');
    const text = new TextDecoder().decode(await env!.fs.readFile('/root/workspace/Main.agda'));
    expect(text).toBe('module Main where\n');

    backend.terminate();
  });
});

describe('lspTapMiddleware', () => {
  function makeFakeTransport() {
    const handlers = new Set<(msg: Record<string, unknown>) => void>();
    return {
      send: vi.fn(),
      onMessage: vi.fn((handler: (msg: Record<string, unknown>) => void) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      }),
      emit: (msg: Record<string, unknown>) => {
        for (const h of handlers) h(msg);
      },
    };
  }

  it('reports outgoing frames as outgoing and forwards them', () => {
    const inner = makeFakeTransport();
    const onFrame = vi.fn();
    const tapped = lspTapMiddleware(onFrame)(inner);

    const msg = { jsonrpc: '2.0', id: 1, method: 'agda', params: {} };
    tapped.send(msg);

    expect(onFrame).toHaveBeenCalledWith(true, msg);
    expect(inner.send).toHaveBeenCalledWith(msg);
  });

  it('reports incoming frames as incoming before the subscriber sees them', () => {
    const inner = makeFakeTransport();
    const onFrame = vi.fn();
    const seen: string[] = [];
    lspTapMiddleware(onFrame)(inner).onMessage(msg => seen.push(String(msg.method)));

    const msg = { jsonrpc: '2.0', method: 'window/logMessage', params: {} };
    inner.emit(msg);

    expect(onFrame).toHaveBeenCalledWith(false, msg);
    expect(seen).toEqual(['window/logMessage']);
  });

  it('keeps subscriptions independent and unsubscribable', () => {
    const inner = makeFakeTransport();
    const onFrame = vi.fn();
    const tapped = lspTapMiddleware(onFrame)(inner);

    const a = vi.fn();
    const b = vi.fn();
    const offA = tapped.onMessage(a);
    tapped.onMessage(b);

    const msg = { jsonrpc: '2.0', method: 'm' };
    inner.emit(msg);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    inner.emit(msg);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});

describe('stderrLines', () => {
  it('splits chunk boundaries, newlines, and CRLF, flushing the tail', async () => {
    const stream = new ReadableStream<ArrayBuffer>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('wasi: boot\nwas').buffer as ArrayBuffer);
        controller.enqueue(enc.encode('mi: pan\r\nbye').buffer as ArrayBuffer);
        controller.close();
      },
    });

    const lines: string[] = [];
    await stderrLines(stream, line => lines.push(line));

    expect(lines).toEqual(['wasi: boot', 'wasmi: pan', 'bye']);
  });

  it('emits nothing for an empty stream', async () => {
    const stream = new ReadableStream<ArrayBuffer>({
      start(controller) {
        controller.close();
      },
    });

    const lines: string[] = [];
    await stderrLines(stream, line => lines.push(line));

    expect(lines).toEqual([]);
  });
});
