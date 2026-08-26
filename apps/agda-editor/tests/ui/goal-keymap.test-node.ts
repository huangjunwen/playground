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
  goalUnderCursor,
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
