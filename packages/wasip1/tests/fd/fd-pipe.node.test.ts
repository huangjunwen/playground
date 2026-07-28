import { describe, expect, it } from 'vitest';
import { EVENTTYPE, FdFlags, Filetype, Result } from '../../src/consts';
import { PipeReadFd, PipeWriteFd } from '../../src/fd-pipe';
import type { StreamConsumer, StreamProvider } from '../../src/ipc';
import type { IovecValue } from '../../src/struct';

// Controlled consumer: pre-seeded queue of outcomes. Each `read()` shifts one.
class StubConsumer implements StreamConsumer {
  private queue: Array<
    { kind: 'chunk'; ab: ArrayBuffer } | { kind: 'eof' } | { kind: 'error'; e: unknown }
  > = [];
  private pendingReader: {
    resolve: (v: ArrayBuffer | null) => void;
    reject: (e: unknown) => void;
  } | null = null;
  cancelled = false;
  cancelReason?: string;
  readCount = 0;

  // Seed the queue before read() — read() returns the outcome synchronously.
  // Models "data already arrived" (createStreamConsumer hits the queue.length>0 branch).
  pushChunk(bytes: Uint8Array): void {
    this.queue.push({ kind: 'chunk', ab: bytes.slice().buffer });
  }
  pushEof(): void {
    this.queue.push({ kind: 'eof' });
  }
  pushError(e: unknown): void {
    this.queue.push({ kind: 'error', e });
  }

  // Resolve a parked reader after read() has returned a pending Promise.
  // Models "slow producer arrives later" (queue was empty, read() parked in pendingReader).
  deliverChunk(bytes: Uint8Array): void {
    this.pendingReader?.resolve(bytes.slice().buffer);
    this.pendingReader = null;
  }
  deliverEof(): void {
    this.pendingReader?.resolve(null);
    this.pendingReader = null;
  }
  deliverError(e: unknown): void {
    this.pendingReader?.reject(e);
    this.pendingReader = null;
  }

  read(): ArrayBuffer | null | Promise<ArrayBuffer | null> {
    this.readCount++;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // Sync returns when queued — matches createStreamConsumer.read() in ipc-mp.ts:
      // data already arrived is handed back without a Promise wrapper.
      if (next.kind === 'chunk') return next.ab;
      if (next.kind === 'eof') return null;
      throw next.e;
    }
    // No queued outcome — park the reader so the test can resolve it later
    // via deliverChunk / deliverEof (matches a real slow producer).
    return new Promise<ArrayBuffer | null>((resolve, reject) => {
      this.pendingReader = { resolve, reject };
    });
  }

  cancel(reason?: string): void {
    this.cancelled = true;
    this.cancelReason = reason;
  }
}

// Controlled provider: records writes; can be set to throw.
class StubProvider implements StreamProvider {
  writes: ArrayBuffer[] = [];
  closed = false;
  errored = false;
  errorMessage?: string;
  onCancel?: (reason?: string) => void;
  rejectNext = false;

  write(chunk: ArrayBuffer): void {
    if (this.rejectNext) {
      this.rejectNext = false;
      throw new Error('provider rejected');
    }
    this.writes.push(chunk);
  }

  close(): void {
    this.closed = true;
  }

  error(message?: string): void {
    this.errored = true;
    this.errorMessage = message;
  }
}

function iovs(...ptrlens: [number, number][]): IovecValue[] {
  return ptrlens.map(([buf, len]) => ({ buf, len }));
}

// ---- PipeReadFd ----

describe('PipeReadFd — identity', () => {
  it('filetype is CHARACTER_DEVICE', () => {
    const fd = new PipeReadFd(new StubConsumer());
    expect(fd.filetype).toBe(Filetype.CHARACTER_DEVICE);
  });
});

