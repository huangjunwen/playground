import { Filetype, Result } from './consts';
import {
  Fd,
  type ReaddirResult,
  type ReadResult,
  type SeekResult,
  type TruncateResult,
  type WriteResult,
} from './fd';
import type { DirEntry } from './fs';

export class DirFd extends Fd {
  readonly filetype = Filetype.DIRECTORY;
  readonly vfsPath: string;
  readonly #entries: readonly DirEntry[];

  constructor(entries: readonly DirEntry[], vfsPath: string) {
    super();
    this.vfsPath = vfsPath;
    this.#entries = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  readdir(): ReaddirResult {
    return { ok: true, entries: this.#entries };
  }

  read(): ReadResult {
    return { ok: false, errno: Result.EISDIR };
  }

  write(): WriteResult {
    return { ok: false, errno: Result.EISDIR };
  }

  pread(): ReadResult {
    return { ok: false, errno: Result.EISDIR };
  }

  pwrite(): WriteResult {
    return { ok: false, errno: Result.EISDIR };
  }

  truncate(): TruncateResult {
    // POSIX `ftruncate(dirfd)` → EISDIR; WASI's fd_filestat_set_size follows.
    return { ok: false, errno: Result.EISDIR };
  }

  seek(): SeekResult {
    // Directories aren't seekable in WASI — fd_readdir walks entries via an
    // explicit cookie, not the fd offset. ESPIPE is the spec-listed errno for
    // "this fd can't seek" (matches wasmtime/wazero).
    return { ok: false, errno: Result.ESPIPE };
  }

  tell(): SeekResult {
    // fd_tell ≡ fd_seek(0, CUR) — same errno as seek, symmetric.
    return { ok: false, errno: Result.ESPIPE };
  }
}
