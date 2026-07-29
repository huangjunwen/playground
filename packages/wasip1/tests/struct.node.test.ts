// Unit tests for src/struct.ts: the `Mem` accessor (a little-endian view over
// one wasm-memory snapshot, with throw/clamp OOB tiers) and the fixed-layout
// WASI p1 struct codecs (Iovec/Prestat/Fdstat/Filestat/Dirent/Subscription/
// Event). Verifies little-endian field offsets against the ABI (wasip1.h),
// zero-padding of unused bytes on write, and the OOB behavior of each Mem
// family

import { describe, expect, it } from 'vitest';
import { EVENTTYPE, SUBSCRIPTION_CLOCK_ABSTIME } from '../src/consts';
import {
  Dirent,
  Event,
  Fdstat,
  Filestat,
  Iovec,
  Mem,
  Prestat,
  Subscription,
  type SubscriptionValue,
} from '../src/struct';

/** A zeroed Mem of n bytes. */
function mem(n: number): Mem {
  return new Mem(new Uint8Array(n));
}

/** A Mem of n bytes pre-filled with 0xff, to detect pad/leak on write. */
function dirty(n: number): Mem {
  const m = mem(n);
  m.raw.fill(0xff);
  return m;
}

type ClockSub = Extract<SubscriptionValue, { type: typeof EVENTTYPE.CLOCK }>;
type FdSub = Extract<
  SubscriptionValue,
  { type: typeof EVENTTYPE.FD_READ | typeof EVENTTYPE.FD_WRITE }
>;

