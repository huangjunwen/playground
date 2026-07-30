/** {@link RunEnv} adapter for the web — wraps wasip1's {@link WasiHost} to
 *  implement the generic program-execution interface. The wasm binary runs in
 *  a dedicated Worker; `fs` is the RPC-backed `HostFs` that routes path
 *  operations to the worker's Vfs.
 */

import { type HostFs, type RunConfig, WasiHost } from '@playground/wasip1';
import type { Command, RunEnv, RunHandle } from '../types';

export class WebWasiRunEnv implements RunEnv {
  private readonly _host: WasiHost;
  readonly fs: HostFs;

  private constructor(host: WasiHost, fs: HostFs) {
    this._host = host;
    this.fs = fs;
  }

  /** Create a `WebWasiRunEnv` by initialising the worker's Vfs. The `config` is
   *  forwarded to `WasiHost.init` (e.g. `{ backend: 'memory' }`). */
  static async create(
    config: Record<string, unknown> = { backend: 'memory' },
  ): Promise<WebWasiRunEnv> {
    const host = new WasiHost();
    const fs = await host.init(config);
    return new WebWasiRunEnv(host, fs);
  }

  run(cmd: Command): RunHandle {
    const cfg: RunConfig = {
      wasmUrl: cmd.program,
      args: cmd.args,
      env: cmd.env,
    };
    const inner = this._host.run(cfg);
    // Worker termination disposes the RPC client, causing exit to reject.
    // Follow POSIX convention: resolve with 128+9 (SIGKILL = 137).
    return {
      stdin: inner.stdin,
      stdout: inner.stdout,
      stderr: inner.stderr,
      exit: inner.exit.catch(() => 137),
    };
  }

  terminate(): void {
    this._host.terminate();
  }
}
