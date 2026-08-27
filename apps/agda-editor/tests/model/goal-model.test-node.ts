/**
 * Goal model — field remapping plus the transactions that change the goal
 * list (pure EditorState in node, no DOM).
 *
 * Field remapping rules:
 * - edits inside a hole (interior inserts/deletes): only `to` moves
 *   (`from` sticks to the right side of `{`)
 * - edits outside a hole: whole record translates (from/to together), id stays valid
 * - deleting an entire hole: from == to (zero width), **record stays in the list**
 *
 * Builders: syncGoals (from-scratch build + existing-list reconciliation).
 * Transactions: the `?` expansion (expandGoalsTransaction) and the give
 * replacement (giveReplacementTransaction).
 *
 */

import { EditorState, Transaction } from '@codemirror/state';
import type { InteractionPoint } from '@playground/language-backend-agda';
import { describe, expect, it, vi } from 'vitest';
import {
  caseClausesText,
  caseReplacementTransaction,
  expandGoalsTransaction,
  type GoalRecord,
  getGoals,
  giveReplacementTransaction,
  goalModelField,
  setGoals,
  syncGoals,
  systemTransaction,
} from '../../src/model/goal-model';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const DOC = 'a = {! x !}'; // hole from=4 to=11

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [goalModelField] });
}

function makeStateWithGoals(doc: string, goals: GoalRecord[]): EditorState {
  return makeState(doc).update({ effects: [setGoals.of(goals)] }).state;
}

/** InteractionPoint with a 1-based position range (mirrors the wire shape). */
const point = (id: number, from1: number, to1: number): InteractionPoint => ({
  id,
  range: [{ start: { pos: from1, line: 1, col: from1 }, end: { pos: to1, line: 1, col: to1 } }],
});

// ---------------------------------------------------------------------------
// Field — edit remapping
// ---------------------------------------------------------------------------

