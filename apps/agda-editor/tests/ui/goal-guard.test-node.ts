/**
 * Boundary protection: transactionFilter rejects edits that split a hole's
 * `{!` / `!}` boundary chars (whole-hole deletion exempt), snaps selections
 * that straddle a hole to cover it (iterated to a fixed point), and passes
 * editor-owned sync transactions carrying `systemTransaction`.
 *
 * Tested at the EditorState level (node, no DOM): `EditorState.update` runs
 * transactionFilters, so a rejected transaction leaves the state untouched.
 */

import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  type GoalRecord,
  goalModelField,
  setGoals,
  systemTransaction,
} from '../../src/model/goal-model';
import {
  filterGoalBoundaries,
  goalAtomicRangesFor,
  goalBoundaryGuard,
} from '../../src/ui/goal-guard';

/** One-hole doc: hole spans [4, 11), boundaries `{!`@4..6 and `!}`@9..11. */
const DOC = 'a = {! x !}';
const HOLE: GoalRecord = { id: 0, from: 4, to: 11 };

/** Two adjacent holes: [3, 8) and [11, 16) in `a = {! !}b = {! !}`. */
const DOC2 = 'a = {! !}b = {! !}';
const HOLES2: GoalRecord[] = [
  { id: 0, from: 3, to: 8 },
  { id: 1, from: 11, to: 16 },
];

function makeState(doc: string, goals: GoalRecord[]): EditorState {
  const base = EditorState.create({
    doc,
    extensions: [goalModelField, EditorState.transactionFilter.of(filterGoalBoundaries)],
  });
  return base.update({ effects: setGoals.of(goals) }).state;
}

describe('filterGoalBoundaries — reject boundary-splitting deletes', () => {
  it('rejects deleting the `{` of a boundary', () => {
    const s = makeState(DOC, [HOLE]);
    const res = s.update({ changes: { from: 4, to: 5 } });
    expect(res.state.doc.toString()).toBe(DOC);
  });

  it('rejects deleting the `!` of a boundary', () => {
    const s = makeState(DOC, [HOLE]);
    const res = s.update({ changes: { from: 5, to: 6 } });
    expect(res.state.doc.toString()).toBe(DOC);
  });

  it('rejects deleting the closing `!}` pair', () => {
    const s = makeState(DOC, [HOLE]);
    const res = s.update({ changes: { from: 9, to: 11 } });
    expect(res.state.doc.toString()).toBe(DOC);
  });

  it('allows deleting the whole hole', () => {
    const s = makeState(DOC, [HOLE]);
    const res = s.update({ changes: { from: 4, to: 11 } });
    expect(res.state.doc.toString()).toBe('a = ');
  });

  it('allows interior edits (do not touch boundaries)', () => {
    const s = makeState(DOC, [HOLE]);
    const res = s.update({ changes: { from: 7, to: 8, insert: 'y' } });
    expect(res.state.doc.toString()).toBe('a = {! y !}');
  });

  it('allows edits outside every hole', () => {
    const s = makeState(DOC, [HOLE]);
    const res = s.update({ changes: { from: 0, to: 0, insert: 'x' } });
    expect(res.state.doc.toString()).toBe('xa = {! x !}');
  });

  it('passes transactions annotated systemTransaction even when touching a boundary', () => {
    const s = makeState(DOC, [HOLE]);
    const res = s.update({
      changes: { from: 4, to: 5 },
      annotations: systemTransaction.of(true),
    });
    expect(res.state.doc.toString()).toBe('a = ! x !}');
  });
});

describe('filterGoalBoundaries — snap straddling selections', () => {
  it('snaps a cursor on a boundary into the whole hole', () => {
    const s = makeState(DOC, [HOLE]);
    const res = s.update({ selection: EditorSelection.cursor(5) });
    expect(res.state.selection.main.from).toBe(4);
    expect(res.state.selection.main.to).toBe(4);
  });

  it('does not snap a cursor inside the interior', () => {
    const s = makeState(DOC, [HOLE]);
    const res = s.update({ selection: EditorSelection.cursor(7) });
    expect(res.state.selection.main.from).toBe(7);
  });

  it('snaps a range straddling a hole to cover the whole hole', () => {
    const s = makeState(DOC, [HOLE]);
    const res = s.update({ selection: EditorSelection.range(5, 7) });
    const sel = res.state.selection.main;
    expect([sel.from, sel.to]).toEqual([4, 11]);
  });

  it('snaps across adjacent holes iteratively to a fixed point', () => {
    const s = makeState(DOC2, HOLES2);
    const res = s.update({ selection: EditorSelection.range(7, 12) });
    const sel = res.state.selection.main;
    expect([sel.from, sel.to]).toEqual([3, 16]);
  });

  it('leaves a selection fully covering a hole unchanged', () => {
    const s = makeState(DOC, [HOLE]);
    const res = s.update({ selection: EditorSelection.range(2, 11) });
    const sel = res.state.selection.main;
    expect([sel.from, sel.to]).toEqual([2, 11]);
  });
});

describe('goalAtomicRangesFor — atomic boundary pairs', () => {
  it('emits one atom per boundary pair, covering the 2 chars', () => {
    const atoms: [number, number][] = [];
    goalAtomicRangesFor([HOLE]).between(0, DOC.length, (from, to) => atoms.push([from, to]));
    expect(atoms).toEqual([
      [4, 6],
      [9, 11],
    ]);
  });
});

describe('goalBoundaryGuard composition', () => {
  it('is a non-empty extension array wiring filter + atoms', () => {
    expect(Array.isArray(goalBoundaryGuard)).toBe(true);
    expect(goalBoundaryGuard.length).toBeGreaterThan(0);
  });
});
