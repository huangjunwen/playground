/**
 * Output panel — the command channel's human output in the dock's
 * output tab: the running command's progress lines (runningInfo,
 * cleared at each command start), then the full error — a failed
 * command's exception — and the module's diagnostics under a counted
 * section head, one message per block, as in agda's output buffer.
 * The Logs tab keeps the wire-level log. The dock is wide, so long
 * messages wrap instead of overflowing. Dirty-checked wholesale
 * rebuild.
 */

import type { EditorState } from '@codemirror/state';
import { getSession } from '../model/session-model';
import { bugIcon, warningIcon } from './icons';
import { verdictDetail } from './status';

export class OutputPanel {
  private key = '';

  constructor(private readonly root: HTMLElement) {}

  update(state: EditorState): void {
    const session = getSession(state);
    const key = JSON.stringify([session.runningInfo, session.error, session.diagnostics]);
    if (key === this.key) return;
    this.key = key;

    const rows: HTMLElement[] = [];
    for (const line of session.runningInfo) {
      const logLine = document.createElement('div');
      logLine.className = 'out-log-line';
      logLine.textContent = line;
      rows.push(logLine);
    }
    // The command's exception — distinct from the diagnostics below:
    // it belongs to one failed command and clears with the next one.
    if (session.error !== undefined) {
      const error = document.createElement('div');
      error.className = 'out-error';
      error.textContent = session.error;
      rows.push(error);
    }
    // The module's diagnostics — the ambient check state riding every
    // goals snapshot: a counted section head, then one block per
    // message, errors before warnings.
    const { errors, warnings } = session.diagnostics;
    if (errors.length > 0 || warnings.length > 0) {
      const head = document.createElement('div');
      head.className = 'out-section';
      head.textContent = `Diagnostics — ${verdictDetail({ errors: errors.length, warnings: warnings.length })}`;
      rows.push(head);
      for (const message of errors) rows.push(messageRow('out-msg-error', bugIcon(), message));
      for (const message of warnings) rows.push(messageRow('out-msg-warn', warningIcon(), message));
    }
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'panel-empty';
      empty.textContent = 'No output yet.';
      rows.push(empty);
    }
    this.root.replaceChildren(...rows);
  }
}

function messageRow(rowClass: string, icon: SVGSVGElement, message: string): HTMLElement {
  const row = document.createElement('div');
  row.className = `out-msg ${rowClass}`;
  const iconEl = document.createElement('span');
  iconEl.className = 'out-msg-icon';
  iconEl.append(icon);
  const body = document.createElement('div');
  body.className = 'out-msg-body';
  body.textContent = message;
  row.append(iconEl, body);
  return row;
}
