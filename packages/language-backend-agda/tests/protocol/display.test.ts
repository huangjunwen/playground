/**
 * Unit tests for the display formatters — agda-mode fidelity pins: every
 * expected string is the line agda itself prints (BasicOps.hs pretty
 * instances, `showGoals`, `prettyShow Range`).
 */

import { describe, expect, it } from 'vitest';
import {
  collectVisibleGoalTypes,
  formatAllGoals,
  formatRange,
  renderGoal,
} from '../../src/protocol/display';
import type { NamedMeta, OutputConstraint } from '../../src/protocol/responses';

const ip = (id: number): { id: number; range: [] } => ({ id, range: [] });
const meta = (name: string): NamedMeta => ({ name, range: [] });
const interval = (l1: number, c1: number, l2: number, c2: number) => ({
  start: { pos: 0, line: l1, col: c1 },
  end: { pos: 0, line: l2, col: c2 },
});

// ---------------------------------------------------------------------------
// renderGoal — BasicOps.hs `Pretty OutputConstraint`

describe('renderGoal', () => {
  it('renders the common shapes', () => {
    const cases: [OutputConstraint, string][] = [
      [{ kind: 'OfType', constraintObj: ip(0), type: 'Nat' }, '?0 : Nat'],
      [{ kind: 'OfType', constraintObj: meta('_A_3'), type: 'Set' }, '_A_3 : Set'],
      [{ kind: 'JustType', constraintObj: ip(1) }, 'Type ?1'],
      [{ kind: 'JustSort', constraintObj: meta('_s') }, 'Sort _s'],
      [
        { kind: 'CmpInType', comparison: '=<:', type: 'Nat', constraintObjs: [ip(0), meta('_m')] },
        '?0 =<: _m : Nat',
      ],
      [{ kind: 'CmpTypes', comparison: '<:', constraintObjs: [ip(0), ip(1)] }, '?0 <: ?1'],
      [{ kind: 'Assign', constraintObj: ip(0), value: 'suc n' }, '?0 := suc n'],
      [
        { kind: 'TypedAssign', constraintObj: ip(0), value: 'suc n', type: 'Nat' },
        '?0 := suc n :? Nat',
      ],
      [{ kind: 'IsEmptyType', type: 'Nat' }, 'Is empty: Nat'],
      [{ kind: 'SizeLtSat', type: 'Size< 3' }, 'Not empty type of sizes: Size< 3'],
      [
        { kind: 'FindInstanceOF', constraintObj: ip(0), candidates: [], type: 'Foo' },
        'Resolve instance argument ?0 : Foo',
      ],
      [{ kind: 'ResolveInstanceOF', name: '_x' }, 'Resolve output type of instance _x'],
      [{ kind: 'PTSInstance', constraintObjs: [ip(0), meta('_s')] }, 'PTS instance for (?0, _s)'],
      [
        { kind: 'PostponedCheckFunDef', name: 'f', type: 'Nat', error: { message: '' } },
        'Check definition of f : Nat',
      ],
      [{ kind: 'DataSort', name: 'D', sort: 'Setω' }, 'Sort Setω allows data/record definitions'],
      [{ kind: 'CheckLock', head: 'e', lock: '@0' }, 'Check lock @0 allows e'],
      [{ kind: 'UsableAtMod', mod: '①', term: 'e' }, 'Is usable at ① modality: e'],
    ];
    for (const [constraint, expected] of cases) expect(renderGoal(constraint)).toBe(expected);
  });

  it('renders CmpElim with polarities in place of the comparison operator', () => {
    const c: OutputConstraint = {
      kind: 'CmpElim',
      polarities: ['+', '-'],
      type: 'Nat',
      constraintObjs: [
        [ip(0), meta('_a')],
        [meta('_b'), ip(1)],
      ],
    };
    expect(renderGoal(c)).toBe('?0 + - _b : Nat');
  });

  it('renders PostponedCheckArgs with its argument spine', () => {
    const c: OutputConstraint = {
      kind: 'PostponedCheckArgs',
      constraintObj: ip(0),
      ofType: 'Nat',
      arguments: ['zero', 'suc'],
      type: 'Nat',
    };
    expect(renderGoal(c)).toBe('?0 := (_ : Nat zero suc) : Nat');
  });
});

