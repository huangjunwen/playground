/**
 * Command palette — the pure halves: fuzzy matching (subsequence,
 * scoring, positions), the key-sequence machinery (event → binding
 * normalization, prefix matching, filtering by a pressed chord),
 * match highlighting, and the registry invariants the palette rows
 * and the global dispatch depend on.
 */

import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import {
  bindingOfEvent,
  commandLabel,
  filterCommands,
  fuzzyMatch,
  highlightSegments,
  matchSequence,
} from '../../src/ui/command-palette';
import { agdaChordRoot, buildCommands, type CommandEnv, modKey } from '../../src/ui/commands';

const stubEnv: CommandEnv = {
  getCtx: () => undefined,
  toggleSide: () => {},
  toggleDock: () => {},
  openPalette: () => {},
  getTheme: () => 'system',
  setTheme: () => {},
  isVim: () => false,
  toggleVim: () => {},
  openAbout: () => {},
};

describe('fuzzyMatch', () => {
  it('matches a subsequence and reports its positions', () => {
    expect(fuzzyMatch('gl', 'Agda: Load')).toEqual({
      score: expect.any(Number),
      positions: [1, 6],
    });
  });

  it('rejects a non-subsequence', () => {
    expect(fuzzyMatch('lg', 'Agda: Load')).toBeNull();
  });

  it('matches case-insensitively', () => {
    expect(fuzzyMatch('AGDA', 'Agda: Load')).not.toBeNull();
  });

  it('scores a word-start hit above a mid-word run', () => {
    const wordStart = fuzzyMatch('l', 'Agda: Load')!;
    const midWord = fuzzyMatch('o', 'Agda: Load')!;
    expect(wordStart.score).toBeGreaterThan(midWord.score);
  });

  it('matches everything on an empty query', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });
});

