// Unit tests for src/iovec.ts: byte movement over a decoded ciovec table
// (iovTotal / readFromIovs / writeToIovs). Decoding the table from wasm memory
// (Iovec.fromArray) is exercised in tests/struct; here the iovs are already
// decoded IovecValue[].

import { describe, expect, it } from 'vitest';
import { iovTotal, readFromIovs, writeToIovs } from '../src/iovec';

describe('iovTotal', () => {
  it('sums each vector length', () => {
    expect(
      iovTotal([
        { buf: 20, len: 3 },
        { buf: 30, len: 5 },
      ]),
    ).toBe(8);
  });

  it('is 0 for an empty table', () => {
    expect(iovTotal([])).toBe(0);
  });

  it('ignores zero-length vectors', () => {
    expect(
      iovTotal([
        { buf: 0, len: 0 },
        { buf: 5, len: 0 },
      ]),
    ).toBe(0);
  });
});

describe('readFromIovs', () => {
  it('gathers bytes from each iov buffer in order', () => {
    const mem = new Uint8Array(64);
    mem.set([10, 11, 12], 20);
    mem.set([20, 21, 22, 23, 24], 30);
    const out = readFromIovs(mem, [
      { buf: 20, len: 3 },
      { buf: 30, len: 5 },
    ]);
    expect([...out]).toEqual([10, 11, 12, 20, 21, 22, 23, 24]);
  });

  it('returns an empty buffer for no vectors', () => {
    const out = readFromIovs(new Uint8Array(8), []);
    expect(out.byteLength).toBe(0);
  });
});

describe('writeToIovs', () => {
  it('scatters source across iov buffers', () => {
    const mem = new Uint8Array(64);
    const n = writeToIovs(
      mem,
      [
        { buf: 0, len: 2 },
        { buf: 4, len: 3 },
      ],
      new Uint8Array([1, 2, 3, 4, 5]),
    );
    expect(n).toBe(5);
    expect([...mem.subarray(0, 2)]).toEqual([1, 2]);
    expect([...mem.subarray(4, 7)]).toEqual([3, 4, 5]);
  });

  it('writes a short source (less than capacity) and reports the count', () => {
    const mem = new Uint8Array(64);
    const n = writeToIovs(
      mem,
      [
        { buf: 0, len: 2 },
        { buf: 4, len: 4 },
      ],
      new Uint8Array([9, 9, 9]),
    );
    expect(n).toBe(3);
    expect([...mem.subarray(0, 2)]).toEqual([9, 9]);
    expect([...mem.subarray(4, 7)]).toEqual([9, 0, 0]);
  });

  it('truncates an oversized source to iovec capacity (leftover case)', () => {
    const mem = new Uint8Array(64);
    const source = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const n = writeToIovs(
      mem,
      [
        { buf: 0, len: 2 },
        { buf: 4, len: 2 },
      ],
      source,
    );
    expect(n).toBe(4);
    expect([...mem.subarray(0, 2)]).toEqual([0, 1]);
    expect([...mem.subarray(4, 6)]).toEqual([2, 3]);
    expect([...source.subarray(n)]).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('writes nothing for an empty source', () => {
    const mem = new Uint8Array(8);
    const n = writeToIovs(mem, [{ buf: 0, len: 4 }], new Uint8Array(0));
    expect(n).toBe(0);
    expect(mem.every(b => b === 0)).toBe(true);
  });

  it('writes nothing for an empty iovec table', () => {
    const mem = new Uint8Array(8);
    const n = writeToIovs(mem, [], new Uint8Array([1, 2, 3]));
    expect(n).toBe(0);
    expect(mem.every(b => b === 0)).toBe(true);
  });

  it('skips a zero-length iov and fills the next one', () => {
    const mem = new Uint8Array(16);
    const n = writeToIovs(
      mem,
      [
        { buf: 0, len: 0 },
        { buf: 4, len: 3 },
      ],
      new Uint8Array([7, 8, 9]),
    );
    expect(n).toBe(3);
    expect([...mem.subarray(4, 7)]).toEqual([7, 8, 9]);
  });
});

describe('fd_read leftover model (scatter over multiple calls)', () => {
  it('carries overflow forward across fd_read calls', () => {
    const chunk = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // one stream chunk, 10 bytes
    let leftover: Uint8Array | null = chunk;

    // call 1: guest iovec capacity 4
    let mem = new Uint8Array(64);
    let n = writeToIovs(
      mem,
      [
        { buf: 0, len: 2 },
        { buf: 4, len: 2 },
      ],
      leftover!,
    );
    expect(n).toBe(4);
    expect([...mem.subarray(0, 2)]).toEqual([0, 1]);
    expect([...mem.subarray(4, 6)]).toEqual([2, 3]);
    leftover = n < leftover!.byteLength ? leftover!.subarray(n) : null;

    // call 2: capacity 4
    mem = new Uint8Array(64);
    n = writeToIovs(
      mem,
      [
        { buf: 0, len: 2 },
        { buf: 4, len: 2 },
      ],
      leftover!,
    );
    expect(n).toBe(4);
    expect([...mem.subarray(0, 2)]).toEqual([4, 5]);
    expect([...mem.subarray(4, 6)]).toEqual([6, 7]);
    leftover = n < leftover!.byteLength ? leftover!.subarray(n) : null;

    // call 3: capacity 4 but only 2 bytes remain
    mem = new Uint8Array(64);
    n = writeToIovs(
      mem,
      [
        { buf: 0, len: 2 },
        { buf: 4, len: 2 },
      ],
      leftover!,
    );
    expect(n).toBe(2);
    expect([...mem.subarray(0, 2)]).toEqual([8, 9]);
    expect([...mem.subarray(4, 6)]).toEqual([0, 0]);
    leftover = n < leftover!.byteLength ? leftover!.subarray(n) : null;
    expect(leftover).toBeNull();
  });
});