describe('PipeReadFd.read', () => {
  it('returns a bare (non-Promise) result when consumer has a chunk queued', () => {
    // Exercises the sync path added by the pull() refactor: consumer.read()
    // returns a bare ArrayBuffer, so read() must return a bare ReadResult
    // rather than a Promise — fd_read then completes without suspending wasm.
    const consumer = new StubConsumer();
    consumer.pushChunk(new Uint8Array([1, 2]));
    const fd = new PipeReadFd(consumer);
    const mem = new Uint8Array(8);
    const r = fd.read(mem, iovs([0, 2]));
    expect(r).not.toBeInstanceOf(Promise);
    expect(r).toEqual({ ok: true, n: 2 });
    expect(Array.from(mem.slice(0, 2))).toEqual([1, 2]);
  });

  it('returns a bare result on sync EOF (first observation)', () => {
    const consumer = new StubConsumer();
    consumer.pushEof();
    const fd = new PipeReadFd(consumer);
    const mem = new Uint8Array(8);
    const r = fd.read(mem, iovs([0, 4]));
    expect(r).not.toBeInstanceOf(Promise);
    expect(r).toEqual({ ok: true, n: 0 });
  });

  it('returns a bare EIO on sync throw (first observation)', () => {
    const consumer = new StubConsumer();
    consumer.pushError(new Error('boom'));
    const fd = new PipeReadFd(consumer);
    const mem = new Uint8Array(8);
    const r = fd.read(mem, iovs([0, 4]));
    expect(r).not.toBeInstanceOf(Promise);
    expect(r).toEqual({ ok: false, errno: Result.EIO });
  });

  it('reads chunk data and scatters into iovs', async () => {
    const consumer = new StubConsumer();
    consumer.pushChunk(new Uint8Array([1, 2, 3, 4, 5]));
    const fd = new PipeReadFd(consumer);
    const mem = new Uint8Array(16);
    const result = await fd.read(mem, iovs([0, 2], [8, 2]));
    expect(result).toEqual({ ok: true, n: 4 });
    expect(Array.from(mem.slice(0, 2))).toEqual([1, 2]);
    expect(Array.from(mem.slice(8, 10))).toEqual([3, 4]);
  });

  it('leftover from one chunk is consumed by next read', async () => {
    const consumer = new StubConsumer();
    consumer.pushChunk(new Uint8Array([10, 20, 30, 40, 50]));
    const fd = new PipeReadFd(consumer);
    const mem = new Uint8Array(16);
    const first = await fd.read(mem, iovs([0, 2]));
    expect(first).toEqual({ ok: true, n: 2 });
    expect(Array.from(mem.slice(0, 2))).toEqual([10, 20]);
    expect(fd.availableBytes()).toBe(3);
    const second = await fd.read(mem, iovs([2, 2]));
    expect(second).toEqual({ ok: true, n: 2 });
    expect(Array.from(mem.slice(2, 4))).toEqual([30, 40]);
    expect(fd.availableBytes()).toBe(1);
  });

  it('EOF chunk produces zero-length read', async () => {
    const consumer = new StubConsumer();
    consumer.pushEof();
    const fd = new PipeReadFd(consumer);
    const mem = new Uint8Array(8);
    const r = await fd.read(mem, iovs([0, 4]));
    expect(r).toEqual({ ok: true, n: 0 });
    // eof is sticky
    const r2 = await fd.read(mem, iovs([0, 4]));
    expect(r2).toEqual({ ok: true, n: 0 });
  });

  it('error chunk produces EIO and sticks', async () => {
    const consumer = new StubConsumer();
    consumer.pushError(new Error('boom'));
    const fd = new PipeReadFd(consumer);
    const mem = new Uint8Array(8);
    const r = await fd.read(mem, iovs([0, 4]));
    expect(r).toEqual({ ok: false, errno: Result.EIO });
    // err is sticky
    const r2 = await fd.read(mem, iovs([0, 4]));
    expect(r2).toEqual({ ok: false, errno: Result.EIO });
  });

  it('nonblocking with empty buffer returns EAGAIN', async () => {
    const consumer = new StubConsumer();
    const fd = new PipeReadFd(consumer);
    fd.setFlags(FdFlags.NONBLOCK);
    expect(fd.hasFlag(FdFlags.NONBLOCK)).toBe(true);
    const mem = new Uint8Array(8);
    const r = await fd.read(mem, iovs([0, 4]));
    expect(r).toEqual({ ok: false, errno: Result.EAGAIN });
  });

  it('nonblocking with consumer sync data returns the chunk (not EAGAIN)', async () => {
    const consumer = new StubConsumer();
    consumer.pushChunk(new Uint8Array([10, 20]));
    const fd = new PipeReadFd(consumer);
    fd.setFlags(FdFlags.NONBLOCK);
    const mem = new Uint8Array(8);
    const r = await fd.read(mem, iovs([0, 4]));
    expect(r).toEqual({ ok: true, n: 2 });
    expect(mem[0]).toBe(10);
    expect(mem[1]).toBe(20);
  });

  it('suspends (returns a Promise) when the producer is slow, then resolves', async () => {
    // Exercises read()'s async branch: empty queue → pull() parks the consumer
    // → read returns `pulled.then(consume)`. Delivering a chunk resolves it.
    const consumer = new StubConsumer();
    const fd = new PipeReadFd(consumer);
    const mem = new Uint8Array(8);
    const p = fd.read(mem, iovs([0, 4]));
    expect(p).toBeInstanceOf(Promise);
    consumer.deliverChunk(new Uint8Array([7, 8, 9]));
    const r = await p;
    expect(r).toEqual({ ok: true, n: 3 });
    expect(Array.from(mem.slice(0, 3))).toEqual([7, 8, 9]);
  });

  it('async consumer reject produces EIO and sticks', async () => {
    // Exercises pullAsync's catch (await raw rejects → err=true).
    const consumer = new StubConsumer();
    const fd = new PipeReadFd(consumer);
    const mem = new Uint8Array(8);
    const p = fd.read(mem, iovs([0, 4]));
    expect(p).toBeInstanceOf(Promise);
    consumer.deliverError(new Error('transport died'));
    const r = await p;
    expect(r).toEqual({ ok: false, errno: Result.EIO });
    // err is sticky
    const r2 = await fd.read(mem, iovs([0, 4]));
    expect(r2).toEqual({ ok: false, errno: Result.EIO });
  });

  it('pullPromise dedup: consumer.read() called once across concurrent onReady/read while pull in flight', async () => {
    // Core invariant (see pullPromise doc): StreamConsumer is single-reader,
    // so a second pull() while one is in flight must reuse the cached promise
    // instead of calling consumer.read() again.
    const consumer = new StubConsumer();
    const fd = new PipeReadFd(consumer);
    fd.onReady(EVENTTYPE.FD_READ, () => {});
    expect(consumer.readCount).toBe(1);
    // Second onReady while pull is in flight — must NOT call consumer.read() again.
    fd.onReady(EVENTTYPE.FD_READ, () => {});
    expect(consumer.readCount).toBe(1);
    // read() while pull is in flight shares the same pullPromise.
    const mem = new Uint8Array(8);
    const p = fd.read(mem, iovs([0, 4]));
    expect(p).toBeInstanceOf(Promise);
    expect(consumer.readCount).toBe(1);
    consumer.deliverChunk(new Uint8Array([1]));
    const r = await p;
    expect(r).toEqual({ ok: true, n: 1 });
  });
});

