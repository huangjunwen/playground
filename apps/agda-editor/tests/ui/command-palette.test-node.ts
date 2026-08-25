/**
 * Command palette — the pure halves: fuzzy matching (subsequence,
 * scoring, positions), mode filtering (the Ctrl+C chord group), match
 * highlighting, and the registry invariants the chord completion and
 * the palette rows depend on.
 */

import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import {
  commandLabel,
  filterCommands,
  fuzzyMatch,
  highlightSegments,
} from '../../src/ui/command-palette';
import { agdaChords, buildCommands, type CommandEnv } from '../../src/ui/commands';

const stubEnv: CommandEnv = {
  getCtx: () => undefined,
  toggleSide: () => {},
  toggleDock: () => {},
  openPalette: () => {},
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

describe('filterCommands', () => {
  const commands = buildCommands(stubEnv);

  it('lists the whole registry in all mode with an empty query', () => {
    const rows = filterCommands(commands, '', 'all');
    expect(rows.map(r => r.command.id)).toEqual(commands.map(c => c.id));
  });

  it('agda mode keeps only the Agda category', () => {
    const rows = filterCommands(commands, '', 'agda');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.command.category).toBe('Agda');
  });

  it('re-orders by score when a query is present', () => {
    const rows = filterCommands(commands, 'give', 'all');
    expect(rows[0]!.command.id).toBe('agda.give');
    expect(rows.length).toBeLessThan(commands.length);
  });

  it('returns nothing for a query nothing matches', () => {
    expect(filterCommands(commands, 'zzzz', 'all')).toEqual([]);
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

  it('resolves every chord letter to an existing Agda command with a keybinding', () => {
    for (const [letter, id] of Object.entries(agdaChords)) {
      const command = commands.find(c => c.id === id);
      expect(command, `chord ${letter} → ${id}`).toBeDefined();
      expect(command!.category).toBe('Agda');
      expect(command!.keybinding).toBeDefined();
    }
  });

  it('labels every command as `Category: Title`', () => {
    for (const command of commands) {
      expect(commandLabel(command)).toBe(`${command.category}: ${command.title}`);
    }
  });
});

describe('command availability (backend as a projection)', () => {
  it('disables exactly the backend-dependent commands while offline', () => {
    const commands = buildCommands(stubEnv);
    const offline = commands.filter(c => c.enabled?.() === false).map(c => c.id);
    expect(offline).toEqual(['agda.load', 'agda.give', 'file.save']);
    // Navigation and view toggles never need the backend.
    for (const command of commands) {
      if (!offline.includes(command.id)) expect(command.enabled?.() ?? true).toBe(true);
    }
  });

  it('enables them once the context exists', () => {
    const commands = buildCommands({ ...stubEnv, getCtx: () => ({}) as never });
    for (const id of ['agda.load', 'agda.give', 'file.save']) {
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
