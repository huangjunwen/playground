// Shared helpers for the ipc/ipc-mp test suite.
//
// The Transport contract (Worker | MessagePort) is satisfied equally by a
// MessagePort pair from MessageChannel, which is exactly the primitive a Worker
// and its parent thread use to exchange messages. Both expose the same
// addEventListener('message') / postMessage(data, transfer) / removeEventListener
// surface and the same optional start(); the code under test treats them
// identically. So a MessageChannel pair faithfully stands in for the
// worker/main endpoints, and is the only transport we can build inside a unit
// test (a DOM Worker can't be spawned in the node environment).

import type { StreamConsumer } from '../src/ipc';

/** A connected transport pair: writes on one port arrive on the other. */
export function makeChannel(): [MessagePort, MessagePort] {
  const { port1, port2 } = new MessageChannel();
  return [port1, port2];
}

/** Advance one macrotask, letting microtask flushes run and a posted message
 *  be delivered on the other side. */
export const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** Build an ArrayBuffer of `n` bytes filled with a deterministic pattern so
 *  transfers can be verified byte-for-byte. The seed shifts the pattern. */
export function buf(n: number, seed = 0): ArrayBuffer {
  const ab = new ArrayBuffer(n);
  const view = new Uint8Array(ab);
  for (let i = 0; i < n; i++) view[i] = (i + seed) % 256;
  return ab;
}

/** The expected `number[]` pattern that `buf(n, seed)` serializes to. */
export function expectedBytes(n: number, seed = 0): number[] {
  return Array.from({ length: n }, (_, i) => (i + seed) % 256);
}

/** ArrayBuffer → number[] (or null) for structural equality checks. */
export function bytes(ab: ArrayBuffer | null | undefined): number[] | null {
  if (ab == null) return null;
  return Array.from(new Uint8Array(ab));
}

export type ReadOutcome = { ok: true; value: ArrayBuffer | null } | { ok: false; error: Error };

/** Read from a consumer, unifying synchronous throws/values with async
 *  rejections. Never throws — returns an outcome instead. */
export async function readOutcome(c: StreamConsumer): Promise<ReadOutcome> {
  let r: ReturnType<StreamConsumer['read']>;
  try {
    r = c.read();
  } catch (error) {
    return { ok: false, error: error as Error };
  }
  if (r instanceof Promise) {
    try {
      return { ok: true, value: await r };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  }
  return { ok: true, value: r };
}

/** Read the next chunk (or null at EOF), throwing in the test if an error
 *  surfaces instead. */
export async function readValue(c: StreamConsumer): Promise<ArrayBuffer | null> {
  const r = await readOutcome(c);
  if (r.ok) return r.value;
  throw r.error;
}

/** Read expecting an error; throws in the test if a value surfaces instead. */
export async function readError(c: StreamConsumer): Promise<Error> {
  const r = await readOutcome(c);
  if (r.ok) throw new Error('expected read to fail, but it returned a value');
  return r.error;
}
