/** Shared utilities for node-based {@link RunEnv} implementations. */

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable } from 'node:stream';
import type { RunHandle } from '../types';

/** Bridge a node child process's stdio to Web Streams and return a
 *  {@link RunHandle}. Callers are responsible for killing the child
 *  process on terminate (typically via {@link RunEnv.terminate}). */
export function childToRunHandle(child: ChildProcessWithoutNullStreams): RunHandle {
  const stdin = new WritableStream<ArrayBuffer>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        child.stdin.write(Buffer.from(chunk), err => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    close() {
      child.stdin.end();
    },
    abort() {
      child.stdin.destroy();
    },
  });

  const stdout = Readable.toWeb(child.stdout) as ReadableStream<ArrayBuffer>;
  const stderr = Readable.toWeb(child.stderr) as ReadableStream<ArrayBuffer>;

  const exit = new Promise<number>(resolve => {
    child.on('close', (code: number | null) => resolve(code ?? 0));
  });

  return {
    stdin,
    stdout,
    stderr,
    exit,
  };
}
