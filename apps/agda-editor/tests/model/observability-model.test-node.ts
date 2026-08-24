/**
 * Observability model — the ring-buffered event log.
 *
 * appendEvent assigns seq (monotonic) and ts; the ring drops oldest events
 * beyond MAX_EVENTS; getEvents reads the log and degrades to [] when the
 * extension is absent. These tests cover the model's own behaviour.
 */

import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  appendEvent,
  formatElapse,
  getEvents,
  MAX_EVENTS,
  observabilityModelField,
} from '../../src/model/observability-model';

function makeState() {
  return EditorState.create({ extensions: [observabilityModelField] });
}

describe('observabilityModelField', () => {
  it('assigns seq and ts to each appended event', () => {
    let state = makeState();
    const before = Date.now();
    state = state.update({
      effects: [appendEvent.of({ level: 'info', kind: 'a', payload: 1 })],
    }).state;
    state = state.update({
      effects: [appendEvent.of({ level: 'warn', kind: 'b', payload: 2 })],
    }).state;

    const events = getEvents(state);
    expect(events.map(e => [e.seq, e.level, e.kind, e.payload])).toEqual([
      [0, 'info', 'a', 1],
      [1, 'warn', 'b', 2],
    ]);
    for (const e of events) {
      expect(e.ts).toBeGreaterThanOrEqual(before);
      expect(e.ts).toBeLessThanOrEqual(Date.now());
    }
  });

  it('drops the oldest events once the ring exceeds MAX_EVENTS', () => {
    let state = makeState();
    for (let i = 0; i < MAX_EVENTS + 5; i++) {
      state = state.update({
        effects: [appendEvent.of({ level: 'debug', kind: 'lsp', payload: i })],
      }).state;
    }

    const events = getEvents(state);
    expect(events).toHaveLength(MAX_EVENTS);
    expect(events[0]!.payload).toBe(5);
    expect(events.at(-1)!.payload).toBe(MAX_EVENTS + 4);
    expect(events.map(e => e.seq)).toEqual(events.map((_, i) => i + 5));
  });

  it('returns an empty log when the extension is absent', () => {
    const state = EditorState.create({});
    expect(getEvents(state)).toEqual([]);
  });
});

describe('formatElapse', () => {
  it('renders sub-second values with three decimals', () => {
    expect(formatElapse(0)).toBe('0.000ms');
    expect(formatElapse(12.3)).toBe('12.300ms');
    expect(formatElapse(999.9994)).toBe('999.999ms');
  });

  it('adds thousands separators past a second', () => {
    expect(formatElapse(1234.5)).toBe('1,234.500ms');
    expect(formatElapse(123456.789)).toBe('123,456.789ms');
  });
});