// ---------------------------------------------------------------------------
// formatRange — prettyShow Range

describe('formatRange', () => {
  it('same line: l.c-c', () => {
    expect(formatRange([interval(4, 13, 4, 15)])).toBe('4.13-15');
  });

  it('across lines: l.c-l.c', () => {
    expect(formatRange([interval(7, 2, 9, 8)])).toBe('7.2-9.8');
  });

  it('joins multiple intervals with commas', () => {
    expect(formatRange([interval(1, 1, 1, 2), interval(3, 4, 3, 9)])).toBe('1.1-2,3.4-9');
  });
});

// ---------------------------------------------------------------------------
// formatAllGoals — BasicOps.hs showGoals (the *All Goals* buffer)

describe('formatAllGoals', () => {
  it('empty snapshot is the All Done buffer', () => {
    expect(formatAllGoals({ visibleGoals: [], invisibleGoals: [] })).toEqual(['All Done']);
  });

  it('lists visible goals first, then hidden metas with their position', () => {
    const lines = formatAllGoals({
      visibleGoals: [{ kind: 'OfType', constraintObj: ip(0), type: 'Nat' }],
      invisibleGoals: [
        {
          kind: 'OfType',
          constraintObj: { name: '_A_3', range: [interval(4, 13, 4, 15)] },
          type: 'Set',
        },
      ],
    });
    expect(lines).toEqual(['?0 : Nat', '_A_3 : Set  [ at 4.13-15 ]']);
  });

  it('hidden meta with no range gets no position suffix', () => {
    const lines = formatAllGoals({
      visibleGoals: [],
      invisibleGoals: [{ kind: 'JustType', constraintObj: meta('_m') }],
    });
    expect(lines).toEqual(['Type _m']);
  });
});

// ---------------------------------------------------------------------------
// collectVisibleGoalTypes

describe('collectVisibleGoalTypes', () => {
  it('collects id → type from OfType constraints on interaction points', () => {
    const typesById = collectVisibleGoalTypes([
      { kind: 'OfType', constraintObj: ip(0), type: 'Nat' },
      { kind: 'OfType', constraintObj: ip(1), type: 'Nat → Nat' },
    ]);
    expect(typesById.get(0)).toBe('Nat');
    expect(typesById.get(1)).toBe('Nat → Nat');
  });

  it('collects JustSort goals as their rendered form (Sort ?N)', () => {
    const typesById = collectVisibleGoalTypes([{ kind: 'JustSort', constraintObj: ip(2) }]);
    expect(typesById.get(2)).toBe('Sort ?2');
  });

  it('skips other shapes and NamedMeta constraint objects', () => {
    const typesById = collectVisibleGoalTypes([
      { kind: 'JustType', constraintObj: ip(0) },
      { kind: 'Assign', constraintObj: meta('_m'), value: 'x' },
      { kind: 'CmpInType', comparison: '=', type: 'Nat', constraintObjs: [ip(2)] },
    ]);
    expect(typesById.size).toBe(0);
  });

  it('returns a fresh map per call (each AllGoalsWarnings is a full snapshot)', () => {
    const first = collectVisibleGoalTypes([{ kind: 'OfType', constraintObj: ip(0), type: 'Nat' }]);
    const second = collectVisibleGoalTypes([
      { kind: 'OfType', constraintObj: ip(9), type: 'Bool' },
    ]);
    expect([...first]).toEqual([[0, 'Nat']]);
    expect([...second]).toEqual([[9, 'Bool']]);
  });
});
