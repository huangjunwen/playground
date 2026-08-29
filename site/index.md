# Playground

My web app playground ([huangjunwen/playground](https://github.com/huangjunwen/playground)): small apps you can use directly in the browser. No local installation required.

## Apps

<div class="cards">

<div class="card">

### [agda-editor](agda-editor/)

An interactive Agda proof editor that runs entirely in the browser: ships with a WebAssembly version of ALS (Agda Language Server). Supports offline use (PWA).

[Open app](agda-editor/) · [Documentation](docs/agda-editor/)

</div>

</div>

## Packages

Shared packages consumed by the apps above.

<div class="cards">

<div class="card">

### [language-backend-agda](docs/language-backend-agda/)

Starts ALS on any run environment and adapts its private `agda` LSP channel into a typed command/response API.

[Documentation](docs/language-backend-agda/)

</div>

<div class="card">

### [run-env](docs/run-env/)

A unified run environment interface: web WASI, Node WASI, and native binaries.

[Documentation](docs/run-env/)

</div>

<div class="card">

### [wasip1](docs/wasip1/)

A hand-rolled WASI Preview 1 runtime: main-thread host + Web Worker over RPC, with JSPI for blocking calls.

[Documentation](docs/wasip1/)

</div>

<div class="card">

### [lsp](docs/lsp/)

A zero-dependency, transport-agnostic LSP client.

[Documentation](docs/lsp/)

</div>

<div class="card">

### [vendor-assets](docs/vendor-assets/)

A declarative registry and provisioning pipeline for vendored binaries, with runtime resolution to web URLs or Node paths.

[Documentation](docs/vendor-assets/)

</div>

</div>