describe('PipeReadFd — unsupported ops', () => {
  // Read-end: every op except read returns its type-specific errno.
  const fd = new PipeReadFd(new StubConsumer());

  it('write → ENOTCAPABLE (read-end lacks FD_WRITE)', () => {
    expect(fd.write()).toEqual({ ok: false, errno: Result.ENOTCAPABLE });
  });

  it('pread → ESPIPE (pipes are non-seekable)', () => {
    expect(fd.pread()).toEqual({ ok: false, errno: Result.ESPIPE });
  });

  it('pwrite → ESPIPE', () => {
    expect(fd.pwrite()).toEqual({ ok: false, errno: Result.ESPIPE });
  });

  it('seek → ESPIPE', () => {
    expect(fd.seek()).toEqual({ ok: false, errno: Result.ESPIPE });
  });

  it('tell → ESPIPE', () => {
    expect(fd.tell()).toEqual({ ok: false, errno: Result.ESPIPE });
  });

  it('truncate → EINVAL (POSIX ftruncate on non-regular-file)', () => {
    expect(fd.truncate()).toEqual({ ok: false, errno: Result.EINVAL });
  });

  it('readdir → ENOTDIR (pipes are not directories)', () => {
    expect(fd.readdir()).toEqual({ ok: false, errno: Result.ENOTDIR });
  });
});

