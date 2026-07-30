// Main-thread driver for WASI Preview 1. Spawns a worker and exposes Web
// Streams for stdin/stdout/stderr plus an exit-code promise.

import { HostFs } from './host-fs';
import { type RpcClient, toReadableStream, toWritableStream } from './ipc';
import { createRpcClient, createStreamConsumer, createStreamProvider, transfer } from './ipc-mp';

export interface RunConfig {
  wasmUrl: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface RunHandle {
  stdin: WritableStream<ArrayBuffer>;
  stdout: ReadableStream<ArrayBuffer>;
  stderr: ReadableStream<ArrayBuffer>;
  /** Resolves to the wasm exit code; rejects on any non-ProcExit throw. */
  exit: Promise<number>;
}

export class WasiHost {
  private readonly worker: Worker;
  private readonly rpc: RpcClient;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.rpc = createRpcClient(this.worker);
  }

  /** Build the worker-side Vfs from a backend config and return a HostFs client
   *  for host-side path operations over RPC. */
  async init(config: Record<string, unknown>): Promise<HostFs> {
    await this.rpc.call('init', [config]);
    return new HostFs(this.rpc);
  }

  /** Run a wasm program. Returns stdio streams and an exit-code promise
   *  synchronously; the caller drives the streams while awaiting exit.
   *  Three MessageChannels are created per invocation for stdin/stdout/stderr. */
  run(config: RunConfig): RunHandle {
    const stdinCh = new MessageChannel();
    const stdoutCh = new MessageChannel();
    const stderrCh = new MessageChannel();

    const stdin = toWritableStream(createStreamProvider(stdinCh.port1));
    const stdout = toReadableStream(createStreamConsumer(stdoutCh.port1));
    const stderr = toReadableStream(createStreamConsumer(stderrCh.port1));

    const exit = this.rpc.call<number>('run', [
      {
        wasmUrl: config.wasmUrl,
        args: config.args ?? [],
        env: config.env ?? {},
        stdinPort: transfer(stdinCh.port2),
        stdoutPort: transfer(stdoutCh.port2),
        stderrPort: transfer(stderrCh.port2),
      },
    ]);

    return { stdin, stdout, stderr, exit };
  }

  /** Abort the worker. Pending RPC calls reject with "rpc client disposed". */
  terminate(): void {
    this.rpc.dispose();
    this.worker.terminate();
  }
}
