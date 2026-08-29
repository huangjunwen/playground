# agda-editor

An interactive **Agda proof editor** that runs entirely in the browser: it ships a WebAssembly build of the [Agda Language Server](https://github.com/agda/agda-language-server) (ALS, Agda 2.8.0, ~29 MB), so you can edit Agda code, type-check it, browse goals, and fill in proofs — **no local Agda installation needed**. The backend runs completely inside a Web Worker.

As a PWA, it can be installed to your desktop and used offline.

## Quick start

1. [Open the app](../../agda-editor/). The first load downloads the ~29 MB wasm backend (cached afterwards, offline-friendly).
2. The backend starts automatically; the file being edited is inside a virtual file system.
3. Write some Agda code and press <kbd>Ctrl+C</kbd> <kbd>Ctrl+L</kbd> to load: progress and errors appear in the Output panel at the bottom; a green **Checked** verdict shows up in the Session panel.
4. Leave goals as `{! !}` (top-level `?` placeholders are also expanded into goals after loading). Write an expression inside a goal and press <kbd>Ctrl+C</kbd> <kbd>Ctrl+Space</kbd> to give: if it type-checks, the whole goal is replaced by that expression.
5. <kbd>Ctrl+C</kbd> <kbd>Ctrl+F</kbd> / <kbd>Ctrl+C</kbd> <kbd>Ctrl+B</kbd> jump between goals; the type of the goal at the cursor is shown inline right after it.

For the full keybinding table and command palette details, see the [keybindings reference](keybindings.md).

## Features

### Editor

- Built on CodeMirror 6: line numbers, bracket matching & auto-closing, code folding, multiple cursors, search, undo/redo, and the rest of the full basic-setup toolkit
- Agda lexical syntax highlighting (keywords, block/line comments, literals, pragmas, holes, …) with colors following the light/dark theme (port from @codewars/codemirror-agda)
- **Vim mode**: toggle from the toolbar or command palette, preference persisted
- Theme cycles through light / dark / follow-system

### Agda interaction

| Feature | Description |
| --- | --- |
| Load | Type-check the whole file with streaming progress; rebuilds the goal list |
| Give | Submit the expression inside ` {! expr !} ` at the cursor for checking; on success the whole goal is replaced |
| Goal navigation | Next / previous goal, wraps around at the ends and scrolls to the middle of the viewport |

### Backend

- WASM build of ALS v6 (Agda 2.8.0) running in a dedicated Web Worker — no server involved
- On startup it runs `als --setup` once to install builtins, then starts the LSP service via `als --raw`
- Can be started / stopped manually from the Session panel; terminated automatically when the page closes

### Observability & debugging

- **Output panel**: command progress, exceptions, diagnostics (errors and warnings grouped with counts)
- **Logs panel**: full LSP wire log, stderr, and command timings; filterable by level, with payloads expandable into trees

## Caveats & limitations

- **Browser support**: requires WebAssembly JSPI (Chrome 137+ / Firefox 153+ / Safari 27+); **iOS Safari is not supported** — the backend fails to start and the Session panel shows exited
- **Single file, no persistence**: currently only the fixed `Main.agda` is edited; documents live in an in-memory virtual FS and **are lost on page refresh** (only theme / Vim preferences persist) — back up your code yourself
- Agda interaction currently focuses on load / give / goal navigation; go-to-definition, semantic completion, case-split, auto, etc. are not wired up in the UI yet
- <kbd>Ctrl+Space</kbd> may conflict with IME toggle keys (fcitx / ibus / …); with a selection present, <kbd>Ctrl+C</kbd> is copy rather than the Agda chord prefix
- Syntax highlighting is purely lexical (semantic highlighting is off); the inline goal type comes from the last load and may be stale after edits — load again to be sure

## Architecture (in brief)

- Editor stack: CodeMirror 6 + `@replit/codemirror-vim`; no UI framework — panels are projections of CM6 `StateField` models
- Backend: WASI Preview1 host + JSPI via `@playground/run-env`, hosting the ALS wasm; in-memory virtual FS written from the main thread via RPC
- Protocol: the in-house `@playground/lsp` byte-stream transport; Agda interaction commands (IOTCM) travel over a custom `agda` LSP request channel, with responses parsed as a stream
- Source: [apps/agda-editor](https://github.com/huangjunwen/playground/tree/master/apps/agda-editor)
