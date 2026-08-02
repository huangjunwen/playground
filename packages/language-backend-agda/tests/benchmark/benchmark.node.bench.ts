/**
 * ALS `cmdLoad` benchmark — Node side.
 *
 * Execution model: spawn a Node subprocess running `node:wasi` via
 * `NodeWasiRunEnv` (spawning is required because `node:wasi`'s synchronous
 * `start(instance)` blocks the event loop forever for an LSP server). Browser
 * counterpart lives in `benchmark.web.bench.ts`.
 *
 * Measures warm round-trip time of `cmdLoad` for small/medium/large Agda
 * sources (see `./sources.ts`). `als --setup` runs once per workspace temp
 * dir in `beforeAll`; per-size timings happen against the primed module cache.
 *
 * NOTE: setup lives at module top level (no `describe` wrapper). vitest's
 * benchmark runner (`runBenchmarkSuite`) invokes top-level `beforeAll`/
 * `afterAll` but does NOT invoke hooks registered on a `describe` sub-suite —
 * wrapping in describe leaves `beforeAll` un-run and every bench errors (NaN).
 *
 * Run with:  pnpm --filter @playground/language-backend-agda test:bench:node
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeWasiRunEnv } from '@playground/run-env/node';
import { afterAll, beforeAll, bench } from 'vitest';
import { DEFAULT_ALS_WORKSPACE, defaultAgdaDataDir } from '../../src/defaults';
import { CommandBuilder } from '../../src/protocol/commands';
import { type AlsHandle, runAls } from '../../src/run';
import { expectLoadResult } from './expect-load';
import { SOURCES } from './sources';

// V8 flags injected into the node:wasi subprocess, selected by env:
// ALS_CPU_PROF=1 -> CPU profile into /tmp/als-node-cp; ALS_TIER=liftoff/turbofan.
const NODE_V8_FLAGS = (() => {
  const tier = process.env.ALS_TIER;
  if (tier === 'liftoff') return ['--liftoff-only'];
  if (tier === 'turbofan') return ['--no-liftoff'];
  if (process.env.ALS_CPU_PROF) return ['--cpu-prof', '--cpu-prof-dir=/tmp/als-node-cp'];
  return [];
})();

const WARMUP = 1;
const ITERS = 5;
const COMMAND_TIMEOUT_MS = 60_000;
const SETUP_TIMEOUT_MS = 60_000; // setup extracts builtin sources in ~1s; covers setup + the 3 sanity cmdLoads

let runner: { env: NodeWasiRunEnv; handle: AlsHandle };
let workspaceRoot: string;
let dataDir: string;

const loadOnce = (file: string): Promise<unknown> => {
  const path = `${DEFAULT_ALS_WORKSPACE}/${file}`;
  return Promise.race([
    runner.handle.session.request(new CommandBuilder(path).load()),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`cmdLoad ${file} timed out (${COMMAND_TIMEOUT_MS}ms)`)),
        COMMAND_TIMEOUT_MS,
      ),
    ),
  ]);
};

beforeAll(async () => {
  workspaceRoot = join(tmpdir(), `als-bench-node-${Date.now()}`);
  const seedBase = join(workspaceRoot, ...DEFAULT_ALS_WORKSPACE.split('/').filter(Boolean));
  await mkdir(seedBase, { recursive: true });
  for (const s of SOURCES) {
    await writeFile(join(seedBase, s.file), s.src);
  }

  dataDir = join(tmpdir(), `als-integration-${Date.now()}`);
  const builtinsHostDir = join(dataDir, 'data', 'builtins');
  const tmpHostDir = join(dataDir, 'tmp');
  const preopens: Record<string, string> = {
    [defaultAgdaDataDir('node-wasi')]: builtinsHostDir,
    '/tmp': tmpHostDir,
    '/': workspaceRoot,
  };
  await mkdir(builtinsHostDir, { recursive: true });
  await mkdir(tmpHostDir, { recursive: true });

  const env = new NodeWasiRunEnv({ preopens, nodeFlags: NODE_V8_FLAGS });
  runner = { env, handle: await runAls(env, { lspWorkspace: DEFAULT_ALS_WORKSPACE }) };

  // Sanity: each source must load to a real, meaningful result (key response
  // kinds present, highlight atoms produced, no errors) — otherwise the
  // timings are meaningless. Also primes the module cache.
  for (const s of SOURCES) {
    expectLoadResult((await loadOnce(s.file)) as Array<{ kind?: string }>, s.name);
  }
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  runner?.env.terminate();
  if (workspaceRoot) void rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  if (dataDir) void rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

for (const s of SOURCES) {
  bench(
    `cmdLoad ${s.name} (~${s.lines} lines)`,
    async () => {
      await loadOnce(s.file);
    },
    { iterations: ITERS, warmupIterations: WARMUP, time: 0 },
  );
}