describe('bindingOfEvent', () => {
  it('normalizes letters, space, and shift into binding segments', () => {
    expect(
      bindingOfEvent({ key: 'l', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }),
    ).toBe(`${modKey}+L`);
    expect(
      bindingOfEvent({ key: ' ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }),
    ).toBe(`${modKey}+Space`);
    expect(
      bindingOfEvent({ key: 'p', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }),
    ).toBe(`${modKey}+Shift+P`);
  });

  it('accepts either ctrl or the platform meta key', () => {
    expect(
      bindingOfEvent({ key: 'c', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false }),
    ).toBe(`${modKey}+C`);
  });

  it('recovers the binding from code on IME-processed events', () => {
    // what fcitx/ibus deliver for their Ctrl+Space IME toggle
    expect(
      bindingOfEvent({
        key: 'Process',
        code: 'Space',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(`${modKey}+Space`);
    expect(
      bindingOfEvent({
        key: 'Process',
        code: 'KeyL',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(`${modKey}+L`);
    // no code to fall back on → still invisible
    expect(
      bindingOfEvent({
        key: 'Process',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
    // real-world capture on Linux/fcitx: key blanked to Unidentified
    expect(
      bindingOfEvent({
        key: 'Unidentified',
        code: 'Space',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(`${modKey}+Space`);
    expect(
      bindingOfEvent({
        key: 'Unidentified',
        code: 'Digit1',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(`${modKey}+1`);
  });

  it('rejects plain keys, alt combos, and bare modifiers', () => {
    expect(
      bindingOfEvent({ key: 'l', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }),
    ).toBeNull();
    expect(
      bindingOfEvent({ key: 'l', ctrlKey: true, metaKey: false, shiftKey: false, altKey: true }),
    ).toBeNull();
    expect(
      bindingOfEvent({
        key: 'Control',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
    expect(
      bindingOfEvent({
        key: 'ArrowDown',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });
});

describe('matchSequence', () => {
  const commands = buildCommands(stubEnv);

  it('counts the chord root as a pure prefix of the agda commands', () => {
    const match = matchSequence(commands, agdaChordRoot);
    expect(match.exact).toEqual([]);
    expect(match.prefixCount).toBe(6); // load, give, refine, case, next-goal, prev-goal
  });

  it('completes a full chord to exactly one command', () => {
    const match = matchSequence(commands, `${agdaChordRoot} ${modKey}+L`);
    expect(match.exact.map(c => c.id)).toEqual(['agda.load']);
    expect(match.prefixCount).toBe(1);
  });

  it('matches a single-key binding exactly', () => {
    const match = matchSequence(commands, `${modKey}+S`);
    expect(match.exact.map(c => c.id)).toEqual(['file.save']);
    expect(match.prefixCount).toBe(1);
  });

  it('matches nothing for an unbound combo', () => {
    const match = matchSequence(commands, `${modKey}+Q`);
    expect(match.exact).toEqual([]);
    expect(match.prefixCount).toBe(0);
  });
});

describe('filterCommands', () => {
  const commands = buildCommands(stubEnv);

  it('lists the whole registry with no prefix and an empty query', () => {
    const rows = filterCommands(commands, '');
    expect(rows.map(r => r.command.id)).toEqual(commands.map(c => c.id));
  });

  it('a pressed chord root keeps only the bindings extending it', () => {
    const rows = filterCommands(commands, '', agdaChordRoot);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.command.category).toBe('Agda');
      expect(row.command.keybinding!.startsWith(`${agdaChordRoot} `)).toBe(true);
    }
  });

  it('re-orders by score when a query is present', () => {
    const rows = filterCommands(commands, 'give');
    expect(rows[0]!.command.id).toBe('agda.give');
    expect(rows.length).toBeLessThan(commands.length);
  });

  it('combines the key prefix with the typed query', () => {
    const rows = filterCommands(commands, 'next', agdaChordRoot);
    expect(rows.map(r => r.command.id)).toEqual(['agda.next-goal']);
  });

  it('returns nothing for a query nothing matches', () => {
    expect(filterCommands(commands, 'zzzz')).toEqual([]);
  });
});

describe('highlightSegments', () => {
  it('splits the label into hit and plain runs', () => {
    // 'Agda: Load': 'a' at 3, 'L' at 6.
    expect(highlightSegments('Agda: Load', [3, 6])).toEqual([
      { text: 'Agd', hit: false },
      { text: 'a', hit: true },
      { text: ': ', hit: false },
      { text: 'L', hit: true },
      { text: 'oad', hit: false },
    ]);
  });

  it('returns one plain segment without hits', () => {
    expect(highlightSegments('Agda: Load', [])).toEqual([{ text: 'Agda: Load', hit: false }]);
  });
});

describe('command registry', () => {
  const commands = buildCommands(stubEnv);

  it('has unique ids', () => {
    const ids = commands.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('extends the chord root only from the Agda category', () => {
    for (const command of commands) {
      if (command.keybinding?.startsWith(`${agdaChordRoot} `)) {
        expect(command.category).toBe('Agda');
      }
    }
  });

  it('labels every command as `Category: Title`', () => {
    for (const command of commands) {
      expect(commandLabel(command)).toBe(`${command.category}: ${command.title}`);
    }
  });

  it('marks exactly one theme command checked per preference', () => {
    for (const theme of ['light', 'dark', 'system'] as const) {
      const commands = buildCommands({ ...stubEnv, getTheme: () => theme });
      const checked = commands.filter(c => c.checked?.()).map(c => c.id);
      expect(checked).toEqual([`view.theme-${theme}`]);
    }
  });

  it('setTheme/toggleVim flow through the environment', () => {
    const setTheme = vi.fn();
    const toggleVim = vi.fn();
    const commands = buildCommands({ ...stubEnv, setTheme, toggleVim });
    const view = { dispatch: vi.fn() } as unknown as EditorView;

    expect(commands.find(c => c.id === 'view.theme-dark')!.run(view)).toBe(true);
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(commands.find(c => c.id === 'view.toggle-vim')!.run(view)).toBe(true);
    expect(toggleVim).toHaveBeenCalledOnce();
  });
});

describe('command availability (backend as a projection)', () => {
  it('disables exactly the backend-dependent commands while offline', () => {
    const commands = buildCommands(stubEnv);
    const offline = commands.filter(c => c.enabled?.() === false).map(c => c.id);
    expect(offline).toEqual(['agda.load', 'agda.give', 'agda.refine', 'agda.case', 'file.save']);
    // Navigation and view toggles never need the backend.
    for (const command of commands) {
      if (!offline.includes(command.id)) expect(command.enabled?.() ?? true).toBe(true);
    }
  });

  it('enables them once the context exists', () => {
    const commands = buildCommands({ ...stubEnv, getCtx: () => ({}) as never });
    for (const id of ['agda.load', 'agda.give', 'agda.refine', 'agda.case', 'file.save']) {
      expect(commands.find(c => c.id === id)!.enabled?.(), id).toBe(true);
    }
  });

  it('file.save runs the context vfs seam when online', () => {
    const syncToVfs = vi.fn(async () => true);
    const commands = buildCommands({ ...stubEnv, getCtx: () => ({ syncToVfs }) as never });
    const view = { dispatch: vi.fn() } as unknown as EditorView;

    expect(commands.find(c => c.id === 'file.save')!.run(view)).toBe(true);
    expect(syncToVfs).toHaveBeenCalledOnce();
    expect(view.dispatch).not.toHaveBeenCalled(); // no warn while online
  });

  it('file.save refuses with a ui warn while offline', () => {
    const commands = buildCommands(stubEnv);
    const view = { dispatch: vi.fn() } as unknown as EditorView;

    expect(commands.find(c => c.id === 'file.save')!.run(view)).toBe(true);
    expect(view.dispatch).toHaveBeenCalledOnce(); // the guarded warn event
  });
});