describe('Mem — little-endian scalar access', () => {
  it('round-trips u8/u16/u32 at their natural offsets', () => {
    const m = mem(16);
    m.setU8(0, 0xab);
    m.setU16(1, 0x0102);
    m.setU32(3, 0x03040506);
    expect(m.u8(0)).toBe(0xab);
    expect(m.u16(1)).toBe(0x0102);
    expect(m.u32(3)).toBe(0x03040506);
  });

  it('round-trips u64 as bigint (little-endian, LSB first)', () => {
    const m = mem(8);
    m.setU64(0, 0x0102030405060708n);
    expect(m.u64(0)).toBe(0x0102030405060708n);
    expect([...m.raw]).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('is built over a sub-view (byteOffset/byteLength honored)', () => {
    const back = new Uint8Array(16);
    const m = new Mem(back.subarray(4, 12)); // 8-byte view at offset 4
    m.setU32(0, 0x01020304);
    expect(m.u32(0)).toBe(0x01020304);
    expect([...back.subarray(4, 8)]).toEqual([4, 3, 2, 1]); // landed at the view's offset
    expect(() => m.u32(6)).toThrow(RangeError); // bounds are relative to the 8-byte view
  });
});

describe('Mem — byte/string helpers', () => {
  it('zero writes n zero bytes', () => {
    const m = dirty(8);
    m.zero(2, 4);
    expect([...m.raw]).toEqual([0xff, 0xff, 0, 0, 0, 0, 0xff, 0xff]);
  });

  it('bytes returns a live aliasing view (no copy)', () => {
    const m = mem(4);
    const view = m.bytes(0, 4);
    view[0] = 42;
    expect(m.raw[0]).toBe(42);
  });

  it('utf8 round-trips multi-byte text', () => {
    const s = 'héllo 🌍'; // 2-byte (é) and 4-byte (🌍) sequences
    const m = mem(s.length * 4);
    const [, n] = m.writeUtf8(0, s);
    expect(m.utf8(0, n)).toBe(s);
  });

  it('writeBytes copies src and returns its length', () => {
    const m = mem(4);
    const n = m.writeBytes(0, new Uint8Array([7, 8, 9]));
    expect(n).toBe(3);
    expect([...m.raw]).toEqual([7, 8, 9, 0]);
  });

  it('writeUtf8 returns [utf16 code units, utf8 bytes]', () => {
    const m = mem(16);
    const [units, bytes] = m.writeUtf8(0, 'é'); // 1 utf16 unit, 2 utf8 bytes
    expect(units).toBe(1);
    expect(bytes).toBe(2);
    expect([...m.raw.subarray(0, 2)]).toEqual([0xc3, 0xa9]);
  });
});

describe('Mem — tier 1 (default): OOB throws RangeError', () => {
  it('scalar setters throw out of bounds (exact fit is allowed)', () => {
    const m = mem(4);
    expect(() => m.setU8(4, 0)).toThrow(RangeError);
    expect(() => m.setU16(3, 0)).toThrow(RangeError);
    expect(() => m.setU32(0, 0)).not.toThrow();
    expect(() => m.setU32(1, 0)).toThrow(RangeError);
    expect(() => m.setU64(0, 0n)).toThrow(RangeError);
  });

  it('scalar getters throw out of bounds', () => {
    const m = mem(4);
    expect(() => m.u8(4)).toThrow(RangeError);
    expect(() => m.u16(3)).toThrow(RangeError);
    expect(() => m.u32(0)).not.toThrow();
    expect(() => m.u64(0)).toThrow(RangeError);
  });

  it('zero/bytes/utf8 throw out of bounds', () => {
    const m = mem(4);
    expect(() => m.zero(2, 4)).toThrow(RangeError);
    expect(() => m.bytes(2, 4)).toThrow(RangeError);
    expect(() => m.utf8(2, 4)).toThrow(RangeError);
    expect(() => m.bytes(0, 4)).not.toThrow();
  });

  it('writeBytes/writeUtf8 throw out of bounds', () => {
    const m = mem(4);
    expect(() => m.writeBytes(0, new Uint8Array(5))).toThrow(RangeError);
    expect(() => m.writeUtf8(0, 'xxxxx')).toThrow(RangeError); // 5 bytes > 4
    expect(() => m.writeBytes(0, new Uint8Array(4))).not.toThrow();
  });

  it('writeBytes is atomic: a partially-OOB write leaves the target untouched', () => {
    const m = dirty(4);
    expect(() => m.writeBytes(2, new Uint8Array([1, 2, 3, 4]))).toThrow(RangeError);
    expect([...m.raw]).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  it('writeUtf8 is atomic: a partially-OOB write leaves the target untouched', () => {
    const m = dirty(4);
    expect(() => m.writeUtf8(2, 'abcd')).toThrow(RangeError); // 4 bytes at [2,6)
    expect([...m.raw]).toEqual([0xff, 0xff, 0xff, 0xff]);
  });
});

describe('Mem — tier 2 (B suffix): OOB silently clamps', () => {
  it('zeroB/bytesB clamp to the valid tail', () => {
    const m = dirty(4);
    m.zeroB(2, 10); // clamps to [2,4)
    expect([...m.raw]).toEqual([0xff, 0xff, 0, 0]);
    expect([...m.bytesB(2, 10)]).toEqual([0, 0]);
    expect([...m.bytesB(10, 4)]).toEqual([]); // entirely past end → empty
  });

  it('utf8B clamps the range without throwing', () => {
    const m = mem(4);
    m.writeBytes(0, new Uint8Array([0x41, 0x42, 0x43, 0x44])); // 'ABCD'
    expect(m.utf8B(0, 100)).toBe('ABCD');
    expect(m.utf8B(2, 100)).toBe('CD');
  });

  it('writeBytesB copies only the prefix that fits', () => {
    const m = mem(4);
    const n = m.writeBytesB(2, new Uint8Array([1, 2, 3, 4, 5])); // dest [2,4) = 2 bytes
    expect(n).toBe(2);
    expect([...m.raw]).toEqual([0, 0, 1, 2]);
  });

  it('writeUtf8B stops at the buffer end (encodeInto)', () => {
    const m = mem(4);
    const [read, written] = m.writeUtf8B(0, 'ABCDEFGH'); // dest = 4 bytes
    expect(read).toBe(4);
    expect(written).toBe(4);
    expect([...m.raw]).toEqual([0x41, 0x42, 0x43, 0x44]); // 'ABCD'
  });
});

describe('Iovec (ciovec, 8B, read-only)', () => {
  it('SIZE === 8', () => {
    expect(Iovec.SIZE).toBe(8);
  });

  it('from decodes buf@0 and len@4 little-endian', () => {
    const m = mem(16);
    m.setU32(0, 0x100);
    m.setU32(4, 0x003);
    expect(Iovec.from(m, 0)).toEqual({ buf: 0x100, len: 3 });
  });

  it('fromArray decodes a table of count vectors at stride SIZE', () => {
    const m = mem(24);
    m.setU32(0, 10);
    m.setU32(4, 1);
    m.setU32(8, 20);
    m.setU32(12, 2);
    m.setU32(16, 30);
    m.setU32(20, 3);
    expect(Iovec.fromArray(m, 0, 3)).toEqual([
      { buf: 10, len: 1 },
      { buf: 20, len: 2 },
      { buf: 30, len: 3 },
    ]);
  });

  it('fromArray returns [] for count 0', () => {
    expect(Iovec.fromArray(mem(8), 0, 0)).toEqual([]);
  });
});

describe('Prestat (8B, write-only)', () => {
  it('SIZE === 8', () => {
    expect(Prestat.SIZE).toBe(8);
  });

  it('write lays out tag@0 (u8) and nameLen@4 (u32)', () => {
    const m = mem(8);
    Prestat.write(m, 0, { tag: 0, nameLen: 5 });
    expect(m.u8(0)).toBe(0);
    expect(m.u32(4)).toBe(5);
  });

  it('write zeroes the pad bytes @1..3 (no guest-memory leak)', () => {
    const m = dirty(8);
    Prestat.write(m, 0, { tag: 0, nameLen: 5 });
    expect([...m.raw]).toEqual([0, 0, 0, 0, 5, 0, 0, 0]);
  });
});

describe('Fdstat (24B, write-only)', () => {
  it('SIZE === 24', () => {
    expect(Fdstat.SIZE).toBe(24);
  });

  it('write lays out filetype@0, fdflags@2, rightsBase@8, rightsInheriting@16', () => {
    const m = mem(24);
    Fdstat.write(m, 0, {
      filetype: 4,
      fdflags: 0b10000,
      rightsBase: 0x100n,
      rightsInheriting: 0x200n,
    });
    expect(m.u8(0)).toBe(4);
    expect(m.u16(2)).toBe(0b10000);
    expect(m.u64(8)).toBe(0x100n);
    expect(m.u64(16)).toBe(0x200n);
  });

  it('write zeroes the pad bytes @1 and @4..7', () => {
    const m = dirty(24);
    Fdstat.write(m, 0, {
      filetype: 4,
      fdflags: 0,
      rightsBase: 0n,
      rightsInheriting: 0n,
    });
    expect(m.raw[1]).toBe(0);
    expect([...m.raw.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
  });
});

describe('Filestat (64B, write-only)', () => {
  it('SIZE === 64', () => {
    expect(Filestat.SIZE).toBe(64);
  });

  it('write lays out filetype@16, nlink@24, size@32, atim@40, mtim@48, ctim@56', () => {
    const m = mem(64);
    Filestat.write(m, 0, {
      filetype: 4,
      size: 0xdeadn,
      nlink: 7n,
      atim: 1n,
      mtim: 2n,
      ctim: 3n,
    });
    expect(m.u8(16)).toBe(4);
    expect(m.u64(24)).toBe(7n);
    expect(m.u64(32)).toBe(0xdeadn);
    expect(m.u64(40)).toBe(1n);
    expect(m.u64(48)).toBe(2n);
    expect(m.u64(56)).toBe(3n);
  });

  it('leaves dev@0 and ino@8 at 0 (no real device/inode)', () => {
    const m = dirty(64);
    Filestat.write(m, 0, { filetype: 4, size: 0n });
    expect(m.u64(0)).toBe(0n);
    expect(m.u64(8)).toBe(0n);
  });

  it('defaults nlink=1n and atim/mtim/ctim=0n when omitted', () => {
    const m = mem(64);
    Filestat.write(m, 0, { filetype: 4, size: 0n });
    expect(m.u64(24)).toBe(1n);
    expect(m.u64(40)).toBe(0n);
    expect(m.u64(48)).toBe(0n);
    expect(m.u64(56)).toBe(0n);
  });

  it('zeroes the full 64 bytes first (pad @17..23 cleaned)', () => {
    const m = dirty(64);
    Filestat.write(m, 0, { filetype: 4, size: 0n });
    expect([...m.raw.subarray(17, 24)]).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('Dirent (24B header + varlen name, write-only)', () => {
  it('HEADER === 24', () => {
    expect(Dirent.HEADER).toBe(24);
  });

  it('sizeOf(nameLen) = HEADER + nameLen', () => {
    expect(Dirent.sizeOf(0)).toBe(24);
    expect(Dirent.sizeOf(5)).toBe(29);
  });

  it('write lays out next@0, ino@8, namlen@16 (derived), type@20, name@24', () => {
    const m = mem(32);
    Dirent.write(m, 0, {
      next: 1n,
      ino: 0xabcn,
      type: 4,
      nameBytes: new Uint8Array([0x66, 0x6f, 0x6f]), // 'foo'
    });
    expect(m.u64(0)).toBe(1n);
    expect(m.u64(8)).toBe(0xabcn);
    expect(m.u32(16)).toBe(3); // derived from nameBytes.length
    expect(m.u8(20)).toBe(4);
    expect([...m.bytes(24, 3)]).toEqual([0x66, 0x6f, 0x6f]);
  });

  it('write zeroes the pad @21..23', () => {
    const m = dirty(32);
    Dirent.write(m, 0, {
      next: 0n,
      ino: 0n,
      type: 0,
      nameBytes: new Uint8Array([1]),
    });
    expect([...m.raw.subarray(21, 24)]).toEqual([0, 0, 0]);
  });
});

describe('Subscription (48B, read-only)', () => {
  it('SIZE === 48', () => {
    expect(Subscription.SIZE).toBe(48);
  });

  it('from decodes a CLOCK subscription: id@16, timeout@24, absolute from flags@40', () => {
    const m = mem(48);
    m.setU64(0, 42n);
    m.setU8(8, EVENTTYPE.CLOCK);
    m.setU32(16, 1); // CLOCKID.MONOTONIC
    m.setU64(24, 1000n); // timeout
    m.setU16(40, SUBSCRIPTION_CLOCK_ABSTIME); // flags → absolute

    const sub = Subscription.from(m, 0) as ClockSub;
    expect(sub.type).toBe(EVENTTYPE.CLOCK);
    expect(sub.userdata).toBe(42n);
    expect(sub.clockId).toBe(1);
    expect(sub.timeoutNs).toBe(1000n);
    expect(sub.absolute).toBe(true);
  });

  it('reads ABSTIME from flags@40, not precision@32 (@32 is precision, not flags)', () => {
    const m = mem(48);
    m.setU8(8, EVENTTYPE.CLOCK);
    m.setU64(32, 0xffffn); // precision garbage — must NOT be read as flags
    m.setU16(40, 0); // flags clear → relative
    expect((Subscription.from(m, 0) as ClockSub).absolute).toBe(false);

    m.setU16(40, SUBSCRIPTION_CLOCK_ABSTIME); // flags set, precision garbage still ignored
    expect((Subscription.from(m, 0) as ClockSub).absolute).toBe(true);
  });

  it('from decodes an FD_READ subscription with fd read as u32@16 (not u64)', () => {
    const m = mem(48);
    m.setU8(8, EVENTTYPE.FD_READ);
    m.setU32(16, 7); // fd
    m.setU32(20, 0xffffffff); // upper-4-byte garbage — must not corrupt fd
    const sub = Subscription.from(m, 0) as FdSub;
    expect(sub.type).toBe(EVENTTYPE.FD_READ);
    expect(sub.fd).toBe(7);
  });

  it('from decodes an FD_WRITE subscription', () => {
    const m = mem(48);
    m.setU8(8, EVENTTYPE.FD_WRITE);
    m.setU32(16, 9);
    const sub = Subscription.from(m, 0) as FdSub;
    expect(sub.type).toBe(EVENTTYPE.FD_WRITE);
    expect(sub.fd).toBe(9);
  });
});

describe('Event (32B, write-only)', () => {
  it('SIZE === 32', () => {
    expect(Event.SIZE).toBe(32);
  });

  it('write lays out userdata@0, errno@8, type@10, nbytes@16, flags@24', () => {
    const m = mem(32);
    Event.write(m, 0, {
      userdata: 1n,
      errno: 8,
      type: EVENTTYPE.FD_READ,
      nbytes: 100n,
      flags: 1,
    });
    expect(m.u64(0)).toBe(1n);
    expect(m.u16(8)).toBe(8);
    expect(m.u8(10)).toBe(EVENTTYPE.FD_READ);
    expect(m.u64(16)).toBe(100n);
    expect(m.u16(24)).toBe(1); // fd_readwrite.flags @24, independent of nbytes@16
  });

  it('flags defaults to 0 when omitted', () => {
    const m = mem(32);
    Event.write(m, 0, {
      userdata: 0n,
      errno: 0,
      type: EVENTTYPE.CLOCK,
      nbytes: 0n,
    });
    expect(m.u16(24)).toBe(0);
  });

  it('write zeroes the full 32 bytes first (pad @11..15 and @26..31 cleaned)', () => {
    const m = dirty(32);
    Event.write(m, 0, {
      userdata: 0n,
      errno: 1,
      type: 1,
      nbytes: 0n,
      flags: 0,
    });
    expect([...m.raw.subarray(11, 16)]).toEqual([0, 0, 0, 0, 0]);
    expect([...m.raw.subarray(26, 32)]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
