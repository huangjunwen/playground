import { describe, expect, it } from 'vitest';
import { Filetype, Result } from '../../src/consts';
import { FsError, type OpenFlags, type Vfs } from '../../src/fs';
import { MemoryDirBackend, MemoryFileBackend, MemoryVfs } from '../../src/fs-mem';

function flags(over: Partial<OpenFlags> = {}): OpenFlags {
  return {
    create: false,
    exclusive: false,
    truncate: false,
    directory: false,
    ...over,
  };
}

function expectErrno(fn: () => unknown, errno: number): void {
  try {
    fn();
    expect.unreachable('expected FsError to be thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(FsError);
    expect((e as FsError).errno).toBe(errno);
  }
}

function putFile(vfs: Vfs, path: string, data: Uint8Array): void {
  const r = vfs.open(path, flags({ create: true, truncate: true }));
  if (r.kind !== 'file') throw new Error(`putFile: ${path} is not a file`);
  r.backend.write(0, data);
  r.backend.close();
}

function getFile(vfs: Vfs, path: string): Uint8Array {
  const r = vfs.open(path, flags());
  if (r.kind !== 'file') throw new Error(`getFile: ${path} is not a file`);
  const size = r.backend.getSize();
  const dst = new Uint8Array(size);
  r.backend.read(0, dst);
  r.backend.close();
  return dst;
}

describe('MemoryVfs.open', () => {
  // non-existent path cases
  it('missing without create throws ENOENT', () => {
    const vfs = new MemoryVfs();
    expectErrno(() => vfs.open('/x', flags()), Result.ENOENT);
  });
  it('create returns a file backend', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/x', flags({ create: true }));
    expect(r.kind).toBe('file');
    r.backend.close();
  });
  it('open({create, directory}) creates a directory', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/d', flags({ create: true, directory: true }));
    r.backend.close();
    expect(vfs.stat('/d').filetype).toBe(Filetype.DIRECTORY);
  });
  // existing file cases
  it('existing file returns the same backend', () => {
    const vfs = new MemoryVfs();
    const a = vfs.open('/x', flags({ create: true }));
    const b = vfs.open('/x', flags());
    if (a.kind === 'file' && b.kind === 'file') expect(a.backend).toBe(b.backend);
    a.backend.close();
    b.backend.close();
  });
  it('create + exclusive on existing throws EEXIST', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/x', flags({ create: true }));
    r.backend.close();
    expectErrno(() => vfs.open('/x', flags({ create: true, exclusive: true })), Result.EEXIST);
  });
  it('truncate empties an existing file', () => {
    const vfs = new MemoryVfs();
    const a = vfs.open('/x', flags({ create: true }));
    if (a.kind === 'file') a.backend.write(0, new Uint8Array([1, 2, 3, 4]));
    a.backend.close();
    const r = vfs.open('/x', flags());
    if (r.kind === 'file') expect(r.backend.getSize()).toBe(4);
    r.backend.close();
    const b = vfs.open('/x', flags({ truncate: true }));
    if (b.kind === 'file') expect(b.backend.getSize()).toBe(0);
    b.backend.close();
  });
  it('directory flag on a file throws ENOTDIR', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/x', flags({ create: true }));
    r.backend.close();
    expectErrno(() => vfs.open('/x', flags({ directory: true })), Result.ENOTDIR);
  });
  // existing directory cases
  it('opening a directory returns a dir backend', () => {
    const vfs = new MemoryVfs();
    const d = vfs.open('/d', flags({ create: true, directory: true }));
    d.backend.close();
    const r = vfs.open('/d', flags({ directory: true }));
    expect(r.kind).toBe('dir');
    r.backend.close();
  });
  it('opening a directory without directory flag still returns dir', () => {
    const vfs = new MemoryVfs();
    const d = vfs.open('/d', flags({ create: true, directory: true }));
    d.backend.close();
    const r = vfs.open('/d', flags());
    expect(r.kind).toBe('dir');
    r.backend.close();
  });
  it('create + exclusive on existing directory throws EEXIST', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/d', flags({ create: true, directory: true }));
    r.backend.close();
    expectErrno(() => vfs.open('/d', flags({ create: true, directory: true, exclusive: true })), Result.EEXIST);
  });
  // root cases
  it('open / returns root dir', () => {
    const r = new MemoryVfs().open('/', flags());
    expect(r.kind).toBe('dir');
    r.backend.close();
  });
  // path structure error cases
  it('missing parent throws ENOENT', () => {
    const vfs = new MemoryVfs();
    expectErrno(() => vfs.open('/a/b', flags({ create: true })), Result.ENOENT);
  });
});

