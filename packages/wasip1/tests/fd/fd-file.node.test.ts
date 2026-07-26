import { describe, expect, it } from 'vitest';
import { FdFlags, Filetype, Result, Whence } from '../../src/consts';
import { FileFd } from '../../src/fd-file';
import { MemoryFileBackend } from '../../src/fs-mem';
import type { IovecValue } from '../../src/struct';

// A fake "wasm linear memory": one flat Uint8Array, iovecs index into it by
// offset. FileFd consumes only the raw view + decoded iovs (see NOTES.md §4).
function mem(n: number): Uint8Array {
  return new Uint8Array(n);
}
function iov(buf: number, len: number): IovecValue {
  return { buf, len };
}
function bytesAt(m: Uint8Array, off: number, n: number): number[] {
  return Array.from(m.subarray(off, off + n));
}
function fileFd(seed: number[] = []): {
  fd: FileFd;
  mem: Uint8Array;
  backend: MemoryFileBackend;
} {
  const backend = new MemoryFileBackend(new Uint8Array(seed));
  return { fd: new FileFd(backend), mem: mem(64), backend };
}

// Section order mirrors the Fd surface: identity → data I/O → cursor → size →
// flags → sync. Single-method sections use `FileFd.<method>`; multi-method or
// themed sections use `FileFd — <theme>`. A failure points straight at the
// offending op.

describe('FileFd — identity', () => {
  it('filetype is REGULAR_FILE', () => {
    expect(fileFd().fd.filetype).toBe(Filetype.REGULAR_FILE);
  });
});

describe('FileFd.read', () => {
  it('scatters into iovecs and stops at EOF (short read)', () => {
    const { fd, mem } = fileFd([10, 20, 30]);
    const dst = mem; // read into the same fake memory at distinct offsets

    const r = fd.read(dst, [iov(0, 2), iov(8, 4)]);
    expect(r).toEqual({ ok: true, n: 3 });
    expect(bytesAt(dst, 0, 2)).toEqual([10, 20]);
    expect(bytesAt(dst, 8, 1)).toEqual([30]);
    expect(fd.tell()).toEqual({ ok: true, cursor: 3 });
  });

  it('returns 0 at EOF', () => {
    const { fd, mem } = fileFd([1, 2]);
    fd.read(mem, [iov(0, 8)]); // drain
    const r = fd.read(mem, [iov(0, 8)]);
    expect(r).toEqual({ ok: true, n: 0 });
  });
});

describe('FileFd.write', () => {
  it('gathers iovecs contiguously and advances the cursor', () => {
    const { fd, mem } = fileFd();
    mem.set([1, 2, 3, 4], 0);
    mem.set([5, 6], 16);

    const r = fd.write(mem, [iov(0, 4), iov(16, 2)]);
    expect(r).toEqual({ ok: true, n: 6 });
    expect(fd.tell()).toEqual({ ok: true, cursor: 6 });
    expect(fd.statSize()).toBe(6);
  });
});

describe('FileFd.pread / pwrite — offset ops, cursor untouched', () => {
  it('pread reads at offset without moving the cursor', () => {
    const { fd, mem } = fileFd([1, 2, 3, 4, 5]);
    const r = fd.pread(mem, [iov(0, 2)], 3);
    expect(r).toEqual({ ok: true, n: 2 });
    expect(bytesAt(mem, 0, 2)).toEqual([4, 5]);
    expect(fd.tell()).toEqual({ ok: true, cursor: 0 });
  });

  it('pwrite writes at offset without moving the cursor', () => {
    const { fd, mem } = fileFd([0, 0, 0, 0]);
    mem.set([9, 9], 0);
    const r = fd.pwrite(mem, [iov(0, 2)], 2);
    expect(r).toEqual({ ok: true, n: 2 });
    expect(fd.tell()).toEqual({ ok: true, cursor: 0 });
    expect(fd.statSize()).toBe(4);
  });
});

describe('FileFd.seek', () => {
  it('SET / CUR / END', () => {
    const { fd } = fileFd([1, 2, 3, 4]);
    expect(fd.seek(2, Whence.SET)).toEqual({ ok: true, cursor: 2 });
    expect(fd.seek(1, Whence.CUR)).toEqual({ ok: true, cursor: 3 });
    expect(fd.seek(-1, Whence.END)).toEqual({ ok: true, cursor: 3 });
  });

  it('rejects negative positions with EINVAL', () => {
    const { fd } = fileFd([1, 2]);
    expect(fd.seek(-1, Whence.SET)).toEqual({ ok: false, errno: Result.EINVAL });
    expect(fd.seek(-10, Whence.CUR)).toEqual({ ok: false, errno: Result.EINVAL });
  });

  it('rejects unknown whence with EINVAL', () => {
    const { fd } = fileFd([1]);
    expect(fd.seek(0, 99)).toEqual({ ok: false, errno: Result.EINVAL });
  });
});

describe('FileFd.tell', () => {
  // fd_tell ≡ fd_seek(fd, 0, CUR) per WASI — shares SeekResult and the same
  // errno set as seek. Side-effect coverage (cursor advancing over read/write)
  // lives inline in those tests; this section covers the success branch of the
  // result type directly.
  it('returns the cursor established by seek', () => {
    const { fd } = fileFd([1, 2, 3, 4]);
    fd.seek(3, Whence.SET);
    expect(fd.tell()).toEqual({ ok: true, cursor: 3 });
  });

  it('starts at 0 on a fresh fd', () => {
    expect(fileFd().fd.tell()).toEqual({ ok: true, cursor: 0 });
  });
});