describe('PipeReadFd — readiness', () => {
  it('onReady fires after a chunk is pulled into leftover', async () => {
    const consumer = new StubConsumer();
    consumer.pushChunk(new Uint8Array([99, 100]));
    const fd = new PipeReadFd(consumer);
    expect(fd.isReady(EVENTTYPE.FD_READ)).toBe(false);
    await new Promise<void>(resolve => {
      fd.onReady(EVENTTYPE.FD_READ, resolve);
    });
    expect(fd.isReady(EVENTTYPE.FD_READ)).toBe(true);
    expect(fd.availableBytes()).toBe(2);
    const mem = new Uint8Array(8);
    const r = await fd.read(mem, iovs([0, 2]));
    expect(r).toEqual({ ok: true, n: 2 });
    expect(Array.from(mem.slice(0, 2))).toEqual([99, 100]);
  });

  it('onReady fires immediately when already ready (eof)', async () => {
    const consumer = new StubConsumer();
    consumer.pushEof();
    const fd = new PipeReadFd(consumer);
    await new Promise<void>(resolve => {
      fd.onReady(EVENTTYPE.FD_READ, resolve);
    });
    expect(fd.isReady(EVENTTYPE.FD_READ)).toBe(true);
  });

  it('onReady fires when async pull resolves with data', async () => {
    const consumer = new StubConsumer();
    const fd = new PipeReadFd(consumer);
    let fired = false;
    fd.onReady(EVENTTYPE.FD_READ, () => {
      fired = true;
    });
    expect(fired).toBe(false);
    consumer.deliverChunk(new Uint8Array([1, 2]));
    await Promise.resolve();
    expect(fired).toBe(true);
    expect(fd.isReady(EVENTTYPE.FD_READ)).toBe(true);
  });

  it('deregistered callback does not fire when async pull resolves', async () => {
    const consumer = new StubConsumer();
    const fd = new PipeReadFd(consumer);
    let fired = false;
    const cleanup = fd.onReady(EVENTTYPE.FD_READ, () => {
      fired = true;
    });
    cleanup();
    consumer.deliverChunk(new Uint8Array([1, 2]));
    await Promise.resolve();
    expect(fired).toBe(false);
  });

  it('onReady for non-FD_READ type never fires', () => {
    const fd = new PipeReadFd(new StubConsumer());
    return new Promise<void>(resolve => {
      let fired = false;
      const cleanup = fd.onReady(EVENTTYPE.FD_WRITE, () => {
        fired = true;
      });
      const t = setTimeout(() => {
        clearTimeout(t);
        cleanup();
        expect(fired).toBe(false);
        resolve();
      }, 20);
    });
  });

  it('onReady fires all registered listeners when async pull resolves', async () => {
    // notify() iterates the listener set — multiple poll cycles may register
    // multiple callbacks; all must fire when the chunk arrives.
    const consumer = new StubConsumer();
    const fd = new PipeReadFd(consumer);
    let fired1 = false;
    let fired2 = false;
    fd.onReady(EVENTTYPE.FD_READ, () => {
      fired1 = true;
    });
    fd.onReady(EVENTTYPE.FD_READ, () => {
      fired2 = true;
    });
    expect(fired1).toBe(false);
    expect(fired2).toBe(false);
    consumer.deliverChunk(new Uint8Array([1]));
    await Promise.resolve();
    expect(fired1).toBe(true);
    expect(fired2).toBe(true);
  });

  it('isReady is false for non-FD_READ types', () => {
    const fd = new PipeReadFd(new StubConsumer());
    expect(fd.isReady(EVENTTYPE.FD_WRITE)).toBe(false);
  });
});

