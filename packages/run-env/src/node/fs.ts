/** node:fs/promises adapter implementing {@link Fs}.
 *
 *  Provides path-translated access to the host filesystem. WASI runtimes map
 *  guest paths to host paths via preopens; the translation is applied here so
 *  callers always work in guest path space. */

import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  stat as fsStat,
  writeFile as fsWriteFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { DirEntry, Fs, StatInfo } from '../types';

/** Translate a guest path to a host path using the preopen mapping.
 *  Finds the longest preopen mount that is a prefix of `guestPath` and
 *  replaces it with the corresponding host directory. */
export function translatePath(guestPath: string, preopens: Record<string, string>): string {
  let bestMount = '';
  let bestHost = '';
  for (const [mount, host] of Object.entries(preopens)) {
    if (mount === '/' || mount === guestPath || guestPath.startsWith(`${mount}/`)) {
      if (mount.length > bestMount.length) {
        bestMount = mount;
        bestHost = host;
      }
    }
  }
  if (!bestMount) return guestPath;
  if (guestPath === bestMount) return bestHost;
  return join(bestHost, guestPath.slice(bestMount.length));
}

/** Fs backed by node:fs/promises with optional path translation. */
export class NodeFs implements Fs {
  constructor(private readonly _preopens: Record<string, string> = {}) {}

  private tr(path: string): string {
    return translatePath(path, this._preopens);
  }

  async readFile(path: string): Promise<Uint8Array> {
    return fsReadFile(this.tr(path));
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await fsWriteFile(this.tr(path), data);
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await fsMkdir(this.tr(path), opts);
  }

  async stat(path: string): Promise<StatInfo> {
    const s = await fsStat(this.tr(path));
    return { size: s.size, isDirectory: s.isDirectory() };
  }

  async remove(path: string): Promise<void> {
    await rm(this.tr(path), { recursive: true, force: true });
  }

  async listDir(path: string): Promise<DirEntry[]> {
    const entries = await readdir(this.tr(path), { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    }));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await rename(this.tr(oldPath), this.tr(newPath));
  }
}