describe('MemoryFileBackend', () => {
  it('read past EOF returns 0', () => {
    const n = new MemoryFileBackend(new Uint8Array([1, 2, 3]));
    const dst = new Uint8Array(4);
    expect(n.read(5, dst)).toBe(0);
  });
  it('read fills dst and returns bytes read', () => {
    const n = new MemoryFileBackend(new Uint8Array([1, 2, 3, 4]));
    const dst2 = new Uint8Array(2);
    expect(n.read(1, dst2)).toBe(2);
    expect(Array.from(dst2)).toEqual([2, 3]);
    const dst10 = new Uint8Array(10);
    expect(n.read(1, dst10)).toBe(3);
    expect(Array.from(dst10.subarray(0, 3))).toEqual([2, 3, 4]);
  });
  it('write grows the store', () => {
    const n = new MemoryFileBackend(new Uint8Array([1, 2]));
    n.write(4, new Uint8Array([9, 9, 9]));
    expect(n.getSize()).toBe(7);
    expect(Array.from(n.bytes)).toEqual([1, 2, 0, 0, 9, 9, 9]);
  });
  it('write in place when within size', () => {
    const n = new MemoryFileBackend(new Uint8Array([1, 2, 3, 4]));
    n.write(1, new Uint8Array([8, 8]));
    expect(Array.from(n.bytes)).toEqual([1, 8, 8, 4]);
  });
  it('read from start (pos=0)', () => {
    const n = new MemoryFileBackend(new Uint8Array([10, 20, 30]));
    const dst = new Uint8Array(2);
    expect(n.read(0, dst)).toBe(2);
    expect(Array.from(dst)).toEqual([10, 20]);
  });
  it('read from empty file returns 0', () => {
    const n = new MemoryFileBackend(new Uint8Array(0));
    const dst = new Uint8Array(4);
    expect(n.read(0, dst)).toBe(0);
  });
  it('getSize on empty file returns 0', () => {
    expect(new MemoryFileBackend(new Uint8Array(0)).getSize()).toBe(0);
  });
  it('write with empty data is a no-op', () => {
    const n = new MemoryFileBackend(new Uint8Array([1, 2, 3]));
    n.write(0, new Uint8Array(0));
    expect(Array.from(n.bytes)).toEqual([1, 2, 3]);
  });
});

describe('MemoryDirBackend', () => {
  it('list maps to entries with types', () => {
    const d = new MemoryDirBackend();
    d.set('f', new MemoryFileBackend(new Uint8Array(0)));
    d.set('sub', new MemoryDirBackend());
    const entries = d.list();
    expect(entries).toContainEqual({ name: 'f', type: Filetype.REGULAR_FILE });
    expect(entries).toContainEqual({ name: 'sub', type: Filetype.DIRECTORY });
  });
  it('list on empty dir returns []', () => {
    expect(new MemoryDirBackend().list()).toEqual([]);
  });
});

describe('MemoryVfs.stat', () => {
  it('file size and type', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/x', flags({ create: true }));
    if (r.kind === 'file') r.backend.write(0, new Uint8Array([1, 2, 3]));
    r.backend.close();
    expect(vfs.stat('/x')).toEqual({ size: 3, filetype: Filetype.REGULAR_FILE });
  });
  it('directory', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/d', flags({ create: true, directory: true }));
    r.backend.close();
    expect(vfs.stat('/d')).toEqual({ size: 0, filetype: Filetype.DIRECTORY });
  });
  it('missing throws ENOENT', () => {
    expectErrno(() => new MemoryVfs().stat('/x'), Result.ENOENT);
  });
  it('root is a directory', () => {
    expect(new MemoryVfs().stat('/')).toEqual({ size: 0, filetype: Filetype.DIRECTORY });
  });
});

