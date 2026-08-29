# @playground/run-env

A unified "program execution environment" abstraction: run programs (`run`) and manipulate their file systems (`fs`) through one interface, erasing the differences between three backends — WASI wasm on the web, WASI wasm on Node, and native binaries on Node.

## API surface

The root entry exports the types; implementations live on platform sub-paths.

| Export | Purpose |
| --- | --- |
| `RunEnv` | `name` / `fs: Fs` / `run(cmd): RunHandle` / `terminate()` |
| `Command` | `program` is interpreted by the backend: URL (web-wasi), host-absolute path (node-wasi), or PATH binary name (node-native) |
| `RunHandle` | `stdin/stdout/stderr` as Web Streams + `exit: Promise<number>` |
| `Fs` | Path-level, whole-file, fully async file-system interface |
| `./node` → `NodeWasiRunEnv` | Spawns a child Node process running `node:wasi`; `preopens` map guest→host paths |
| `./node` → `NativeRunEnv` | Spawns native processes directly (no sandbox) |
| `./web` → `WebWasiRunEnv` | Static `create(config)`; wraps `WasiHost` from `@playground/wasip1` |

## Usage

```ts
// web
const env = await WebWasiRunEnv.create({ backend: 'memory' });
// node
const env = new NodeWasiRunEnv({ preopens: { '/root': '/tmp/host-root' } });

const handle = env.run({ program, args: ['als', '--raw'], env: { HOME: '/root' } });
const code = await handle.exit; // stdout/stderr are ReadableStream<ArrayBuffer>

await env.fs.writeFile('/root/Main.agda', bytes);
env.terminate();
```

## Relationships

Depends on `@playground/wasip1` (the web backend embeds `WasiHost`; `fs` is the RPC version of `HostFs`).

## Caveats

- Exit codes follow POSIX conventions: normal exit is the code; killed-by-signal is `128+N`. On web, terminating the worker turns the `exit` rejection into a resolve with `137` (SIGKILL)
- `NodeWasiRunEnv` spawns a fresh child Node process per `run` call (`node:wasi`'s `start()` blocks synchronously) and needs `--experimental-wasi-unstable-preview1`
- The two Node backends only track the **last** `run`'s child process — `terminate()` kills only that one
- `Fs` is a whole-file API (open-op-close per operation), not a streaming/handle-based fs
