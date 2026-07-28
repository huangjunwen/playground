// In-memory Vfs. All data is held in Uint8Array buffers — entirely ephemeral,
// no persistence. Failures are thrown as FsError(errno).

import { Filetype, Result } from './consts';
import {
  type DirBackend,
  type DirEntry,
  type FileBackend,
  FsError,
  type OpenFlags,
  type OpenResult,
  type Vfs,
} from './fs';
import type { VfsFactory } from './fs-registry';

// ---- MemoryFileBackend ----

export class MemoryFileBackend implements FileBackend {
  constructor(public bytes: Uint8Array) {}

  getSize(): number {
    return this.bytes.length;
  }

  read(pos: number, dst: Uint8Array): number {
    const size = this.bytes.length;
    if (pos >= size) return 0;
    const n = Math.min(dst.length, size - pos);
    dst.set(this.bytes.subarray(pos, pos + n));
    return n;
  }

  write(pos: number, data: Uint8Array): void {
    const need = pos + data.length;
    if (need > this.bytes.length) {
      const grown = new Uint8Array(need);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes.set(data, pos);
  }

  setSize(size: number): void {
    if (size === this.bytes.length) return;
    if (size < this.bytes.length) {
      this.bytes = this.bytes.slice(0, size);
    } else {
      const grown = new Uint8Array(size);
      grown.set(this.bytes);
      this.bytes = grown;
    }
  }

  close(): void {}
}

// ---- MemoryDirBackend ----

export class MemoryDirBackend implements DirBackend {
  readonly children = new Map<string, MemoryFileBackend | MemoryDirBackend>();

  has(name: string): boolean {
    return this.children.has(name);
  }

  get(name: string): MemoryFileBackend | MemoryDirBackend | undefined {
    return this.children.get(name);
  }

  set(name: string, node: MemoryFileBackend | MemoryDirBackend): void {
    this.children.set(name, node);
  }

  remove(name: string): boolean {
    return this.children.delete(name);
  }

  list(): DirEntry[] {
    return Array.from(this.children, ([name, node]) => ({
      name,
      type: node instanceof MemoryDirBackend ? Filetype.DIRECTORY : Filetype.REGULAR_FILE,
    }));
  }

  close(): void {}
}

// ---- MemoryVfs ----

export class MemoryVfs implements Vfs {
  readonly root = new MemoryDirBackend();

  private resolve(path: string): MemoryFileBackend | MemoryDirBackend | null {
    if (path === '/') return this.root;
    const parts = path.slice(1).split('/');
    let current: MemoryFileBackend | MemoryDirBackend = this.root;
    for (const part of parts) {
      if (!(current instanceof MemoryDirBackend)) return null;
      const next = current.get(part);
      if (!next) return null;
      current = next;
    }
    return current;
  }

  /** Resolve parent dir + basename. `path` must not be `/` (callers guard root). */
  private parentOf(path: string): { parent: MemoryDirBackend; name: string } | null {
    const i = path.lastIndexOf('/');
    const parentPath = i === 0 ? '/' : path.slice(0, i);
    const parent = this.resolve(parentPath);
    if (!(parent instanceof MemoryDirBackend)) return null;
    return { parent, name: path.slice(i + 1) };
  }

  open(path: string, flags: OpenFlags): OpenResult {
    if (path === '/') return { kind: 'dir', backend: this.root };
    const ctx = this.parentOf(path);
    if (!ctx) throw new FsError(Result.ENOENT);
    const existing = ctx.parent.get(ctx.name);
    if (existing) {
      if (flags.create && flags.exclusive) throw new FsError(Result.EEXIST);
      if (existing instanceof MemoryDirBackend) return { kind: 'dir', backend: existing };
      if (flags.directory) throw new FsError(Result.ENOTDIR);
      if (flags.truncate) existing.bytes = new Uint8Array(0);
      return { kind: 'file', backend: existing };
    }
    if (!flags.create) throw new FsError(Result.ENOENT);
    if (flags.directory) {
      const dir = new MemoryDirBackend();
      ctx.parent.set(ctx.name, dir);
      return { kind: 'dir', backend: dir };
    }
    const node = new MemoryFileBackend(new Uint8Array(0));
    ctx.parent.set(ctx.name, node);
    return { kind: 'file', backend: node };
  }

  stat(path: string): { size: number; filetype: number } {
    const node = this.resolve(path);
    if (!node) throw new FsError(Result.ENOENT);
    if (node instanceof MemoryDirBackend) return { size: 0, filetype: Filetype.DIRECTORY };
    return { size: node.getSize(), filetype: Filetype.REGULAR_FILE };
  }

  remove(path: string, opts?: { directory: boolean }): void {
    if (path === '/') throw new FsError(Result.EBUSY);
    const ctx = this.parentOf(path);
    if (!ctx) throw new FsError(Result.ENOENT);
    const existing = ctx.parent.get(ctx.name);
    if (!existing) throw new FsError(Result.ENOENT);
    if (opts?.directory === true && !(existing instanceof MemoryDirBackend)) {
      throw new FsError(Result.ENOTDIR);
    }
    if (opts?.directory === false && existing instanceof MemoryDirBackend) {
      throw new FsError(Result.EISDIR);
    }
    if (existing instanceof MemoryDirBackend && existing.children.size > 0) {
      throw new FsError(Result.ENOTEMPTY);
    }
    ctx.parent.remove(ctx.name);
  }

  rename(oldPath: string, newPath: string): void {
    if (oldPath === '/') throw new FsError(Result.EBUSY);
    if (newPath === '/') throw new FsError(Result.EBUSY);
    const oldParent = this.parentOf(oldPath);
    if (!oldParent) throw new FsError(Result.ENOENT);
    const oldNode = oldParent.parent.get(oldParent.name);
    if (!oldNode) throw new FsError(Result.ENOENT);
    if (oldPath === newPath) return;
    if (oldNode instanceof MemoryDirBackend && newPath.startsWith(`${oldPath}/`)) {
      throw new FsError(Result.EINVAL);
    }
    const newParent = this.parentOf(newPath);
    if (!newParent) throw new FsError(Result.ENOENT);
    const newNode = newParent.parent.get(newParent.name);
    if (newNode) {
      if (oldNode instanceof MemoryDirBackend && newNode instanceof MemoryFileBackend)
        throw new FsError(Result.ENOTDIR);
      if (oldNode instanceof MemoryFileBackend && newNode instanceof MemoryDirBackend)
        throw new FsError(Result.EISDIR);
      if (newNode instanceof MemoryDirBackend && newNode.children.size > 0)
        throw new FsError(Result.ENOTEMPTY);
      newParent.parent.remove(newParent.name);
    }
    oldParent.parent.remove(oldParent.name);
    newParent.parent.set(newParent.name, oldNode);
  }

  info(): Record<string, unknown> {
    return { type: 'memory' };
  }
}

/** Factory for the `memory` backend — register at the composition root via
 *  registerVfs('memory', memoryVfsFactory). MemoryVfs needs no async setup. */
export const memoryVfsFactory: VfsFactory = () => Promise.resolve(new MemoryVfs());
