/**
 * Goal-boundary integrity: keeps the cursor and edits out of a hole's boundary
 * chars (`{!` / `!}`), which are markers and must never be split.
 *
 * Three layers, all exported via {@link goalBoundaryGuard}:
 *  1. {@link filterGoalBoundaries} (transactionFilter) — rejects edits that
 *     touch a boundary unless they delete the whole hole, and snaps selections
 *     that straddle a hole to cover the whole hole (iterated to a fixed point
 *     so neighbouring holes get absorbed too).
 *  2. {@link goalAtomicRangesFor} (pure) + {@link goalAtomicRanges} (facet) —
 *     tells CM6's built-in cursor/mouse movement to skip across the 2-char
 *     boundary pairs, so the caret never rests between `{`/`!` or `!`/`}`.
 *
 * Transactions annotated with `systemTransaction` (editor-owned sync, see
 * goal-model.ts) always pass: they replace whole goals with the authoritative
 * state ALS just confirmed, and a reject would silently drop both the text
 * change AND the fresh goal list.
 *
 * Dead records (from == to — a hole deleted locally, awaiting the next
 * load's reconciliation) have no boundary chars left; every layer here
 * skips them, so typing at/around a deleted hole's position is free.
 */

import type { Extension, Transaction, TransactionSpec } from '@codemirror/state';
import { EditorSelection, EditorState, RangeSet, RangeValue } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  type GoalRecord,
  goalModelField,
  HOLE_BOUNDARY,
  systemTransaction,
} from '../model/goal-model';

/** The deletion range [delFrom, delTo) overlaps a boundary pair of `g`. */
function touchesBoundary(g: GoalRecord, delFrom: number, delTo: number): boolean {
  if (g.from === g.to) return false; // dead record (deleted hole): no boundary to protect
  const touchesOpening = delFrom < g.from + HOLE_BOUNDARY && delTo > g.from;
  const touchesClosing = delFrom < g.to && delTo > g.to - HOLE_BOUNDARY;
  return touchesOpening || touchesClosing;
}

/** A selection [lo, hi) partially overlaps a hole without covering it and without being entirely interior. */
function straddlesHole(g: GoalRecord, lo: number, hi: number): boolean {
  if (g.from === g.to) return false; // dead record: a point cannot be straddled
  const overlaps = lo < g.to && hi > g.from;
  const fullyContains = lo <= g.from && hi >= g.to;
  const entirelyInterior = lo >= g.from + HOLE_BOUNDARY && hi <= g.to - HOLE_BOUNDARY;
  return overlaps && !fullyContains && !entirelyInterior;
}

export function filterGoalBoundaries(
  tr: Transaction,
): TransactionSpec | readonly TransactionSpec[] {
  if (tr.annotation(systemTransaction)) return tr;
  const state = tr.startState.field(goalModelField, false);
  if (!state || state.length === 0) return tr;

  if (tr.docChanged) {
    let rejected = false;
    tr.changes.iterChanges((fromA, toA) => {
      if (rejected) return;
      for (const g of state) {
        if (!touchesBoundary(g, fromA, toA)) continue;
        // Whole-goal deletion (range fully contains the goal): allowed.
        if (fromA <= g.from && toA >= g.to) continue;
        rejected = true;
        return;
      }
    });
    if (rejected) return [];
  }

  // Selection-only transactions: snap any non-empty range that straddles
  // a hole so it spans the whole hole instead of cutting through its
  // boundary. (Skipped for doc-changing transactions so we never drop
  // their text changes.) Empty cursors pass through untouched — a caret
  // on a boundary char is legal editing ground (the vim layer snaps the
  // pair-splitting positions separately), and teleporting it to the
  // hole's start is what kept vim motions out of goals.
  if (!tr.docChanged && tr.selection) {
    let changed = false;
    const ranges = tr.selection.ranges.map(r => {
      if (r.empty) return r;
      let lo = Math.min(r.from, r.to);
      let hi = Math.max(r.from, r.to);
      let prevLo = -1;
      let prevHi = -1;
      // A straddle may expand onto a neighbour; iterate to a fixed point.
      while (prevLo !== lo || prevHi !== hi) {
        prevLo = lo;
        prevHi = hi;
        for (const g of state) {
          if (straddlesHole(g, lo, hi)) {
            lo = Math.min(lo, g.from);
            hi = Math.max(hi, g.to);
          }
        }
      }
      if (lo === r.from && hi === r.to) return r;
      changed = true;
      return r.from <= r.to ? EditorSelection.range(lo, hi) : EditorSelection.range(hi, lo);
    });
    if (changed) {
      return { selection: EditorSelection.create(ranges, tr.selection.mainIndex) };
    }
  }

  return tr;
}

/** Marker value for atomic ranges; CM6 only cares about the range span. */
class BoundaryAtom extends RangeValue {}

const BOUNDARY_ATOM = new BoundaryAtom();

/** Atomic ranges covering every hole's `{!` and `!}` boundary pairs (pure, node-testable). */
export function goalAtomicRangesFor(goals: GoalRecord[]): RangeSet<RangeValue> {
  const atoms = goals.flatMap(g => {
    if (g.from === g.to) return []; // dead record (deleted hole): no boundary pair
    return [
      BOUNDARY_ATOM.range(g.from, g.from + HOLE_BOUNDARY),
      BOUNDARY_ATOM.range(g.to - HOLE_BOUNDARY, g.to),
    ];
  });
  return RangeSet.of(atoms, true);
}

/** CM6 facet provider wiring {@link goalAtomicRangesFor} to the current goals. */
export const goalAtomicRanges: Extension = EditorView.atomicRanges.of(view => {
  const goals = view.state.field(goalModelField, false) ?? [];
  return goalAtomicRangesFor(goals);
});

export const goalBoundaryGuard: Extension = [
  EditorState.transactionFilter.of(filterGoalBoundaries),
  goalAtomicRanges,
];
