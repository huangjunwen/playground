/**
 * Goal keymap — the editor-side halves of the commands: read the cursor
 * and goal model, then either call the command layer (load/give, via a
 * lazy ExecuteContext — the backend boots async) or move the selection
 * (next goal). Pure state math (goal under cursor, interior text, next
 * target) lives in exported functions so node tests cover it without a
 * transport.
 */

import type { EditorState } from '@codemirror/state';
import type { Command, KeyBinding } from '@codemirror/view';
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

/** Agda-style bindings; C-c chords pending inside CM6's keymap. */
export function goalKeymap(getCtx: CtxAccessor): KeyBinding[] {
  return [
    { key: 'C-c C-l', run: loadCommand(getCtx) },
    { key: 'C-c C-Space', run: giveFromCursorCommand(getCtx) },
    { key: 'C-c C-f', run: nextGoalCommand },
  ];
}
