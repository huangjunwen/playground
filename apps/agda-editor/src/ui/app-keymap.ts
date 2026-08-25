/**
 * App keymap — two layers. The editor-scoped keymap holds only the bare
 * Mod-C agda-chord prefix (it needs the editor's selection to decide
 * copy-vs-palette). Everything else command-shaped is global:
 * Mod-Shift-P opens the palette and Mod-S saves the file, from any
 * focus target — a window keydown listener, so the bindings survive
 * focus sitting in a panel or on the page body.
 */

import type { KeyBinding } from '@codemirror/view';

export interface AppKeymapEnv {
  openPalette(mode: 'all' | 'agda'): void;
}

export function appKeymap(env: AppKeymapEnv): KeyBinding[] {
  return [
    {
      // The agda C-c prefix — but only when it would not steal copy:
      // with a selection the key falls through to the browser.
      key: 'Mod-c',
      run: view => {
        if (!view.state.selection.main.empty) return false;
        env.openPalette('agda');
        return true;
      },
    },
  ];
}

export interface GlobalKeysHooks {
  openPalette(): void;
  saveFile(): void;
}

/**
 * Window-level shortcuts (palette, save) that must fire regardless of
 * what has focus. Events already handled deeper in the page (CM keymap
 * preventDefaults on success) are skipped via defaultPrevented.
 * Returns a disposer.
 */
export function wireGlobalKeys(win: Window, hooks: GlobalKeysHooks): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.shiftKey && key === 'p') {
      event.preventDefault();
      hooks.openPalette();
    } else if (!event.shiftKey && key === 's') {
      // Inside the palette the input owns the keyboard (chord letters,
      // navigation) — Ctrl+S there is not a save.
      const target = event.target as HTMLElement | null;
      if ((target?.closest('.palette') ?? null) !== null) return;
      event.preventDefault();
      hooks.saveFile();
    }
  };
  win.addEventListener('keydown', onKeydown);
  return () => win.removeEventListener('keydown', onKeydown);
}
