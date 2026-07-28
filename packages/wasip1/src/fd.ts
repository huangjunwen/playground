// WASI file descriptor abstraction. Fd is a vtable of safe defaults: every
// operation throws UnsupportedError unless a subclass overrides it, so a concrete
// fd implements only the operations it supports.
//
// Sync-vs-async policy:
// - read/write/pread/pwrite return a union — a bare result when the op is
//   synchronous, a Promise when it may suspend.
// - seek/tell/statSize/readdir/etc. are always synchronous — they touch only
//   cursor or snapshot state.
// - readySignal is always async (returns Promise); the default resolves
//   immediately.

import type { DirEntry } from './fs';
import type { IovecValue } from './struct';

export type ReadResult = { ok: true; n: number } | { ok: false; errno: number };
export type WriteResult = { ok: true; n: number } | { ok: false; errno: number };
export type SeekResult = { ok: true; cursor: number } | { ok: false; errno: number };
export type TruncateResult = { ok: true } | { ok: false; errno: number };
export type ReaddirResult =
  | { ok: true; entries: readonly DirEntry[] }
  | { ok: false; errno: number };

export abstract class Fd {
  /** WASI filetype constant (e.g. REGULAR_FILE, CHARACTER_DEVICE). */
  abstract readonly filetype: number;

  /** Runtime fd flags — a `FdFlags` bitmask set via `setFlags`. Default 0. */
  private flags = 0;

  /** Scatter-read up to the iovecs' total capacity into `mem`'s iovec buffers.
   *  Returns `{ ok, n }` (n may be 0 at EOF). */
  read(_mem: Uint8Array, _iovs: IovecValue[]): ReadResult | Promise<ReadResult> {
    throw new UnsupportedError('read');
  }

  /** Gather-write from `mem`'s iovec buffers. Returns `{ ok, n }` — bytes accepted. */
  write(_mem: Uint8Array, _iovs: IovecValue[]): WriteResult | Promise<WriteResult> {
    throw new UnsupportedError('write');
  }

  /** Scatter-read up to the iovecs' total capacity starting at `offset`, without
   *  moving the cursor. Returns `{ ok, n }` (n may be 0 at EOF). */
  pread(_mem: Uint8Array, _iovs: IovecValue[], _offset: number): ReadResult | Promise<ReadResult> {
    throw new UnsupportedError('pread');
  }

  /** Gather-write from `mem`'s iovec buffers at `offset`, without moving the
   *  cursor. Returns `{ ok, n }` — bytes accepted. */
  pwrite(
    _mem: Uint8Array,
    _iovs: IovecValue[],
    _offset: number,
  ): WriteResult | Promise<WriteResult> {
    throw new UnsupportedError('pwrite');
  }

  /** Set the underlying store to exactly `size` bytes (truncate or extend). */
  truncate(_size: number): TruncateResult {
    throw new UnsupportedError('truncate');
  }

  /** Reposition the cursor by `offset` relative to `whence` (SET/CUR/END). */
  seek(_offset: number, _whence: number): SeekResult {
    throw new UnsupportedError('seek');
  }

  /** Current cursor position. WASI defines `fd_tell` as `fd_seek(fd, 0, CUR)`,
   *  so it shares `SeekResult` and the same errno set as `seek`. */
  tell(): SeekResult {
    throw new UnsupportedError('tell');
  }

  /** Flush data and metadata to stable storage. Maps from WASI `fd_sync`.
   *  Default: no-op. */
  sync(): void {}

  /** Flush data only. Maps from WASI `fd_datasync`. Default: no-op. */
  datasync(): void {}

  /** Snapshot of directory entries (sorted by name); index is the fd_readdir cookie.
   *  Non-directory fds return `{ ok: false, errno: ENOTDIR }`. */
  readdir(): ReaddirResult {
    throw new UnsupportedError('readdir');
  }

  /** Bytes readable without blocking. Default: 0. */
  availableBytes(): number {
    return 0;
  }

  /** File size in bytes. Default: 0. */
  statSize(): number {
    return 0;
  }

  /** Set this fd's runtime flags (a `FdFlags` bitmask): APPEND/NONBLOCK/DSYNC/
   *  RSYNC/SYNC. These are the per-fd, mutable flags — set at open AND
   *  changeable afterward (WASI `fd_fdstat_set_flags`). Default stores the
   *  value; override to react to a change.
   *
   *  The open-time flags (`oflags`: CREAT/TRUNC/...) are a separate type,
   *  consumed once by `Vfs.open` and not kept as fd state — see `OpenFlags`. */
  setFlags(flags: number): void {
    this.flags = flags;
  }

  /** Current `FdFlags` bitmask. */
  getFlags(): number {
    return this.flags;
  }

  /** True iff `flag` (a single `FdFlags` bit) is currently set. */
  hasFlag(flag: number): boolean {
    return (this.flags & flag) !== 0;
  }

  /** Whether `type` (FD_READ/FD_WRITE) can proceed without blocking. Default: false. */
  isReady(_type: number): boolean {
    return false;
  }

  /** Resolves when the fd becomes ready for `type`; resolves immediately if already ready.
   *  Default: resolves immediately. */
  readySignal(_type: number): Promise<void> {
    return Promise.resolve();
  }

  /** Release resources. Default: no-op. */
  close(): void {}
}

/** Thrown by the default Fd operations; subclasses override an op to support it. */
export class UnsupportedError extends Error {
  constructor(readonly method: string) {
    super(`Fd.${method} not supported`);
    this.name = 'UnsupportedError';
  }
}