describe('goalModelField — edit remapping', () => {
  const HOLE: GoalRecord = { id: 0, from: 4, to: 11, typeString: 'Nat' };

  it('interior insert moves only to', () => {
    const s2 = makeStateWithGoals(DOC, [HOLE]).update({ changes: { from: 7, insert: 'yy' } }).state;
    expect(getGoals(s2)).toEqual([{ id: 0, from: 4, to: 13, typeString: 'Nat' }]);
  });

  it('interior delete moves only to', () => {
    const s2 = makeStateWithGoals(DOC, [HOLE]).update({ changes: { from: 6, to: 8 } }).state;
    expect(getGoals(s2)).toEqual([{ id: 0, from: 4, to: 9, typeString: 'Nat' }]);
  });

  it('insert before the hole translates from+to', () => {
    const s2 = makeStateWithGoals(DOC, [HOLE]).update({
      changes: { from: 0, insert: 'b = ' },
    }).state;
    expect(getGoals(s2)).toEqual([{ id: 0, from: 8, to: 15, typeString: 'Nat' }]);
  });

  it('insert exactly at to (right after `}`) leaves the goal untouched', () => {
    const s2 = makeStateWithGoals(DOC, [HOLE]).update({ changes: { from: 11, insert: 'X' } }).state;
    expect(getGoals(s2)).toEqual([{ id: 0, from: 4, to: 11, typeString: 'Nat' }]);
  });

  it('insert at the closing brace position expands to', () => {
    const s2 = makeStateWithGoals(DOC, [HOLE]).update({ changes: { from: 10, insert: 'X' } }).state;
    expect(getGoals(s2)).toEqual([{ id: 0, from: 4, to: 12, typeString: 'Nat' }]);
  });

  it('deleting the whole hole → from==to (zero width), record stays in the list', () => {
    const s2 = makeStateWithGoals(DOC, [HOLE]).update({ changes: { from: 4, to: 11 } }).state;
    expect(getGoals(s2)).toEqual([{ id: 0, from: 4, to: 4, typeString: 'Nat' }]);
  });

  it('undo re-inserting the hole text resurrects the dead record', () => {
    const deleted = makeStateWithGoals(DOC, [HOLE]).update({
      changes: { from: 4, to: 11 },
      userEvent: 'delete.selection',
    }).state;
    expect(getGoals(deleted)).toEqual([{ id: 0, from: 4, to: 4, typeString: 'Nat' }]);
    const undone = deleted.update({
      changes: { from: 4, to: 4, insert: '{! x !}' },
      userEvent: 'undo',
    }).state;
    expect(getGoals(undone)).toEqual([{ id: 0, from: 4, to: 11, typeString: 'Nat' }]);
  });

  it('undo of a non-hole insertion at the dead record stays dead', () => {
    const deleted = makeStateWithGoals(DOC, [HOLE]).update({
      changes: { from: 4, to: 11 },
      userEvent: 'delete.selection',
    }).state;
    const undone = deleted.update({ changes: { from: 4, insert: 'x' }, userEvent: 'undo' }).state;
    expect(getGoals(undone)).toEqual([{ id: 0, from: 5, to: 5, typeString: 'Nat' }]);
  });

  it('a plain (non-undo) hole-shaped insert at the dead record stays dead', () => {
    const deleted = makeStateWithGoals(DOC, [HOLE]).update({
      changes: { from: 4, to: 11 },
      userEvent: 'delete.selection',
    }).state;
    const retyped = deleted.update({
      changes: { from: 4, insert: '{! !}' },
      userEvent: 'input.type',
    }).state;
    expect(getGoals(retyped)).toEqual([{ id: 0, from: 9, to: 9, typeString: 'Nat' }]);
  });

  it('setGoals replaces the whole list', () => {
    const s2 = makeStateWithGoals(DOC, [HOLE]).update({
      effects: setGoals.of([{ id: 5, from: 0, to: 1 }]),
    }).state;
    expect(getGoals(s2)).toEqual([{ id: 5, from: 0, to: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// syncGoals
// ---------------------------------------------------------------------------

describe('syncGoals', () => {
  it('builds from scratch when nothing exists: 1-based → 0-based, types by id, sorted', () => {
    // `?` (1-char range) @1-based 163 → 0-based 162..163; block {! !} @ 1-based 180..185 → 179..184
    const points = [point(1, 180, 185), point(0, 163, 164)];
    const types = new Map([
      [0, 'Nat'],
      [1, 'Nat → Nat'],
    ]);

    const goals = syncGoals([], points, types);

    expect(goals).toHaveLength(2);
    // sorted by from: id 0 first (163 < 180)
    expect(goals[0]).toEqual({ id: 0, from: 162, to: 163, typeString: 'Nat' });
    expect(goals[1]).toEqual({ id: 1, from: 179, to: 184, typeString: 'Nat → Nat' });
  });

  it('leaves typeString undefined when the goal has no type entry', () => {
    const goals = syncGoals([], [point(7, 11, 12)], new Map());
    expect(goals[0]?.typeString).toBeUndefined();
  });

  it('keeps both `?` (1-char range) and block holes as plain ranges — no kind field', () => {
    // Design: GoalRecord has no kind/no hasId; `?` vs block is only distinguished by length
    const goals = syncGoals([], [point(0, 5, 6), point(1, 9, 14)], new Map());
    expect(goals[0]?.to - goals[0]!.from).toBe(1); // ? width 1
    expect(goals[1]?.to - goals[1]!.from).toBe(5); // {! !} width 5
  });

  it('drops points without a usable range (malformed interval)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const points = [
      { id: 3, range: [] as never },
      { id: 4, range: [{ start: { pos: 1, line: 1, col: 1 }, end: { pos: 1, line: 1, col: 1 } }] },
    ];
    const goals = syncGoals([], points, new Map());
    expect(goals.map(g => g.id)).toEqual([4]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reconciles an existing list: fresh from points, survivors keep positions, types refreshed', () => {
    const goals = syncGoals(
      [
        { id: 2, from: 15, to: 22 },
        { id: 3, from: 30, to: 37, typeString: 'stale' },
      ],
      // 5 is fresh; 2 and 3 appear in the snapshot → survivors, response
      // ranges ignored (state positions are authoritative).
      [point(5, 3, 4), point(2, 99, 199), point(3, 31, 38)],
      new Map([
        [5, 'Nat'],
        [3, 'Nat → Nat'],
      ]),
    );

    expect(goals).toEqual([
      { id: 5, from: 2, to: 3, typeString: 'Nat' }, // 1-based 3..4 → 0-based 2..3, sorted first
      { id: 2, from: 15, to: 22 }, // untouched (no type entry)
      { id: 3, from: 30, to: 37, typeString: 'Nat → Nat' }, // type refreshed, position kept
    ]);
  });

  it('drops existing goals absent from the snapshot (solved by the mutation)', () => {
    const goals = syncGoals(
      [
        { id: 2, from: 15, to: 22 },
        { id: 3, from: 30, to: 37 },
      ],
      [point(3, 31, 38)],
      new Map(),
    );

    expect(goals).toEqual([{ id: 3, from: 30, to: 37 }]);
  });

  it('resurrects a dead (zero-width) record from the response range', () => {
    // The hole was deleted locally; ALS still reports the point — the
    // dead prior's collapsed position must not win over the fresh range.
    const goals = syncGoals([{ id: 2, from: 15, to: 15 }], [point(2, 16, 23)], new Map());
    expect(goals).toEqual([{ id: 2, from: 15, to: 22 }]);
  });

  it('keeps survivor type strings when no AllGoalsWarnings was seen (undefined map)', () => {
    const goals = syncGoals(
      [{ id: 2, from: 15, to: 22, typeString: 'Nat' }],
      [point(2, 15, 22)],
      undefined,
    );

    expect(goals).toEqual([{ id: 2, from: 15, to: 22, typeString: 'Nat' }]);
  });

  it('returns the existing list unchanged when no snapshot was seen (undefined)', () => {
    const existing: GoalRecord[] = [{ id: 2, from: 15, to: 22, typeString: 'Nat' }];

    expect(syncGoals(existing, undefined, new Map())).toBe(existing);
  });
});

// ---------------------------------------------------------------------------
// expandGoalsTransaction
// ---------------------------------------------------------------------------

describe('expandGoalsTransaction', () => {
  it('expands a bare `?` goal into a 7-char hole', () => {
    const state = makeState('a = ?');

    const next = state.update(expandGoalsTransaction(state, [{ id: 0, from: 4, to: 5 }])).state;

    expect(next.doc.toString()).toBe('a = {!   !}');
    expect(getGoals(next)).toEqual([{ id: 0, from: 4, to: 11 }]);
  });

  it('commits the goal list alone when no goal is a bare `?` (doc unchanged)', () => {
    const state = makeState('a = {! x !}');

    const next = state.update(expandGoalsTransaction(state, [{ id: 0, from: 4, to: 11 }])).state;

    expect(next.doc.toString()).toBe('a = {! x !}');
    expect(getGoals(next)).toEqual([{ id: 0, from: 4, to: 11 }]);
  });

  it('expands multiple `?` goals at once, shifting later positions by the width delta', () => {
    const state = makeState('x = ?\ny = ?');

    const next = state.update(
      expandGoalsTransaction(state, [
        { id: 0, from: 4, to: 5 },
        { id: 1, from: 10, to: 11 },
      ]),
    ).state;

    expect(next.doc.toString()).toBe('x = {!   !}\ny = {!   !}');
    expect(getGoals(next)).toEqual([
      { id: 0, from: 4, to: 11 },
      { id: 1, from: 16, to: 23 },
    ]);
  });

  it('leaves `?` outside the goal list untouched (comments, strings, nested blocks)', () => {
    const state = makeState('-- ? in a comment\na = ?');

    const next = state.update(expandGoalsTransaction(state, [{ id: 0, from: 22, to: 23 }])).state;

    expect(next.doc.toString()).toBe('-- ? in a comment\na = {!   !}');
    expect(getGoals(next)).toEqual([{ id: 0, from: 22, to: 29 }]);
  });

  it('replaces any previously committed goal list (setGoals effect runs)', () => {
    const state = makeState('a = ?');
    const withGoals = state.update({ effects: [setGoals.of([])] }).state;

    const next = state.update(expandGoalsTransaction(withGoals, [{ id: 0, from: 4, to: 5 }])).state;

    expect(getGoals(next)).toEqual([{ id: 0, from: 4, to: 11 }]);
  });
});

// ---------------------------------------------------------------------------
// Give replacement transaction — give family
// ---------------------------------------------------------------------------

describe('giveReplacementTransaction', () => {
  const GIVE_DOC = 'a = {! x !}';
  // hole spans [4, 11); interior is " x " (6..9)

  it('paren:false keeps the payload verbatim and removes the given goal', () => {
    const state = makeStateWithGoals(GIVE_DOC, [{ id: 1, from: 4, to: 11 }]);

    const next = state.update(
      giveReplacementTransaction(state, { id: 1, from: 4, to: 11 }, ' x ', { paren: false }),
    ).state;

    expect(next.doc.toString()).toBe('a =  x ');
    expect(getGoals(next).find(g => g.id === 1)).toBeUndefined();
  });

  it('paren:true wraps the payload in parentheses', () => {
    const state = makeStateWithGoals(GIVE_DOC, [{ id: 1, from: 4, to: 11 }]);

    const next = state.update(
      giveReplacementTransaction(state, { id: 1, from: 4, to: 11 }, ' x ', { paren: true }),
    ).state;

    expect(next.doc.toString()).toBe('a = ( x )');
  });

  it('str replaces the whole hole with the given text', () => {
    const state = makeStateWithGoals(GIVE_DOC, [{ id: 1, from: 4, to: 11 }]);

    const next = state.update(
      giveReplacementTransaction(state, { id: 1, from: 4, to: 11 }, ' x ', { str: 'suc ?' }),
    ).state;

    expect(next.doc.toString()).toBe('a = suc ?');
    expect(getGoals(next)).toHaveLength(0);
  });

  it('is a system transaction outside the undo history (bypasses boundary protection)', () => {
    const state = makeStateWithGoals(GIVE_DOC, [{ id: 1, from: 4, to: 11 }]);

    const spec = giveReplacementTransaction(state, { id: 1, from: 4, to: 11 }, ' x ', {
      paren: false,
    });
    const tr = state.update(spec);

    expect(tr.annotation(systemTransaction)).toBe(true);
    expect(tr.annotation(Transaction.addToHistory)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Case replacement transaction — MakeCase commit
// ---------------------------------------------------------------------------

describe('caseClausesText', () => {
  it('joins a Function split as plain lines', () => {
    expect(caseClausesText('Function', ['f zero = zero', 'f (suc n) = suc (f n)'])).toBe(
      'f zero = zero\nf (suc n) = suc (f n)',
    );
  });

  it('indents an ExtendedLambda split under a `λ where` head', () => {
    expect(caseClausesText('ExtendedLambda', ['zero → zero', 'suc n → suc (go n)'])).toBe(
      'λ where\n  zero → zero\n  suc n → suc (go n)',
    );
  });
});

describe('caseReplacementTransaction', () => {
  const CASE_DOC = 'a = {! n !}\nb = {! y !}'; // hole 0: [4, 11); hole 1: [16, 23)

  it('replaces the hole with the clauses, parks the cursor, drops the goal, remaps survivors', () => {
    const state = makeStateWithGoals(CASE_DOC, [
      { id: 0, from: 4, to: 11 },
      { id: 1, from: 16, to: 23 },
    ]);
    const goal = { id: 0, from: 4, to: 11 } as const;

    // 7-char hole → 31-char insert (delta +24): survivor shifts to [40, 47).
    const tr = state.update(
      caseReplacementTransaction(state, goal, 'Function', ['f zero = zero', 'f (suc n) = {! !}']),
    );

    expect(tr.state.doc.toString()).toBe('a = f zero = zero\nf (suc n) = {! !}\nb = {! y !}');
    expect(tr.state.selection.main.head).toBe(4);
    expect(getGoals(tr.state)).toEqual([{ id: 1, from: 40, to: 47 }]);
    expect(tr.annotation(systemTransaction)).toBe(true);
    expect(tr.annotation(Transaction.addToHistory)).toBe(false);
  });

  it('commits an ExtendedLambda block through the same shape', () => {
    const state = makeStateWithGoals(CASE_DOC, [{ id: 0, from: 4, to: 11 }]);

    const tr = state.update(
      caseReplacementTransaction(state, { id: 0, from: 4, to: 11 }, 'ExtendedLambda', [
        'zero → zero',
      ]),
    );

    expect(tr.state.doc.toString()).toBe('a = λ where\n  zero → zero\nb = {! y !}');
    expect(getGoals(tr.state)).toEqual([]);
    expect(tr.state.selection.main.head).toBe(4);
  });
});