describe('FileFd.truncate', () => {
  it('grows with zero padding', () => {
    const { fd, backend } = fileFd([1, 2]);
    expect(fd.truncate(4)).toEqual({ ok: true });
    expect(fd.statSize()).toBe(4);
    expect(bytesAt(backend.bytes, 0, 4)).toEqual([1, 2, 0, 0]);
  });

  it('shrinks', () => {
    const { fd, backend } = fileFd([1, 2, 3, 4]);
    expect(fd.truncate(2)).toEqual({ ok: true });
    expect(fd.statSize()).toBe(2);
    expect(bytesAt(backend.bytes, 0, 2)).toEqual([1, 2]);
  });
});

describe('FileFd — fdflags storage', () => {
  it('setFlags / getFlags round-trip stores the full mask', () => {
    const { fd } = fileFd();
    const mask = FdFlags.APPEND | FdFlags.DSYNC | FdFlags.SYNC;
    fd.setFlags(mask);
    expect(fd.getFlags()).toBe(mask);
    expect(fd.hasFlag(FdFlags.APPEND)).toBe(true);
    expect(fd.hasFlag(FdFlags.DSYNC)).toBe(true);
    expect(fd.hasFlag(FdFlags.SYNC)).toBe(true);
    expect(fd.hasFlag(FdFlags.NONBLOCK)).toBe(false);
  });

  it('defaults to 0', () => {
    expect(fileFd().fd.getFlags()).toBe(0);
  });
});

describe('FileFd — O_APPEND (FdFlags.APPEND)', () => {
  it('write lands at EOF regardless of cursor; cursor advances to new EOF', () => {
    const { fd, mem, backend } = fileFd([1, 2, 3]); // existing 3 bytes
    fd.setFlags(FdFlags.APPEND);
    fd.seek(0, Whence.SET); // cursor at 0 — APPEND must ignore it
    mem.set([7, 7, 7, 7], 0);

    const r = fd.write(mem, [iov(0, 4)]);
    expect(r).toEqual({ ok: true, n: 4 });
    expect(fd.tell()).toEqual({ ok: true, cursor: 7 }); // 3 + 4
    expect(fd.statSize()).toBe(7);
    // existing data preserved, new bytes appended
    expect(bytesAt(backend.bytes, 0, 7)).toEqual([1, 2, 3, 7, 7, 7, 7]);
  });

  it('repeated writes each append at the (new) EOF', () => {
    const { fd, mem, backend } = fileFd([]);
    fd.setFlags(FdFlags.APPEND);
    mem.set([1], 0);
    mem.set([2], 1);
    mem.set([3], 2);

    expect(fd.write(mem, [iov(0, 1)])).toEqual({ ok: true, n: 1 });
    // seek to 0 between writes — APPEND must still go to EOF
    fd.seek(0, Whence.SET);
    expect(fd.write(mem, [iov(1, 1)])).toEqual({ ok: true, n: 1 });
    fd.seek(0, Whence.SET);
    expect(fd.write(mem, [iov(2, 1)])).toEqual({ ok: true, n: 1 });

    expect(fd.statSize()).toBe(3);
    expect(fd.tell()).toEqual({ ok: true, cursor: 3 });
    expect(bytesAt(backend.bytes, 0, 3)).toEqual([1, 2, 3]);
  });

  it('a multi-iovs gather is one contiguous append from EOF', () => {
    const { fd, mem, backend } = fileFd([9]); // 1 byte
    fd.setFlags(FdFlags.APPEND);
    mem.set([1, 2], 0);
    mem.set([3, 4, 5], 8);

    expect(fd.write(mem, [iov(0, 2), iov(8, 3)])).toEqual({ ok: true, n: 5 });
    expect(fd.statSize()).toBe(6);
    expect(bytesAt(backend.bytes, 0, 6)).toEqual([9, 1, 2, 3, 4, 5]);
  });

  it('pwrite ignores APPEND — offset semantics win', () => {
    const { fd, mem, backend } = fileFd([0, 0, 0, 0]);
    fd.setFlags(FdFlags.APPEND);
    mem.set([7], 0);

    const r = fd.pwrite(mem, [iov(0, 1)], 2);
    expect(r).toEqual({ ok: true, n: 1 });
    // byte written at offset 2, not appended (size stays 4, no grow)
    expect(fd.statSize()).toBe(4);
    expect(bytesAt(backend.bytes, 0, 4)).toEqual([0, 0, 7, 0]);
  });

  it('clearing APPEND restores cursor-based writes', () => {
    const { fd, mem, backend } = fileFd([1, 2]);
    fd.setFlags(FdFlags.APPEND);
    fd.setFlags(0); // clear all flags
    expect(fd.hasFlag(FdFlags.APPEND)).toBe(false);

    fd.seek(0, Whence.SET);
    mem.set([8], 0);
    expect(fd.write(mem, [iov(0, 1)])).toEqual({ ok: true, n: 1 });
    // overwrote byte 0 (cursor-based), no append
    expect(fd.statSize()).toBe(2);
    expect(bytesAt(backend.bytes, 0, 2)).toEqual([8, 2]);
  });
});

describe('FileFd — sync / datasync (in-memory no-ops)', () => {
  it('sync does not throw', () => {
    const { fd } = fileFd([1, 2]);
    expect(() => fd.sync()).not.toThrow();
  });

  it('datasync does not throw', () => {
    const { fd } = fileFd([1, 2]);
    expect(() => fd.datasync()).not.toThrow();
  });
});
