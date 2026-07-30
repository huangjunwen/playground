import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NativeRunEnv } from '../src/node-native';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function collectStdout(handle: { stdout: ReadableStream<ArrayBuffer> }): Promise<string> {
  const chunks: ArrayBuffer[] = [];
  for await (const chunk of handle.stdout) chunks.push(chunk);
  return decoder.decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
}

describe('NativeRunEnv', () => {
  describe('run()', () => {
    it('captures stdout', async () => {
      const env = new NativeRunEnv();
      const handle = env.run({
        program: process.execPath,
        args: ['-e', "process.stdout.write('hello world')"],
      });
      const out = await collectStdout(handle);
      expect(await handle.exit).toBe(0);
      expect(out).toBe('hello world');
    });

    it('captures stderr', async () => {
      const env = new NativeRunEnv();
      const handle = env.run({
        program: process.execPath,
        args: ['-e', "process.stderr.write('boom')"],
      });
      const chunks: ArrayBuffer[] = [];
      for await (const chunk of handle.stderr) chunks.push(chunk);
      const err = decoder.decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
      await handle.exit;
      expect(err).toBe('boom');
    });

    it('exposes non-zero exit code', async () => {
      const env = new NativeRunEnv();
      const handle = env.run({ program: process.execPath, args: ['-e', 'process.exit(42)'] });
      expect(await handle.exit).toBe(42);
    });

    it('forwards env to the child', async () => {
      const env = new NativeRunEnv();
      const handle = env.run({
        program: process.execPath,
        args: ['-e', 'process.stdout.write(process.env.MY_VAR)'],
        env: { MY_VAR: 'passed-through' },
      });
      const out = await collectStdout(handle);
      await handle.exit;
      expect(out).toBe('passed-through');
    });

    it('terminate() kills a long-running process', async () => {
      const env = new NativeRunEnv();
      const handle = env.run({
        program: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
      });
      env.terminate();
      // POSIX convention: SIGKILL (signal 9) → exit code 137.
      expect(await handle.exit).toBe(137);
    });
  });

  describe('fs', () => {
    let tmp: string;

    beforeAll(async () => {
      tmp = await mkdtemp(join(tmpdir(), 'run-env-native-'));
    });

    afterAll(async () => {
      await rm(tmp, { recursive: true, force: true });
    });

    it('writeFile + readFile round-trip', async () => {
      const env = new NativeRunEnv();
      const path = join(tmp, 'round-trip.txt');
      await env.fs.writeFile(path, encoder.encode('content'));
      const data = await env.fs.readFile(path);
      expect(decoder.decode(data)).toBe('content');
    });

    it('stat reports size and type', async () => {
      const env = new NativeRunEnv();
      const path = join(tmp, 'round-trip.txt');
      const info = await env.fs.stat(path);
      expect(info.size).toBe('content'.length);
      expect(info.isDirectory).toBe(false);
    });

    it('mkdir + listDir', async () => {
      const env = new NativeRunEnv();
      const dir = join(tmp, 'listdir-test');
      await env.fs.mkdir(dir);
      await env.fs.writeFile(join(dir, 'a.txt'), new Uint8Array());
      await env.fs.mkdir(join(dir, 'sub'));
      const entries = await env.fs.listDir(dir);
      expect(entries).toHaveLength(2);
      const a = entries.find(e => e.name === 'a.txt');
      expect(a?.isDirectory).toBe(false);
      const sub = entries.find(e => e.name === 'sub');
      expect(sub?.isDirectory).toBe(true);
    });

    it('rename moves the file', async () => {
      const env = new NativeRunEnv();
      const src = join(tmp, 'rename-src.txt');
      const dst = join(tmp, 'rename-dst.txt');
      await env.fs.writeFile(src, encoder.encode('data'));
      await env.fs.rename(src, dst);
      const data = await env.fs.readFile(dst);
      expect(decoder.decode(data)).toBe('data');
    });

    it('remove deletes the file', async () => {
      const env = new NativeRunEnv();
      const path = join(tmp, 'remove-me.txt');
      await env.fs.writeFile(path, encoder.encode('x'));
      await env.fs.remove(path);
      await expect(env.fs.stat(path)).rejects.toThrow();
    });
  });
});
