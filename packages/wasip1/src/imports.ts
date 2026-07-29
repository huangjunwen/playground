// WASI Preview 1 syscall implementations. createWasiImports(ctx) builds the
// wasi_snapshot_preview1 import object; every syscall closes over ctx (fd
// table, vfs, args/env, memory).
//
// JSPI / suspending policy:
// - Sync-state syscalls (paths, metadata, dirs, seek/tell) are plain sync
//   functions — no Promise, no wrapSuspending.
// - sched_yield and poll_oneoff always suspend — wrapped with ctx.wrapSuspending.
// - fd_read/write/pread/pwrite MAY suspend: each returns `number | Promise<number>`
//   from one non-async import. The SAME call yields a bare number for a FileFd
//   (sync) or a Promise for a pipe (suspends). `result instanceof Promise
//   ? result.then(finish) : finish(result)` lets JSPI auto-pick per call, so one
//   import serves both fd kinds — no always-suspend tax, no splitting one WASI
//   name in two. Wrapped with ctx.wrapSuspending.
//
// Structs are (de)coded at the memory boundary via struct.ts; in between it's
// plain values.

import { CLOCKID, Oflags, PREOPENTYPE_DIR, Result, Rights } from './consts';
import type { Fd, ReadResult, SeekResult, WriteResult } from './fd';
import { DirFd } from './fd-dir';
import { FileFd } from './fd-file';
import type { FdTable } from './fd-table';
import { type DirEntry, FsError, type OpenFlags, type OpenResult, type Vfs } from './fs';
import { mkdir, resolvePath } from './path';
import { runPoll } from './poll';
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
} from './struct';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// The imports JSPI may suspend on. `ctx.wrapSuspending` is applied to these in
// the post-pass at the end of createWasiImports.
const SUSPENDING_NAMES = [
  'sched_yield',
  'fd_read',
  'fd_write',
  'fd_pread',
  'fd_pwrite',
  'poll_oneoff',
] as const;

/** Dependency boundary injected into createWasiImports. */
export interface WasiCtx {
  /** Fresh Uint8Array view over current wasm memory (memory can grow). */
  getMem: () => Uint8Array;
  /** Marks an import as JSPI-suspendable. A JSPI host supplies
   *  `fn => new WebAssembly.Suspending(fn)`; environments without JSPI (Node,
   *  tests) supply the identity function. Applied to SUSPENDING_NAMES. */
  wrapSuspending: <T extends (...args: never[]) => unknown>(fn: T) => T;
  fdTable: FdTable;
  vfs: Vfs;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
}

/** Thrown by proc_exit; worker catches it to end the run with a code. */
export class ProcExit extends Error {
  constructor(readonly code: number) {
    super('proc_exit');
    this.name = 'ProcExit';
  }
}

/** Map a thrown FsError to its errno; unexpected throws become EIO. */
function fsErrno(e: unknown): number {
  if (e instanceof FsError) return e.errno;
  return Result.EIO;
}

/**
 * Safely read a byte range from guest linear memory. Returns the subarray view
 * if `ptr` and `len` fall entirely within `mem`, or `null` if they would read
 * past the end of memory. All WASI path-bearing syscalls gate on this so we
 * return EINVAL instead of letting the JS runtime trap (which is the WASI
 * fallback for invalid pointers).
 */
function tryReadMem(mem: Uint8Array, ptr: number, len: number): Uint8Array | null {
  if (ptr < 0 || len < 0 || ptr > mem.byteLength || ptr + len > mem.byteLength) return null;
  return mem.subarray(ptr, ptr + len);
}

