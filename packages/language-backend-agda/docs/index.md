# @playground/language-backend-agda

The Agda Language Server (ALS) integration package. It starts ALS on any `RunEnv` with a two-phase lifecycle (`als --setup` once → `als --raw` as a resident LSP service) and adapts ALS's private `agda` LSP channel (IOTCM commands / JSONTop responses) into a typed command/response API.

## API surface

| Export | Purpose |
| --- | --- |
| `runAls(runEnv, opts?)` | Core entry: sentinel-gated setup phase + main service + LSP initialize handshake → `AlsHandle` |
| `AlsRunOptions` | `program` / `agdaDataDir` / `home` / `env` / `onCreateLspTransport` (middleware observing handshake frames) / `onSetup` (last hook before the handshake) / `lspWorkspace` / `lspCapabilities` |
| `AlsHandle` | `{ session, log?, exit? }` — no lifecycle control (the RunEnv is owned by the caller) |
| `AlsSession` | `request(cmd): Promise<AgdaResponse[]>` (batch) and `stream(cmd): AsyncGenerator<AgdaResponse>` (incremental); commands serialized by an async lock; `End` / `DoneExiting` responses act as termination sentinels |
| `CommandBuilder` | Binds a module path + defaults (highlighting level, rewrite mode); produces `IOTCMCommand { raw, kind }`; covers `load`, `metas`, `give`, `case`, `compute`, `abort`, `autoOne/autoAll`, `solveOne/solveAll`, `goalType*`, `infer`, `context`, `refine`/`intro`, `elaborateGive`, `helperFunction`, `exit`, `compile`, … |
| `parseAgdaResponse` + response types | Fully typed mirror of Agda's JSONTop protocol (`AgdaResponse`, `GoalInfo`, `DisplayInfo`, `HighlightingAtom`, `InteractionPoint`, …) |
| `display.ts` | `renderGoal`, `formatAllGoals` — a faithful port of Agda's own pretty rendering (All Goals buffer) |
| `defaults.ts` | `DEFAULT_ALS_WORKSPACE` (`/root/workspace`), default capabilities, and per-backend program/data-dir defaults (web-wasm → asset URLs; node-wasi → local paths; node-native → `als` on PATH) |

## Usage

```ts
const env = new NodeWasiRunEnv({ preopens: { /* … */ } }); // or WebWasiRunEnv.create()
const als = await runAls(env); // runs `als --setup` automatically on first use

const commands = new CommandBuilder('/root/workspace/Main.agda');
for await (const response of als.session.stream(commands.load())) {
  if (response.kind === 'InteractionPoints') { /* … */ }
}
const responses = await als.session.request(commands.metas()); // batch alternative
```

## Relationships

```
vendor-assets (asset resolution)  ─┐
lsp (LSP client) ──────────────────┼─▶ language-backend-agda
wasip1 ──▶ run-env (web backend) ──┘
```

## Caveats

- Setup is gated by the sentinel file `${agdaDataDir}/.setup-done` and only runs once
- `onSetup` is the **last chance** to subscribe to handshake-phase server notifications — `LspClient` does not buffer them (unsubscribed notifications are dropped, unhandled server requests get `MethodNotFound`)
- Commands run strictly serially; later `request`/`stream` calls queue behind earlier ones
- Response streams end at `End` (regular commands) or `DoneExiting` (`Cmd_exit`); the sentinel itself is not yielded
- The `node-native` backend requires `als` installed on the host; wasm backends resolve the default program via `@playground/vendor-assets` (run its `ensure` script first)
