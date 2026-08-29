# @playground/lsp

A zero-dependency, transport-agnostic LSP client library. It provides JSON-RPC request/notification semantics, the `initialize` handshake, `Content-Length` frame encoding/decoding, and currently a byte-stream transport (Web Streams) — so anything that exposes a stdin/stdout byte-stream pair (child process, Web Worker, …) can be driven as an LSP server.

## API surface

| Export | Purpose |
| --- | --- |
| `LspClient` | Core class: `request(method, params)` (auto id allocation, pending-promise tracking), `notify`, `start()` (initialize/initialized handshake, caches server capabilities), `onServerRequest` / `onServerNotification` |
| `LspTransport` | Transport interface: `send(msg)` + `onMessage(handler)` |
| `LspTransportMiddleware` | Transport decorator type (tap into both directions) |
| `ByteStreamLspTransport` | Transport built on `WritableStream` + `ReadableStream` — runtime-agnostic |
| `encodeLspMessage` / `LspFrameDecoder` | Frame encoder and incremental decoder (geometric buffer growth, zero-copy parse on empty buffer) |
| `LoggingTransport` / `LspLogSink` | Observe both directions (defaults to `console.debug`) |

## Usage

```ts
const transport = new ByteStreamLspTransport(handle.stdin, handle.stdout); // process or worker stdio
const client = new LspClient(transport);
await client.start({ rootUri: 'file:///root/workspace', capabilities: { /* … */ } });
const result = await client.request('agda', { /* … */ }); // any custom method
client.onServerNotification('window/logMessage', params => { /* … */ });
```

## Caveats

- `send` is synchronous fire-and-forget: no backpressure, no write-failure reporting
- Unhandled server requests are auto-answered with `MethodNotFound (-32601)`; handler errors with `-32603`; notification handler exceptions are swallowed
- The decoder tolerates non-standard servers inserting extra headers (e.g. `Content-Type`)

