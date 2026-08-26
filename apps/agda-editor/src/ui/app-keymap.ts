/**
 * App keymap — two layers of the same sequence machinery.
 *
 * The editor-scoped keymap holds only the bare Mod-C chord root: it
 * needs the editor's selection to decide copy-vs-palette (CM's
 * defaultKeymap would otherwise swallow Mod-C inside the editor with
 * `preventDefault: true`).
 *
 * Everything else command-shaped is global: a window keydown listener
 * that runs the pressed binding through the registry — a single-key
 * binding runs its command outright (Ctrl+S saves, Ctrl+Shift+P opens
 * the palette), a multi-key root (Ctrl+C) opens the palette filtered
 * to the commands that extend it. Events already handled deeper in
 * the page are skipped via defaultPrevented; the palette's own input
 * owns keys while it has focus.
 */

import type { KeyBinding } from '@codemirror/view';
import { bindingOfEvent, matchSequence } from './command-palette';
import type { AppCommand } from './commands';

export interface AppKeymapEnv {
  /** Open the palette with the agda chord root already pressed. */
  openChordRoot(): void;
}

export function appKeymap(env: AppKeymapEnv): KeyBinding[] {
  return [
    {
      // The agda C-c root — but only when it would not steal copy:
      // with a selection the key falls through to the browser.
      key: 'Mod-c',
      run: view => {
        if (!view.state.selection.main.empty) return false;
        env.openChordRoot();
        return true;
      },
    },
  ];
}

export interface GlobalKeysHooks {
  getCommands(): readonly AppCommand[];
  run(command: AppCommand): void;
  /** Open the palette with `prefix` marked as already pressed. */
  openPalette(prefix?: string): void;
}

/**
 * Window-level sequence dispatch: full bindings run directly, chord
 * roots open the palette at that prefix. A pure prefix press (Ctrl+C)
 * yields to the browser while a selection is active — copy wins.
 * Returns a disposer.
 */
export function wireGlobalKeys(win: Window, hooks: GlobalKeysHooks): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if ((target?.closest('.palette') ?? null) !== null) return;
    const binding = bindingOfEvent(event);
    if (binding === null) return;
    const match = matchSequence(hooks.getCommands(), binding);
    if (match.prefixCount > 1) {
      // A chord root: ambiguous, so it opens the palette as a filter.
      // With a selection the same press is copy — let the browser win.
      const selection = win.getSelection();
      if (match.exact.length === 0 && selection !== null && !selection.isCollapsed) return;
      event.preventDefault();
      hooks.openPalette(binding);
      return;
    }
    if (match.exact.length === 1 && match.prefixCount === 1) {
      event.preventDefault();
      hooks.run(match.exact[0]!);
    }
  };
  win.addEventListener('keydown', onKeydown);
  return () => win.removeEventListener('keydown', onKeydown);
}
