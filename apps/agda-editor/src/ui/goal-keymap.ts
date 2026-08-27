/**
 * Goal keymap — the editor-side halves of the commands: read the cursor
 * and goal model, then either call the command layer (load/give, via a
 * lazy ExecuteContext — the backend boots async) or move the selection
 * (next/previous goal). Pure state math (goal under cursor, interior
 * text, next/previous target) lives in exported functions so node
 * tests cover it without a transport; the bindings themselves live in
 * app-keymap / the palette.
 */

import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { Command } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import { type ExecuteContext, executeGive, executeLoad } from '../integration/commands';
import { type GoalRecord, getGoals, goalAt, HOLE_BOUNDARY } from '../model/goal-model';
import { appendEventTransaction } from '../model/observability-model';

/** Ctx accessor: undefined until the backend finished booting. */
export type CtxAccessor = () => ExecuteContext | undefined;

/** The goal a give targets: the cursor's hole, falling back to the first visible one. */
export function goalUnderCursor(state: EditorState): GoalRecord | undefined {
  const head = state.selection.main.head;
  const at = goalAt(state, head);
  if (at !== undefined) return at; // goalAt matches [from, to), so never a deleted hole
  return getGoals(state).find(g => g.to > g.from);
}

/** The payload a give sends for `goal`: its interior text, trimmed. */
export function interiorOf(state: EditorState, goal: GoalRecord): string {
  return state.doc.sliceString(goal.from + HOLE_BOUNDARY, goal.to - HOLE_BOUNDARY).trim();
}

/**
 * Where `next goal` moves the cursor: the first visible goal starting at
 * or after the cursor, wrapping to the first one.
 */
export function nextGoalRange(
  goals: GoalRecord[],
  head: number,
): { from: number; to: number; id: number } | undefined {
  const visible = goals.filter(g => g.to > g.from).sort((a, b) => a.from - b.from);
  if (visible.length === 0) return undefined;
  const target = visible.find(g => g.from >= head) ?? visible[0]!;
  return { id: target.id, from: target.from, to: target.to };
}

/**
 * Where `previous goal` moves the cursor: the last visible goal that
 * ends at or before the cursor, wrapping to the last one.
 */
export function prevGoalRange(
  goals: GoalRecord[],
  head: number,
): { from: number; to: number; id: number } | undefined {
  const visible = goals.filter(g => g.to > g.from).sort((a, b) => a.from - b.from);
  if (visible.length === 0) return undefined;
  let target = visible[visible.length - 1]!;
  for (const g of visible) {
    if (g.to > head) break;
    target = g;
  }
  return { id: target.id, from: target.from, to: target.to };
}

// ---------------------------------------------------------------------------
// Boundary deletion dance — Backspace (plain/vim-insert) and x (vim normal)
// ---------------------------------------------------------------------------

/** Whole-goal delete spec: removes the hole and parks the cursor at its start. */
function deleteGoalSpec(goal: GoalRecord): TransactionSpec {
  return {
    changes: { from: goal.from, to: goal.to },
    selection: { anchor: goal.from },
  };
}

/** Whole-goal select spec: the dance's first press. */
function selectGoalSpec(goal: GoalRecord): TransactionSpec {
  return { selection: { anchor: goal.from, head: goal.to } };
}

/** The main range covers exactly the whole hole (the dance's armed state). */
function exactlyCoversGoal(lo: number, hi: number, g: GoalRecord): boolean {
  return lo === g.from && hi === g.to;
}

/**
 * Backspace at a goal boundary: the first press selects the whole hole,
 * the second deletes it. Triggered when the char Backspace would remove
 * belongs to a `{!` / `!}` boundary pair; an interior cursor (or an
 * interior selection) falls through to normal editing, and a selection
 * that merely contains the hole is left to the standard selection delete.
 */
export function goalBackspaceSpec(state: EditorState): TransactionSpec | undefined {
  const goals = getGoals(state).filter(g => g.to > g.from);
  const main = state.selection.main;
  const lo = Math.min(main.from, main.to);
  const hi = Math.max(main.from, main.to);
  const armed = goals.find(g => exactlyCoversGoal(lo, hi, g));
  if (armed !== undefined) return deleteGoalSpec(armed);
  if (!main.empty) return undefined;
  const head = main.head;
  // [head-1, head) meets a boundary pair ⇔ head ∈ (from, from+2] ∪ (to-2, to]
  const touching = goals.find(
    g =>
      (head > g.from && head <= g.from + HOLE_BOUNDARY) ||
      (head > g.to - HOLE_BOUNDARY && head <= g.to),
  );
  return touching === undefined ? undefined : selectGoalSpec(touching);
}

