/**
 * Repro attempt — vim mode on, then theme switch, then keys misbehave.
 * Mirrors main.ts's extension order and the exact toggle-vim/setTheme
 * mechanics, drives REAL key events through the focused editor.
 */
import { indentWithTab } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { vim } from '@replit/codemirror-vim';
import { basicSetup } from 'codemirror';
import { describe, expect, it } from 'vitest';
import { appKeymap } from '../../src/ui/app-keymap';

const DOC = 'hello world\nsecond line';

function makeView(): EditorView {
  const vimCompartment = new Compartment();
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [
        keymap.of([...appKeymap({ openChordRoot: () => {} }), indentWithTab]),
        basicSetup,
        vimCompartment.of([]),
      ],
    }),
    parent: document.body,
  });
  (view as unknown as { vimCompartment: Compartment }).vimCompartment = vimCompartment;
  return view;
}

/** Real keydown+keypress on the focused contentDOM (vim listens for those). */
function press(view: EditorView, key: string, opts: KeyboardEventInit = {}): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }),
  );
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keypress', { key, bubbles: true, cancelable: true, ...opts }),
  );
}

describe('vim + theme switch', () => {
  it('vim keys still work after theme switch', () => {
    const view = makeView();
    const compartment = (view as unknown as { vimCompartment: Compartment }).vimCompartment;
    view.focus();

    // 1. toggle vim ON (exactly what toggleVim does)
    view.dispatch({ effects: compartment.reconfigure(vim()) });

    // sanity: 'x' deletes a char in normal mode
    press(view, 'x');
    expect(view.state.doc.toString()).toBe('ello world\nsecond line');

    // 2. theme switch (exactly what applyTheme does)
    document.documentElement.dataset.theme = 'dark';

    // 3. keys again
    press(view, 'x');
    expect(view.state.doc.toString()).toBe('llo world\nsecond line');
    view.destroy();
  });

  it('vim keys survive a focus round-trip (palette flow) after theme switch', () => {
    const view = makeView();
    const compartment = (view as unknown as { vimCompartment: Compartment }).vimCompartment;
    view.dispatch({ effects: compartment.reconfigure(vim()) });
    view.focus();
    press(view, 'x');
    expect(view.state.doc.toString()).toBe('ello world\nsecond line');

    document.documentElement.dataset.theme = 'dark';

    // palette flow: focus leaves the editor (its input), then returns
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    input.value = 'dark';
    input.remove();
    view.focus();

    press(view, 'x');
    expect(view.state.doc.toString()).toBe('llo world\nsecond line');
    view.destroy();
  });
});
