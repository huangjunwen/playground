/**
 * Events pane increment — the watermark rule of the events panel: append only newer
 * events, rebuild once when the ring buffer truncated the head. Seqs start
 * at 0 (observability-model.ts), so the initial watermark is -1.
 *
 */

import { describe, expect, it } from 'vitest';
import type { ObservabilityEvent } from '../../src/model/observability-model';
import { eventsToAppend, payloadSummary, summaryEntries } from '../../src/ui/events-panel';

const event = (seq: number, level: ObservabilityEvent['level'] = 'info'): ObservabilityEvent => ({
  seq,
  ts: 1700000000000 + seq,
  level,
  kind: `e${seq}`,
  payload: { n: seq },
});

describe('eventsToAppend', () => {
  it('renders everything on the initial pass (watermark -1, seqs from 0)', () => {
    expect(eventsToAppend(-1, [event(0), event(1)])).toEqual({
      rebuild: false,
      fresh: [event(0), event(1)],
    });
  });

  it('appends only events newer than the watermark', () => {
    const events = [event(0), event(1), event(2)];
    expect(eventsToAppend(0, events)).toEqual({ rebuild: false, fresh: [event(1), event(2)] });
  });

  it('returns nothing new when the watermark is current', () => {
    expect(eventsToAppend(2, [event(0), event(1), event(2)])).toEqual({
      rebuild: false,
      fresh: [],
    });
  });

  it('flags a rebuild when truncation dropped the head (first seq > watermark+1)', () => {
    const truncated = [event(40), event(41)];
    expect(eventsToAppend(2, truncated)).toEqual({ rebuild: true, fresh: truncated });
  });

  it('handles an empty buffer', () => {
    expect(eventsToAppend(5, [])).toEqual({ rebuild: false, fresh: [] });
  });
});

describe('payloadSummary', () => {
  it('renders an elapse string like any other value (no special-casing)', () => {
    // Durations are formatted at the source (observability-model.ts); the
    // panel only ever sees the string.
    expect(payloadSummary({ elapse: '12.300ms' })).toBe('elapse: "12.300ms"');
  });

  it('summarises other payloads as `key: value` pairs, sorted by key', () => {
    expect(payloadSummary({ kind: 'End' })).toBe('kind: "End"');
    expect(payloadSummary({ goalId: 3, error: 'boom' })).toBe('error: "boom", goalId: 3');
    expect(payloadSummary({ b: 2, a: 1 })).toBe('a: 1, b: 2');
    expect(payloadSummary(undefined)).toBe('');
  });

  it('truncates long summaries with an ellipsis', () => {
    const summary = payloadSummary({ raw: 'x'.repeat(200) });
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(161);
  });
});

describe('summaryEntries', () => {
  it('types each entry by its leaf kind', () => {
    expect(summaryEntries({ a: 1, b: 's', c: true, d: null })).toEqual([
      { key: 'a', value: '1', cls: 'pv-num' },
      { key: 'b', value: '"s"', cls: 'pv-str' },
      { key: 'c', value: 'true', cls: 'pv-bool' },
      { key: 'd', value: 'null', cls: 'pv-bool' },
    ]);
  });

  it('keeps nested structures compact with a compound class, keys sorted', () => {
    expect(summaryEntries({ points: [{ id: 0 }] })).toEqual([
      { key: 'points', value: '[{"id":0}]', cls: 'pv-compound' },
    ]);
    expect(summaryEntries({ z: 1, a: { y: 2, x: 3 } })).toEqual([
      { key: 'a', value: '{"x":3,"y":2}', cls: 'pv-compound' },
      { key: 'z', value: '1', cls: 'pv-num' },
    ]);
  });
});
