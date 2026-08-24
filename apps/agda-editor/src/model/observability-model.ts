/**
 * Observability model — a ring-buffered, structured event log of what the
 * editor did, for debugging/observation.
 *
 * Distinct from the session model's per-command *status* (cleared on
 * command start): this log is a persistent *trace* — every command
 * start/end, every raw LSP response (backend wire tap), and the load/give
 * outcomes accumulate until the ring wraps.
 */

import { StateEffect, StateField, type TransactionSpec } from '@codemirror/state';

export type EventLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ObservabilityEvent {
  seq: number;
  ts: number;
  level: EventLevel;
  kind: string;
  payload: unknown;
}

/** Maximum events kept in the ring before old ones are dropped. */
export const MAX_EVENTS = 500;

/** Append a structured event; `seq` and `ts` are assigned by the field. */
export const appendEvent = StateEffect.define<Omit<ObservabilityEvent, 'seq' | 'ts'>>();

export const observabilityModelField = StateField.define<ObservabilityEvent[]>({
  create: () => [],
  update(events, tr) {
    let next = events;
    for (const effect of tr.effects) {
      if (effect.is(appendEvent)) {
        const lastSeq = next.length > 0 ? next[next.length - 1]!.seq : -1;
        next = [...next, { ...effect.value, seq: lastSeq + 1, ts: Date.now() }];
        if (next.length > MAX_EVENTS) next = next.slice(-MAX_EVENTS);
      }
    }
    return next;
  },
});

/** Read the event log (empty when the extension is absent). */
export function getEvents(state: {
  field<T>(f: StateField<T>, require?: boolean): T;
}): ObservabilityEvent[] {
  return state.field(observabilityModelField, false) ?? [];
}

// ---------------------------------------------------------------------------
// Log transactions — the only entry points that append events
// ---------------------------------------------------------------------------

/**
 * Format a duration for an event payload: `12.345ms`, or with thousands
 * separators past a second (`1,234.567ms`). Elapsed times are stringified
 * here, at the source, so consumers render them like any other value.
 */
export function formatElapse(ms: number): string {
  const num =
    ms >= 1000
      ? ms.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
      : ms.toFixed(3);
  return `${num}ms`;
}

/** Append an event; `seq` and `ts` are assigned by the field on apply. */
export function appendEventTransaction(
  level: EventLevel,
  kind: string,
  payload?: unknown,
): TransactionSpec {
  return { effects: [appendEvent.of({ level, kind, payload })] };
}
