import { describe, expect, it } from 'vitest';
import type { Fd } from '../../src/fd';
import { FdTable } from '../../src/fd-table';

describe('FdTable', () => {
  it('open allocates increasing fds starting at 3', () => {
    const t = new FdTable();
    expect(t.open({} as Fd, 0n)).toBe(3);
    expect(t.open({} as Fd, 0n)).toBe(4);
  });

  it('open with fd reserves it and bumps nextFd past it', () => {
    const t = new FdTable();
    t.open({} as Fd, 0n, { fd: 5 });
    expect(t.has(5)).toBe(true);
    expect(t.open({} as Fd, 0n)).toBe(6);
  });

  it('open with fd below nextFd does not roll it back', () => {
    const t = new FdTable();
    t.open({} as Fd, 0n); // -> 3
    t.open({} as Fd, 0n, { fd: 1 });
    expect(t.open({} as Fd, 0n)).toBe(4);
  });

  it('open with a taken fd closes the old entry first (no silent leak)', () => {
    const t = new FdTable();
    let oldClosed = 0,
      oldHook = 0;
    t.open(
      {
        close: () => {
          oldClosed++;
        },
      } as unknown as Fd,
      0n,
      {
        fd: 3,
        onClose: () => {
          oldHook++;
        },
      },
    );
    const fresh = {} as Fd;
    const fd = t.open(fresh, 1n, { fd: 3 });
    expect(fd).toBe(3);
    expect(oldClosed).toBe(1);
    expect(oldHook).toBe(1);
    expect(t.get(3)?.desc).toBe(fresh);
    expect(t.get(3)?.rights).toBe(1n);
  });

  it('get returns the stored entry', () => {
    const t = new FdTable();
    const fd = {} as Fd;
    t.open(fd, 1n, { fd: 3 });
    const e = t.get(3);
    expect(e?.desc).toBe(fd);
    expect(e?.rights).toBe(1n);
  });

  it('has returns false for an unknown fd', () => {
    expect(new FdTable().has(42)).toBe(false);
  });

  it('close removes the entry and invokes fd.close()', () => {
    const t = new FdTable();
    let closes = 0;
    const fd = {
      close: () => {
        closes++;
      },
    } as unknown as Fd;
    t.open(fd, 0n, { fd: 3 });
    expect(t.close(3)).toBe(true);
    expect(t.has(3)).toBe(false);
    expect(closes).toBe(1);
  });

  it('close on an unknown fd returns false', () => {
    expect(new FdTable().close(99)).toBe(false);
  });

  it('close runs the optional onClose hook', () => {
    const t = new FdTable();
    let portClosed = false;
    t.open({ close() {} } as unknown as Fd, 0n, {
      fd: 3,
      onClose: () => {
        portClosed = true;
      },
    });
    t.close(3);
    expect(portClosed).toBe(true);
  });

  it('renumber moves an entry from->to (desc/rights travel; from gone)', () => {
    const t = new FdTable();
    const fd = {} as Fd;
    t.open(fd, 5n, { fd: 3 });
    expect(t.renumber(3, 9)).toBe(true);
    expect(t.has(3)).toBe(false);
    expect(t.has(9)).toBe(true);
    expect(t.get(9)?.desc).toBe(fd);
    expect(t.get(9)?.rights).toBe(5n);
  });

  it('renumber onto an existing fd closes the target first', () => {
    const t = new FdTable();
    let closedTarget = 0;
    const target = {
      close: () => {
        closedTarget++;
      },
    } as unknown as Fd;
    const mover = {} as Fd;
    t.open(target, 0n, { fd: 4 });
    t.open(mover, 1n, { fd: 5 });
    expect(t.renumber(5, 4)).toBe(true);
    expect(closedTarget).toBe(1);
    expect(t.get(4)?.desc).toBe(mover);
    expect(t.has(5)).toBe(false);
  });

  it('renumber runs target onClose but not mover onClose (hook travels)', () => {
    const t = new FdTable();
    let targetHook = 0,
      moverHook = 0;
    t.open({ close() {} } as unknown as Fd, 0n, {
      fd: 4,
      onClose: () => {
        targetHook++;
      },
    });
    t.open({ close() {} } as unknown as Fd, 0n, {
      fd: 5,
      onClose: () => {
        moverHook++;
      },
    });
    t.renumber(5, 4);
    expect(targetHook).toBe(1);
    expect(moverHook).toBe(0);
    t.close(4);
    expect(moverHook).toBe(1);
  });

  it('renumber from===to is a no-op (does not close)', () => {
    const t = new FdTable();
    let closes = 0;
    t.open(
      {
        close: () => {
          closes++;
        },
      } as unknown as Fd,
      0n,
      { fd: 3 },
    );
    expect(t.renumber(3, 3)).toBe(true);
    expect(closes).toBe(0);
    expect(t.has(3)).toBe(true);
  });

  it('renumber unknown from returns false', () => {
    expect(new FdTable().renumber(99, 3)).toBe(false);
  });

  it('renumber updates nextFd when target exceeds current', () => {
    const t = new FdTable();
    t.open({} as Fd, 0n, { fd: 3 });
    t.renumber(3, 20);
    expect(t.open({} as Fd, 0n)).toBe(21);
  });

  it('closeAll closes every entry (desc.close + onClose) and empties the table', () => {
    const t = new FdTable();
    let closes = 0,
      hooks = 0;
    t.open(
      {
        close: () => {
          closes++;
        },
      } as unknown as Fd,
      0n,
      {
        fd: 0,
        onClose: () => {
          hooks++;
        },
      },
    );
    t.open(
      {
        close: () => {
          closes++;
        },
      } as unknown as Fd,
      0n,
      {
        fd: 1,
        onClose: () => {
          hooks++;
        },
      },
    );
    t.open(
      {
        close: () => {
          closes++;
        },
      } as unknown as Fd,
      0n,
      { fd: 2 },
    );
    t.closeAll();
    expect(closes).toBe(3);
    expect(hooks).toBe(2);
    expect(t.has(0)).toBe(false);
    expect(t.has(1)).toBe(false);
    expect(t.has(2)).toBe(false);
  });

  it('closeAll on an empty table is a no-op', () => {
    const t = new FdTable();
    expect(() => t.closeAll()).not.toThrow();
  });
});
