import { Filetype, Result, Whence } from './consts';
import { Fd, type ReadResult, type SeekResult, type WriteResult } from './fd';
import type { FileBackend } from './fs';
import type { IovecValue } from './struct';

export class FileFd extends Fd {
  readonly filetype = Filetype.REGULAR_FILE;

  private cursor = 0;
  private nb = false;

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
    let n = 0;
    for (const { buf, len } of iovs) {
      if (len === 0) continue;
      try {
        this.backend.write(this.cursor + n, mem.subarray(buf, buf + len));
      } catch {
        return { ok: false, errno: Result.EIO };
      }
      n += len;
    }
    this.cursor += n;
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

  truncate(size: number): void {
    this.backend.setSize(size);
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

  tell(): number {
    return this.cursor;
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

  setNonblocking(nb: boolean): void {
    this.nb = nb;
  }

  getNonblocking(): boolean {
    return this.nb;
  }

  close(): void {
    this.backend.close();
  }
}