/**
 * `x` in vim normal mode at a goal boundary: same two-press dance. The
 * cursor on any of the four boundary chars arms it; a cursor inside the
 * hole edits per-character like anywhere else.
 */
export function goalVimDeleteSpec(state: EditorState): TransactionSpec | undefined {
  const goals = getGoals(state).filter(g => g.to > g.from);
  const main = state.selection.main;
  const lo = Math.min(main.from, main.to);
  const hi = Math.max(main.from, main.to);
  const armed = goals.find(g => exactlyCoversGoal(lo, hi, g));
  if (armed !== undefined) return deleteGoalSpec(armed);
  if (!main.empty) return undefined;
  const head = main.head;
  // [head, head+1) meets a boundary pair ⇔ head ∈ [from, from+2) ∪ [to-2, to)
  const touching = goals.find(
    g =>
      (head >= g.from && head < g.from + HOLE_BOUNDARY) ||
      (head >= g.to - HOLE_BOUNDARY && head < g.to),
  );
  return touching === undefined ? undefined : selectGoalSpec(touching);
}

/** Minimal shape of the cm5 shim the vim plugin hangs on the view. */
interface VimShim {
  state?: { vim?: { insertMode?: boolean; visualMode?: boolean } };
}

/** Vim's mode state, or undefined when the vim extension is off. */
function vimModeOf(view: EditorView): { insertMode?: boolean; visualMode?: boolean } | undefined {
  return (view as EditorView & { cm?: VimShim }).cm?.state?.vim;
}

/**
 * Backspace half of the dance. Binds unconditionally but defers to vim
 * when it owns the key: in vim normal/visual mode Backspace is a motion,
 * not a delete.
 */
export const goalBackspaceCommand: Command = view => {
  const vim = vimModeOf(view);
  if (vim !== undefined && !vim.insertMode) return false;
  const spec = goalBackspaceSpec(view.state);
  if (spec === undefined) return false;
  view.dispatch(spec);
  return true;
};

/**
 * `x` half of the dance. Only acts in vim normal mode with the cursor on
 * a hole boundary; every other x (plain typing, vim insert, interior
 * cursor) falls through untouched.
 */
export const goalVimDeleteCommand: Command = view => {
  const vim = vimModeOf(view);
  if (vim === undefined || vim.insertMode || vim.visualMode) return false;
  const spec = goalVimDeleteSpec(view.state);
  if (spec === undefined) return false;
  view.dispatch(spec);
  return true;
};

/** Type-check the file (Cmd_load). */
export function loadCommand(getCtx: CtxAccessor): Command {
  return () => {
    const ctx = getCtx();
    if (ctx === undefined) return false;
    void executeLoad(ctx);
    return true;
  };
}

/**
 * Give the goal under the cursor (falling back to the first visible one)
 * its own interior text — the emacs interaction, no prompt. Empty
 * interior consumes the key and says why via the observability log.
 */
export function giveFromCursorCommand(getCtx: CtxAccessor): Command {
  return view => {
    const ctx = getCtx();
    if (ctx === undefined) return false;
    const goal = goalUnderCursor(view.state);
    const payload = goal === undefined ? '' : interiorOf(view.state, goal);
    if (goal === undefined || payload === '') {
      view.dispatch(
        appendEventTransaction('warn', 'ui', { note: 'give: no expression under cursor' }),
      );
      return true;
    }
    void executeGive(ctx, goal.id, payload);
    return true;
  };
}

/** Select the next goal's hole interior and scroll it into view. */
export const nextGoalCommand: Command = view => {
  const target = nextGoalRange(getGoals(view.state), view.state.selection.main.head);
  if (target === undefined) return false;
  const cursor = target.from + HOLE_BOUNDARY;
  view.dispatch({
    selection: { anchor: cursor },
    scrollIntoView: true,
    effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
  });
  return true;
};

/** Select the previous goal's hole interior and scroll it into view. */
export const prevGoalCommand: Command = view => {
  const target = prevGoalRange(getGoals(view.state), view.state.selection.main.head);
  if (target === undefined) return false;
  const cursor = target.from + HOLE_BOUNDARY;
  view.dispatch({
    selection: { anchor: cursor },
    scrollIntoView: true,
    effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
  });
  return true;
};
