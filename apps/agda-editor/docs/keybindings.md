# agda-editor keybindings

Keybindings below are taken from `src/ui/commands.ts`. On macOS, <kbd>Ctrl</kbd> maps to <kbd>⌘</kbd>.

## Keybindings

| Keys | Command | Description |
| --- | --- | --- |
| <kbd>Ctrl+C</kbd> <kbd>Ctrl+L</kbd> | Agda: Load | Type-check the whole file |
| <kbd>Ctrl+C</kbd> <kbd>Ctrl+Space</kbd> | Agda: Give | Fill the goal at the cursor with the expression inside it |
| <kbd>Ctrl+C</kbd> <kbd>Ctrl+R</kbd> | Agda: Refine | Fill the goal at the cursor with the expression inside it and open new subgoals for what agda could not infer (empty goal → intro) |
| <kbd>Ctrl+C</kbd> <kbd>Ctrl+C</kbd> | Agda: Case | Split on the variable in the goal at the cursor (writes the split clauses, then re-checks) |
| <kbd>Ctrl+C</kbd> <kbd>Ctrl+F</kbd> | Agda: Next goal | Jump to the next goal |
| <kbd>Ctrl+C</kbd> <kbd>Ctrl+B</kbd> | Agda: Previous goal | Jump to the previous goal |
| <kbd>Ctrl+S</kbd> | File: Save | Save the document to the backend's virtual file system |
| <kbd>Ctrl+Shift+P</kbd> | View: Show all commands | Open the command palette |
| <kbd>Ctrl+C</kbd> (alone) | — | Opens the palette filtered to the <kbd>Ctrl+C</kbd> chord prefix; **yields to copy when a selection is present** |
| <kbd>Escape</kbd> | — | Close the command palette |
| <kbd>↑</kbd> / <kbd>↓</kbd> / <kbd>Enter</kbd> in the palette | — | Navigate / run (disabled rows are skipped) |
| <kbd>Backspace</kbd> in the palette (empty query) | — | "Un-press" the last key of a pending chord |
| Vim `:w` / `:write` | same as File: Save | The save entry point in Vim mode |

## Commands without keybindings

These commands are available via the command palette or toolbar icons:

- View: Toggle the sidebar — show/hide the sidebar
- View: Toggle the events panel — show/hide the dock (Output / Logs)
- Color theme: light / dark / system — theme switching
- Vim mode — toggle Vim mode

## Command palette

Press <kbd>Ctrl+Shift+P</kbd> (or the first toolbar icon) to open the full-screen command palette overlay:

- Fuzzy-searches `Category: Title` command labels with match highlighting
- Toggle commands (Vim, theme, …) show a <kbd>✓</kbd> mark for their current state
- Commands requiring the backend are disabled while it is not ready
- Multi-key sequences (e.g. <kbd>Ctrl+C</kbd> <kbd>Ctrl+L</kbd>) are presented as highlighted pending keys — you can complete the chord by pressing the keys with the palette open
