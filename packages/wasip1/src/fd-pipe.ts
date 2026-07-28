// Pipe read/write ends over IPC stream primitives (transport-agnostic).
//
// Sync-vs-async policy (see Fd doc in fd.ts): read/write return a union —
// bare result when synchronous, Promise when it may suspend. PipeReadFd.read
// is sync when the consumer has data queued / EOF / errored; it suspends only
// when the reader actually parks.

import { EVENTTYPE, FdFlags, Filetype, Result } from './consts';
import {
  Fd,
  type ReaddirResult,
  type ReadResult,
  type SeekResult,
  type TruncateResult,
  type WriteResult,
} from './fd';
import { readFromIovs, writeToIovs } from './iovec';
import type { StreamConsumer, StreamProvider } from './ipc';
import type { IovecValue } from './struct';

// ---- PipeReadFd ----
//
// One-chunk-per-call + short reads.

export class PipeReadFd extends Fd {
  readonly filetype = Filetype.CHARACTER_DEVICE;

  private eof = false;
  private err = false;
  private leftover: Uint8Array | null = null;
  /**
   * Dedup cache: ensures only one consumer.read() is in flight at a time.
   * onReady and read both call pull(); without this, the second call would
   * hit the single-reader constraint and throw. Sync pulls bypass the cache.
   */
  private pullPromise: Promise<void> | null = null;
  private pullPromiseListeners = new Set<() => void>();

  constructor(private readonly consumer: StreamConsumer) {
    super();
  }

  /**
   * Ensure leftover/eof/err is set if returns immediately or after resolved.
   */
  private pull(): void | Promise<void> {
    if (this.leftover !== null || this.eof || this.err) return;
    if (this.pullPromise) return this.pullPromise;

    let raw: ArrayBuffer | Promise<ArrayBuffer | null> | null;
    try {
      raw = this.consumer.read();
      // async case
      if (raw instanceof Promise) {
        const p = this.pullAsync(raw);
        this.pullPromise = p;
        return p;
      }
      // sync case
      if (raw === null) this.eof = true;
      else this.leftover = new Uint8Array(raw);
      return;
    } catch {
      this.err = true;
      return;
    }
  }

  private async pullAsync(raw: Promise<ArrayBuffer | null>): Promise<void> {
    try {
      const ab = await raw;
      if (ab === null) this.eof = true;
      else this.leftover = new Uint8Array(ab);
    } catch {
      this.err = true;
    }
    this.pullPromise = null;
    this.notify();
  }

  /** Fire and clear all registered readiness callbacks. Callbacks are
   *  infallible signals (poll resolves a race promise) and must not throw. */
  private notify(): void {
    if (this.pullPromiseListeners.size === 0) return;
    const cbs = [...this.pullPromiseListeners];
    this.pullPromiseListeners.clear();
    for (const cb of cbs) cb();
  }

  read(mem: Uint8Array, iovs: IovecValue[]): ReadResult | Promise<ReadResult> {
    const consume = (): ReadResult => {
      if (this.err) return { ok: false, errno: Result.EIO };
      if (this.eof) return { ok: true, n: 0 };
      const chunk = this.leftover as Uint8Array;
      const n = writeToIovs(mem, iovs, chunk);
      this.leftover = n < chunk.byteLength ? chunk.subarray(n) : null;
      return { ok: true, n };
    };
    const pulled = this.pull();
    if (pulled instanceof Promise) {
      if (this.hasFlag(FdFlags.NONBLOCK)) return { ok: false, errno: Result.EAGAIN };
      return pulled.then(consume);
    }
    return consume();
  }

  // Return type-specific errno instead of the base UnsupportedError.

  /** Read-ends lack FD_WRITE. WASI's rights model → ENOTCAPABLE. */
  write(): WriteResult {
    return { ok: false, errno: Result.ENOTCAPABLE };
  }

  /** Pipes aren't seekable; positional reads fail at the seek step. */
  pread(): ReadResult {
    return { ok: false, errno: Result.ESPIPE };
  }

