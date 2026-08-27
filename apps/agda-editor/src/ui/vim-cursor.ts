/**
 * Vim cursor hygiene — two patches the vim layer needs around goals and
 * line ends, both driven from one update listener:
 *
 * 1. replit/codemirror-vim#38: mouse clicks past the last character of
 *    a line leave the CM6 cursor at `line.to`, a position vim does not
 *    model — `x` deletes nothing, `i` inserts a column left of the
 *    visible caret. External selections landing there are pulled back
 *    onto the last character.
 * 2. Vim motions ignore CM6 atomicRanges, so they can park the cursor
 *    between the `{`/`!` (or `!`/`}`) of a goal boundary pair. Vim's
 *    own ops are snapped to a real position by travel direction:
 *    rightward into the hole, leftward out of it.
 */

import { EditorView, type ViewUpdate } from '@codemirror/view';
import { type GoalRecord, goalModelField, HOLE_BOUNDARY } from '../model/goal-model';

/** Minimal shape of the cm5 shim the vim plugin hangs on the view. */
interface VimShim {
  state?: { vim?: { insertMode?: boolean; visualMode?: boolean } };
  curOp?: { isVimOp?: boolean };
}

/**
 * Cursor position that splits a boundary pair (rests on the inner `!`
 * of `{!` / `!}`), snapped by motion direction: rightward dives into
 * the hole's interior, leftward exits onto the outer `{` / `}` — or out
 * of the hole entirely when the interior has collapsed.
 */
function snapBoundarySplit(head: number, prevHead: number, g: GoalRecord): number | undefined {
  const interior = g.to - g.from > 2 * HOLE_BOUNDARY;
  const forward = head >= prevHead;
  if (head === g.from + 1) return forward ? (interior ? g.from + HOLE_BOUNDARY : g.to) : g.from;
  if (head === g.to - HOLE_BOUNDARY)
    return forward ? g.to - 1 : interior ? g.to - HOLE_BOUNDARY - 1 : g.from;
  return undefined;
}

function clamp(u: ViewUpdate): void {
  if (!u.selectionSet || u.docChanged) return;
  const cm = (u.view as EditorView & { cm?: VimShim }).cm;
  const vimState = cm?.state?.vim;
  if (!vimState || vimState.insertMode || vimState.visualMode) return;
  const main = u.state.selection.main;

  if (cm.curOp?.isVimOp) {
    // Vim's own motion just moved the cursor. It ignores atomicRanges, so
    // it can park between the `{`/`!` (or `!`/`}`) of a hole boundary —
    // snap it to a real vim position by travel direction.
    if (!main.empty) return;
    const goals = u.state.field(goalModelField, false) ?? [];
    const prevHead = u.startState.selection.main.head;
    for (const g of goals) {
      const snapped = snapBoundarySplit(main.head, prevHead, g);
      if (snapped !== undefined) {
        u.view.dispatch({ selection: { anchor: snapped } });
        return;
      }
    }
    return;
  }

  // External selection (mouse click, jump): CM's own motion already
  // respects atomicRanges, so only the past-EOL clamp is needed.
  if (!main.empty) return;
  const line = u.state.doc.lineAt(main.head);
  if (line.length === 0 || main.head !== line.to) return;
  u.view.dispatch({
    selection: { anchor: main.head - 1 },
    scrollIntoView: false,
  });
}

/** Add next to `vim()` in the same compartment so it tracks vim on/off. */
export const clampVimCursor = EditorView.updateListener.of(clamp);
