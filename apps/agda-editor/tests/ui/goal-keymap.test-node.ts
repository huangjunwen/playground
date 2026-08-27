/**
 * Goal keymap — the pure state math: which goal a give targets, the payload
 * it sends, and where `next goal` lands (ordering + wrap-around). The
 * Command wrappers are one-liners over these and stay untested here.
 *
 */

import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { type GoalRecord, goalModelField, setGoals } from '../../src/model/goal-model';
import { sessionModelField } from '../../src/model/session-model';
import {
  goalBackspaceSpec,
  goalUnderCursor,
  goalVimDeleteSpec,
  interiorOf,
  nextGoalRange,
  prevGoalRange,
} from '../../src/ui/goal-keymap';

function makeState(doc: string, goals: GoalRecord[], head = 0) {
  return EditorState.create({
    doc,
    selection: { anchor: head },
    extensions: [goalModelField, sessionModelField],
  }).update({ effects: [setGoals.of(goals)] }).state;
}

describe('goalUnderCursor', () => {
  it('finds the hole containing the cursor', () => {
    const state = makeState('a = {! x !}\n', [{ id: 0, from: 4, to: 11 }], 7);
    expect(goalUnderCursor(state)?.id).toBe(0);
  });

  it('falls back to the first visible goal when the cursor is outside', () => {
    const goals = [
      { id: 0, from: 4, to: 11 },
      { id: 1, from: 16, to: 23 },
    ];
    const state = makeState('a = {! x !}\nb = {! y !}\n', goals, 0);
    expect(goalUnderCursor(state)?.id).toBe(0);
  });

  it('never falls back to a deleted hole', () => {
    const goals = [
      { id: 0, from: 4, to: 4 }, // deleted
      { id: 1, from: 16, to: 23 },
    ];
    const state = makeState('a\nb = {! y !}\n', goals, 0);
    expect(goalUnderCursor(state)?.id).toBe(1);
  });
});

describe('interiorOf', () => {
  it('extracts the hole interior, trimmed of the boundary and padding', () => {
    // `{!` at 4-5, interior '  suc n  ' at 6-14, `!}` at 15-16 → to = 17.
    const state = makeState('a = {!  suc n  !}\n', [{ id: 0, from: 4, to: 17 }]);
    expect(interiorOf(state, { id: 0, from: 4, to: 17 })).toBe('suc n');
  });

  it('gives the empty string for an untouched hole', () => {
    expect(interiorOf(makeState('a = {!   !}\n', []), { id: 0, from: 4, to: 11 })).toBe('');
  });
});

describe('nextGoalRange', () => {
  const goals: GoalRecord[] = [
    { id: 1, from: 14, to: 19 },
    { id: 0, from: 4, to: 9 },
    { id: 2, from: 24, to: 24 }, // deleted — skipped
  ];

  it('picks the first goal starting at or after the cursor', () => {
    expect(nextGoalRange(goals, 10)).toEqual({ id: 1, from: 14, to: 19 });
  });

  it('wraps around past the last goal', () => {
    expect(nextGoalRange(goals, 20)).toEqual({ id: 0, from: 4, to: 9 });
  });

  it('returns undefined when there is no visible goal', () => {
    expect(nextGoalRange([], 0)).toBeUndefined();
  });
});

describe('prevGoalRange', () => {
  const goals: GoalRecord[] = [
    { id: 1, from: 14, to: 19 },
    { id: 0, from: 4, to: 9 },
    { id: 2, from: 24, to: 24 }, // deleted — skipped
  ];

  it('picks the goal whose end the cursor sits on', () => {
    expect(prevGoalRange(goals, 19)).toEqual({ id: 1, from: 14, to: 19 });
  });

  it('skips the goal the cursor sits inside when it starts before it', () => {
    // Cursor at 15/16 (inside goal 1, which ends at 19): goal 1 ends after
    // the cursor, so the previous one is goal 0.
    expect(prevGoalRange(goals, 15)).toEqual({ id: 0, from: 4, to: 9 });
    expect(prevGoalRange(goals, 16)).toEqual({ id: 0, from: 4, to: 9 });
  });

  it('wraps around before the first goal', () => {
    expect(prevGoalRange(goals, 3)).toEqual({ id: 1, from: 14, to: 19 });
  });

  it('returns undefined when there is no visible goal', () => {
    expect(prevGoalRange([], 0)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Boundary deletion dance — goalBackspaceSpec / goalVimDeleteSpec
// ---------------------------------------------------------------------------

describe('goalBackspaceSpec', () => {
  // 'a = {!  n  !}\n': `{!` at 4..5, interior at 6..10, `!}` at 11..12, to = 13.
  const doc = 'a = {!  n  !}\n';
  const goal: GoalRecord = { id: 0, from: 4, to: 13 };
  const at = (head: number) => makeState(doc, [goal], head);

  it('first press at the interior start selects the whole hole', () => {
    expect(goalBackspaceSpec(at(6))).toEqual({ selection: { anchor: 4, head: 13 } });
  });

  it('first press right after the closing brace selects the whole hole', () => {
    expect(goalBackspaceSpec(at(13))).toEqual({ selection: { anchor: 4, head: 13 } });
  });

  it('second press with the armed selection deletes the hole', () => {
    const armed = makeState(doc, [goal]).update({ selection: { anchor: 4, head: 13 } }).state;
    expect(goalBackspaceSpec(armed)).toEqual({
      changes: { from: 4, to: 13 },
      selection: { anchor: 4 },
    });
  });

  it('a selection merely containing the hole falls through (normal delete)', () => {
    const wide = makeState(doc, [goal]).update({ selection: { anchor: 0, head: 14 } }).state;
    expect(goalBackspaceSpec(wide)).toBeUndefined();
  });

  it('an interior cursor away from the boundary falls through', () => {
    expect(goalBackspaceSpec(at(8))).toBeUndefined();
  });

  it('a cursor before the hole falls through (deletes unrelated text)', () => {
    expect(goalBackspaceSpec(at(4))).toBeUndefined();
    expect(goalBackspaceSpec(at(2))).toBeUndefined();
  });
});

describe('goalVimDeleteSpec', () => {
  const doc = 'a = {!  n  !}\n';
  const goal: GoalRecord = { id: 0, from: 4, to: 13 };
  const at = (head: number) => makeState(doc, [goal], head);

  it('cursor on any boundary char arms the dance', () => {
    for (const head of [4, 5, 11, 12]) {
      expect(goalVimDeleteSpec(at(head))).toEqual({ selection: { anchor: 4, head: 13 } });
    }
  });

  it('second press with the armed selection deletes the hole', () => {
    const armed = makeState(doc, [goal]).update({ selection: { anchor: 4, head: 13 } }).state;
    expect(goalVimDeleteSpec(armed)).toEqual({
      changes: { from: 4, to: 13 },
      selection: { anchor: 4 },
    });
  });

  it('an interior cursor falls through to per-character x', () => {
    expect(goalVimDeleteSpec(at(6))).toBeUndefined();
    expect(goalVimDeleteSpec(at(10))).toBeUndefined();
  });

  it('a cursor past the hole falls through (x hits the char after it)', () => {
    expect(goalVimDeleteSpec(at(13))).toBeUndefined();
  });
});
