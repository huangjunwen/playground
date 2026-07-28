import { describe, expect, it } from 'vitest';
import { Filetype, Result } from '../../src/consts';
import { DirFd } from '../../src/fd-dir';
import type { DirEntry } from '../../src/fs';

const EISDIR = { ok: false, errno: Result.EISDIR };
const ESPIPE = { ok: false, errno: Result.ESPIPE };

function dirFd(entries: DirEntry[] = []): DirFd {
  return new DirFd(entries, '/');
}

// DirFd.readdir always returns ok:true — pull entries out for field-level checks.
function readdirEntries(fd: DirFd): readonly DirEntry[] {
  const r = fd.readdir();
  if (!r.ok) throw new Error('DirFd.readdir should succeed');
  return r.entries;
}

describe('DirFd — identity', () => {
  it('filetype is DIRECTORY', () => {
    expect(dirFd().filetype).toBe(Filetype.DIRECTORY);
  });

  it('carries its vfsPath', () => {
    expect(new DirFd([], '/foo/bar').vfsPath).toBe('/foo/bar');
  });
});

describe('DirFd.readdir', () => {
  it('returns entries sorted by name (fd_readdir walks a stable order)', () => {
    const fd = dirFd([
      { name: 'c.txt', type: Filetype.REGULAR_FILE },
      { name: 'a.txt', type: Filetype.REGULAR_FILE },
      { name: 'b.dir', type: Filetype.DIRECTORY },
    ]);
    expect(readdirEntries(fd).map(e => e.name)).toEqual(['a.txt', 'b.dir', 'c.txt']);
  });

  it('snapshots — later mutation of the input array is not visible', () => {
    const input: DirEntry[] = [
      { name: 'b', type: Filetype.REGULAR_FILE },
      { name: 'a', type: Filetype.REGULAR_FILE },
    ];
    const fd = dirFd(input);
    input.push({ name: '0-zulu', type: Filetype.REGULAR_FILE });
    expect(readdirEntries(fd).map(e => e.name)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const input: DirEntry[] = [
      { name: 'b', type: Filetype.REGULAR_FILE },
      { name: 'a', type: Filetype.REGULAR_FILE },
    ];
    dirFd(input);
    expect(input.map(e => e.name)).toEqual(['b', 'a']);
  });

  it('is empty for an empty directory', () => {
    expect(dirFd().readdir()).toEqual({ ok: true, entries: [] });
  });
});

describe('DirFd — byte ops reject with EISDIR (POSIX read/write on a directory)', () => {
  it('read', () => expect(dirFd().read()).toEqual(EISDIR));
  it('write', () => expect(dirFd().write()).toEqual(EISDIR));
  it('pread', () => expect(dirFd().pread()).toEqual(EISDIR));
  it('pwrite', () => expect(dirFd().pwrite()).toEqual(EISDIR));
  it('truncate (POSIX ftruncate(dirfd) → EISDIR)', () =>
    expect(dirFd().truncate()).toEqual(EISDIR));
});

describe('DirFd — seek/tell reject with ESPIPE (dir fd offset is meaningless in WASI)', () => {
  // WASI fd_readdir walks entries via an explicit cookie, not the fd offset, so
  // seeking a dir is well-defined only as "not allowed". ESPIPE is the
  // spec-listed errno wasmtime/wazero return for non-seekable fds. fd_tell is
  // defined as fd_seek(fd, 0, CUR), so it must return the same errno — the two
  // are an inseparable pair.
  it('seek', () => expect(dirFd().seek()).toEqual(ESPIPE));
  it('tell (symmetric with seek)', () => expect(dirFd().tell()).toEqual(ESPIPE));
});
