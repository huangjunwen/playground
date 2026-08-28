/**
 * Session model — busy/error/diagnostics/runningInfo/backend StateField
 * driven by effects, plus the transactions (commands.ts's streaming
 * executor) that dispatch them.
 *
 * The field tests cover each effect in isolation; the transaction tests
 * cover the composite dispatches a command actually performs (start = busy +
 * clear error + clear diagnostics + clear runningInfo together, end keeps
 * the final error, diagnostics, and runningInfo).
 */

import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  appendRunningInfo,
  backendExitTransaction,
  backendOnlineTransaction,
  checkedTransaction,
  clearRunningInfo,
  clearRunningInfoTransaction,
  commandEndTransaction,
  commandStartTransaction,
  diagnosticsTransaction,
  errorTransaction,
  getSession,
  runningInfoTransaction,
  sessionModelField,
  setBackendStatus,
  setBusy,
  setDiagnostics,
  setError,
} from '../../src/model/session-model';

function makeState(doc = ''): EditorState {
  return EditorState.create({ doc, extensions: [sessionModelField] });
}

function seedStaleSession(state: EditorState): EditorState {
  return state.update({
    effects: [
      setError.of('stale error'),
      setDiagnostics.of({ warnings: ['stale warning'], errors: ['stale check error'] }),
      appendRunningInfo.of('stale log line'),
      appendRunningInfo.of('another stale line'),
    ],
  }).state;
}

describe('sessionModelField', () => {
  it('starts booting, idle, with no error, no diagnostics, unchecked, and empty runningInfo', () => {
    const session = getSession(makeState());
    expect(session.backend).toEqual({ state: 'booting' });
    expect(session.busy).toBe(false);
    expect(session.error).toBeUndefined();
    expect(session.diagnostics).toEqual({ warnings: [], errors: [] });
    expect(session.checked).toBe(false);
    expect(session.runningInfo).toEqual([]);
  });

  it('setBusy toggles busy', () => {
    let state = makeState().update({ effects: setBusy.of(true) }).state;
    expect(getSession(state).busy).toBe(true);
    state = state.update({ effects: setBusy.of(false) }).state;
    expect(getSession(state).busy).toBe(false);
  });

  it('setError sets and clears the error', () => {
    let state = makeState().update({ effects: setError.of('parse error') }).state;
    expect(getSession(state).error).toBe('parse error');
    state = state.update({ effects: setError.of(undefined) }).state;
    expect(getSession(state).error).toBeUndefined();
  });

  it('setDiagnostics replaces the diagnostics wholesale — a healed module clears them', () => {
    let state = makeState().update({
      effects: setDiagnostics.of({
        warnings: ['UnusedVariable'],
        errors: ['Termination checking failed'],
      }),
    }).state;
    expect(getSession(state).diagnostics).toEqual({
      warnings: ['UnusedVariable'],
      errors: ['Termination checking failed'],
    });
    state = state.update({ effects: setDiagnostics.of({ warnings: [], errors: [] }) }).state;
    expect(getSession(state).diagnostics).toEqual({ warnings: [], errors: [] });
  });

  it('appendRunningInfo appends messages in order', () => {
    let state = makeState().update({ effects: appendRunningInfo.of('Loading Main...') }).state;
    state = state.update({ effects: appendRunningInfo.of('Checking Main...') }).state;
    expect(getSession(state).runningInfo).toEqual(['Loading Main...', 'Checking Main...']);
  });

  it('clearRunningInfo empties the runningInfo', () => {
    let state = makeState().update({
      effects: [appendRunningInfo.of('a'), appendRunningInfo.of('b')],
    }).state;
    state = state.update({ effects: clearRunningInfo.of(null) }).state;
    expect(getSession(state).runningInfo).toEqual([]);
  });

  it('a document edit invalidates the checked result', () => {
    let state = makeState('a = ?').update(checkedTransaction(true)).state;
    expect(getSession(state).checked).toBe(true);

    state = state.update({ changes: { from: 4, insert: ' ' } }).state;

    expect(getSession(state).checked).toBe(false);
  });
});

