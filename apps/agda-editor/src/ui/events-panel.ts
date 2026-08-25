/**
 * Events panel — the observability-model log in the bottom dock.
 *
 * Rendering is incremental: a `seq` watermark, each update appends only
 * newer events; when the ring buffer truncated the head (its first seq
 * jumped past watermark+1) the pane rebuilds once. Level filtering is
 * display-only and rebuilds on change. The pane holds no state of its
 * own beyond the watermark and DOM; every update is a projection of the
 * EditorState it is handed.
 */

import type { EditorState } from '@codemirror/state';
import type { EventLevel, ObservabilityEvent } from '../model/observability-model';
import { getEvents } from '../model/observability-model';

const LEVEL_ORDER: Record<EventLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Increment decision for the events pane (exported for node tests). */
export function eventsToAppend(
  lastSeq: number,
  events: ObservabilityEvent[],
): { rebuild: boolean; fresh: ObservabilityEvent[] } {
  if (events.length === 0) return { rebuild: false, fresh: [] };
  if (events[0]!.seq > lastSeq + 1) return { rebuild: true, fresh: events };
  return { rebuild: false, fresh: events.filter(e => e.seq > lastSeq) };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clockTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

type ValueClass = 'pv-str' | 'pv-num' | 'pv-bool';

function leafValue(v: unknown): { value: string; cls: ValueClass } {
  if (typeof v === 'string') return { value: JSON.stringify(v) ?? '""', cls: 'pv-str' };
  if (typeof v === 'number') return { value: String(v), cls: 'pv-num' };
  if (typeof v === 'boolean' || v === null) return { value: String(v), cls: 'pv-bool' };
  return { value: String(v), cls: 'pv-bool' };
}

/** Object entries sorted by key, so payloads render in a stable order. */
function sortedEntries(value: Record<string, unknown>): Array<readonly [string, unknown]> {
  return Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** JSON.stringify with object keys sorted (compact, like the wire format). */
function sortedJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(',')}]`;
  const body = sortedEntries(v as Record<string, unknown>)
    .map(([k, val]) => `${JSON.stringify(k)}:${sortedJson(val)}`)
    .join(',');
  return `{${body}}`;
}

function compactJson(v: unknown): string {
  const text = sortedJson(v);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/** Fold-head shape label with a count: `[… 10 items …]` / `{… 3 pairs …}`. */
function compoundLabel(isArray: boolean, count: number): string {
  return isArray
    ? `[… ${count} item${count === 1 ? '' : 's'} …]`
    : `{… ${count} pair${count === 1 ? '' : 's'} …}`;
}

/** One summary entry per top-level key; nested values stay compact (exported for node tests). */
export function summaryEntries(
  payload: unknown,
): Array<{ key: string; value: string; cls: string }> {
  if (typeof payload !== 'object' || payload === null) {
    const leaf = leafValue(payload);
    return [{ key: '', ...leaf }];
  }
  return sortedEntries(payload as Record<string, unknown>).map(([k, v]) =>
    v !== null && typeof v === 'object'
      ? { key: k, value: compactJson(v), cls: 'pv-compound' }
      : { key: k, ...leafValue(v) },
  );
}

const MAX_SUMMARY = 160;

/** Collapsed one-liner: `key: value, key: value` (exported for node tests). */
export function payloadSummary(payload: unknown): string {
  if (payload === undefined) return '';
  const text = summaryEntries(payload)
    .map(e => (e.key === '' ? e.value : `${e.key}: ${e.value}`))
    .join(', ');
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY)}…` : text;
}

/**
 * Expandable tree (devtools-style): every key whose value is an object or
 * array gets a `▸`/`▾` fold arrow toggling just that level; leaf keys get
 * an inert spacer so all keys line up. Fold clicks report through `notify`
 * so the entry's `+`/`−` badges can refresh.
 */
