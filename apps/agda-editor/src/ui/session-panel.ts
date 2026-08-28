/**
 * Session panel — the session model's summary in the sidebar: the
 * backend lifecycle with its start/stop toggle, the file being edited,
 * and the verdict line — a spinner while busy, otherwise present only
 * when agda has a verdict worth showing (a bug icon in red for
 * errors, a triangle in amber for warnings, a trophy in green for a
 * clean check) with the item counts as its detail suffix. The verdict
 * row is a button: the long texts it summarises — the running
 * command's progress, its exception, the module's diagnostics — live
 * in the dock's output panel, and a click reveals that tab.
 * Dirty-checked wholesale rebuild.
 */

import type { EditorState } from '@codemirror/state';
import { filePathFacet, getSession } from '../model/session-model';
import {
  bugIcon,
  fileIcon,
  pauseIcon,
  playIcon,
  saveIcon,
  serverIcon,
  trophyIcon,
  warningIcon,
} from './icons';
import { type StatusCluster, statusCluster, type VerdictView, verdictDetail } from './status';

export interface SessionPanelHooks {
  /** Boot a fresh backend (the old one has exited). */
  onBackendStart(): void;
  /** Terminate the running backend. */
  onBackendStop(): void;
  /** Persist the document (the file row's save icon). */
  onSaveFile(): void;
  /** Reveal the dock's output tab (the verdict row's click). */
  onShowOutput(): void;
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
    const rows: HTMLElement[] = [
      this.backendRow(cluster),
      this.fileRow(file, cluster.backend.tone === 'online'),
    ];
    // The verdict row is always present so nothing below it jumps:
    // Busy (spinner, amber), then Error (bug, red) / Warning
    // (triangle, amber) / Checked (trophy, green) when idle — the
    // button jumps to the output panel's details — or an empty
    // placeholder line.
    if (cluster.busy) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      rows.push(this.line(spinner, 'Busy', 'verdict-busy'));
    } else if (cluster.verdict) {
      rows.push(this.verdictRow(cluster.verdict));
    } else {
      const empty = document.createElement('div');
      empty.className = 'session-line';
      rows.push(empty);
    }
    this.root.replaceChildren(...rows);
  }

  /** The verdict as a summary button — icon, word, counts — jumping to the output panel. */
  private verdictRow(verdict: VerdictView): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `session-line verdict-row verdict-${verdict.kind}`;
    row.title = 'Show the details in the output panel';
    const icon =
      verdict.kind === 'error'
        ? bugIcon()
        : verdict.kind === 'warning'
          ? warningIcon()
          : trophyIcon();
    const word =
      verdict.kind === 'error' ? 'Error' : verdict.kind === 'warning' ? 'Warning' : 'Checked';
    const detail = verdictDetail(verdict.counts);
    const value = document.createElement('span');
    value.textContent = detail === '' ? word : `${word} — ${detail}`;
    row.addEventListener('click', () => this.hooks.onShowOutput());
    return this.appendIcon(row, icon, value);
  }

  /** The edited file's path with the manual-save action at its right. */
  private fileRow(file: string, backendOnline: boolean): HTMLElement {
    const row = this.line(fileIcon(), file, 'file-row');
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'session-action';
    save.title = 'Save the file';
    save.disabled = !backendOnline;
    save.append(saveIcon());
    save.addEventListener('click', this.hooks.onSaveFile);
    row.append(save);
    return row;
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
      toggle.className = 'session-action';
      toggle.title = 'Terminate the backend';
      toggle.append(pauseIcon());
      toggle.addEventListener('click', this.hooks.onBackendStop);
    } else if (cluster.backend.tone === 'exited') {
      toggle.className = 'session-action';
      toggle.title = 'Start the backend';
      toggle.append(playIcon());
      toggle.addEventListener('click', this.hooks.onBackendStart);
    } else {
      toggle.className = 'session-action';
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
    return this.appendIcon(row, icon, typeof content === 'string' ? textSpan(content) : content);
  }

  private appendIcon(
    row: HTMLElement,
    icon: HTMLElement | SVGSVGElement,
    value: HTMLElement,
  ): HTMLElement {
    const iconEl = document.createElement('span');
    iconEl.className = 'session-icon';
    iconEl.append(icon);
    row.append(iconEl, value);
    return row;
  }
}

function textSpan(text: string): HTMLElement {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}