describe('MemoryVfs.remove', () => {
  // success cases
  it('removes a regular file', () => {
    const vfs = new MemoryVfs();
    putFile(vfs, '/x', new Uint8Array([1]));
    vfs.remove('/x');
    expectErrno(() => vfs.stat('/x'), Result.ENOENT);
  });
  it('removes an empty directory', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/d', flags({ create: true, directory: true }));
    r.backend.close();
    vfs.remove('/d');
    expectErrno(() => vfs.stat('/d'), Result.ENOENT);
  });
  // error cases
  it('non-empty directory throws ENOTEMPTY', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/d', flags({ create: true, directory: true }));
    r.backend.close();
    putFile(vfs, '/d/f', new Uint8Array([1]));
    expectErrno(() => vfs.remove('/d'), Result.ENOTEMPTY);
  });
  it('removing root throws EBUSY', () => {
    expectErrno(() => new MemoryVfs().remove('/'), Result.EBUSY);
  });
  it('missing throws ENOENT', () => {
    expectErrno(() => new MemoryVfs().remove('/x'), Result.ENOENT);
  });
  // directory option enforcement
  it('file with directory:true throws ENOTDIR', () => {
    const vfs = new MemoryVfs();
    putFile(vfs, '/x', new Uint8Array([1]));
    expectErrno(() => vfs.remove('/x', { directory: true }), Result.ENOTDIR);
  });
  it('dir with directory:false throws EISDIR', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/d', flags({ create: true, directory: true }));
    r.backend.close();
    expectErrno(() => vfs.remove('/d', { directory: false }), Result.EISDIR);
  });
  it('file with directory:false succeeds', () => {
    const vfs = new MemoryVfs();
    putFile(vfs, '/x', new Uint8Array([1]));
    vfs.remove('/x', { directory: false });
    expectErrno(() => vfs.stat('/x'), Result.ENOENT);
  });
  it('dir with directory:true succeeds', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/d', flags({ create: true, directory: true }));
    r.backend.close();
    vfs.remove('/d', { directory: true });
    expectErrno(() => vfs.stat('/d'), Result.ENOENT);
  });
});

describe('MemoryFileBackend.setSize', () => {
  it('truncates shorter (keeps first n bytes)', () => {
    const n = new MemoryFileBackend(new Uint8Array([1, 2, 3, 4, 5]));
    n.setSize(3);
    expect(n.getSize()).toBe(3);
    expect(Array.from(n.bytes)).toEqual([1, 2, 3]);
  });
  it('extends with zero padding', () => {
    const n = new MemoryFileBackend(new Uint8Array([1, 2]));
    n.setSize(4);
    expect(n.getSize()).toBe(4);
    expect(Array.from(n.bytes)).toEqual([1, 2, 0, 0]);
  });
  it('same size is a no-op', () => {
    const n = new MemoryFileBackend(new Uint8Array([1, 2, 3]));
    n.setSize(3);
    expect(n.getSize()).toBe(3);
    expect(Array.from(n.bytes)).toEqual([1, 2, 3]);
  });
  it('setSize(0) empties the file', () => {
    const n = new MemoryFileBackend(new Uint8Array([1, 2, 3]));
    n.setSize(0);
    expect(n.getSize()).toBe(0);
    expect(Array.from(n.bytes)).toEqual([]);
  });
});

