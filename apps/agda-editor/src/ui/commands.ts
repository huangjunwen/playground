/**
 * Commands — the registry every entry point shares: the palette rows,
 * the keyboard bindings, the chord completions. A command is data
 * (id, title, category, display keybinding) plus a `run(view)`; the
 * environment (backend access, panel toggles, theme + vim prefs, the
 * palette itself) is injected by main.ts so the registry stays pure
 * data + wiring.
 *
 * Backend-dependent commands also declare `enabled()`: the palette and
 * the buttons render them disabled until the backend runs — a
 * projection of the session model, mirroring how `run` still guards
 * (a keyboard shortcut has no row to disable). Preference-backed
 * commands declare `checked()` the same way, so palette rows can
 * carry a state mark (the current theme, vim on/off).
 *
 * Multi-key bindings (the Agda chords) share the root `agdaChordRoot`
 * (Ctrl+C / ⌘C): pressing it anywhere opens the palette filtered to
 * the commands that extend it — see ui/command-palette.ts and
 * ui/app-keymap.ts for the sequence machinery.
 */

import type { EditorView } from '@codemirror/view';
import { appendEventTransaction } from '../model/observability-model';
import type { ThemePref } from '../model/prefs';
import {
  type CtxAccessor,
  caseFromCursorCommand,
  giveFromCursorCommand,
  loadCommand,
  nextGoalCommand,
  prevGoalCommand,
  refineFromCursorCommand,
} from './goal-keymap';
import { showToast } from './toast';

export type CommandCategory = 'Agda' | 'File' | 'View' | 'Help';

/** One palette entry / keymap target. */
export interface AppCommand {
  id: string;
  /** Shown as `Category: Title` in the palette. */
  title: string;
  category: CommandCategory;
  /** Display-only keybinding, already platform-resolved. */
  keybinding?: string;
  /**
   * Whether the command can run right now (the backend being up).
   * Undefined means always enabled; the palette shows a disabled row
   * while false, and `run` refuses politely (the guarded warn).
   */
  enabled?(): boolean;
  /**
   * For toggle-like commands: whether they are currently in effect.
   * The palette prefixes such a row with a check mark.
   */
  checked?(): boolean;
  run(view: EditorView): boolean;
}

/** The actions the registry needs from the outside world. */
export interface CommandEnv {
  getCtx: CtxAccessor;
  toggleSide(): void;
  toggleDock(): void;
  openPalette(prefix?: string): void;
  getTheme(): ThemePref;
  setTheme(pref: ThemePref): void;
  isVim(): boolean;
  toggleVim(): void;
  openAbout(): void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
/** Display name of the modifier key (⌘ on Apple keyboards). */
export const modKey = isMac ? '⌘' : 'Ctrl';

/**
 * The root of every Agda chord binding (`Ctrl+C` / `⌘C`). Pressing it
 * is a prefix filter, not a command: the palette opens listing the
 * commands that extend it, and the next key completes one.
 */
export const agdaChordRoot = `${modKey}+C`;

/** A backend-dependent command that refuses politely when offline. */
function guarded(note: string, run: (view: EditorView) => boolean): (view: EditorView) => boolean {
  return view => {
    const ok = run(view);
    if (!ok) {
      view.dispatch(appendEventTransaction('warn', 'usr::wrn', { note }));
      showToast(note); // the dock may be closed — echo it over the editor
    }
    return true;
  };
}

/** The whole command vocabulary, wired to `env`. */
export function buildCommands(env: CommandEnv): AppCommand[] {
  // Backend availability as a projection: rows and buttons disable on
  // it, and the guarded runs still refuse on the keyboard paths.
  const backendOnline = () => env.getCtx() !== undefined;
  return [
    {
      id: 'agda.load',
      title: 'Load (type-check the file)',
      category: 'Agda',
      keybinding: `${agdaChordRoot} ${modKey}+L`,
      enabled: backendOnline,
      run: view => guarded('load: backend offline', loadCommand(env.getCtx))(view),
    },
    {
      id: 'agda.give',
      title: 'Give (fill the goal under the cursor)',
      category: 'Agda',
      keybinding: `${agdaChordRoot} ${modKey}+Space`,
      enabled: backendOnline,
      run: view => guarded('give: backend offline', giveFromCursorCommand(env.getCtx))(view),
    },
    {
      id: 'agda.refine',
      title: 'Refine (fill the goal under the cursor and open new subgoals)',
      category: 'Agda',
      keybinding: `${agdaChordRoot} ${modKey}+R`,
      enabled: backendOnline,
      run: view => guarded('refine: backend offline', refineFromCursorCommand(env.getCtx))(view),
    },
    {
      id: 'agda.case',
      title: 'Case (split the variable in the goal under the cursor)',
      category: 'Agda',
      keybinding: `${agdaChordRoot} ${modKey}+C`,
      enabled: backendOnline,
      run: view => guarded('case: backend offline', caseFromCursorCommand(env.getCtx))(view),
    },
    {
      id: 'agda.next-goal',
      title: 'Next goal',
      category: 'Agda',
      keybinding: `${agdaChordRoot} ${modKey}+F`,
      run: nextGoalCommand,
    },
    {
      id: 'agda.prev-goal',
      title: 'Previous goal',
      category: 'Agda',
      keybinding: `${agdaChordRoot} ${modKey}+B`,
      run: prevGoalCommand,
    },
    {
      id: 'file.save',
      title: 'Save the file',
      category: 'File',
      keybinding: `${modKey}+S`,
      enabled: backendOnline,
      run: guarded('save: backend not running', () => {
        const ctx = env.getCtx();
        if (ctx === undefined) return false;
        void ctx.vfsWrite();
        return true;
      }),
    },
    {
      id: 'view.show-commands',
      title: 'Show all commands',
      category: 'View',
      keybinding: `${modKey}+Shift+P`,
      run: () => {
        env.openPalette();
        return true;
      },
    },
    {
      id: 'view.toggle-sidebar',
      title: 'Toggle the sidebar',
      category: 'View',
      run: () => {
        env.toggleSide();
        return true;
      },
    },
    {
      id: 'view.toggle-events',
      title: 'Toggle the events panel',
      category: 'View',
      run: () => {
        env.toggleDock();
        return true;
      },
    },
    {
      id: 'view.theme-light',
      title: 'Color theme: light',
      category: 'View',
      checked: () => env.getTheme() === 'light',
      run: () => {
        env.setTheme('light');
        return true;
      },
    },
    {
      id: 'view.theme-dark',
      title: 'Color theme: dark',
      category: 'View',
      checked: () => env.getTheme() === 'dark',
      run: () => {
        env.setTheme('dark');
        return true;
      },
    },
    {
      id: 'view.theme-system',
      title: 'Color theme: follow the system',
      category: 'View',
      checked: () => env.getTheme() === 'system',
      run: () => {
        env.setTheme('system');
        return true;
      },
    },
    {
      id: 'view.toggle-vim',
      title: 'Vim mode',
      category: 'View',
      checked: () => env.isVim(),
      run: () => {
        env.toggleVim();
        return true;
      },
    },
    {
      id: 'help.about',
      title: 'About agda-editor',
      category: 'Help',
      run: () => {
        env.openAbout();
        return true;
      },
    },
  ];
}
