# @playground/wasip1

A hand-rolled WASI Preview 1 runtime. Its core shape is a main-thread `WasiHost` plus a Web Worker executing the wasm with JSPI handling blocking semantics. It contains an fd layer, a virtual file system (with pluggable backends), and transport-agnostic RPC / byte-stream IPC infrastructure.

## API surface

| Export | Purpose |
| --- | --- |
| `WasiHost` | Main-thread entry: constructor spawns the worker; `init(config)` builds the worker-side Vfs and returns a `HostFs`; `run(RunConfig)` synchronously returns `{stdin, stdout, stderr, exit}` (stdio via per-call MessageChannels); `terminate()` |
| `HostFs` / `createHostFsServer` | RPC client/server pair for the path-level async fs (errno survives the wire via `FsError`) |
| `Vfs` / `FileBackend` / `DirBackend` / `FsError` | Synchronous VFS abstraction (paths must already be normalized) |
| `MemoryVfs` / `registerVfs` / `createVfs` | Pure-memory backend + a registry dispatching on `config.backend` |
| `Fd` / `FileFd` / `DirFd` / `PipeReadFd` / `PipeWriteFd` / `FdTable` | fd layer (vtable-based; unimplemented ops throw `UnsupportedError`) |
| `createWasiImports` / `WasiCtx` | Build the `wasi_snapshot_preview1` import object for custom hosts/tests |
| `RpcClient`/`RpcServer`, `StreamProvider`/`StreamConsumer` | MessagePort/Worker RPC + one-way byte streams with explicit state machines; `toReadableStream`/`toWritableStream` adapters |
| `Result`, `Rights`, `Filetype`, `Oflags`, … | WASI constants |

## Usage

```ts
const host = new WasiHost();
const fs = await host.init({ backend: 'memory' }); // HostFs
await fs.writeFile('/root/hello.txt', bytes);

const handle = host.run({ wasmUrl, args: ['prog'], env: {} });
await handle.stdin.write(encoder.encode('input'));
const code = await handle.exit; // from ProcExit
host.terminate();
```

## Caveats

- **JSPI required on the web**: `_start` is wrapped with `WebAssembly.Suspending`/`promising`; `fd_read`/`fd_write`, `poll_oneoff`, and `sched_yield` may suspend (this is how pipe blocking reads work). `WasiCtx.wrapSuspending` can inject an identity function to degrade in non-JSPI environments (Node, tests)
- The wasm module is fetched via `fetch(wasmUrl)` and compile-cached by URL
- One `run` at a time per worker (`EBUSY` otherwise); fds 0/1/2 are stdio pipes, fd 3 is the Vfs root
- The worker-side Vfs is synchronous; everything on the host side goes through RPC and becomes async
- After `terminate()`, pending RPCs reject; stream payloads may be transferred (detached) — do not reuse passed ArrayBuffers
