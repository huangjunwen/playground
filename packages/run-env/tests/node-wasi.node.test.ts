import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAssetPath } from '@playground/vendor-assets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeWasiRunEnv } from '../src/node-wasi';

const WASM_PATH = resolveAssetPath('als-wasm', 'opt');

const decoder = new TextDecoder();
const ALS_TIMEOUT = 60_000; // wasm instantiation + command

async function collectStdout(handle: { stdout: ReadableStream<ArrayBuffer> }): Promise<string> {
  const chunks: ArrayBuffer[] = [];
  for await (const chunk of handle.stdout) chunks.push(chunk);
  return decoder.decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
}

describe('NodeWasiRunEnv', () => {
  describe('run()', () => {
    it(
      'runs als --version and captures output',
      async () => {
        const env = new NodeWasiRunEnv();
        const handle = env.run({ program: WASM_PATH, args: ['als', '--version'] });
        const out = await collectStdout(handle);
        const code = await handle.exit;
        expect(code).toBe(0);
        expect(out).toContain('Agda');
        expect(out).toContain('Language Server');
      },
      ALS_TIMEOUT,
    );

    it(
      'runs als --help and captures usage text',
      async () => {
        const env = new NodeWasiRunEnv();
        const handle = env.run({ program: WASM_PATH, args: ['als', '--help'] });
        const out = await collectStdout(handle);
        const code = await handle.exit;
        expect(code).toBe(0);
        expect(out).toContain('--raw');
        expect(out).toContain('--setup');
      },
      ALS_TIMEOUT,
    );

    it(
      'terminate() kills a running wasm process',
      async () => {
        const env = new NodeWasiRunEnv();
        const handle = env.run({ program: WASM_PATH, args: ['als', '--raw'] });
        // Give it a moment to start, then kill.
        await new Promise(resolve => setTimeout(resolve, 2000));
        env.terminate();
        // POSIX convention: SIGKILL (signal 9) → exit code 137.
        expect(await handle.exit).toBe(137);
      },
      ALS_TIMEOUT,
    );
  });

  describe('fs (with path translation)', () => {
    let hostDir: string;

    beforeAll(async () => {
      hostDir = await mkdtemp(join(tmpdir(), 'run-env-wasi-'));
    });

    afterAll(async () => {
      await rm(hostDir, { recursive: true, force: true });
    });

    it('translates guest paths to host paths via preopens', async () => {
      const env = new NodeWasiRunEnv({ preopens: { '/data': hostDir } });

      // Write via the Fs interface (guest path space) …
      await env.fs.writeFile('/data/hello.txt', new TextEncoder().encode('from-wasi'));

      // … and read back through the same interface.
      const data = await env.fs.readFile('/data/hello.txt');
      expect(new TextDecoder().decode(data)).toBe('from-wasi');

      // The file actually exists on the real host filesystem.
      const info = await env.fs.stat('/data/hello.txt');
      expect(info.size).toBe('from-wasi'.length);
      expect(info.isDirectory).toBe(false);
    });

    it('mkdir + listDir through path translation', async () => {
      const env = new NodeWasiRunEnv({ preopens: { '/data': hostDir } });
      await env.fs.mkdir('/data/sub', { recursive: true });
      await env.fs.writeFile('/data/sub/a.txt', new Uint8Array());
      const entries = await env.fs.listDir('/data/sub');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe('a.txt');
      expect(entries[0]?.isDirectory).toBe(false);
    });
  });
});
