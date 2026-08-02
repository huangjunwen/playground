/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import wasmUrl from '../../vendor-assets/vendor/als-wasm/v6/als-2.8.0-opt.wasm?url';
import { WebWasiRunEnv } from '../src/web/web-wasi';

const decoder = new TextDecoder();
const ALS_TIMEOUT = 60_000;

async function collectStdout(handle: { stdout: ReadableStream<ArrayBuffer> }): Promise<string> {
  let result = '';
  for await (const chunk of handle.stdout) {
    result += decoder.decode(chunk, { stream: true });
  }
  return result + decoder.decode(); // flush
}
describe('WebWasiRunEnv', () => {
  it(
    'runs als --version',
    async () => {
      const env = await WebWasiRunEnv.create();
      const handle = env.run({ program: wasmUrl, args: ['als', '--version'] });
      const out = await collectStdout(handle);
      const code = await handle.exit;
      expect(code).toBe(0);
      expect(out).toContain('Agda');
      expect(out).toContain('Language Server');
      env.terminate();
    },
    ALS_TIMEOUT,
  );

  it(
    'runs als --help',
    async () => {
      const env = await WebWasiRunEnv.create();
      const handle = env.run({ program: wasmUrl, args: ['als', '--help'] });
      const out = await collectStdout(handle);
      const code = await handle.exit;
      expect(code).toBe(0);
      expect(out).toContain('--raw');
      expect(out).toContain('--setup');
      env.terminate();
    },
    ALS_TIMEOUT,
  );

  it(
    'fs writeFile + readFile round-trip',
    async () => {
      const env = await WebWasiRunEnv.create();
      await env.fs.mkdir('/scratch', { recursive: true });
      await env.fs.writeFile('/scratch/test.txt', new TextEncoder().encode('web-fs'));
      const data = await env.fs.readFile('/scratch/test.txt');
      expect(new TextDecoder().decode(data)).toBe('web-fs');
      env.terminate();
    },
    ALS_TIMEOUT,
  );

  it(
    'terminate kills a running worker',
    async () => {
      const env = await WebWasiRunEnv.create();
      // Start a long-running command (--raw keeps the LSP server alive)
      const handle = env.run({ program: wasmUrl, args: ['als', '--raw'] });
      // Give it a moment to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      env.terminate();
      // POSIX convention: SIGKILL (signal 9) → exit code 137.
      expect(await handle.exit).toBe(137);
    },
    ALS_TIMEOUT,
  );
});