export function createWasiImports(ctx: WasiCtx) {
  const raw = {
    // ---- proc / sched ----
    proc_exit: (code: number): never => {
      throw new ProcExit(code);
    },
    // Yield a full event-loop tick (setTimeout 0 drains the task queue, whereas
    // Promise.resolve only drains microtasks) so host-side work can progress
    // while wasm busy-waits. Requires JSPI (suspending import + promising
    // _start); the test harness uses the identity fallback, which still resolves.
    // Defined as a plain function — `ctx.wrapSuspending` is applied in the
    // post-pass at the end of createWasiImports.
    sched_yield: (): Promise<number> =>
      new Promise(resolve => setTimeout(() => resolve(Result.SUCCESS), 0)),
    proc_raise: (_signal: number): number => Result.ENOSYS,

    // ---- args / env ----
    args_sizes_get: (argvPtr: number, argvBufSizePtr: number): number => {
      const mem = new Mem(ctx.getMem());
      mem.setU32(argvPtr, ctx.args.length);
      let bufSize = 0;
      for (const a of ctx.args) bufSize += ENCODER.encode(a).length + 1;
      mem.setU32(argvBufSizePtr, bufSize);
      return Result.SUCCESS;
    },
    args_get: (argvPtr: number, argvBufPtr: number): number => {
      const mem = new Mem(ctx.getMem());
      let bufOffset = argvBufPtr;
      let argTableOffset = argvPtr;
      for (const arg of ctx.args) {
        mem.setU32(argTableOffset, bufOffset);
        argTableOffset += 4;
        const bytes = ENCODER.encode(arg);
        mem.writeBytes(bufOffset, bytes);
        bufOffset += bytes.length;
        mem.setU8(bufOffset, 0);
        bufOffset += 1;
      }
      return Result.SUCCESS;
    },
    environ_sizes_get: (countPtr: number, bufSizePtr: number): number => {
      const mem = new Mem(ctx.getMem());
      const entries = Object.entries(ctx.env).map(([k, v]) => `${k}=${v}`);
      mem.setU32(countPtr, entries.length);
      let bufSize = 0;
      for (const e of entries) bufSize += ENCODER.encode(e).length + 1;
      mem.setU32(bufSizePtr, bufSize);
      return Result.SUCCESS;
    },
    environ_get: (environPtr: number, bufPtr: number): number => {
      const mem = new Mem(ctx.getMem());
      const entries = Object.entries(ctx.env).map(([k, v]) => `${k}=${v}`);
      let bufOffset = bufPtr;
      let tableOffset = environPtr;
      for (const e of entries) {
        mem.setU32(tableOffset, bufOffset);
        tableOffset += 4;
        const bytes = ENCODER.encode(e);
        mem.writeBytes(bufOffset, bytes);
        bufOffset += bytes.length;
        mem.setU8(bufOffset, 0);
        bufOffset += 1;
      }
      return Result.SUCCESS;
    },

    // ---- clocks / random ----
    clock_time_get: (clockId: number, _precision: bigint, outPtr: number): number => {
      const mem = new Mem(ctx.getMem());
      const ns =
        clockId === CLOCKID.MONOTONIC
          ? BigInt(Math.floor(performance.now() * 1_000_000))
          : BigInt(Date.now()) * 1_000_000n;
      mem.setU64(outPtr, ns);
      return Result.SUCCESS;
    },
    clock_res_get: (_clockId: number, outPtr: number): number => {
      const mem = new Mem(ctx.getMem());
      mem.setU64(outPtr, 1_000_000n);
      return Result.SUCCESS;
    },
    random_get: (bufPtr: number, bufLen: number): number => {
      const mem = new Mem(ctx.getMem());
      const bytes = new Uint8Array(bufLen);
      crypto.getRandomValues(bytes);
      mem.writeBytes(bufPtr, bytes);
      return Result.SUCCESS;
    },

    // ---- path: filesystem name ops ----
    path_open: (
      dirFd: number,
      _dirFlags: number,
      pathPtr: number,
      pathLen: number,
      oflags: number,
      _rightsBase: bigint,
      _rightsInheriting: bigint,
      _fdflags: number,
      outFdPtr: number,
    ): number => {
      const mem = new Mem(ctx.getMem());
      const pathView = tryReadMem(mem.raw, pathPtr, pathLen);
      if (!pathView) return Result.EINVAL;
      const rawPath = DECODER.decode(pathView);
      const path = resolvePath(ctx.fdTable, dirFd, rawPath);
      const flags: OpenFlags = {
        create: (oflags & Oflags.CREAT) !== 0,
        exclusive: (oflags & Oflags.EXCL) !== 0,
        truncate: (oflags & Oflags.TRUNC) !== 0,
        directory: (oflags & Oflags.DIRECTORY) !== 0,
      };
      let r: OpenResult;
      try {
        r = ctx.vfs.open(path, flags);
      } catch (e) {
        return fsErrno(e);
      }
      let desc: Fd;
      let rights: bigint;
      if (r.kind === 'dir') {
        if (!(oflags & Oflags.DIRECTORY)) {
          return Result.EISDIR;
        }
        const entries = r.backend.list();
        desc = new DirFd(entries, path);
        rights = Rights.FD_READ;
      } else {
        desc = new FileFd(r.backend);
        rights = Rights.FD_READ | Rights.FD_WRITE;
      }
      const fd = ctx.fdTable.open(desc, rights);
      mem.setU32(outFdPtr, fd);
      return Result.SUCCESS;
    },
    path_create_directory: (dirFd: number, pathPtr: number, pathLen: number): number => {
      const mem = new Mem(ctx.getMem());
      const pathView = tryReadMem(mem.raw, pathPtr, pathLen);
      if (!pathView) return Result.EINVAL;
      const rawPath = DECODER.decode(pathView);
      const path = resolvePath(ctx.fdTable, dirFd, rawPath);
      try {
        mkdir(ctx.vfs, path);
      } catch (e) {
        return fsErrno(e);
      }
      return Result.SUCCESS;
    },
    path_unlink_file: (dirFd: number, pathPtr: number, pathLen: number): number => {
      const mem = new Mem(ctx.getMem());
      const pathView = tryReadMem(mem.raw, pathPtr, pathLen);
      if (!pathView) return Result.EINVAL;
      const rawPath = DECODER.decode(pathView);
      const path = resolvePath(ctx.fdTable, dirFd, rawPath);
      try {
        ctx.vfs.remove(path, { directory: false });
      } catch (e) {
        return fsErrno(e);
      }
      return Result.SUCCESS;
    },
    path_remove_directory: (dirFd: number, pathPtr: number, pathLen: number): number => {
      const mem = new Mem(ctx.getMem());
      const pathView = tryReadMem(mem.raw, pathPtr, pathLen);
      if (!pathView) return Result.EINVAL;
      const rawPath = DECODER.decode(pathView);
      const path = resolvePath(ctx.fdTable, dirFd, rawPath);
      try {
        ctx.vfs.remove(path, { directory: true });
      } catch (e) {
        return fsErrno(e);
      }
      return Result.SUCCESS;
    },
    path_rename: (
      oldDirFd: number,
      oldPathPtr: number,
      oldLen: number,
      newDirFd: number,
      newPathPtr: number,
      newPathLen: number,
    ): number => {
      const mem = new Mem(ctx.getMem());
      const oldView = tryReadMem(mem.raw, oldPathPtr, oldLen);
      if (!oldView) return Result.EINVAL;
      const newView = tryReadMem(mem.raw, newPathPtr, newPathLen);
      if (!newView) return Result.EINVAL;
      const oldRawPath = DECODER.decode(oldView);
      const newRawPath = DECODER.decode(newView);
      const oldPath = resolvePath(ctx.fdTable, oldDirFd, oldRawPath);
      const newPath = resolvePath(ctx.fdTable, newDirFd, newRawPath);
      try {
        ctx.vfs.rename(oldPath, newPath);
      } catch (e) {
        return fsErrno(e);
      }
      return Result.SUCCESS;
    },
    path_filestat_get: (
      dirFd: number,
      _flags: number,
      pathPtr: number,
      pathLen: number,
      outPtr: number,
    ): number => {
      const mem = new Mem(ctx.getMem());
      const pathView = tryReadMem(mem.raw, pathPtr, pathLen);
      if (!pathView) return Result.EINVAL;
      const rawPath = DECODER.decode(pathView);
      const path = resolvePath(ctx.fdTable, dirFd, rawPath);
      let stat: { size: number; filetype: number };
      try {
        stat = ctx.vfs.stat(path);
      } catch (e) {
        return fsErrno(e);
      }
      Filestat.write(mem, outPtr, { filetype: stat.filetype, size: BigInt(stat.size) });
      return Result.SUCCESS;
    },
    path_filestat_set_times: (
      _d: number,
      _f: number,
      _p: number,
      _l: number,
      _a: bigint,
      _m: bigint,
      _fs: number,
    ): number => Result.SUCCESS,
    path_link: (
      _od: number,
      _of: number,
      _op: number,
      _ol: number,
      _nd: number,
      _np: number,
      _nl: number,
    ): number => Result.ENOSYS,
    path_symlink: (_op: number, _ol: number, _d: number, _np: number, _nl: number): number =>
      Result.ENOSYS,
    path_readlink: (_d: number, _p: number, _l: number, _b: number, _bl: number): number =>
      Result.EINVAL,

    // ---- fd: metadata & control ----
    fd_close: (fd: number): number => (ctx.fdTable.close(fd) ? Result.SUCCESS : Result.EBADF),
    fd_renumber: (from: number, to: number): number =>
      ctx.fdTable.renumber(from, to) ? Result.SUCCESS : Result.EBADF,
    fd_seek: (fd: number, offset: bigint, whence: number, outPtr: number): number => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      const r: SeekResult = entry.desc.seek(Number(offset), whence);
      if (!r.ok) return r.errno;
      const mem = new Mem(ctx.getMem());
      mem.setU64(outPtr, BigInt(r.cursor));
      return Result.SUCCESS;
    },
    fd_tell: (fd: number, outPtr: number): number => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      const r: SeekResult = entry.desc.tell();
      if (!r.ok) return r.errno;
      const mem = new Mem(ctx.getMem());
      mem.setU64(outPtr, BigInt(r.cursor));
      return Result.SUCCESS;
    },
    fd_fdstat_get: (fd: number, outPtr: number): number => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      const mem = new Mem(ctx.getMem());
      Fdstat.write(mem, outPtr, {
        filetype: entry.desc.filetype,
        fdflags: entry.desc.getFlags(),
        rightsBase: entry.rights,
        rightsInheriting: 0n,
      });
      return Result.SUCCESS;
    },
    fd_fdstat_set_flags: (fd: number, flags: number): number => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      entry.desc.setFlags(flags);
      return Result.SUCCESS;
    },
    fd_fdstat_set_rights: (fd: number, rightsBase: bigint, _rightsInheriting: bigint): number => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      // WASI rights can only be narrowed (intersect), never widened.
      entry.rights &= rightsBase;
      return Result.SUCCESS;
    },
    fd_prestat_get: (fd: number, outPtr: number): number => {
      if (fd !== 3) return Result.EBADF;
      const mem = new Mem(ctx.getMem());
      Prestat.write(mem, outPtr, { tag: PREOPENTYPE_DIR, nameLen: 1 }); // '/' is 1 byte
      return Result.SUCCESS;
    },
    fd_prestat_dir_name: (fd: number, pathPtr: number, _pathLen: number): number => {
      if (fd !== 3) return Result.EBADF;
      const mem = new Mem(ctx.getMem());
      mem.writeUtf8(pathPtr, '/');
      return Result.SUCCESS;
    },
    fd_readdir: (
      fd: number,
      bufPtr: number,
      bufLen: number,
      cookie: bigint,
      bufusedPtr: number,
    ): number => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      const readdir = entry.desc.readdir();
      if (!readdir.ok) return readdir.errno;
      const entries: readonly DirEntry[] = readdir.entries;
      const mem = new Mem(ctx.getMem());
      const start = Number(cookie);
      let offset = bufPtr;
      for (let i = start; i < entries.length; i++) {
        const e = entries[i]!;
        const nameBytes = ENCODER.encode(e.name);
        if (offset - bufPtr + Dirent.sizeOf(nameBytes.length) > bufLen) break;
        Dirent.write(mem, offset, { next: BigInt(i + 1), ino: 0n, type: e.type, nameBytes });
        offset += Dirent.sizeOf(nameBytes.length);
      }
      mem.setU32(bufusedPtr, offset - bufPtr);
      return Result.SUCCESS;
    },
    fd_filestat_get: (fd: number, outPtr: number): number => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      const mem = new Mem(ctx.getMem());
      Filestat.write(mem, outPtr, {
        filetype: entry.desc.filetype,
        size: BigInt(entry.desc.statSize()),
      });
      return Result.SUCCESS;
    },
    fd_filestat_set_size: (fd: number, size: bigint): number => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      const r = entry.desc.truncate(Number(size));
      return r.ok ? Result.SUCCESS : r.errno;
    },
    fd_filestat_set_times: (_fd: number, _a: bigint, _m: bigint, _f: number): number =>
      Result.SUCCESS,
    fd_advise: (_fd: number, _o: bigint, _l: bigint, _a: number): number => Result.SUCCESS,
    fd_allocate: (_fd: number, _o: bigint, _l: bigint): number => Result.SUCCESS,

    // ---- I/O ----
    //
    // fd_read/write/pread/pwrite use the JSPI Suspending shim: each is a
    // non-async function returning `number | Promise<number>`. The dispatch
    // `result instanceof Promise ? result.then(finish) : finish(result)` lets
    // JSPI auto-pick — files return bare results (no suspension); pipes return
    // Promises (real suspension).
    fd_read: (
      fd: number,
      iovsPtr: number,
      iovsLen: number,
      nreadPtr: number,
    ): number | Promise<number> => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      if ((entry.rights & Rights.FD_READ) === 0n) return Result.EBADF;
      const mem = new Mem(ctx.getMem());
      const iovs = Iovec.fromArray(mem, iovsPtr, iovsLen);
      const result = entry.desc.read(mem.raw, iovs);
      const finish = (r: ReadResult): number => {
        if (!r.ok) return r.errno;
        mem.setU32(nreadPtr, r.n);
        return Result.SUCCESS;
      };
      return result instanceof Promise ? result.then(finish) : finish(result);
    },
    fd_write: (
      fd: number,
      iovsPtr: number,
      iovsLen: number,
      nwrittenPtr: number,
    ): number | Promise<number> => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      if ((entry.rights & Rights.FD_WRITE) === 0n) return Result.EBADF;
      const mem = new Mem(ctx.getMem());
      const iovs = Iovec.fromArray(mem, iovsPtr, iovsLen);
      const result = entry.desc.write(mem.raw, iovs);
      const finish = (r: WriteResult): number => {
        if (!r.ok) return r.errno;
        mem.setU32(nwrittenPtr, r.n);
        return Result.SUCCESS;
      };
      return result instanceof Promise ? result.then(finish) : finish(result);
    },
    fd_pread: (
      fd: number,
      iovsPtr: number,
      iovsLen: number,
      offset: bigint,
      nreadPtr: number,
    ): number | Promise<number> => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      if ((entry.rights & Rights.FD_READ) === 0n) return Result.EBADF;
      const mem = new Mem(ctx.getMem());
      const iovs = Iovec.fromArray(mem, iovsPtr, iovsLen);
      const result = entry.desc.pread(mem.raw, iovs, Number(offset));
      const finish = (r: ReadResult): number => {
        if (!r.ok) return r.errno;
        mem.setU32(nreadPtr, r.n);
        return Result.SUCCESS;
      };
      return result instanceof Promise ? result.then(finish) : finish(result);
    },
    fd_pwrite: (
      fd: number,
      iovsPtr: number,
      iovsLen: number,
      offset: bigint,
      nwrittenPtr: number,
    ): number | Promise<number> => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      if ((entry.rights & Rights.FD_WRITE) === 0n) return Result.EBADF;
      const mem = new Mem(ctx.getMem());
      const iovs = Iovec.fromArray(mem, iovsPtr, iovsLen);
      const result = entry.desc.pwrite(mem.raw, iovs, Number(offset));
      const finish = (r: WriteResult): number => {
        if (!r.ok) return r.errno;
        mem.setU32(nwrittenPtr, r.n);
        return Result.SUCCESS;
      };
      return result instanceof Promise ? result.then(finish) : finish(result);
    },
    // Flush accepted data to stable storage (default no-op; overridable per Fd).
    fd_sync: (fd: number): number => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      entry.desc.sync();
      return Result.SUCCESS;
    },
    fd_datasync: (fd: number): number => {
      const entry = ctx.fdTable.get(fd);
      if (!entry) return Result.EBADF;
      entry.desc.datasync();
      return Result.SUCCESS;
    },
    // Wait for fd readiness or a clock timeout.
    poll_oneoff: async (
      subsPtr: number,
      eventsPtr: number,
      nsubs: number,
      neventsPtr: number,
    ): Promise<number> => {
      if (nsubs === 0) {
        const mem = new Mem(ctx.getMem());
        mem.setU32(neventsPtr, 0);
        return Result.SUCCESS;
      }
      const mem = new Mem(ctx.getMem());
      const subs: SubscriptionValue[] = [];
      for (let i = 0; i < nsubs; i++)
        subs.push(Subscription.from(mem, subsPtr + i * Subscription.SIZE));
      const lookupFd = (fd: number) => ctx.fdTable.get(fd)?.desc;
      const sleepFn = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
      const events = await runPoll(subs, lookupFd, sleepFn);
      // Re-snapshot after the await — poll may have yielded to the event loop.
      const fresh = new Mem(ctx.getMem());
      for (let i = 0; i < events.length; i++)
        Event.write(fresh, eventsPtr + i * Event.SIZE, events[i]!);
      fresh.setU32(neventsPtr, events.length);
      return Result.SUCCESS;
    },

    // ---- sockets (ENOSYS) ----
    sock_accept: (_fd: number, _flags: number, _outPtr: number): number => Result.ENOSYS,
    sock_open: (_af: number, _ty: number, _proto: number, _outPtr: number): number => Result.ENOSYS,
    sock_recv: (
      _fd: number,
      _dPtr: number,
      _dLen: number,
      _flags: number,
      _o: number,
      _o2: number,
    ): number => Result.ENOSYS,
    sock_send: (_fd: number, _dPtr: number, _dLen: number, _flags: number, _o: number): number =>
      Result.ENOSYS,
    sock_shutdown: (_fd: number, _how: number): number => Result.ENOSYS,
  };
  // Apply `ctx.wrapSuspending` to the imports JSPI may suspend on. The raw
  // impls are plain functions so this is the single point that adds the marker.
  for (const name of SUSPENDING_NAMES) {
    const impl = raw[name];
    if (typeof impl === 'function') {
      // biome-ignore lint/suspicious/noExplicitAny: raw is a heterogeneous map of import impls; wrapSuspending preserves each impl's call signature
      raw[name] = ctx.wrapSuspending(impl as (...args: any[]) => unknown) as any;
    }
  }
  return raw;
}
