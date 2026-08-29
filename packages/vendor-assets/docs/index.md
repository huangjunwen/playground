# @playground/vendor-assets

A registry and provisioning pipeline for vendored binary assets. External assets are described by a declarative manifest (`families/*/params.json` + `assets.json`); the `ensure` script downloads/builds/verifies them into `vendor/`, and the runtime API resolves them to a web URL or a Node file path.

## API surface

| Export | Purpose |
| --- | --- |
| `listFamilies()` / `listAssets(family, version?)` | Enumerate registered assets |
| `getAssetInfo(family, asset, version?)` | Metadata: `filename`, `sha256`, `sizeBytes` (version defaults to the family's `defaultVersion`) |
| `resolveAssetUrl(family, asset, version?)` | Bundler-served URL for the browser (via Vite's `?url` glob) |
| `resolveAssetPath(...)` | Absolute file-system path (Node only) |

## Usage

```ts
// one-time, before running: pnpm --filter @playground/vendor-assets ensure
const wasmUrl = resolveAssetUrl('als-wasm', 'opt');   // web
const wasmPath = resolveAssetPath('als-wasm', 'opt'); // node
const info = getAssetInfo('als-wasm', 'opt');         // { version: 'v6', sha256, … }
```

## Caveats

- The registry relies on Vite's `import.meta.glob` (with `?url`) — the package assumes a Vite-compatible bundler
- Everything under `vendor/<family>/<version>/` is globbed into the bundle — which is why build intermediates are deliberately kept out of it
- The `ensure` script needs `curl` and network access
