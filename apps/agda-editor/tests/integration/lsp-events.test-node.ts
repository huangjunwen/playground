/**
 * LSP wire events (integration/lsp-events.ts) — backend event hooks
 * become observability event specs here.
 *
 */

import { EditorState, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { lspFrameEvent, lspLogEvent } from '../../src/integration/lsp-events';
import { getEvents, observabilityModelField } from '../../src/model/observability-model';

/** A real-ish view state: dispatch applies the spec, events accumulate. */
function makeView() {
  let state = EditorState.create({ extensions: [observabilityModelField] });
  const dispatch = (spec: TransactionSpec): void => {
    state = state.update(spec).state;
  };
  return { state: () => state, dispatch };
}

describe('lspFrameEvent', () => {
  it('marks outgoing frames as lsp::o', () => {
    const view = makeView();

    view.dispatch(lspFrameEvent(true, { jsonrpc: '2.0', id: 1, method: 'initialize' }));

    expect(getEvents(view.state())).toEqual([
      expect.objectContaining({ level: 'debug', kind: 'lsp::o' }),
    ]);
    expect((getEvents(view.state())[0]!.payload as { method?: string }).method).toBe('initialize');
  });

  it('marks incoming frames as lsp::i', () => {
    const view = makeView();

    view.dispatch(lspFrameEvent(false, { jsonrpc: '2.0', method: 'window/logMessage' }));

    expect(getEvents(view.state())).toEqual([
      expect.objectContaining({ level: 'debug', kind: 'lsp::i' }),
    ]);
  });
});

describe('lspLogEvent', () => {
  it('marks each server error-stream line as lsp::e', () => {
    const view = makeView();

    view.dispatch(lspLogEvent('wasmi: panic'));

    expect(getEvents(view.state())).toEqual([
      expect.objectContaining({
        level: 'debug',
        kind: 'lsp::e',
        payload: { line: 'wasmi: panic' },
      }),
    ]);
  });
});

it('numbers every event in order regardless of builder', () => {
  const view = makeView();

  view.dispatch(lspFrameEvent(true, { jsonrpc: '2.0', method: 'a' }));
  view.dispatch(lspLogEvent('line'));
  view.dispatch(lspFrameEvent(false, { jsonrpc: '2.0', method: 'b' }));

  const seqs = getEvents(view.state()).map(e => e.seq);
  expect(seqs).toEqual([0, 1, 2]);
});
