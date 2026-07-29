// Fd table — allocates fd numbers and tracks open file descriptors.
import type { Fd } from './fd';

export interface FdEntry {
  desc: Fd;
  rights: bigint;
  /** Extra teardown beyond fd.close() — e.g. closing an associated transport. */
  onClose?: () => void;
}

export class FdTable {
  private readonly entries = new Map<number, FdEntry>();
  private nextFd = 3;

  get(fd: number): FdEntry | undefined {
    return this.entries.get(fd);
  }

  has(fd: number): boolean {
    return this.entries.has(fd);
  }

  /** Open a new fd. If opts.fd is given, reserve that number (for well-known
   *  fds like 0/1/2) and bump nextFd past it; otherwise allocate the next
   *  number automatically. An already-open fd is closed first (no leak). */
  open(desc: Fd, rights: bigint, opts?: { fd?: number; onClose?: () => void }): number {
    const fd = opts?.fd ?? this.nextFd++;
    if (this.entries.has(fd)) this.close(fd);
    this.entries.set(fd, { desc, rights, onClose: opts?.onClose });
    if (fd >= this.nextFd) this.nextFd = fd + 1;
    return fd;
  }

  /** Close the fd: calls desc.close() and the optional onClose hook.
   *  Returns false if fd is unknown. */
  close(fd: number): boolean {
    const entry = this.entries.get(fd);
    if (!entry) return false;
    entry.desc.close();
    entry.onClose?.();
    return this.entries.delete(fd);
  }

  /** Close every open fd (desc.close + onClose for each). */
  closeAll(): void {
    for (const fd of [...this.entries.keys()]) this.close(fd);
  }

  /** Renumber fd `from` to `to`. If `to` is open it is closed first
   *  (desc.close() + onClose). The `from` descriptor is NOT closed and its
   *  onClose travels with it — only its number changes. Returns false if
   *  `from` is unknown; true if `from === to` (no-op) or the move succeeds. */
  renumber(from: number, to: number): boolean {
    const fromEntry = this.entries.get(from);
    if (!fromEntry) return false;
    if (from === to) return true;
    if (this.entries.has(to)) this.close(to);
    this.entries.set(to, fromEntry);
    this.entries.delete(from);
    if (to >= this.nextFd) this.nextFd = to + 1;
    return true;
  }
}
