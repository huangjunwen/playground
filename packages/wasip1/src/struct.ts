// WASI Preview 1 fixed-layout ABI structs over wasm linear memory.
//
// Each struct owns its byte layout (size + field offsets) and exposes a value
// codec: `Struct.from(mem, ptr)` decodes guest memory into a plain value object;
// `Struct.write(mem, ptr, value)` encodes a plain value back. Codecs are
// stateless — they never hold the memory snapshot
//
// `Mem` is the shared little-endian accessor bound to one getMem() snapshot: it
// caches the DataView once and adds byte/string helpers.
//
// ABI reference: wasi-libc `libc-bottom-half/headers/public/wasi/wasip1.h`
// (mirrors wasi_snapshot_preview1.witx). Field offsets track its offsetof()
// _Static_asserts; sizes track its sizeof() asserts.

import { EVENTTYPE, SUBSCRIPTION_CLOCK_ABSTIME } from './consts';

/** Little-endian view over one wasm-memory snapshot.
 *
 *  Two accessor families — pick by how the caller should react to a bad range:
 *    1. default (no suffix): out-of-bounds throws RangeError (≈ a trap). Writes
 *       validate the full target range up front, so a throw never leaves a
 *       partial write behind (DataView setters and `Uint8Array.set` both check
 *       before mutating).
 *    2. `B` suffix (bounded): out-of-bounds is silently clamped — `subarray`/
 *       `fill` shorten/no-op, and the `B` writes copy only the prefix that fits
 *       in the valid tail. Use for offsets you computed yourself, or when the
 *       caller clamps first.
 *
 *  For an untrusted guest `ptr+len` (e.g. WASI path arguments) wrap a default
 *  accessor in try/catch and map the RangeError to EINVAL. */
export class Mem {
  readonly dv: DataView;

  constructor(readonly raw: Uint8Array) {
    this.dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  }

  // (1) default — OOB throws RangeError (≈ trap)
  u8(o: number): number {
    return this.dv.getUint8(o);
  }
  u16(o: number): number {
    return this.dv.getUint16(o, true);
  }
  u32(o: number): number {
    return this.dv.getUint32(o, true);
  }
  u64(o: number): bigint {
    return this.dv.getBigUint64(o, true);
  }

  setU8(o: number, v: number): void {
    this.dv.setUint8(o, v);
  }
  setU16(o: number, v: number): void {
    this.dv.setUint16(o, v, true);
  }
  setU32(o: number, v: number): void {
    this.dv.setUint32(o, v, true);
  }
  setU64(o: number, v: bigint): void {
    this.dv.setBigUint64(o, v, true);
  }