describe('PipeReadFd.close', () => {
  it('cancels the consumer', () => {
    const consumer = new StubConsumer();
    const fd = new PipeReadFd(consumer);
    fd.close();
    expect(consumer.cancelled).toBe(true);
  });
});

// ---- PipeWriteFd ----

describe('PipeWriteFd — identity', () => {
  it('filetype is CHARACTER_DEVICE', () => {
    const fd = new PipeWriteFd(new StubProvider());
    expect(fd.filetype).toBe(Filetype.CHARACTER_DEVICE);
  });
});

describe('PipeWriteFd.write', () => {
  it('gathers iovs and forwards to provider', async () => {
    const provider = new StubProvider();
    const fd = new PipeWriteFd(provider);
    const mem = new Uint8Array(8);
    mem.set([1, 2, 3, 4], 0);
    const r = await fd.write(mem, iovs([0, 2], [2, 2]));
    expect(r).toEqual({ ok: true, n: 4 });
    expect(provider.writes.length).toBe(1);
    expect(Array.from(new Uint8Array(provider.writes[0]!))).toEqual([1, 2, 3, 4]);
  });

  it('returns EPIPE when provider rejects', async () => {
    const provider = new StubProvider();
    provider.rejectNext = true;
    const fd = new PipeWriteFd(provider);
    const mem = new Uint8Array(8);
    const r = await fd.write(mem, iovs([0, 2]));
    expect(r).toEqual({ ok: false, errno: Result.EPIPE });
  });
});

describe('PipeWriteFd — unsupported ops', () => {
  // Write-end: every op except write returns its type-specific errno.
  const fd = new PipeWriteFd(new StubProvider());

  it('read → ENOTCAPABLE (write-end lacks FD_READ)', () => {
    expect(fd.read()).toEqual({ ok: false, errno: Result.ENOTCAPABLE });
  });

  it('pread → ESPIPE', () => {
    expect(fd.pread()).toEqual({ ok: false, errno: Result.ESPIPE });
  });

  it('pwrite → ESPIPE', () => {
    expect(fd.pwrite()).toEqual({ ok: false, errno: Result.ESPIPE });
  });

  it('seek → ESPIPE', () => {
    expect(fd.seek()).toEqual({ ok: false, errno: Result.ESPIPE });
  });

  it('tell → ESPIPE', () => {
    expect(fd.tell()).toEqual({ ok: false, errno: Result.ESPIPE });
  });

  it('truncate → EINVAL', () => {
    expect(fd.truncate()).toEqual({ ok: false, errno: Result.EINVAL });
  });

  it('readdir → ENOTDIR', () => {
    expect(fd.readdir()).toEqual({ ok: false, errno: Result.ENOTDIR });
  });
});

describe('PipeWriteFd — readiness', () => {
  it('isReady is true for FD_WRITE only', () => {
    const fd = new PipeWriteFd(new StubProvider());
    expect(fd.isReady(EVENTTYPE.FD_WRITE)).toBe(true);
    expect(fd.isReady(EVENTTYPE.FD_READ)).toBe(false);
  });

  it('onReady for FD_WRITE fires immediately', async () => {
    const fd = new PipeWriteFd(new StubProvider());
    await new Promise<void>(resolve => {
      fd.onReady(EVENTTYPE.FD_WRITE, resolve);
    });
  });

  it('onReady for FD_READ never fires', () => {
    const fd = new PipeWriteFd(new StubProvider());
    return new Promise<void>(resolve => {
      let fired = false;
      const cleanup = fd.onReady(EVENTTYPE.FD_READ, () => {
        fired = true;
      });
      const t = setTimeout(() => {
        clearTimeout(t);
        cleanup();
        expect(fired).toBe(false);
        resolve();
      }, 20);
    });
  });
});

describe('PipeWriteFd.close', () => {
  it('closes the provider', () => {
    const provider = new StubProvider();
    const fd = new PipeWriteFd(provider);
    fd.close();
    expect(provider.closed).toBe(true);
  });
});
