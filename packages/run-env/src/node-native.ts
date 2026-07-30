/** {@link RunEnv} for native binaries — spawns the program as a direct child
 *  process with no WASI sandboxing. The filesystem is the real host fs with no
 *  path translation. */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { NodeFs } from './node/fs';
import { childToRunHandle } from './node/util';
import type { Command, RunEnv, RunHandle } from './types';

export class NativeRunEnv implements RunEnv {
  readonly fs = new NodeFs();
  private _child: ChildProcessWithoutNullStreams | null = null;

  run(cmd: Command): RunHandle {
    this._child = spawn(cmd.program, cmd.args, {
      env: { ...process.env, ...cmd.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