describe('checkedTransaction', () => {
  it('sets the checked flag', () => {
    const state = makeState().update(checkedTransaction(true)).state;
    expect(getSession(state).checked).toBe(true);

    const next = state.update(checkedTransaction(false)).state;
    expect(getSession(next).checked).toBe(false);
  });
});

describe('commandStartTransaction', () => {
  it('marks busy and clears stale error, diagnostics, and runningInfo', () => {
    let state = seedStaleSession(makeState());

    state = state.update(commandStartTransaction()).state;

    const session = getSession(state);
    expect(session.busy).toBe(true);
    expect(session.error).toBeUndefined();
    expect(session.diagnostics).toEqual({ warnings: [], errors: [] });
    expect(session.runningInfo).toEqual([]);
  });
});

describe('commandEndTransaction', () => {
  it('clears busy but keeps error, diagnostics, and runningInfo', () => {
    let state = seedStaleSession(makeState());

    state = state.update(commandEndTransaction()).state;

    const session = getSession(state);
    expect(session.busy).toBe(false);
    expect(session.error).toBe('stale error');
    expect(session.diagnostics).toEqual({
      warnings: ['stale warning'],
      errors: ['stale check error'],
    });
    expect(session.runningInfo).toEqual(['stale log line', 'another stale line']);
  });
});

describe('runningInfoTransaction', () => {
  it('appends the message to the runningInfo', () => {
    let state = makeState();

    state = state.update(runningInfoTransaction('Checking Main ()')).state;
    state = state.update(runningInfoTransaction('Loading Main.agda')).state;

    expect(getSession(state).runningInfo).toEqual(['Checking Main ()', 'Loading Main.agda']);
  });
});

describe('clearRunningInfoTransaction', () => {
  it('clears the runningInfo', () => {
    let state = seedStaleSession(makeState());

    state = state.update(clearRunningInfoTransaction()).state;

    expect(getSession(state).runningInfo).toEqual([]);
  });
});

describe('errorTransaction', () => {
  it('sets the error message extracted from the response', () => {
    const state = makeState().update(errorTransaction('Main.agda:1.1: parse error')).state;

    expect(getSession(state).error).toBe('Main.agda:1.1: parse error');
  });
});

describe('diagnosticsTransaction', () => {
  it('records an AllGoalsWarnings snapshot as the module diagnostics', () => {
    const state = makeState().update(
      diagnosticsTransaction({
        warnings: ['Unsolved metas'],
        errors: ['Termination checking failed'],
      }),
    ).state;

    expect(getSession(state).diagnostics).toEqual({
      warnings: ['Unsolved metas'],
      errors: ['Termination checking failed'],
    });
  });
});

describe('backend lifecycle', () => {
  it('starts booting and the transactions walk it online then exited', () => {
    let state = makeState();
    expect(getSession(state).backend).toEqual({ state: 'booting' });

    state = state.update(backendOnlineTransaction()).state;
    expect(getSession(state).backend).toEqual({ state: 'online' });

    state = state.update(backendExitTransaction(1)).state;
    expect(getSession(state).backend).toEqual({ state: 'exited', code: 1 });
  });

  it('the backend status survives document edits (unlike checked)', () => {
    let state = makeState('a = ?').update(backendOnlineTransaction()).state;
    state = state.update({ changes: { from: 4, insert: ' ' } }).state;
    expect(getSession(state).backend).toEqual({ state: 'online' });
  });

  it('setBackendStatus sets the raw status directly', () => {
    const state = makeState().update({
      effects: setBackendStatus.of({ state: 'exited', code: 0 }),
    }).state;
    expect(getSession(state).backend).toEqual({ state: 'exited', code: 0 });
  });
});
