// WASI file descriptor abstraction. Fd is a vtable of safe defaults: every
// operation throws UnsupportedError unless a subclass overrides it, so a concrete
// fd (file, pipe, ...) implements only the operations it supports.
//
// Sync-vs-async policy:
// - read/write/pread/pwrite return a union. Sync fds (files) return a bare
//   result; async fds (pipes) return a Promise — sync returns skip suspension.
// - seek/tell/statSize/readdir/etc. are always sync — they touch only cursor
//   state or in-memory snapshots.
// - readySignal is always async (returns Promise) — only pipes ever override
//   it; the default resolves immediately, so files never block poll.

import type { DirEntry } from './fs';
import type { IovecValue } from './struct';

export type ReadResult = { ok: true; n: number } | { ok: false; errno: number };
export type WriteResult = { ok: true; n: number } | { ok: false; errno: number };
export type SeekResult = { ok: true; cursor: number } | { ok: false; errno: number };

export abstract class Fd {
  /** WASI filetype constant (e.g. REGULAR_FILE, CHARACTER_DEVICE). */
  abstract readonly filetype: number;

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
  truncate(_size: number): void {
    throw new UnsupportedError('truncate');
  }

  /** Reposition the cursor by `offset` relative to `whence` (SET/CUR/END). */
  seek(_offset: number, _whence: number): SeekResult {
    throw new UnsupportedError('seek');
  }

  /** Current cursor position. */
  tell(): number {
    throw new UnsupportedError('tell');
  }

  /** Snapshot of directory entries (sorted by name); index is the fd_readdir cookie. */
  readdir(): readonly DirEntry[] {
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

  /** Set the nonblocking flag. Default: no-op. */
  setNonblocking(_nb: boolean): void {}

  /** Nonblocking flag. Default: false. */
  getNonblocking(): boolean {
    return false;
  }

  /** Whether `type` (FD_READ/FD_WRITE) can proceed without blocking. Default: false. */
  isReady(_type: number): boolean {
    return false;
  }

  /** Resolves when the fd becomes ready for `type`; resolves immediately if already ready.
   *  Default: resolves immediately — files are always ready, only pipes wait. */
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