  #assert(o: number, n: number): void {
    if (o < 0 || n < 0 || o > this.raw.byteLength || o + n > this.raw.byteLength)
      throw new RangeError(`mem [${o}, ${o + n}) out of bounds (len=${this.raw.byteLength})`);
  }

  /** Zero `n` bytes at `o` (pads / unused fields → no guest-memory leak). */
  zero(o: number, n: number): void {
    this.#assert(o, n);
    this.raw.fill(0, o, o + n);
  }

  /** View `n` bytes at `o` (no copy). */
  bytes(o: number, n: number): Uint8Array {
    this.#assert(o, n);
    return this.raw.subarray(o, o + n);
  }

  /** Decode `n` bytes at `o` as UTF-8 (WASI paths are ptr+len, not NUL-terminated). */
  utf8(o: number, n: number): string {
    return DECODER.decode(this.bytes(o, n));
  }

  /** Copy all of `src` into memory at `o`; returns bytes written (= src.length). */
  writeBytes(o: number, src: Uint8Array): number {
    this.raw.set(src, o);
    return src.length;
  }

  /** Encode `str` to UTF-8 at `o` (no NUL terminator). Returns `[utf16CodeUnits,
   *  utf8Bytes]` written. */
  writeUtf8(o: number, str: string): [number, number] {
    const b = ENCODER.encode(str);
    this.raw.set(b, o);
    return [str.length, b.length];
  }

  // (2) `B` suffix — bounded: OOB silently clamps; self-computed offsets only

  /** Zero `n` bytes at `o`; clamps to the valid range. */
  zeroB(o: number, n: number): void {
    this.raw.fill(0, o, o + n);
  }

  /** View `n` bytes at `o` (no copy); OOB clamps to a shorter/empty view. */
  bytesB(o: number, n: number): Uint8Array {
    return this.raw.subarray(o, o + n);
  }

  /** Decode `n` bytes at `o` as UTF-8; OOB clamps the range. */
  utf8B(o: number, n: number): string {
    return DECODER.decode(this.raw.subarray(o, o + n));
  }

  /** Copy `src` into memory at `o`, stopping at the buffer end; returns bytes written. */
  writeBytesB(o: number, src: Uint8Array): number {
    const b = this.raw.subarray(o, o + src.length);
    b.set(src.subarray(0, b.length));
    return b.length;
  }

  /** Encode `str` to UTF-8 at `o`, stopping at the buffer end. Returns
   *  `[utf16CodeUnits, utf8Bytes]` written. */
  writeUtf8B(o: number, str: string): [number, number] {
    const r = ENCODER.encodeInto(str, this.raw.subarray(o));
    return [r.read, r.written];
  }
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// ---- ciovec (8B, read-only) ----
// { u32 buf; u32 buf_len } — one scatter/gather vector. The guest prepares an
// array of these for fd_read/write; the host decodes it and never writes one back.
export interface IovecValue {
  buf: number;
  len: number;
}

export const Iovec = {
  SIZE: 8,

  from(mem: Mem, ptr: number): IovecValue {
    return { buf: mem.u32(ptr), len: mem.u32(ptr + 4) };
  },

  /** Decode `count` ciovecs starting at `ptr` (the fd_read/write iovec table). */
  fromArray(mem: Mem, ptr: number, count: number): IovecValue[] {
    const out: IovecValue[] = [];
    for (let i = 0; i < count; i++) out.push(Iovec.from(mem, ptr + i * Iovec.SIZE));
    return out;
  },
} as const;

// ---- prestat (8B, write-only) ----
// { u8 tag; u8[3] pad; u32 pr_name_len } — describes a preopened directory.
export interface PrestatValue {
  tag: number;
  nameLen: number;
}

export const Prestat = {
  SIZE: 8,

  write(mem: Mem, ptr: number, v: PrestatValue): void {
    mem.zero(ptr, Prestat.SIZE);
    mem.setU8(ptr, v.tag);
    mem.setU32(ptr + 4, v.nameLen);
  },
} as const;

// ---- fdstat (24B, write-only) ----
// { u8 filetype; u8 pad; u16 fdflags; u32 pad; u64 rights_base; u64 rights_inheriting }
export interface FdstatValue {
  filetype: number;
  fdflags: number;
  rightsBase: bigint;
  rightsInheriting: bigint;
}

export const Fdstat = {
  SIZE: 24,

  write(mem: Mem, ptr: number, v: FdstatValue): void {
    mem.zero(ptr, Fdstat.SIZE);
    mem.setU8(ptr, v.filetype);
    mem.setU16(ptr + 2, v.fdflags);
    mem.setU64(ptr + 8, v.rightsBase);
    mem.setU64(ptr + 16, v.rightsInheriting);
  },
} as const;

// ---- filestat (64B, write-only) ----
// { u64 dev; u64 ino; u8 filetype; u8[7] pad; u64 nlink; u64 size; u64 atim; u64 mtim; u64 ctim }
// dev/ino are left 0 — this host has no real device/inode numbers.
export interface FilestatValue {
  filetype: number;
  size: bigint;
  /** default 1n */
  nlink?: bigint;
  /** default 0n */
  atim?: bigint;
  /** default 0n */
  mtim?: bigint;
  /** default 0n */
  ctim?: bigint;
}

