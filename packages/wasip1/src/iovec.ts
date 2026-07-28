// Scatter/gather over a decoded ciovec table.
//
// Decoding the table itself (the ciovec layout) lives in struct.ts as `Iovec`;
// this module only moves bytes between wasm linear memory and a contiguous
// buffer once the table is already decoded into `IovecValue[]`.

import type { IovecValue } from './struct';

/** Total capacity of an iovec table (sum of each vector's length). */
export function iovTotal(iovs: readonly IovecValue[]): number {
  let total = 0;
  for (const v of iovs) total += v.len;
  return total;
}

/** Gather bytes from the iovec buffers in `mem` into one contiguous Uint8Array. */
export function readFromIovs(mem: Uint8Array, iovs: readonly IovecValue[]): Uint8Array {
  const out = new Uint8Array(iovTotal(iovs));
  let w = 0;
  for (const { buf, len } of iovs) {
    out.set(mem.subarray(buf, buf + len), w);
    w += len;
  }
  return out;
}

/**
 * Scatter `source` into the iovec buffers in `mem`, filling them in order until
 * `source` is exhausted or every iov is full. Returns the number of bytes written.
 */
export function writeToIovs(
  mem: Uint8Array,
  iovs: readonly IovecValue[],
  source: Uint8Array,
): number {
  let off = 0;
  for (const { buf, len } of iovs) {
    if (off >= source.byteLength) break;
    const take = Math.min(len, source.byteLength - off);
    mem.subarray(buf, buf + take).set(source.subarray(off, off + take));
    off += take;
  }
  return off;
}
