/**
 * Session panel — the session model in the sidebar, the sole status
 * home (the toolbar holds only the command buttons): the backend
 * lifecycle with its start/stop toggle, the file being edited, and the
 * verdict line — a spinner while busy, otherwise present only when
 * agda has a verdict worth showing (a bug icon in red for errors, a
 * trophy in green for a clean check); then, after a blank line, the
 * per-command progress lines (runningInfo, cleared at each command
 * start) with the full error after them — the conclusion of the
 * stream, as in agda's output buffer. Dirty-checked wholesale rebuild.
 */

import type { EditorState } from '@codemirror/state';
import { filePathFacet, getSession } from '../model/session-model';
import { bugIcon, fileIcon, pauseIcon, playIcon, serverIcon, trophyIcon } from './icons';
import { type StatusCluster, statusCluster } from './status';

export interface SessionPanelHooks {
  /** Boot a fresh backend (the old one has exited). */
  onBackendStart(): void;
  /** Terminate the running backend. */
  onBackendStop(): void;
}

export class SessionPanel {
  private key = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: SessionPanelHooks,
  ) {}

  update(state: EditorState): void {
    const session = getSession(state);
    const file = state.facet(filePathFacet);
    const key = JSON.stringify([session, file]);
    if (key === this.key) return;
    this.key = key;

    const cluster = statusCluster(state);
    const rows: HTMLElement[] = [this.backendRow(cluster), this.line(fileIcon(), file, 'file-row')];
    // The verdict row is always present so the log lines below never
    // jump: Busy (spinner, amber), then Error (bug, red) / Checked
    // (trophy, green) when idle, or an empty placeholder line.
    if (cluster.busy) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      rows.push(this.line(spinner, 'Busy', 'verdict-busy'));
    } else if (cluster.verdict) {
      const icon = cluster.verdict.kind === 'error' ? bugIcon() : trophyIcon();
      const word = cluster.verdict.kind === 'error' ? 'Error' : 'Checked';
      rows.push(this.line(icon, word, `verdict-${cluster.verdict.kind}`));
    } else {
      const empty = document.createElement('div');
      empty.className = 'session-line';
      rows.push(empty);
    }
    const gap = document.createElement('div');
    gap.className = 'session-gap';
    rows.push(gap);
    for (const line of session.runningInfo) {
      const logLine = document.createElement('div');
      logLine.className = 'session-log-line';
      logLine.textContent = line;
      rows.push(logLine);
    }
    if (session.error !== undefined) {
      const error = document.createElement('div');
      error.className = 'session-error';
      error.textContent = session.error;
      rows.push(error);
    }
    this.root.replaceChildren(...rows);
  }

  /** Server icon, the tinted lifecycle pill, and the start/stop toggle. */
  private backendRow(cluster: StatusCluster): HTMLElement {
    // The whole row tints with the lifecycle (icon, pill, dot, word):
    // amber booting, green online, red exited.
    const row = document.createElement('div');
    row.className = `session-line backend-${cluster.backend.tone}`;

    const iconEl = document.createElement('span');
    iconEl.className = 'session-icon';
    iconEl.append(serverIcon());

    const badge = document.createElement('span');
    badge.className = 'backend-badge';
    const dot = document.createElement('span');
    dot.className = 'backend-dot';
    const label = document.createElement('span');
    label.textContent = cluster.backend.label;
    badge.append(dot, label);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    if (cluster.backend.tone === 'online') {
      toggle.className = 'backend-toggle';
      toggle.title = 'Terminate the backend';
      toggle.append(pauseIcon());
      toggle.addEventListener('click', this.hooks.onBackendStop);
    } else if (cluster.backend.tone === 'exited') {
      toggle.className = 'backend-toggle';
      toggle.title = 'Start the backend';
      toggle.append(playIcon());
      toggle.addEventListener('click', this.hooks.onBackendStart);
    } else {
      toggle.className = 'backend-toggle';
      toggle.disabled = true;
      toggle.title = 'Backend is booting';
      toggle.append(pauseIcon());
    }

    row.append(iconEl, badge, toggle);
    return row;
  }

  private line(
    icon: HTMLElement | SVGSVGElement,
    content: HTMLElement | string,
    rowClass?: string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = rowClass === undefined ? 'session-line' : `session-line ${rowClass}`;
    const iconEl = document.createElement('span');
    iconEl.className = 'session-icon';
    iconEl.append(icon);
    const value = document.createElement('span');
    if (typeof content === 'string') value.textContent = content;
    else value.append(content);
    row.append(iconEl, value);
    return row;
  }
}