  /** Pipes aren't seekable; positional writes fail at the seek step. */
  pwrite(): WriteResult {
    return { ok: false, errno: Result.ESPIPE };
  }

  seek(): SeekResult {
    return { ok: false, errno: Result.ESPIPE };
  }

  tell(): SeekResult {
    // fd_tell ≡ fd_seek(0, CUR) — same errno as seek, symmetric.
    return { ok: false, errno: Result.ESPIPE };
  }

  /** POSIX ftruncate on a non-regular-file → EINVAL. */
  truncate(): TruncateResult {
    return { ok: false, errno: Result.EINVAL };
  }

  /** Pipes aren't directories → ENOTDIR. */
  readdir(): ReaddirResult {
    return { ok: false, errno: Result.ENOTDIR };
  }

  isReady(type: number): boolean {
    return type === EVENTTYPE.FD_READ && (this.leftover !== null || this.eof || this.err);
  }

  /** Register a callback to fire when a chunk arrives. Returns a deregister
   *  function so poll can clean up after each cycle — prevents handler accumulation.
   */
  onReady(type: number, cb: () => void): () => void {
    if (type !== EVENTTYPE.FD_READ) return () => {};
    const pulled = this.pull();
    if (!(pulled instanceof Promise)) {
      queueMicrotask(cb);
      return () => {};
    }
    this.pullPromiseListeners.add(cb);
    return () => {
      this.pullPromiseListeners.delete(cb);
    };
  }

  availableBytes(): number {
    return this.leftover?.byteLength ?? 0;
  }

  close(): void {
    this.consumer.cancel();
  }
}

// ---- PipeWriteFd ----
//
// fd_write gathers the iovec buffers into one chunk and transfers it.

export class PipeWriteFd extends Fd {
  readonly filetype = Filetype.CHARACTER_DEVICE;

  constructor(private readonly provider: StreamProvider) {
    super();
  }

  write(mem: Uint8Array, iovs: IovecValue[]): WriteResult {
    const data = readFromIovs(mem, iovs);
    const n = data.byteLength;
    try {
      // Multiple fd_write calls coalesce into one postMessage on the next
      // microtask drain (typically when wasm hits a Suspending import).
      this.provider.write(data.buffer as ArrayBuffer);
    } catch {
      return { ok: false, errno: Result.EPIPE };
    }
    return { ok: true, n };
  }

  // Return type-specific errno instead of the base UnsupportedError (cf. DirFd).

  /** Write-ends lack FD_READ. WASI's rights model → ENOTCAPABLE. */
  read(): ReadResult {
    return { ok: false, errno: Result.ENOTCAPABLE };
  }

  /** Pipes aren't seekable; positional reads fail at the seek step. */
  pread(): ReadResult {
    return { ok: false, errno: Result.ESPIPE };
  }

  /** Pipes aren't seekable; positional writes fail at the seek step. */
  pwrite(): WriteResult {
    return { ok: false, errno: Result.ESPIPE };
  }

  seek(): SeekResult {
    return { ok: false, errno: Result.ESPIPE };
  }

  tell(): SeekResult {
    // fd_tell ≡ fd_seek(0, CUR) — same errno as seek, symmetric.
    return { ok: false, errno: Result.ESPIPE };
  }

  /** POSIX ftruncate on a non-regular-file → EINVAL. */
  truncate(): TruncateResult {
    return { ok: false, errno: Result.EINVAL };
  }

  /** Pipes aren't directories → ENOTDIR. */
  readdir(): ReaddirResult {
    return { ok: false, errno: Result.ENOTDIR };
  }

  /** Always writable */
  isReady(type: number): boolean {
    return type === EVENTTYPE.FD_WRITE;
  }

  onReady(type: number, cb: () => void): () => void {
    if (type === EVENTTYPE.FD_WRITE) {
      queueMicrotask(cb);
      return () => {};
    }
    return () => {};
  }

  close(): void {
    this.provider.close();
  }
}
