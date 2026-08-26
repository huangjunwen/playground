/**
 * Command palette — the VSCode-style overlay every command flows
 * through. The palette is a *filter over the registry*, driven two
 * ways that compose: a typed query (fuzzy) and a pressed key
 * sequence. Multi-key bindings (the Agda chords) make the difference
 * visible: every unpressed key is highlighted as "to press next";
 * pressing a binding's root (Ctrl+C) opens the palette with that
 * prefix marked as pressed — those segments dim while the rest stay
 * highlighted. Pressing the next key narrows further; when exactly
 * one command is left it runs and the palette closes. Backspace
 * un-presses, Escape closes.
 *
 * Event-to-binding normalization, sequence matching, filtering and
 * match highlighting are exported as pure functions (node-tested);
 * the class below is their thin DOM projection.
 *
 * Commands whose `enabled()` is false (backend-dependent, offline)
 * render as disabled rows — navigation skips them and Enter refuses —
 * and `sync()` re-derives them when the session model changes while
 * the palette is open.
 */

import type { AppCommand } from './commands';
import { modKey } from './commands';

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

/**
 * Normalize a keyboard event into a binding segment ('Ctrl+L',
 * '⌘+Space', 'Ctrl+Shift+P') or null when the event carries no
 * command modifier, is alt-ed, or is a bare modifier key. Pure over
 * the four event fields it reads.
 */
export function bindingOfEvent(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): string | null {
  if (event.altKey) return null;
  if (!event.ctrlKey && !event.metaKey) return null;
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : null;
  if (key === null) return null; // modifiers, arrows, etc. are no bindings
  return event.shiftKey ? `${modKey}+Shift+${key}` : `${modKey}+${key}`;
}

export interface SequenceMatch {
  /** Commands whose binding equals the sequence exactly. */
  exact: AppCommand[];
  /** Commands whose binding equals OR extends the sequence. */
  prefixCount: number;
}

/**
 * Match a pressed key sequence against the registry: how many
 * commands it completes, and how many it is still a prefix of.
 * `prefixCount > 1` means "keep filtering"; a single survivor means
 * "run it".
 */
export function matchSequence(commands: readonly AppCommand[], seq: string): SequenceMatch {
  let exact: AppCommand[] = [];
  let prefixCount = 0;
  for (const command of commands) {
    const binding = command.keybinding;
    if (binding === undefined) continue;
    if (binding === seq) exact = [...exact, command];
    if (binding === seq || binding.startsWith(`${seq} `)) prefixCount += 1;
  }
  return { exact, prefixCount };
}

export interface PaletteEntry {
  command: AppCommand;
  score: number;
  positions: number[];
}

/**
 * The visible rows: the key-prefix filter first (a pressed sequence
 * keeps only the bindings that extend it), then the typed query
 * fuzzy-matching the label and re-ordering by score; ties keep
 * registry order.
 */
export function filterCommands(
  commands: readonly AppCommand[],
  query: string,
  keyPrefix = '',
): PaletteEntry[] {
  const pool =
    keyPrefix === ''
      ? [...commands]
      : commands.filter(c => c.keybinding?.startsWith(`${keyPrefix} `) ?? false);
  if (query.trim() === '') return pool.map(command => ({ command, score: 0, positions: [] }));
  const scored: PaletteEntry[] = [];
  for (const command of pool) {
    const m = fuzzyMatch(query, commandLabel(command));
    if (m !== null) scored.push({ command, score: m.score, positions: m.positions });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    // Ties favor the shorter label ('View: Vim mode' over 'View: Show
    // all commands' for the query "vim"); sort is stable, so registry
    // order still decides exact ties.
    return commandLabel(a.command).length - commandLabel(b.command).length;
  });
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
  private keyPrefix = '';
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

  /**
   * Open the palette, optionally with a key sequence already pressed
   * (the chord root from a cold Ctrl+C). Always resets the query.
   */
  open(keyPrefix = ''): void {
    this.keyPrefix = keyPrefix;
    this.root.hidden = false;
    this.updateHint();
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

  /** The currently pressed key sequence (test/debug surface). */
  get prefix(): string {
    return this.keyPrefix;
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

  private updateHint(): void {
    if (this.keyPrefix === '') {
      this.hint.hidden = true;
      return;
    }
    this.hint.hidden = false;
    this.hint.textContent = `${this.keyPrefix} pressed — press a highlighted key to run, Backspace to un-press, Esc to close.`;
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
    this.entries = filterCommands(this.hooks.getCommands(), this.input.value, this.keyPrefix).slice(
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
    if (entry.command.checked?.()) {
      const check = document.createElement('span');
      check.className = 'palette-check';
      check.textContent = '✓';
      row.append(check);
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
    const binding = entry.command.keybinding;
    if (binding !== undefined) {
      const keys = document.createElement('span');
      keys.className = 'palette-key';
      const pressed = this.keyPrefix === '' ? 0 : this.keyPrefix.split(' ').length;
      for (const [i, seg] of binding.split(' ').entries()) {
        if (i > 0) keys.append(' ');
        const kbd = document.createElement('kbd');
        kbd.textContent = seg;
        if (i < pressed) kbd.classList.add('pressed');
        else kbd.classList.add('await');
        keys.append(kbd);
      }
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
    // Backspace on an empty query un-presses the last chord key.
    if (e.key === 'Backspace' && this.input.value === '' && this.keyPrefix !== '') {
      e.preventDefault();
      this.keyPrefix = this.keyPrefix.split(' ').slice(0, -1).join(' ');
      this.updateHint();
      this.refresh();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const binding = bindingOfEvent(e);
      if (binding === null) return;
      const seq = this.keyPrefix === '' ? binding : `${this.keyPrefix} ${binding}`;
      const match = matchSequence(this.hooks.getCommands(), seq);
      if (match.prefixCount === 1 && match.exact.length === 1) {
        // One survivor: the sequence completes to it — run and close.
        e.preventDefault();
        this.run({ command: match.exact[0]!, score: 0, positions: [] });
        return;
      }
      if (match.prefixCount > 1) {
        // Still ambiguous: the press narrows the filter, stays open.
        e.preventDefault();
        this.keyPrefix = seq;
        this.updateHint();
        this.refresh();
        return;
      }
      // Nothing binds this combo: swallow it inside the palette, but
      // let the couple of plain input conveniences through.
      if (seq === `${modKey}+V` || seq === `${modKey}+A`) return;
      e.preventDefault();
    }
  }

  private run(entry: PaletteEntry): void {
    if (!this.isEnabled(entry)) return; // stays open, no refusal spam
    const command = entry.command;
    this.close();
    this.hooks.onRun(command);
  }
}
