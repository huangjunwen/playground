/// <reference lib="webworker" />
// WASI Preview 1 worker entry point. Exposes init (build Vfs from config) and
// run (instantiate + execute wasm) via an RPC control channel.
// stdin/stdout/stderr travel on separate host-supplied MessagePorts.

import { Result, Rights } from './consts';
import { DirFd } from './fd-dir';
import { PipeReadFd, PipeWriteFd } from './fd-pipe';
import { FdTable } from './fd-table';
import { FsError, type Vfs } from './fs';
import { memoryVfsFactory } from './fs-mem';
import { createVfs, registerVfs } from './fs-registry';
import { createHostFsServer } from './host-fs';
import { createWasiImports, ProcExit, type WasiCtx } from './imports';
import { createRpcServer, createStreamConsumer, createStreamProvider } from './ipc-mp';

// Register vfs factories.
registerVfs('memory', memoryVfsFactory);

interface RunArgs {
  wasmUrl: string;
  args: string[];
  env: Record<string, string>;
  stdinPort: MessagePort;
  stdoutPort: MessagePort;
  stderrPort: MessagePort;
}

// ---- Module state ----
let busy = false;
let vfs: Vfs = null!;
const moduleCache = new Map<string, WebAssembly.Module>();

// The worker is a JSPI environment (it relies on WebAssembly.promising for
// _start), so wrapSuspending is the real WebAssembly.Suspending.
const wrapSuspending: WasiCtx['wrapSuspending'] = fn => new WebAssembly.Suspending(fn);

// ---- RPC methods ----
async function init(config: Record<string, unknown>): Promise<void> {
  vfs = await createVfs(config);
}

// run owns a whole wasm execution and resolves with the exit code.
async function run(args: RunArgs): Promise<number> {
  if (busy) throw new FsError(Result.EBUSY);
  busy = true;

  const fdTable = new FdTable();

  fdTable.open(new PipeReadFd(createStreamConsumer(args.stdinPort)), Rights.FD_READ, {
    fd: 0,
    onClose: () => args.stdinPort.close(),
  });
  fdTable.open(new PipeWriteFd(createStreamProvider(args.stdoutPort)), Rights.FD_WRITE, {
    fd: 1,
    onClose: () => args.stdoutPort.close(),
  });
  fdTable.open(new PipeWriteFd(createStreamProvider(args.stderrPort)), Rights.FD_WRITE, {
    fd: 2,
    onClose: () => args.stderrPort.close(),
  });

  const root = vfs.open('/', {
    create: false,
    exclusive: false,
    truncate: false,
    directory: true,
  });
  if (root.kind !== 'dir') throw new Error('root is not a directory');
  const rootEntries = root.backend.list();
  fdTable.open(new DirFd(rootEntries, '/'), Rights.FD_READ, { fd: 3 });

  let mod = moduleCache.get(args.wasmUrl);
  if (!mod) {
    const wasmBytes = await fetch(args.wasmUrl).then(r => r.arrayBuffer());
    mod = await WebAssembly.compile(wasmBytes);
    moduleCache.set(args.wasmUrl, mod);
  }

  let instance: WebAssembly.Instance;
  const ctx: WasiCtx = {
    getMem: () => new Uint8Array((instance.exports.memory as WebAssembly.Memory).buffer),
    wrapSuspending,
    fdTable,
    vfs,
    args: args.args,
    env: args.env,
  };
  instance = await WebAssembly.instantiate(mod, {
    wasi_snapshot_preview1: createWasiImports(ctx),
  });

  const promisingStart = WebAssembly.promising(instance.exports._start as () => void);
  try {
    await promisingStart();
    return 0;
  } catch (e) {
    if (e instanceof ProcExit) return e.code;
    throw e;
  } finally {
    fdTable.closeAll();
    busy = false;
  }
}

// ---- Bootstrapping ----
createRpcServer(self as unknown as Worker, {
  init,
  run,
  ...createHostFsServer({ getVfs: () => vfs }),
});
