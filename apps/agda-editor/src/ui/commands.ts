/**
 * Commands — the registry every entry point shares: the palette rows,
 * the keyboard bindings, the chord completions. A command is data
 * (id, title, category, display keybinding) plus a `run(view)`; the
 * environment (backend access, panel toggles, palette itself) is
 * injected by main.ts so the registry stays pure data + wiring.
 *
 * Backend-dependent commands also declare `enabled()`: the palette and
 * the buttons render them disabled until the backend runs — a
 * projection of the session model, mirroring how `run` still guards
 * (a keyboard shortcut has no row to disable).
 *
 * The `Agda` category doubles as the Ctrl+C chord group: opening the
 * palette in agda mode lists exactly these commands, so the chord
 * letters are discoverable instead of memorized.
 */

import type { EditorView } from '@codemirror/view';
import { appendEventTransaction } from '../model/observability-model';
import {
  type CtxAccessor,
  giveFromCursorCommand,
  loadCommand,
  nextGoalCommand,
  prevGoalCommand,
} from './goal-keymap';

export type CommandCategory = 'Agda' | 'File' | 'View';

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
  run(view: EditorView): boolean;
}

/** The actions the registry needs from the outside world. */
export interface CommandEnv {
  getCtx: CtxAccessor;
  toggleSide(): void;
  toggleDock(): void;
  openPalette(mode: 'all' | 'agda'): void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
/** Display name of the modifier key (⌘ on Apple keyboards). */
export const modKey = isMac ? '⌘' : 'Ctrl';

/**
 * The Ctrl+C chord table: the letter pressed with Ctrl while the
 * palette is in agda mode completes to this command id.
 */
export const agdaChords: Record<string, string> = {
  l: 'agda.load',
  ' ': 'agda.give',
  f: 'agda.next-goal',
  b: 'agda.prev-goal',
};

/** A backend-dependent command that refuses politely when offline. */
function guarded(note: string, run: (view: EditorView) => boolean): (view: EditorView) => boolean {
  return view => {
    const ok = run(view);
    if (!ok) view.dispatch(appendEventTransaction('warn', 'ui', { note }));
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
      keybinding: `${modKey}+C ${modKey}+L`,
      enabled: backendOnline,
      run: view => guarded('load: backend offline', loadCommand(env.getCtx))(view),
    },
    {
      id: 'agda.give',
      title: 'Give (fill the goal under the cursor)',
      category: 'Agda',
      keybinding: `${modKey}+C ${modKey}+Space`,
      enabled: backendOnline,
      run: view => guarded('give: backend offline', giveFromCursorCommand(env.getCtx))(view),
    },
    {
      id: 'agda.next-goal',
      title: 'Next goal',
      category: 'Agda',
      keybinding: `${modKey}+C ${modKey}+F`,
      run: nextGoalCommand,
    },
    {
      id: 'agda.prev-goal',
      title: 'Previous goal',
      category: 'Agda',
      keybinding: `${modKey}+C ${modKey}+B`,
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
        void ctx.syncToVfs();
        return true;
      }),
    },
    {
      id: 'view.show-commands',
      title: 'Show all commands',
      category: 'View',
      keybinding: `${modKey}+Shift+P`,
      run: () => {
        env.openPalette('all');
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
  ];
}
