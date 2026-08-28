/**
 * Status cluster — every slot's projection: the backend lifecycle, the
 * busy spinner, and the idle-only verdict.
 *
 */

import { EditorState, type StateEffect } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  sessionModelField,
  setBackendStatus,
  setBusy,
  setChecked,
  setDiagnostics,
  setError,
} from '../../src/model/session-model';
import { statusCluster, verdictDetail } from '../../src/ui/status';

function makeState(effects: StateEffect<unknown>[] = []): EditorState {
  let state = EditorState.create({ extensions: [sessionModelField] });
  for (const e of effects) state = state.update({ effects: [e as never] }).state;
  return state;
}

describe('backend slot', () => {
  it('tracks the lifecycle: booting → online → exited (code)', () => {
    expect(statusCluster(makeState()).backend).toEqual({ label: 'booting', tone: 'booting' });
    expect(statusCluster(makeState([setBackendStatus.of({ state: 'online' })])).backend).toEqual({
      label: 'online',
      tone: 'online',
    });
    expect(
      statusCluster(makeState([setBackendStatus.of({ state: 'exited', code: 1 })])).backend,
    ).toEqual({ label: 'exited (1)', tone: 'exited' });
  });

  it('an exit is visible even mid-command — it masks nothing else', () => {
    const cluster = statusCluster(
      makeState([setBackendStatus.of({ state: 'exited', code: 1 }), setBusy.of(true)]),
    );
    expect(cluster.backend).toEqual({ label: 'exited (1)', tone: 'exited' });
    expect(cluster.busy).toBe(true);
  });
});

describe('busy slot', () => {
  it('mirrors the session busy flag', () => {
    expect(statusCluster(makeState()).busy).toBe(false);
    expect(statusCluster(makeState([setBusy.of(true)])).busy).toBe(true);
  });
});

describe('verdict slot (idle only, shown only when worth it)', () => {
  it('is absent by default (never loaded / stale renders nothing)', () => {
    expect(statusCluster(makeState()).verdict).toBeUndefined();
  });

  it('is error when the session holds an error (the exception counts as one)', () => {
    expect(
      statusCluster(makeState([setError.of('Main.agda:1.1: parse error\ncontext')])).verdict,
    ).toEqual({
      kind: 'error',
      counts: { errors: 1, warnings: 0 },
    });
  });

  it('is error when the module carries non-fatal check errors (diagnostics)', () => {
    expect(
      statusCluster(
        makeState([setDiagnostics.of({ warnings: [], errors: ['Termination checking failed'] })]),
      ).verdict,
    ).toEqual({ kind: 'error', counts: { errors: 1, warnings: 0 } });
  });

  it('error beats warning, and the counts add up across carriers', () => {
    expect(
      statusCluster(
        makeState([
          setError.of('boom'),
          setDiagnostics.of({ warnings: ['UnusedVariable', 'ImportWarning'], errors: ['boom2'] }),
        ]),
      ).verdict,
    ).toEqual({ kind: 'error', counts: { errors: 2, warnings: 2 } });
  });

  it('is warning when the module carries only benign warnings', () => {
    expect(
      statusCluster(makeState([setDiagnostics.of({ warnings: ['UnusedVariable'], errors: [] })]))
        .verdict,
    ).toEqual({ kind: 'warning', counts: { errors: 0, warnings: 1 } });
  });

  it('is checked after a clean load — unsolved goals do not clear it', () => {
    // Status.checked is agda's no-error verdict; unsolved goals stay
    // visible in the goals panel (checked + empty panel = All Done).
    expect(statusCluster(makeState([setChecked.of(true)])).verdict).toEqual({
      kind: 'checked',
      counts: { errors: 0, warnings: 0 },
    });
  });

  it('is absent while busy — a running command has no verdict yet', () => {
    expect(
      statusCluster(makeState([setBusy.of(true), setError.of('boom')])).verdict,
    ).toBeUndefined();
    expect(
      statusCluster(makeState([setBusy.of(true), setChecked.of(true)])).verdict,
    ).toBeUndefined();
  });
});

describe('verdictDetail — the counts as a detail suffix', () => {
  it('pluralises and orders: errors before warnings', () => {
    expect(verdictDetail({ errors: 2, warnings: 0 })).toBe('2 errors');
    expect(verdictDetail({ errors: 1, warnings: 0 })).toBe('1 error');
    expect(verdictDetail({ errors: 0, warnings: 1 })).toBe('1 warning');
    expect(verdictDetail({ errors: 0, warnings: 3 })).toBe('3 warnings');
    expect(verdictDetail({ errors: 2, warnings: 1 })).toBe('2 errors, 1 warning');
  });

  it('is empty when there is nothing to count (the plain word shows alone)', () => {
    expect(verdictDetail({ errors: 0, warnings: 0 })).toBe('');
  });
});
