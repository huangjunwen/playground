// Vfs factory. createVfs dispatches by `config.backend` to construct a Vfs
// tree from a plain config object, so callers don't need to import specific
// backends. VfsFactory itself stays async: a backend may need to
// do async setup before it can expose a sync interface (e.g. acquiring an
// OPFS access handle); the sync boundary starts after the factory resolves.

import type { Vfs } from './fs';

export type VfsFactory = (config: Record<string, unknown>) => Promise<Vfs>;

// Empty by design — every backend (memory, opfs, ...) registers itself via
// registerVfs at the composition root (host.ts). The registry knows no concrete
// Vfs, so it never imports a backend module.
const registry = new Map<string, VfsFactory>();

/** Register a Vfs factory under `name`. Idempotent — re-registration is a no-op. */
export function registerVfs(name: string, factory: VfsFactory): void {
  if (registry.has(name)) return;
  registry.set(name, factory);
}

export function getVfsFactory(name: string): VfsFactory | undefined {
  return registry.get(name);
}

/** Construct a Vfs from a backend config object. Reads `config.backend` to find
 *  the factory, then calls it with the full config. */
export async function createVfs(config: Record<string, unknown>): Promise<Vfs> {
  const backend = config.backend as string;
  const factory = getVfsFactory(backend);
  if (!factory) throw new Error(`unknown VFS backend: ${backend}`);
  return factory(config);
}
