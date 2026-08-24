/**
 * Goal decorations — the decoration set built from the goal model: hole
 * marks, the active hole's emphasis, the inline type widget, and the
 * invisibility of deleted holes.
 *
 */

import { EditorState } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { type GoalRecord, goalModelField, setGoals } from '../../src/model/goal-model';
import { sessionModelField } from '../../src/model/session-model';
import { buildGoalDecorations } from '../../src/ui/goal-decorations';

interface DecoEntry {
  from: number;
  to: number;
  spec: unknown;
}

function collect(set: DecorationSet): DecoEntry[] {
  const out: DecoEntry[] = [];
  const iter = set.iter();
  while (iter.value !== null) {
    out.push({ from: iter.from, to: iter.to, spec: iter.value.spec });
    iter.next();
  }
  return out;
}

function makeState(doc: string, goals: GoalRecord[], head = 0) {
  return EditorState.create({
    doc,
    selection: { anchor: head },
    extensions: [goalModelField, sessionModelField],
  }).update({ effects: [setGoals.of(goals)] }).state;
}

describe('buildGoalDecorations', () => {
  it('marks every visible hole and emphasizes the active one', () => {
    const doc = 'a = {! !}\nb = {! !}\n';
    const goals = [
      { id: 0, from: 4, to: 9 },
      { id: 1, from: 14, to: 19 },
    ];
    const state = makeState(doc, goals, 15);

    const decos = collect(buildGoalDecorations(state));
    expect(decos).toHaveLength(2); // no typeString → no widget
    expect(decos[0]!.spec).toEqual({ class: 'cm-goal-hole' });
    expect(decos[1]!.spec).toEqual({ class: 'cm-goal-hole cm-goal-active' });
    expect(decos[1]!.from).toBe(14);
  });

  it('renders nothing for deleted holes (from == to)', () => {
    const state = makeState('a\n', [{ id: 0, from: 1, to: 1 }]);
    expect(collect(buildGoalDecorations(state))).toHaveLength(0);
  });

  it('appends an inline type widget for the active goal with a cached type', () => {
    const state = makeState('a = {!  x  !}\n', [{ id: 0, from: 4, to: 13, typeString: 'Nat' }], 6);
    const decos = collect(buildGoalDecorations(state));
    expect(decos).toHaveLength(2);
    const widget = decos[1]!;
    expect(widget.from).toBe(13);
    expect(widget.spec).toMatchObject({ side: 1, widget: { typeString: 'Nat' } });
  });

  it('decorates nothing on a goal-free document', () => {
    const state = makeState('plain text\n', []);
    expect(collect(buildGoalDecorations(state))).toHaveLength(0);
  });
});
