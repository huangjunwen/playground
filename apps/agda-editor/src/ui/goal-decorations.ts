/**
 * Goal decorations — hole marks, emphasis for the hole the cursor is in,
 * and an inline widget showing the active goal's cached type (zero-latency:
 * it renders from the goal model, not a round-trip). Pure projection of
 * goal-model.ts: buildGoalDecorations is a plain function of state.
 */

import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { getGoals } from '../model/goal-model';

const holeDecoration = Decoration.mark({ class: 'cm-goal-hole' });
const activeHoleDecoration = Decoration.mark({ class: 'cm-goal-hole cm-goal-active' });

/** Widget drawn after the active goal showing its cached type. */
class InlineTypeWidget extends WidgetType {
  constructor(readonly typeString: string) {
    super();
  }

  eq(other: InlineTypeWidget): boolean {
    return other.typeString === this.typeString;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-goal-type-inline';
    span.textContent = this.typeString;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function buildGoalDecorations(state: EditorState): DecorationSet {
  const goals = getGoals(state);
  const head = state.selection.main.head;
  const active = goals.find(g => head >= g.from && head < g.to);
  const decos: Range<Decoration>[] = [];
  for (const g of goals) {
    const isActive = active?.id === g.id;
    // Deleted holes (from == to) render nothing.
    if (g.to > g.from) {
      decos.push((isActive ? activeHoleDecoration : holeDecoration).range(g.from, g.to));
    }
    if (isActive && g.typeString !== undefined) {
      decos.push(
        Decoration.widget({ side: 1, widget: new InlineTypeWidget(g.typeString) }).range(g.to),
      );
    }
  }
  return Decoration.set(decos, true);
}

export const goalDecorations: Extension = EditorView.decorations.of(view =>
  buildGoalDecorations(view.state),
);

/** Syntactic theme for the decorations; colors come from main.css variables. */
export const goalStyleTheme: Extension = EditorView.theme({
  '.cm-goal-hole': {
    backgroundColor: 'var(--goal-hole-bg)',
    boxShadow: '0 0 0 1px var(--goal-hole-border)',
  },
  '.cm-goal-active': {
    backgroundColor: 'var(--goal-active-bg)',
    boxShadow: '0 0 0 2px var(--goal-active-border)',
  },
  '.cm-goal-type-inline': {
    display: 'inline-block',
    marginLeft: '4px',
    padding: '0 4px',
    fontSize: '0.8em',
    fontStyle: 'italic',
    color: 'var(--goal-type-fg)',
    backgroundColor: 'var(--goal-type-bg)',
    borderRadius: '3px',
  },
});
