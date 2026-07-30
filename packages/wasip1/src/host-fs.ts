/**
 * Host-side filesystem surface, client and server paired in one module.
 * Stateless path-based API (whole-file reads/writes) — no handle table.
 * The server wraps a sync `Vfs` (open + op + close per call); the client
 * forwards each call over RPC. `FsError` survives the wire intact because
 * `ipc-mp.ts` serializes it as a discriminated `{kind:'FsError', errno}`.
 */

import { Filetype, Result } from './consts';
import { type DirBackend, type FileBackend, FsError, type Vfs } from './fs';
import type { RpcClient, RpcMethods } from './ipc';
import { mkdir, mkdirRecursive, normalizePath } from './path';

/** Shared RPC method names; referenced by both client and server halves. */
export const HostFsMethodNames = {
  READ_FILE: 'fs.readFile',
  WRITE_FILE: 'fs.writeFile',
  LIST_DIR: 'fs.listDir',
  STAT: 'fs.stat',
  REMOVE: 'fs.remove',
  RENAME: 'fs.rename',
  MKDIR: 'fs.mkdir',
} as const;

// ---- Client ----

/** Async path-based filesystem backed by an RPC channel to the worker.
 *  Each method is one round-trip; the server holds no per-handle state. */
export class HostFs {
  constructor(private readonly _rpc: RpcClient) {}

  readFile(path: string): Promise<Uint8Array> {
    return this._rpc.call<Uint8Array>(HostFsMethodNames.READ_FILE, [path]);
  }

  writeFile(path: string, data: Uint8Array): Promise<void> {
    return this._rpc.call<void>(HostFsMethodNames.WRITE_FILE, [path, data]);
  }

  listDir(path: string): Promise<{ name: string; isDirectory: boolean }[]> {
    return this._rpc.call<{ name: string; isDirectory: boolean }[]>(HostFsMethodNames.LIST_DIR, [
      path,
    ]);
  }

  stat(path: string): Promise<{ size: number; isDirectory: boolean }> {
    return this._rpc.call<{ size: number; isDirectory: boolean }>(HostFsMethodNames.STAT, [path]);
  }

  remove(path: string): Promise<void> {
    return this._rpc.call<void>(HostFsMethodNames.REMOVE, [path]);
  }

  rename(oldPath: string, newPath: string): Promise<void> {
    return this._rpc.call<void>(HostFsMethodNames.RENAME, [oldPath, newPath]);
  }

  /** Create a directory. With `recursive: true`, creates parents and swallows
   *  EEXIST at any level; default `recursive: false` is single-level (parent
   *  must exist, EEXIST if target exists). */
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    return this._rpc.call<void>(HostFsMethodNames.MKDIR, [path, opts]);
  }
}

// ---- Server ----

export interface HostFsServerDeps {
  /** Current Vfs. Resolves to null until `init` has run; calling any fs.*
   *  method before init rejects with a TypeError surfaced over RPC. */
  getVfs: () => Vfs;
}

/** Build the host-fs RPC handlers. Stateless: each call opens the path,
 *  performs the op, and closes — no handle table persists across calls. */
export function createHostFsServer(deps: HostFsServerDeps): RpcMethods {
  const openFileRead = (p: string): FileBackend => {
    const r = deps.getVfs().open(p, {
      create: false,
      exclusive: false,
      truncate: false,
      directory: false,
    });
    if (r.kind !== 'file') throw new FsError(Result.EISDIR);
    return r.backend;
  };

  const openFileWrite = (p: string): FileBackend => {
    const r = deps.getVfs().open(p, {
      create: true,
      exclusive: false,
      truncate: true,
      directory: false,
    });
    if (r.kind !== 'file') throw new FsError(Result.EISDIR);
    return r.backend;
  };

  const openDirList = (p: string): DirBackend => {
    const r = deps.getVfs().open(p, {
      create: false,
      exclusive: false,
      truncate: false,
      directory: true,
    });
    if (r.kind !== 'dir') throw new FsError(Result.ENOTDIR);
    return r.backend;
  };

  return {
    [HostFsMethodNames.READ_FILE](path: string): Uint8Array {
      const backend = openFileRead(normalizePath(path));
      try {
        const dst = new Uint8Array(backend.getSize());
        backend.read(0, dst);
        return dst;
      } finally {
        backend.close();
      }
    },

    [HostFsMethodNames.WRITE_FILE](path: string, data: Uint8Array): void {
      const backend = openFileWrite(normalizePath(path));
      try {
        backend.write(0, data);
        backend.setSize(data.length);
      } finally {
        backend.close();
      }
    },

    [HostFsMethodNames.LIST_DIR](path: string): { name: string; isDirectory: boolean }[] {
      const backend = openDirList(normalizePath(path));
      try {
        return backend.list().map(e => ({
          name: e.name,
          isDirectory: e.type === Filetype.DIRECTORY,
        }));
      } finally {
        backend.close();
      }
    },

    [HostFsMethodNames.STAT](path: string): { size: number; isDirectory: boolean } {
      const s = deps.getVfs().stat(normalizePath(path));
      return { size: s.size, isDirectory: s.filetype === Filetype.DIRECTORY };
    },

    [HostFsMethodNames.REMOVE](path: string): void {
      deps.getVfs().remove(normalizePath(path));
    },

    [HostFsMethodNames.RENAME](oldPath: string, newPath: string): void {
      deps.getVfs().rename(normalizePath(oldPath), normalizePath(newPath));
    },

    [HostFsMethodNames.MKDIR](path: string, opts?: { recursive?: boolean }): void {
      const p = normalizePath(path);
      if (opts?.recursive) {
        mkdirRecursive(deps.getVfs(), p);
      } else {
        mkdir(deps.getVfs(), p);
      }
    },
  };
}