export const Filestat = {
  SIZE: 64,

  write(mem: Mem, ptr: number, v: FilestatValue): void {
    const { filetype, size, nlink = 1n, atim = 0n, mtim = 0n, ctim = 0n } = v;
    mem.zero(ptr, Filestat.SIZE);
    mem.setU8(ptr + 16, filetype);
    mem.setU64(ptr + 24, nlink);
    mem.setU64(ptr + 32, size);
    mem.setU64(ptr + 40, atim);
    mem.setU64(ptr + 48, mtim);
    mem.setU64(ptr + 56, ctim);
  },
} as const;

// ---- dirent (24B header + variable-length name, write-only) ----
// { u64 d_next; u64 d_ino; u32 d_namlen; u8 d_type; u8[3] pad; char d_name[] }
// Variable-length: total = HEADER + name length. d_namlen is derived from the
// name bytes, so it is not in the value.
export interface DirentValue {
  next: bigint;
  ino: bigint;
  type: number;
  nameBytes: Uint8Array;
}

export const Dirent = {
  HEADER: 24,

  /** Bytes one dirent occupies given a name of `nameLen` bytes (for buffer-fit checks). */
  sizeOf(nameLen: number): number {
    return Dirent.HEADER + nameLen;
  },

  write(mem: Mem, ptr: number, v: DirentValue): void {
    mem.zero(ptr, Dirent.HEADER);
    mem.setU64(ptr + 0, v.next);
    mem.setU64(ptr + 8, v.ino);
    mem.setU32(ptr + 16, v.nameBytes.length);
    mem.setU8(ptr + 20, v.type);
    mem.writeBytes(ptr + 24, v.nameBytes);
  },
} as const;

// ---- subscription (48B, read-only) ----
// { u64 userdata; u8 type; u8[7] pad; union subscription_u @16 }
//   clock:    { u32 id @16; u32 pad; u64 timeout @24; u64 precision @32; u16 flags @40 }
//   fd_*:     { u32 fd @16 }
export type SubscriptionValue =
  | {
      userdata: bigint;
      type: typeof EVENTTYPE.CLOCK;
      clockId: number;
      timeoutNs: bigint;
      absolute: boolean;
    }
  | {
      userdata: bigint;
      type: typeof EVENTTYPE.FD_READ | typeof EVENTTYPE.FD_WRITE;
      fd: number;
    };

export const Subscription = {
  SIZE: 48,

  from(mem: Mem, ptr: number): SubscriptionValue {
    const userdata = mem.u64(ptr);
    const type = mem.u8(ptr + 8);
    if (type === EVENTTYPE.CLOCK) {
      return {
        userdata,
        type,
        clockId: mem.u32(ptr + 16),
        timeoutNs: mem.u64(ptr + 24),
        absolute: (mem.u16(ptr + 40) & SUBSCRIPTION_CLOCK_ABSTIME) !== 0,
      };
    }
    // Non-clock subscriptions are fd_read/fd_write (the only other valid WASI
    // event types); a malformed guest byte is UB and still flows as an fd sub.
    return {
      userdata,
      type: type as typeof EVENTTYPE.FD_READ | typeof EVENTTYPE.FD_WRITE,
      fd: mem.u32(ptr + 16),
    };
  },
} as const;

// ---- event (32B, write-only) ----
// { u64 userdata; u16 errno; u8 type; u8[5] pad; fd_readwrite { u64 nbytes; u16 flags; u8[6] pad } }
export interface EventValue {
  userdata: bigint;
  errno: number;
  type: number;
  nbytes: bigint;
  /** eventrwflags (event.fd_readwrite.flags); default 0. Set EVENTRWFLAGS_FD_READWRITE_HANGUP to signal the peer closed. */
  flags?: number;
}

export const Event = {
  SIZE: 32,

  write(mem: Mem, ptr: number, v: EventValue): void {
    mem.zero(ptr, Event.SIZE);
    mem.setU64(ptr + 0, v.userdata);
    mem.setU16(ptr + 8, v.errno);
    mem.setU8(ptr + 10, v.type);
    mem.setU64(ptr + 16, v.nbytes);
    mem.setU16(ptr + 24, v.flags ?? 0);
  },
} as const;