describe('MemoryVfs.rename', () => {
  // success cases
  it('renames a file to a new path', () => {
    const vfs = new MemoryVfs();
    putFile(vfs, '/a', new Uint8Array([1, 2]));
    vfs.rename('/a', '/b');
    expectErrno(() => vfs.stat('/a'), Result.ENOENT);
    expect(Array.from(getFile(vfs, '/b'))).toEqual([1, 2]);
  });
  it('overwrites an existing file', () => {
    const vfs = new MemoryVfs();
    putFile(vfs, '/a', new Uint8Array([9]));
    putFile(vfs, '/b', new Uint8Array([1, 1]));
    vfs.rename('/a', '/b');
    expect(Array.from(getFile(vfs, '/b'))).toEqual([9]);
    expectErrno(() => vfs.stat('/a'), Result.ENOENT);
  });
  it('moves a directory subtree', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/d', flags({ create: true, directory: true }));
    r.backend.close();
    putFile(vfs, '/d/f', new Uint8Array([1]));
    vfs.rename('/d', '/e');
    expect(vfs.stat('/e').filetype).toBe(Filetype.DIRECTORY);
    expect(vfs.stat('/e/f').size).toBe(1);
    expectErrno(() => vfs.stat('/d'), Result.ENOENT);
  });
  it('overwrites an empty directory', () => {
    const vfs = new MemoryVfs();
    const r1 = vfs.open('/a', flags({ create: true, directory: true }));
    r1.backend.close();
    const r2 = vfs.open('/b', flags({ create: true, directory: true }));
    r2.backend.close();
    vfs.rename('/a', '/b');
    expect(vfs.stat('/b').filetype).toBe(Filetype.DIRECTORY);
    expectErrno(() => vfs.stat('/a'), Result.ENOENT);
  });
  it('same path is a no-op', () => {
    const vfs = new MemoryVfs();
    putFile(vfs, '/a', new Uint8Array([1]));
    vfs.rename('/a', '/a');
    expect(Array.from(getFile(vfs, '/a'))).toEqual([1]);
  });
  // error cases
  it('missing old -> ENOENT', () => {
    const vfs = new MemoryVfs();
    expectErrno(() => vfs.rename('/x', '/y'), Result.ENOENT);
  });
  it('missing new parent -> ENOENT', () => {
    const vfs = new MemoryVfs();
    putFile(vfs, '/a', new Uint8Array(0));
    expectErrno(() => vfs.rename('/a', '/nope/b'), Result.ENOENT);
  });
  it('root either way -> EBUSY', () => {
    const vfs = new MemoryVfs();
    expectErrno(() => vfs.rename('/', '/x'), Result.EBUSY);
    expectErrno(() => vfs.rename('/x', '/'), Result.EBUSY);
  });
  it('dir over file -> ENOTDIR', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/a', flags({ create: true, directory: true }));
    r.backend.close();
    putFile(vfs, '/b', new Uint8Array(0));
    expectErrno(() => vfs.rename('/a', '/b'), Result.ENOTDIR);
  });
  it('file over dir -> EISDIR', () => {
    const vfs = new MemoryVfs();
    putFile(vfs, '/a', new Uint8Array(0));
    const r = vfs.open('/b', flags({ create: true, directory: true }));
    r.backend.close();
    expectErrno(() => vfs.rename('/a', '/b'), Result.EISDIR);
  });
  it('non-empty target dir -> ENOTEMPTY', () => {
    const vfs = new MemoryVfs();
    const r1 = vfs.open('/a', flags({ create: true, directory: true }));
    r1.backend.close();
    const r2 = vfs.open('/b', flags({ create: true, directory: true }));
    r2.backend.close();
    putFile(vfs, '/b/c', new Uint8Array(0));
    expectErrno(() => vfs.rename('/a', '/b'), Result.ENOTEMPTY);
  });
  it('rename into own subtree -> EINVAL', () => {
    const vfs = new MemoryVfs();
    const r = vfs.open('/a', flags({ create: true, directory: true }));
    r.backend.close();
    expectErrno(() => vfs.rename('/a', '/a/b'), Result.EINVAL);
  });
});

describe('MemoryVfs.info', () => {
  it('reports type=memory', () => {
    expect(new MemoryVfs().info()).toEqual({ type: 'memory' });
  });
});
