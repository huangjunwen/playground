import { describe, expect, it } from 'vitest';
import { Fd } from '../../src/fd';
import { DirFd } from '../../src/fd-dir';
import { FileFd } from '../../src/fd-file';
import { PipeReadFd, PipeWriteFd } from '../../src/fd-pipe';
import { MemoryFileBackend } from '../../src/fs-mem';
import type { StreamConsumer, StreamProvider } from '../../src/ipc';

// Each concrete Fd subclass overrides the full set of ops a guest might reach
// on it, so every call returns its type-specific errno (EISDIR / ESPIPE /
// ENOTCAPABLE / ENOTDIR / EINVAL / …) instead of leaking the base class's
// UnsupportedError.

/** True iff `fd`'s class provides its own implementation of `method`
 *  (i.e. did not inherit Fd's default). */
function isOverridden(fd: Fd, method: keyof Fd): boolean {
  return (fd as any)[method] !== (Fd.prototype as any)[method];
}

// Minimal stream stubs — the override check only compares function identity,
// it never invokes the methods, so no-ops suffice.
const stubConsumer: StreamConsumer = { read: () => null, cancel: () => {} };
const stubProvider: StreamProvider = { write: () => {}, close: () => {}, error: () => {} };

const samples: { name: string; fd: Fd; required: readonly (keyof Fd)[] }[] = [
  {
    name: 'FileFd',
    fd: new FileFd(new MemoryFileBackend(new Uint8Array())),
    required: ['read', 'write', 'pread', 'pwrite', 'seek', 'tell', 'truncate', 'readdir', 'close'],
  },
  {
    name: 'DirFd',
    fd: new DirFd([], '/'),
    required: ['readdir', 'read', 'write', 'pread', 'pwrite', 'seek', 'tell', 'truncate'],
  },
  {
    name: 'PipeReadFd',
    fd: new PipeReadFd(stubConsumer),
    required: [
      'read',
      'write',
      'pread',
      'pwrite',
      'seek',
      'tell',
      'truncate',
      'readdir',
      'isReady',
      'onReady',
      'availableBytes',
      'close',
    ],
  },
  {
    name: 'PipeWriteFd',
    fd: new PipeWriteFd(stubProvider),
    required: [
      'write',
      'read',
      'pread',
      'pwrite',
      'seek',
      'tell',
      'truncate',
      'readdir',
      'isReady',
      'onReady',
      'close',
    ],
  },
];

describe('Fd subclasses — override completeness', () => {
  for (const { name, fd, required } of samples) {
    it(`${name} overrides every op its contract requires`, () => {
      const missing = required.filter(m => !isOverridden(fd, m));
      expect(missing, `${name} forgot to override: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
