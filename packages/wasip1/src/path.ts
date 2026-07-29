import { Result } from './consts';
import { DirFd } from './fd-dir';
import type { FdTable } from './fd-table';
import { FsError, type Vfs } from './fs';

/** Collapse `.`, `..`, duplicate/trailing slashes to a canonical absolute
 *  path. */
export function normalizePath(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  const parts = path.split('/').filter(p => p.length > 0);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return `/${stack.join('/')}`;
}

/** Resolve a WASI path relative to dirFd: look up the directory fd, join its
 *  vfsPath with childPath, and normalize. Falls back to treating childPath as
 *  absolute if dirFd is invalid or not a DirFd. */
export function resolvePath(fdTable: FdTable, dirFd: number, childPath: string): string {
  const entry = fdTable.get(dirFd);
  if (entry?.desc instanceof DirFd) return normalizePath(`${entry.desc.vfsPath}/${childPath}`);
  return childPath;
}

/** Create a directory at `path` (single level; parent must exist). Thin wrapper
 *  over open({create, exclusive, directory}) so backends need no separate mkdir
 *  hook. Throws FsError (EEXIST if it exists, ENOENT if parent missing). */
export function mkdir(vfs: Vfs, path: string): void {
  vfs.open(path, {
    create: true,
    exclusive: true,
    directory: true,
    truncate: false,
  });
}

/** Walk `path` segment-by-segment, creating each ancestor. Swallows EEXIST
 *  (an ancestor already existing is the normal case); any other error propagates. */
export function mkdirRecursive(vfs: Vfs, path: string): void {
  const parts = path.split('/').filter(p => p.length > 0);
  let cur = '';
  for (const part of parts) {
    cur = cur === '' ? `/${part}` : `${cur}/${part}`;
    try {
      mkdir(vfs, cur);
    } catch (e) {
      if (e instanceof FsError && e.errno === Result.EEXIST) continue;
      throw e;
    }
  }
}
