import { describe, expect, it } from 'vitest';
import { Filetype } from '../../src/consts';
import { Fd } from '../../src/fd';
import { DirFd } from '../../src/fd-dir';
import { FileFd } from '../../src/fd-file';
import { MemoryFileBackend } from '../../src/fs-mem';

// The base Fd class throws UnsupportedError from any op a subclass hasn't
// overridden. That throw is a *host-author bug* signal — it means the glue
// layer would have to fall back to a generic errno (ENOTSUP/EBADF) instead of
// the type-specific one the guest expects (EISDIR for read-on-dir, ESPIPE for
// seek-on-dir, …). This test makes that contract explicit per filetype: every
// concrete Fd subclass must override the ops its filetype is reachable through,
// so the correct errno is always returned in user code.

/** True iff `fd`'s class provides its own implementation of `method`
 *  (i.e. did not inherit Fd's default that throws UnsupportedError). */
function isOverridden(fd: Fd, method: keyof Fd): boolean {
  return (fd as any)[method] !== (Fd.prototype as any)[method];
}

/** Per-filetype contract: ops that MUST be overridden by any Fd of that type.
 *  Either the op succeeds or returns a type-specific errno — either way the
 *  base UnsupportedError must not leak. */
const REQUIRED_OPS: Record<number, readonly (keyof Fd)[]> = {
  [Filetype.REGULAR_FILE]: ['read', 'write', 'pread', 'pwrite', 'seek', 'tell', 'truncate'],
  [Filetype.DIRECTORY]: ['readdir', 'read', 'write', 'pread', 'pwrite', 'seek', 'tell', 'truncate'],
};

describe('Fd subclasses — override completeness', () => {
  const samples: { name: string; fd: Fd }[] = [
    { name: 'FileFd', fd: new FileFd(new MemoryFileBackend(new Uint8Array())) },
    { name: 'DirFd', fd: new DirFd([], '/') },
  ];

  for (const { name, fd } of samples) {
    it(`${name} (filetype=${fd.filetype}) overrides every op its filetype requires`, () => {
      const required = REQUIRED_OPS[fd.filetype];
      if (!required) {
        throw new Error(`no REQUIRED_OPS entry for filetype=${fd.filetype}; add one`);
      }
      const missing = required.filter(m => !isOverridden(fd, m));
      expect(missing, `${name} forgot to override: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('REQUIRED_OPS covers every sample filetype (no silent gaps)', () => {
    const uncovered = samples.map(s => s.fd.filetype).filter(t => !(t in REQUIRED_OPS));
    expect(uncovered).toEqual([]);
  });
});
