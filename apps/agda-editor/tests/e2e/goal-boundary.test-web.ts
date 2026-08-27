/**
 * Goal boundary editing — the two-press delete dance and vim motion
 * across hole boundaries, driven with real key events through a real
 * EditorView (vim extension + goal guard wired like main.ts).
 *
 * - Backspace (plain and vim-insert) at a boundary: 1st press selects
 *   the whole hole, 2nd press deletes it.
 * - x (vim normal) on a boundary char: same dance; interior cursor
 *   edits per-character.
 * - vim h/l never rest between `{`/`!` or `!`/`}`; they dive into the
 *   interior or exit onto the outer brace by travel direction.
 * - vim u after a dance delete restores both the text and the goal
 *   record (undo resurrection).
 */
import { indentWithTab } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { vim } from '@replit/codemirror-vim';
import { basicSetup } from 'codemirror';
import { describe, expect, it } from 'vitest';
import { type GoalRecord, goalModelField, setGoals } from '../../src/model/goal-model';
import { goalBoundaryGuard } from '../../src/ui/goal-guard';
import { goalBackspaceCommand, goalVimDeleteCommand } from '../../src/ui/goal-keymap';
import { clampVimCursor } from '../../src/ui/vim-cursor';

// 'a = {!  n  !}\nb\n' — `{!` at 4..5, interior '  n  ' at 6..10, `!}` at 11..12.
const DOC = 'a = {!  n  !}\nb\n';
const GOAL: GoalRecord = { id: 0, from: 4, to: 13 };

function makeView(withVim: boolean): EditorView {
  const vimCompartment = new Compartment();
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [
        keymap.of([
          { key: 'Backspace', run: goalBackspaceCommand },
          { key: 'x', run: goalVimDeleteCommand },
          indentWithTab,
        ]),
        basicSetup,
        vimCompartment.of(withVim ? [vim(), clampVimCursor] : []),
        goalModelField,
        goalBoundaryGuard,
      ],
    }),
    parent: document.body,
  });
  view.dispatch({ effects: setGoals.of([GOAL]) });
  view.focus();
  return view;
}

function press(view: EditorView, key: string): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

const head = (view: EditorView): number => view.state.selection.main.head;

describe('vim motion across a hole', () => {
  it('l walks the boundary pairs without resting inside them', () => {
    const view = makeView(true);
    const seen: number[] = [];
    for (let i = 0; i < 11; i++) {
      press(view, 'l');
      seen.push(head(view));
    }
    // 5 splits the `{!` pair → snapped into the interior (6);
    // 11 splits the `!}` pair → snapped onto `}` (12).
    expect(seen).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 12]);
    view.destroy();
  });

  it('h exits the hole onto the outer braces', () => {
    const view = makeView(true);
    view.dispatch({ selection: { anchor: 12 } }); // on `}`
    press(view, 'h'); // 11 splits `!}` → snapped to interior end
    expect(head(view)).toBe(10);
    view.dispatch({ selection: { anchor: 6 } }); // interior start
    press(view, 'h'); // 5 splits `{!` → snapped onto `{`
    expect(head(view)).toBe(4);
    press(view, 'h');
    expect(head(view)).toBe(3);
    view.destroy();
  });
});

describe('vim x at a boundary — the two-press dance', () => {
  it('1st press selects the hole, 2nd deletes it, u restores both', () => {
    const view = makeView(true);
    view.dispatch({ selection: { anchor: 4 } }); // on `{`
    press(view, 'x');
    const sel = view.state.selection.main;
    expect([sel.from, sel.to]).toEqual([4, 13]);

    press(view, 'x');
    expect(view.state.doc.toString()).toBe('a = \nb\n');
    expect(view.state.field(goalModelField)).toEqual([{ id: 0, from: 4, to: 4 }]);

    press(view, 'u');
    expect(view.state.doc.toString()).toBe(DOC);
    expect(view.state.field(goalModelField)).toEqual([GOAL]);
    view.destroy();
  });

  it('x with an interior cursor edits per-character like anywhere else', () => {
    const view = makeView(true);
    view.dispatch({ selection: { anchor: 8 } }); // on 'n'
    press(view, 'x');
    expect(view.state.doc.toString()).toBe('a = {!    !}\nb\n');
    expect(view.state.field(goalModelField)).toEqual([{ id: 0, from: 4, to: 12 }]);
    view.destroy();
  });
});

describe('Backspace dance (no vim)', () => {
  it('1st press at the interior start selects, 2nd deletes', () => {
    const view = makeView(false);
    view.dispatch({ selection: { anchor: 6 } });
    press(view, 'Backspace');
    const sel = view.state.selection.main;
    expect([sel.from, sel.to]).toEqual([4, 13]);

    press(view, 'Backspace');
    expect(view.state.doc.toString()).toBe('a = \nb\n');
    expect(head(view)).toBe(4);
    view.destroy();
  });

  it('right after the closing brace arms the dance too', () => {
    const view = makeView(false);
    view.dispatch({ selection: { anchor: 13 } });
    press(view, 'Backspace');
    expect(view.state.selection.main.to).toBe(13);
    expect(view.state.selection.main.from).toBe(4);
    view.destroy();
  });

  it('an interior backspace away from the boundary deletes normally', () => {
    const view = makeView(false);
    view.dispatch({ selection: { anchor: 9 } }); // deletes the 'n' at 8
    press(view, 'Backspace');
    expect(view.state.doc.toString()).toBe('a = {!    !}\nb\n');
    view.destroy();
  });
});
