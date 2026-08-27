/**
 * Regression — replit/codemirror-vim#38: an external selection change
 * (mouse click past the last character, or a programmatic dispatch)
 * leaves the cursor at `line.to`, where vim's `x`/`i` misbehave.
 * `clampVimCursor` pulls such cursors back onto the last character.
 */
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vim } from '@replit/codemirror-vim';
import { describe, expect, it } from 'vitest';
import { clampVimCursor } from '../../src/ui/vim-cursor';

const DOC = 'hello world\nsecond line'; // line 1: chars 0..11, to = 11

function makeView(): EditorView {
  const vimCompartment = new Compartment();
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [vimCompartment.of([vim(), clampVimCursor])],
    }),
    parent: document.body,
  });
  (view as unknown as { vimCompartment: Compartment }).vimCompartment = vimCompartment;
  return view;
}

function press(view: EditorView, key: string, opts: KeyboardEventInit = {}): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }),
  );
}

describe('clampVimCursor', () => {
  it('clamps an external EOL selection so x deletes the last char', () => {
    const view = makeView();
    view.focus();

    // click-past-EOL effect: cursor parked at line.to (past-last-char)
    view.dispatch({ selection: { anchor: 11 } });
    expect(view.state.selection.main.head).toBe(10); // clamped onto 'd'

    press(view, 'x');
    expect(view.state.doc.toString()).toBe('hello worl\nsecond line');
    view.destroy();
  });

  it('clamps after a real mousedown past the line end', () => {
    const view = makeView();
    view.focus();

    const eol = view.coordsAtPos(11)!;
    const mid = view.coordsAtPos(6)!;
    view.contentDOM.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: eol.left + 50, // well past 'd', still inside the page
        clientY: (mid.top + mid.bottom) / 2,
        button: 0,
        detail: 1, // plain single click (CM6 keys off event.detail)
      }),
    );

    expect(view.state.selection.main.head).toBe(10);
    press(view, 'x');
    expect(view.state.doc.toString()).toBe('hello worl\nsecond line');
    view.destroy();
  });

  it('leaves vim motions alone ($ stays functional)', () => {
    const view = makeView();
    view.focus();

    press(view, '0'); // start of line 1
    press(view, '$'); // vim's own EOL motion — already on-char
    expect(view.state.selection.main.head).toBe(10);

    press(view, 'x');
    expect(view.state.doc.toString()).toBe('hello worl\nsecond line');
    view.destroy();
  });

  it('does not clamp in insert mode (EOL caret is legal there)', () => {
    const view = makeView();
    view.focus();

    press(view, 'A'); // append at end of line — insert mode at line.to
    expect(view.state.selection.main.head).toBe(11);

    // even an external EOL selection must stay put while inserting
    view.dispatch({ selection: { anchor: 11 } });
    expect(view.state.selection.main.head).toBe(11);
    view.destroy();
  });

  it('does not clamp an empty line (vim has no on-char position there)', () => {
    const view = makeView();
    view.focus();

    view.dispatch({ selection: { anchor: DOC.length } }); // end of last line
    expect(view.state.selection.main.head).toBe(DOC.length - 1); // clamped

    view.dispatch({
      changes: { from: 12, to: DOC.length, insert: '' }, // wipe line 2 -> empty
      selection: { anchor: 12 },
    });
    expect(view.state.selection.main.head).toBe(12); // untouched
    view.destroy();
  });
});