function buildNode(key: string, value: unknown, notify: () => void): HTMLElement {
  if (value === null || typeof value !== 'object') {
    const row = el('div', 'pv-row');
    if (key !== '') row.append(el('span', 'pv-key', `${key}: `));
    const leaf = leafValue(value);
    row.append(el('span', leaf.cls, leaf.value));
    return row;
  }
  const isArr = Array.isArray(value);
  const entries = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : sortedEntries(value as Record<string, unknown>);

  const node = el('div', 'pv-node');
  const head = el('div', 'pv-row pv-head');
  head.title = 'expand level';
  const toggle = el('span', 'pv-toggle', '▸');
  const toggleFold = (): void => {
    node.classList.toggle('open');
    const open = node.classList.contains('open');
    toggle.textContent = open ? '▾' : '▸';
    head.title = open ? 'collapse level' : 'expand level';
    notify();
  };
  // The whole head row toggles this level's fold.
  head.addEventListener('click', ev => {
    ev.stopPropagation();
    toggleFold();
  });
  if (key !== '') head.append(el('span', 'pv-key', `${key}: `));
  head.append(el('span', 'pv-compound', compoundLabel(isArr, entries.length)), toggle);
  const children = el('div', 'pv-children');
  for (const [k, v] of entries) children.append(buildNode(k, v, notify));
  node.append(head, children);
  return node;
}

/** What a payload block offers to its row (the `+`/`−` badges + row click). */
interface PayloadBlock {
  node: HTMLElement;
  /** Show the tree with only the top level unfolded. */
  openTop(): void;
  /** Open the tree and every fold in it. */
  expandAll(): void;
  /** Close the tree entirely. */
  collapseAll(): void;
  /** Tree shown and every fold open? */
  isFullyOpen(): boolean;
  /** Tree hidden? */
  isFullyClosed(): boolean;
  /** Run after any in-tree fold toggle (badge refresh). */
  onChange(listener: () => void): void;
}

/**
 * Devtools-style payload block: a coloured `key: value, …` one-liner while
 * collapsed, the fold tree below it when open. All state decisions — which
 * folds are open, whether the tree shows at all — live in the DOM; the
 * badges read them back through isFullyOpen/isFullyClosed.
 */
function payloadBlock(payload: unknown): PayloadBlock {
  const block = el('div', 'dock-event-payload');
  const summary = el('span', 'dock-event-summary');
  for (const [i, ent] of summaryEntries(payload).entries()) {
    if (i > 0) summary.append(', ');
    if (ent.key !== '') summary.append(el('span', 'pv-key', `${ent.key}: `));
    summary.append(el('span', ent.cls, ent.value));
  }
  block.append(summary);

  const listeners: Array<() => void> = [];
  const notify = (): void => {
    for (const l of listeners) l();
  };

  const tree = el('div', 'pv-root');
  if (typeof payload === 'object' && payload !== null) {
    const entries = Array.isArray(payload)
      ? (payload as unknown[]).map((v, i) => [String(i), v] as const)
      : sortedEntries(payload as Record<string, unknown>);
    for (const [k, v] of entries) tree.append(buildNode(k, v, notify));
  } else {
    tree.append(buildNode('', payload, notify));
  }
  // In-tree clicks must not fall through to the row's own toggle.
  tree.addEventListener('click', ev => ev.stopPropagation());
  block.append(tree);

  const folds = (): HTMLElement[] => [...tree.querySelectorAll<HTMLElement>('.pv-node')];
  const arrowsSync = (): void => {
    for (const n of folds()) {
      const open = n.classList.contains('open');
      const arrow = n.querySelector<HTMLElement>(':scope > .pv-head > .pv-toggle');
      if (arrow) arrow.textContent = open ? '▾' : '▸';
      const head = n.querySelector<HTMLElement>(':scope > .pv-head');
      if (head) head.title = open ? 'collapse level' : 'expand level';
    }
  };
  /** Show the tree; nested folds keep whatever state they had. */
  const show = (): void => {
    block.classList.add('open');
  };
  const setOpenAll = (open: boolean): void => {
    block.classList.toggle('open', open);
    for (const n of folds()) n.classList.toggle('open', open);
    arrowsSync();
  };
  return {
    node: block,
    openTop: () => {
      show();
      arrowsSync();
    },
    expandAll: () => setOpenAll(true),
    collapseAll: () => setOpenAll(false),
    isFullyOpen: () =>
      block.classList.contains('open') && folds().every(n => n.classList.contains('open')),
    isFullyClosed: () => !block.classList.contains('open'),
    onChange: l => {
      listeners.push(l);
    },
  };
}

