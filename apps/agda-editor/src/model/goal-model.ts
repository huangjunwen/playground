/**
 * Goal model — GoalRecord plus the StateField that stores and remaps it, and
 * the transactions that change the goal list.
 *
 * The position layer (from/to) is remapped by CM6 on every edit; the
 * semantic layer (id/typeString) is refreshed only via the transactions
 * here (syncGoals and friends).
 */

import {
  Annotation,
  ChangeSet,
  type EditorState,
  StateEffect,
  StateField,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import type { GiveResult, InteractionPoint } from '@playground/language-backend-agda';

/**
 * Pass card for editor-owned sync transactions (expansion, command-applied
 * text): boundary protection lets them through.
 */
export const systemTransaction = Annotation.define<boolean>();

export interface GoalRecord {
  /** Agda interaction id (monotonic within a load cycle; may be renumbered afterwards). */
  id: number;
  /** CM6 0-based start (`{` or `?`). */
  from: number;
  /** CM6 0-based end (after `}` / after `?`). */
  to: number;
  /** Type string cached from AllGoalsWarnings at last load (advisory once the buffer drifts). */
  typeString?: string;
}

/** Boundary char count: `{!` and `!}` each span 2 chars. */
export const HOLE_BOUNDARY = 2;

/**
 * Soft sync: replace the whole goal list. The payload's positions are final —
 * already mapped through this transaction's changes by the builder that
 * emitted it; only later transactions' edits remap them again.
 */
export const setGoals = StateEffect.define<GoalRecord[]>();

/**
 * Goal model StateField. The position layer is remapped on every doc change:
 * - from sticks to the right side of `{` (side=1), to sticks to the left side of `}` (side=-1)
 * - edits inside a hole (interior inserts/deletes): from stays, to follows
 * - edits outside a hole: whole record translates
 * - deleting an entire hole: mapPos converges to one point → from==to (zero width),
 *   but the record stays in the list
 */
export const goalModelField = StateField.define<GoalRecord[]>({
  create: () => [],
  update(value, tr) {
    let synced: GoalRecord[] | undefined;
    for (const e of tr.effects) {
      if (e.is(setGoals)) synced = e.value;
    }
    // A sync payload speaks final coordinates for the transaction it rides
    // in (its builder mapped it) — take it verbatim, no second remap.
    if (synced !== undefined) return synced;
    if (!tr.docChanged) return value;
    return value.map(g => {
      const from = tr.changes.mapPos(g.from, 1);
      const to = Math.max(tr.changes.mapPos(g.to, -1), from);
      return { ...g, from, to };
    });
  },
});

export function getGoals(state: { field<T>(f: StateField<T>): T }): GoalRecord[] {
  return state.field(goalModelField);
}

/** Goal containing `pos` (`pos ∈ [from, to)`), for cursor location. */
export function goalAt(
  state: { field<T>(f: StateField<T>): T },
  pos: number,
): GoalRecord | undefined {
  return getGoals(state).find(g => pos >= g.from && pos < g.to);
}

/** Lookup by id (first choice for commands; caller falls back to position lookup when ids go stale). */
export function goalById(
  state: { field<T>(f: StateField<T>): T },
  id: number,
): GoalRecord | undefined {
  return getGoals(state).find(g => g.id === id);
}

// ---------------------------------------------------------------------------
// Data builders — reconciled goal list
// ---------------------------------------------------------------------------

/**
 * Reconcile the goal list with the goal data a command accumulated, taking
 * the InteractionPoints snapshot as the standard: every point in the
 * snapshot becomes exactly one goal record; existing goals absent from it
 * were solved — dropped. Same builder behind the load rebuild (`existing`
 * empty) and the give-family sync (`existing` non-empty).
 *
 * `points` undefined → no snapshot came; indistinguishable from "all goals
 * solved", so the sync is skipped. `typesById` undefined → no
 * AllGoalsWarnings was seen; survivor type strings are kept.
 *
 * Per point, the layers merge by priority:
 * - position: the state's remapped range when the id survives (already
 *   self-consistent with the document); otherwise the response range —
 *   authoritative for the new document ("payload = written text"
 *   convention), converted Agda 1-based → CM6 0-based here. An empty range
 *   array is malformed and dropped (reappears at the next load); a
 *   zero-width interval (e.g. refine's rightMargin hack) passes through.
 * - typeString: the response's entry when present (a nested solved meta
 *   changes it, e.g. `?0 → Nat` becomes `Nat → Nat`); otherwise the
 *   surviving record's cached string.
 */
export function syncGoals(
  existing: GoalRecord[],
  points: InteractionPoint[] | undefined,
  typesById: Map<number, string> | undefined,
): GoalRecord[] {
  if (points === undefined) return existing;
  const priorById = new Map(existing.map(g => [g.id, g] as const));
  const goals: GoalRecord[] = [];
  for (const p of points) {
    const prior = priorById.get(p.id);
    if (prior === undefined) {
      if (p.range.length === 0) {
        console.warn(`syncGoals: dropping malformed interaction point ${p.id} (empty range)`);
        continue;
      }
      const { start, end } = p.range[0]!;
      goals.push({
        id: p.id,
        from: start.pos - 1,
        to: end.pos - 1,
        typeString: typesById?.get(p.id),
      });
    } else {
      const type = typesById?.get(p.id);
      goals.push(type === undefined ? prior : { ...prior, typeString: type });
    }
  }
  return goals.sort((a, b) => a.from - b.from);
}

// ---------------------------------------------------------------------------
// `?` expansion transaction
// ---------------------------------------------------------------------------

/** Expanded hole text: `{!` + 3 spaces + `!}` (decision point 4). */
export const HOLE_TEXT = '{!   !}';

/**
 * Transaction that commits `goals` (original coordinates), expanding bare
 * `?` goals into `{!   !}` holes in the same transaction — dispatched
 * together with the caller's own spec by the load commit and the
 * give-family sync.
 *
 * The expansion is driven by the goal list, never by scanning the document:
 * only top-level goals live in the list, so `?` inside comments, string
 * literals or nested `{! !}` blocks is structurally excluded.
 *
 * The changes carry original coordinates; the setGoals payload final ones —
 * the records are mapped through the expansion changes here (same sticky
 * sides the goal field uses), so the field takes the payload verbatim. That
 * lets a give-family sync ride in one multi-spec dispatch with the
 * replacement spec (one transaction, one UI update).
 */
export function expandGoalsTransaction(state: EditorState, goals: GoalRecord[]): TransactionSpec {
  const changes: Array<{ from: number; to: number; insert: string }> = [];

  for (const g of goals) {
    if (state.sliceDoc(g.from, g.from + 1) === '?') {
      changes.push({ from: g.from, to: g.from + 1, insert: HOLE_TEXT });
    }
  }

  const expanded = ChangeSet.of(changes, state.doc.length);
  const final = goals.map(g => {
    const from = expanded.mapPos(g.from, 1);
    const to = Math.max(expanded.mapPos(g.to, -1), from);
    return { ...g, from, to };
  });

  const annotations = [systemTransaction.of(true), Transaction.addToHistory.of(false)];
  // `sequential`: when dispatched after another spec, this spec's positions
  // are in the coordinates of the document *after* that spec (CM6 composes
  // them into one transaction) — dispatched alone, the flag is inert.
  return changes.length > 0
    ? { changes, effects: [setGoals.of(final)], annotations, sequential: true }
    : { effects: [setGoals.of(final)], annotations, sequential: true };
}

// ---------------------------------------------------------------------------
// Give replacement transaction
// ---------------------------------------------------------------------------

/**
 * Transaction spec that commits a GiveAction's giveResult to the given goal:
 * replace the whole hole with the give text and drop the goal from the list.
 * Survivors are mapped to final coordinates through the replacement here, so
 * this spec composes with the follow-up sync (expandGoalsTransaction +
 * syncGoals) in one multi-spec dispatch. Annotated as a system transaction
 * (bypasses boundary protection) and kept out of the undo history.
 *
 * - {paren:false}: keep the payload verbatim (strip the hole boundaries)
 * - {paren:true}:  wrap the payload in parentheses
 * - {str}:         replace the whole hole with the string
 */
export function giveReplacementTransaction(
  state: EditorState,
  goal: GoalRecord,
  payload: string,
  result: GiveResult,
): TransactionSpec {
  const insert = 'str' in result ? result.str : result.paren ? `(${payload})` : payload;
  const goals = getGoals(state).filter(g => g.id !== goal.id);
  const replaced = ChangeSet.of([{ from: goal.from, to: goal.to, insert }], state.doc.length);
  const final = goals.map(g => {
    const from = replaced.mapPos(g.from, 1);
    const to = Math.max(replaced.mapPos(g.to, -1), from);
    return { ...g, from, to };
  });
  return {
    changes: [{ from: goal.from, to: goal.to, insert }],
    effects: [setGoals.of(final)],
    annotations: [systemTransaction.of(true), Transaction.addToHistory.of(false)],
  };
}
