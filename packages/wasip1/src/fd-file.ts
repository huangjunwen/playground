import { FdFlags, Filetype, Result, Whence } from './consts';
import {
  Fd,
  type ReaddirResult,
  type ReadResult,
  type SeekResult,
  type TruncateResult,
  type WriteResult,
} from './fd';
import type { FileBackend } from './fs';
import type { IovecValue } from './struct';

export class FileFd extends Fd {
  readonly filetype = Filetype.REGULAR_FILE;

  private cursor = 0;

  constructor(private readonly backend: FileBackend) {
    super();
  }

  read(mem: Uint8Array, iovs: IovecValue[]): ReadResult {
    let n = 0;
    for (const { buf, len } of iovs) {
      if (len === 0) continue;
      let got: number;
      try {
        got = this.backend.read(this.cursor + n, mem.subarray(buf, buf + len));
      } catch {
        return { ok: false, errno: Result.EIO };
      }
      n += got;
      if (got < len) break;
    }
    this.cursor += n;
    return { ok: true, n };
  }

  write(mem: Uint8Array, iovs: IovecValue[]): WriteResult {
    // O_APPEND (FdFlags.APPEND): each fd_write lands at current EOF, ignoring
    // the cursor — matches POSIX O_APPEND. The whole gather is one contiguous
    // append starting at EOF.
    const start = this.hasFlag(FdFlags.APPEND) ? this.backend.getSize() : this.cursor;
    let n = 0;
    for (const { buf, len } of iovs) {
      if (len === 0) continue;
      try {
        this.backend.write(start + n, mem.subarray(buf, buf + len));
      } catch {
        return { ok: false, errno: Result.EIO };
      }
      n += len;
    }
    this.cursor = start + n;
    return { ok: true, n };
  }

  pread(mem: Uint8Array, iovs: IovecValue[], offset: number): ReadResult {
    let n = 0;
    for (const { buf, len } of iovs) {
      if (len === 0) continue;
      let got: number;
      try {
        got = this.backend.read(offset + n, mem.subarray(buf, buf + len));
      } catch {
        return { ok: false, errno: Result.EIO };
      }
      n += got;
      if (got < len) break;
    }
    return { ok: true, n };
  }

  // pwrite writes at the explicit `offset` and ignores O_APPEND — matching the
  // traditional POSIX pwrite contract (offset semantics win; the cursor is
  // untouched).
  pwrite(mem: Uint8Array, iovs: IovecValue[], offset: number): WriteResult {
    let n = 0;
    for (const { buf, len } of iovs) {
      if (len === 0) continue;
      try {
        this.backend.write(offset + n, mem.subarray(buf, buf + len));
      } catch {
        return { ok: false, errno: Result.EIO };
      }
      n += len;
    }
    return { ok: true, n };
  }

  truncate(size: number): TruncateResult {
    this.backend.setSize(size);
    return { ok: true };
  }

  /** Regular files aren't directories → ENOTDIR (POSIX readdir on a non-dir fd). */
  readdir(): ReaddirResult {
    return { ok: false, errno: Result.ENOTDIR };
  }

  seek(offset: number, whence: number): SeekResult {
    let newCursor: number;
    if (whence === Whence.SET) {
      newCursor = offset;
    } else if (whence === Whence.CUR) {
      newCursor = this.cursor + offset;
    } else if (whence === Whence.END) {
      newCursor = this.backend.getSize() + offset;
    } else {
      return { ok: false, errno: Result.EINVAL };
    }
    if (newCursor < 0) return { ok: false, errno: Result.EINVAL };
    this.cursor = newCursor;
    return { ok: true, cursor: newCursor };
  }

  tell(): SeekResult {
    return { ok: true, cursor: this.cursor };
  }

  isReady(_type: number): boolean {
    return true;
  }

  availableBytes(): number {
    return this.backend.getSize() - this.cursor;
  }

  statSize(): number {
    return this.backend.getSize();
  }

  close(): void {
    this.backend.close();
  }
}
