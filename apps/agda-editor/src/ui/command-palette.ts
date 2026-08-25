/**
 * Command palette — the VSCode-style overlay every command flows
 * through. Two modes: `all` lists the registry (Ctrl+Shift+P); `agda`
 * opens on Ctrl+C and lists only the Agda chord commands, so the
 * chord letters are visible instead of memorized — typing a letter
 * with Ctrl held completes the chord (Ctrl+C Ctrl+L etc.) directly.
 *
 * Filtering and match highlighting are exported as pure functions
 * (node-tested); the class below is their thin DOM projection: one
 * input, a hint line in agda mode, and rows of label + keybinding.
 * Commands whose `enabled()` is false (backend-dependent, offline)
 * render as disabled rows — navigation skips them and Enter refuses —
 * and `sync()` re-derives them when the session model changes while
 * the palette is open.
 */

import type { AppCommand, CommandCategory } from './commands';
import { agdaChords } from './commands';

export type PaletteMode = 'all' | 'agda';

/** Fuzzy subsequence match: every query char, in order, in target. */
export function fuzzyMatch(
  query: string,
  target: string,
): { score: number; positions: number[] } | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return { score: 0, positions: [] };
  const positions: number[] = [];
  let score = 0;
  let streak = 0;
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi]!, ti);
    if (found === -1) return null;
    // Consecutive chars score higher; word starts higher still.
    streak = found === ti ? streak + 1 : 1;
    score += streak * 2;
    if (found === 0 || /[\s(:]/.test(t[found - 1] ?? '')) score += 6;
    positions.push(found);
    ti = found + 1;
  }
  return { score, positions };
}

/** The label a command is matched and shown by: `Category: Title`. */
export function commandLabel(command: AppCommand): string {
  return `${command.category}: ${command.title}`;
}

export interface PaletteEntry {
  command: AppCommand;
  score: number;
  positions: number[];
}

/**
 * The visible rows: in agda mode only the Agda-category commands (the
 * Ctrl+C chord group, unfiltered by default), in all mode the whole
 * registry. A query fuzzy-matches the label and re-orders by score;
 * ties keep registry order.
 */
