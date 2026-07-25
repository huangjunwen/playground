// Filesystem abstractions. All operations are synchronous.

// ---- Backend interfaces (sync byte store for fd layer) ----

/** Position-addressable byte store backing a FileFd. */
export interface FileBackend {
  /** Read up to `dst.length` bytes starting at `pos`, filling `dst` from the
   *  front; returns the byte count actually read (0 at/past EOF). */
  read(pos: number, dst: Uint8Array): number;
  /** Write `src` at `pos`, growing the store as needed. */
  write(pos: number, src: Uint8Array): void;
  /** Total size in bytes. */
  getSize(): number;
  /** Set the store to exactly `size` bytes: truncate or zero-pad extend. */
  setSize(size: number): void;
  /** Release backend resources. Idempotent. */
  close(): void;
}

/** A logical directory entry (`name` plus a WASI filetype constant). */
export interface DirEntry {
  name: string;
  type: number;
}

/** Snapshot of a directory's entries, backing a DirFd. */
export interface DirBackend {
  /** Return all entries; the caller snapshots and sorts. */
  list(): DirEntry[];
  /** Release backend resources. Idempotent. */
  close(): void;
}

/** Result of opening a path: a backend handle, never an Fd (callers build the Fd). */
export type OpenResult =
  | { kind: 'file'; backend: FileBackend }
  | { kind: 'dir'; backend: DirBackend };

/** Flags influencing open semantics (WASI oflags + a derived write bit).
 *
 *  Incompatible combinations (open throws EINVAL):
 *    combination          │ reason
 *   ──────────────────────┼───────────────────────────────────
 *    truncate && !write   │ truncation requires write access
 *    exclusive && !create │ EXCL is meaningless without CREAT
 */
export interface OpenFlags {
  /** true: target must be a directory — an existing file throws ENOTDIR,
   *  and with `create` a directory is created instead of a file.
   *  false: opens files; an existing directory still opens as a dir. */
  directory: boolean;
  /** true: create the target if missing (kind chosen by `directory`).
   *  false: missing target throws ENOENT. */
  create: boolean;
  /** Only meaningful with `create`.
   *  true: target must not exist yet — throws EEXIST if it does.
   *  false: an existing target is opened as-is. */
  exclusive: boolean;
  /** true: an existing regular file is cleared to 0 bytes on open.
   *  false: existing content is kept. No effect on dirs or fresh files. */
  truncate: boolean;
  /** true: caller intends to write — read-only backends throw EROFS.
   *  false: read-only access. */
  write: boolean;
}

/** Transport-agnostic virtual filesystem (path ops are sync).
 *
 *  Path contract: every method receives its path(s) **already normalized**
 *  (no `.`, `..`, duplicate or trailing slashes; leading `/` present).
 *  Backends MUST NOT re-normalize. */
export interface Vfs {
  /** Open `path` per `flags`; returns a backend handle (file or dir). With
   *  `create + directory`, creates a directory; with `create` alone, a regular
   *  file. Throws FsError. */
  open(path: string, flags: OpenFlags): OpenResult;
  /** Stat `path`: size in bytes and WASI filetype. Throws FsError (e.g. ENOENT). */
  stat(path: string): { size: number; filetype: number };
  /** Remove the entry at `path`. Throws FsError (ENOENT if missing,
   *  ENOTEMPTY if a non-empty directory).
   *
   *  `directory: true`  — entry must be a directory; a file yields ENOTDIR.
   *  `directory: false` — entry must be a regular file; a dir yields EISDIR.
   *  Omitted — either type is accepted. */
  remove(path: string, opts?: { directory: boolean }): void;
  /** Rename `oldPath` to `newPath` (POSIX semantics). Throws FsError. */
  rename(oldPath: string, newPath: string): void;
  /** Backend metadata dict (JSON) — type, stats, nested backends. */
  info(): Record<string, unknown>;
}

/** Thrown by Vfs methods on failure; carries a WASI errno (see Result). */
export class FsError extends Error {
  readonly payload: { errno: number };
  constructor(readonly errno: number) {
    super(`fs error: errno ${errno}`);
    this.name = 'FsError';
    this.payload = { errno };
  }
}
