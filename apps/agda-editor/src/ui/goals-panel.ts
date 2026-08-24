/**
 * Goals panel — the goal model as a clickable outline in the sidebar.
 * Small and only changes on commands: rebuild wholesale, but dirty-check
 * the serialized list first. Deleted holes (from == to) are invisible.
 */

import type { EditorState } from '@codemirror/state';
import { getGoals } from '../model/goal-model';

export interface GoalsPanelOptions {
  /** Called when a row is clicked; jump the editor to that hole. */
  onJumpGoal?(goal: { id: number; from: number; to: number }): void;
}

export class GoalsPanel {
  private key = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: GoalsPanelOptions = {},
  ) {}

  update(state: EditorState): void {
    const goals = getGoals(state).filter(g => g.to > g.from);
    const key = JSON.stringify(goals);
    if (key === this.key) return;
    this.key = key;

    if (goals.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'panel-empty';
      empty.textContent = 'no goals';
      this.root.replaceChildren(empty);
      return;
    }

    this.root.replaceChildren(
      ...goals.map(goal => {
        const row = document.createElement('div');
        row.className = 'goal-row';
        const id = document.createElement('span');
        id.className = 'goal-row-id';
        id.textContent = `#${goal.id}`;
        const type = document.createElement('span');
        type.className = 'goal-row-type';
        type.textContent = goal.typeString ?? '—';
        row.append(id, type);
        row.addEventListener('click', () => this.opts.onJumpGoal?.(goal));
        return row;
      }),
    );
  }
}
