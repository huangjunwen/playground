/// <reference types="vite/client" />

/**
 * ALS `cmdLoad` benchmark — Browser side.
 *
 * Execution model: ALS over `@playground/wasip1`'s in-process wasm worker via
 * `WebWasiRunEnv`, with the memory VFS backend (the default). Builtins are
 * extracted into the memory VFS during `als --setup`; the whole fs lives in
 * the worker's heap and dies when the worker terminates.
 *
 * Node counterpart: `benchmark.node.bench.ts`.
 *
 * Run with:  pnpm --filter @playground/language-backend-agda test:bench:web
 *
 * NOTE: vitest's benchmark runner (`runBenchmarkSuite`) never invokes the
 * `beforeAll`/`afterAll` hooks of a `describe()` sub-suite — it only runs
 * `task.warmup()` + `task.run()` per benchmark task. Hooks DO fire at module
 * top level, so setup/teardown must NOT be wrapped in `describe()`.
 */

import { WebWasiRunEnv } from '@playground/run-env/web';
import { afterAll, beforeAll, bench } from 'vitest';
import { DEFAULT_ALS_WORKSPACE } from '../../src/defaults';
import { cmdLoad } from '../../src/protocol/commands';
import { type AlsHandle, runAls } from '../../src/run';
import { expectLoadResult } from './expect-load';
import { SOURCES } from './sources';

const WARMUP = 1;
const ITERS = 5;
const COMMAND_TIMEOUT_MS = 60_000;
const SETUP_TIMEOUT_MS = 60_000; // setup extracts builtin sources in ~1s; covers setup + the 3 sanity cmdLoads

let runner: { env: WebWasiRunEnv; handle: AlsHandle };

const loadOnce = (file: string): Promise<unknown> => {
  const path = `${DEFAULT_ALS_WORKSPACE}/${file}`;
  return Promise.race([
    runner.handle.session.request(cmdLoad(path)),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`cmdLoad ${file} timed out (${COMMAND_TIMEOUT_MS}ms)`)),
        COMMAND_TIMEOUT_MS,
      ),
    ),
  ]);
};

beforeAll(async () => {
  const textEncoder = new TextEncoder();
  const env = await WebWasiRunEnv.create();
  await env.fs.mkdir(DEFAULT_ALS_WORKSPACE, { recursive: true });
  for (const s of SOURCES) {
    await env.fs.writeFile(`${DEFAULT_ALS_WORKSPACE}/${s.file}`, textEncoder.encode(s.src));
  }
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