export class EventsPanel {
  private readonly pane: HTMLElement;
  private readonly levelSelect: HTMLSelectElement;
  private lastState: EditorState | undefined;
  private lastSeq = -1;
  private minLevel: EventLevel = 'info';
  /** Set by display-only changes (level filter): the next render replaces. */
  private forceRebuild = false;

  constructor(root: HTMLElement) {
    this.pane = root.querySelector<HTMLElement>('.dock-events')!;
    this.levelSelect = root.querySelector<HTMLSelectElement>('.dock-level select')!;
    this.levelSelect.addEventListener('change', () => {
      this.minLevel = this.levelSelect.value as EventLevel;
      this.forceRebuild = true;
      if (this.lastState !== undefined) this.render(this.lastState);
    });
  }

  /** Project a new state into the pane. */
  update(state: EditorState): void {
    this.lastState = state;
    this.render(state);
  }

  private render(state: EditorState): void {
    const events = getEvents(state);
    const { rebuild, fresh } = eventsToAppend(this.lastSeq, events);
    const replace = rebuild || this.forceRebuild;
    this.forceRebuild = false;
    this.lastSeq = events.at(-1)?.seq ?? this.lastSeq;
    // A forced rebuild renders the whole buffer, not just the delta.
    const rows = (replace ? events : fresh)
      .filter(e => LEVEL_ORDER[e.level] >= LEVEL_ORDER[this.minLevel])
      .map(e => this.eventRow(e));
    if (replace) this.pane.replaceChildren(...rows);
    else if (rows.length > 0) this.pane.append(...rows);
    // Stick to the bottom unless the user scrolled up.
    const nearBottom = this.pane.scrollHeight - this.pane.scrollTop - this.pane.clientHeight < 24;
    if (nearBottom) this.pane.scrollTop = this.pane.scrollHeight;
  }

  private eventRow(e: ObservabilityEvent): HTMLElement {
    const row = el('div', `dock-event dock-event-${e.level}`);
    row.append(
      el('span', 'dock-event-time', clockTime(e.ts)),
      el('span', `dock-event-level dock-event-level-${e.level}`, e.level[0]!),
      el('span', 'dock-event-kind', e.kind),
    );
    if (e.payload !== undefined) {
      // Badges right after the kind, always visible: `+` disabled when
      // everything is open, `−` disabled when everything is collapsed.
      // Clicking the entry itself shows the tree (top level only); the
      // badges handle deep expansion / full collapse.
      const block = payloadBlock(e.payload);
      const plus = el('button', 'dock-event-expand dock-event-expand-plus', '+');
      plus.title = 'expand all';
      const minus = el('button', 'dock-event-expand dock-event-expand-minus', '−');
      minus.title = 'collapse all';
      const sync = (): void => {
        plus.disabled = block.isFullyOpen();
        minus.disabled = block.isFullyClosed();
        // The row only ever expands; `−` owns the collapse.
        row.title = block.isFullyClosed() ? 'expand top level' : '';
      };
      plus.addEventListener('click', ev => {
        ev.stopPropagation();
        block.expandAll();
        sync();
      });
      minus.addEventListener('click', ev => {
        ev.stopPropagation();
        block.collapseAll();
        sync();
      });
      block.onChange(sync);
      row.append(plus, minus, block.node);
      // Clicking the entry only expands the top level; `+`/`−` own the
      // deep expansion and the full collapse.
      row.addEventListener('click', () => {
        if (block.isFullyClosed()) block.openTop();
        sync();
      });
      sync();
    }
    return row;
  }
}