export function filterCommands(
  commands: readonly AppCommand[],
  query: string,
  mode: PaletteMode,
): PaletteEntry[] {
  const pool =
    mode === 'agda'
      ? commands.filter(c => c.category === ('Agda' satisfies CommandCategory))
      : commands;
  if (query.trim() === '') return pool.map(command => ({ command, score: 0, positions: [] }));
  const scored: PaletteEntry[] = [];
  for (const command of pool) {
    const m = fuzzyMatch(query, commandLabel(command));
    if (m !== null) scored.push({ command, score: m.score, positions: m.positions });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** Label split into hit/plain segments for <mark> rendering. */
export function highlightSegments(
  label: string,
  positions: number[],
): Array<{ text: string; hit: boolean }> {
  if (positions.length === 0) return [{ text: label, hit: false }];
  const segments: Array<{ text: string; hit: boolean }> = [];
  const hits = new Set(positions);
  let run = '';
  let runHit = hits.has(0);
  for (let i = 0; i < label.length; i++) {
    const hit = hits.has(i);
    if (hit === runHit) run += label[i]!;
    else {
      segments.push({ text: run, hit: runHit });
      run = label[i]!;
      runHit = hit;
    }
  }
  segments.push({ text: run, hit: runHit });
  return segments;
}

export interface PaletteHooks {
  /** The registry to list (re-read on every open). */
  getCommands(): readonly AppCommand[];
  /** Run a picked/completed command; the palette closes first. */
  onRun(command: AppCommand): void;
  /** Return focus to the editor after close. */
  onClose(): void;
}

const MAX_ROWS = 64;

/** The palette overlay: hidden until `open`, rebuilt per interaction. */
export class CommandPalette {
  private readonly input: HTMLInputElement;
  private readonly hint: HTMLElement;
  private readonly list: HTMLElement;
  private mode: PaletteMode = 'all';
  private entries: PaletteEntry[] = [];
  private active = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: PaletteHooks,
  ) {
    this.input = root.querySelector<HTMLInputElement>('.palette-input')!;
    this.hint = root.querySelector<HTMLElement>('.palette-hint')!;
    this.list = root.querySelector<HTMLElement>('.palette-list')!;
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', e => this.onKeyDown(e));
    root.addEventListener('mousedown', e => {
      if (e.target === this.root) this.close();
    });
    this.list.addEventListener('click', e => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.palette-row');
      if (row === null) return;
      const idx = Number(row.dataset.idx);
      const entry = this.entries[idx];
      if (entry !== undefined) this.run(entry);
    });
  }

  open(mode: PaletteMode): void {
    this.mode = mode;
    this.root.hidden = false;
    this.hint.hidden = mode !== 'agda';
    if (mode === 'agda') {
      this.hint.textContent =
        'Ctrl+C chord — hold Ctrl and press the command letter, or pick below; Esc closes.';
    }
    this.input.value = '';
    this.refresh();
    this.input.focus();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.hooks.onClose();
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * Re-derive the rows without disturbing the query — for when the
   * world changes under an open palette (the backend coming online
   * re-enabling its commands). No-op while closed.
   */
  sync(): void {
    if (this.root.hidden) return;
    this.refresh(true);
  }

  private isEnabled(entry: PaletteEntry): boolean {
    return entry.command.enabled?.() ?? true;
  }

  private firstEnabled(): number {
    const idx = this.entries.findIndex(entry => this.isEnabled(entry));
    return idx === -1 ? 0 : idx;
  }

  private refresh(preserveActive = false): void {
    const keep = preserveActive ? this.active : 0;
    this.entries = filterCommands(this.hooks.getCommands(), this.input.value, this.mode).slice(
      0,
      MAX_ROWS,
    );
    const rows = this.entries.map((entry, idx) => this.row(entry, idx));
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = 'No matching commands';
      rows.push(empty);
    }
    this.list.replaceChildren(...rows);
    const clamped = Math.min(keep, Math.max(this.entries.length - 1, 0));
    const target = this.entries[clamped];
    this.setActive(target !== undefined && this.isEnabled(target) ? clamped : this.firstEnabled());
  }

  /** VSCode-style row: the label with match marks left, the keys right. */
  private row(entry: PaletteEntry, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'palette-row';
    row.dataset.idx = String(idx);
    row.setAttribute('role', 'option');
    if (!this.isEnabled(entry)) {
      row.classList.add('disabled');
      row.setAttribute('aria-disabled', 'true');
    }
    const label = document.createElement('span');
    label.className = 'palette-label';
    const segments = highlightSegments(commandLabel(entry.command), entry.positions);
    for (const seg of segments) {
      if (seg.text === '') continue;
      if (seg.hit) {
        const mark = document.createElement('mark');
        mark.textContent = seg.text;
        label.append(mark);
      } else {
        label.append(seg.text);
      }
    }
    row.append(label);
    if (entry.command.keybinding !== undefined) {
      const keys = document.createElement('kbd');
      keys.className = 'palette-key';
      keys.textContent = entry.command.keybinding;
      row.append(keys);
    }
    return row;
  }

  private setActive(idx: number): void {
    this.active = idx;
    const rows = this.list.querySelectorAll<HTMLElement>('.palette-row');
    for (const row of rows) row.classList.toggle('active', Number(row.dataset.idx) === idx);
    rows[idx]?.scrollIntoView({ block: 'nearest' });
  }

  /** Step through the rows, skipping disabled ones (wrap-around). */
  private move(step: 1 | -1): void {
    const n = this.entries.length;
    if (n === 0) return;
    for (let i = 1; i <= n; i++) {
      const idx = (this.active + step * i + n * i) % n;
      if (this.isEnabled(this.entries[idx]!)) {
        this.setActive(idx);
        return;
      }
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.move(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.move(-1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const entry = this.entries[this.active];
      if (entry !== undefined) this.run(entry);
      return;
    }
    // Agda mode doubles as the Ctrl+C chord reader: Ctrl+letter runs
    // the chord command directly.
    if (this.mode === 'agda' && (e.ctrlKey || e.metaKey)) {
      const id = agdaChords[e.key.toLowerCase()];
      if (id !== undefined) {
        e.preventDefault();
        const command = this.hooks.getCommands().find(c => c.id === id);
        if (command !== undefined) this.run({ command, score: 0, positions: [] });
      }
    }
  }

  private run(entry: PaletteEntry): void {
    if (!this.isEnabled(entry)) return; // stays open, no refusal spam
    const command = entry.command;
    this.close();
    this.hooks.onRun(command);
  }
}
