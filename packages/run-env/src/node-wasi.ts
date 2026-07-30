/** {@link RunEnv} for WASI Preview 1 wasm binaries on Node.js.
 *
 *  Spawns a child Node process running `node:wasi` so the event loop stays
 *  free (node:wasi's `start()` is synchronous and blocks). Guest paths are
 *  translated to host paths via the preopen mapping, and the WASI preopens are
 *  injected into the child-process script so the wasm sees the same virtual
 *  filesystem that `fs` exposes to the caller. */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { NodeFs } from './node/fs';
import { childToRunHandle } from './node/util';
import type { Command, Fs, RunEnv, RunHandle } from './types';

const WASI_FLAG = '--experimental-wasi-unstable-preview1';

/** Build the child-process script: instantiates WASI and runs the wasm. */
function wasiRunnerScript(
  wasmPath: string,
  args: string[],
  env: Record<string, string>,
  preopens: Record<string, string>,
): string {
  return `
import { WASI } from 'node:wasi';
import { readFile } from 'node:fs/promises';

const wasmBytes = await readFile(${JSON.stringify(wasmPath)});
const wasi = new WASI({
  version: 'preview1',
  args: ${JSON.stringify(args)},
  env: ${JSON.stringify(env)},
  preopens: ${JSON.stringify(preopens)},
  stdin: 0,
  stdout: 1,
  stderr: 2,
});

const importObj = { wasi_snapshot_preview1: wasi.wasiImport };
const wasm = await WebAssembly.instantiate(wasmBytes, importObj);

try {
  wasi.start(wasm.instance);
} catch (e) {
  const msg = e?.message || String(e);
  if (!msg.includes('0')) throw e;
}
`;
}

export interface NodeWasiRunEnvOptions {
  /** Guest→host preopen mapping. Keys are guest mount paths (e.g. '/root'),
   *  values are host directories. Drives both the WASI config in spawned
   *  processes and the path translation used by `fs`. */
  preopens?: Record<string, string>;
  /** Extra Node CLI flags injected into the spawned subprocess (e.g.
   *  '--liftoff-only' for V8 tier experiments). */
  nodeFlags?: string[];
}

export class NodeWasiRunEnv implements RunEnv {
  private readonly _preopens: Record<string, string>;
  private readonly _nodeFlags: string[];
  private readonly _fs: Fs;
  private _child: ChildProcessWithoutNullStreams | null = null;

  constructor(opts: NodeWasiRunEnvOptions = {}) {
    this._preopens = opts.preopens ?? {};
    this._nodeFlags = opts.nodeFlags ?? [];
    this._fs = new NodeFs(this._preopens);
  }

  get fs(): Fs {
    return this._fs;
  }

  run(cmd: Command): RunHandle {
    const script = wasiRunnerScript(cmd.program, cmd.args, cmd.env ?? {}, this._preopens);

    this._child = spawn(
      process.argv[0]!,
      [WASI_FLAG, ...this._nodeFlags, '--input-type=module', '-e', script],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    return childToRunHandle(this._child);
  }

  terminate(): void {
    try {
      this._child?.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }
}
