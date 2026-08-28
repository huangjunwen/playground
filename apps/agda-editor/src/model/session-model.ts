/**
 * Session model — the editor's interaction session with the Agda backend.
 *
 * A "session" is the conversation around the current file: the backend
 * process behind it (backend), the command currently running (busy), the
 * error it surfaced (error), its progress lines (runningInfo), the module's
 * current diagnostics (diagnostics), and the file path it targets
 * (filePathFacet). Every command — load, give, and future
 * case/intro/query commands — runs inside one: they all toggle busy, surface
 * errors, and append runningInfo lines.
 *
 * `checked` mirrors the load stream's `Status` response — agda's verdict
 * that the file type-checked without errors. Unsolved goals do NOT clear it
 * (they are warnings to agda); "All Done" is composed downstream as checked
 * && no goals left. Only load consumes Status: after a give or any local
 * edit, agda's verdict is stale — any edit invalidates it automatically.
 *
 * The command transactions are dispatched while a command's responses
 * stream in: start/end toggle busy (start also clears the previous error,
 * diagnostics, and runningInfo), RunningInfo messages append in real time,
 * DisplayInfo (Error) sets the error, and every AllGoalsWarnings snapshot
 * replaces the diagnostics. Consumers read the state via getSession;
 * nothing outside this file changes it.
 */

import { Facet, StateEffect, StateField, type TransactionSpec } from '@codemirror/state';
import { systemTransaction } from './goal-model';

/** The workspace file this session is editing; commands sync and address it. */
export const filePathFacet = Facet.define<string, string>({
  combine: values => values[0]!,
});

/** Lifecycle of the backend process this session talks to. */
export type BackendStatus =
  | { state: 'booting' }
  | { state: 'online' }
  | { state: 'exited'; code: number };

/**
 * The module's diagnostics — agda's warnings and non-fatal errors, two
 * flavors of the same thing (agda classifies the error-ish ones via
 * `errorWarnings` in `Agda.Interaction.Options.Warnings`; termination and
 * coverage failures live here). This is *module state*, not a command
 * result: agda accumulates it while checking and replays it inside every
 * AllGoalsWarnings snapshot — every command that ends in a goals display
 * (`Cmd_load`, `Cmd_give`, `Cmd_metas` … all finish by interpreting
 * `Cmd_metas`, see `Agda.Interaction.InteractionTop`) carries the same
 * list. Each snapshot replaces this wholesale.
 */
export interface SessionDiagnostics {
  /** Benign warning messages. */
  warnings: string[];
  /** Non-fatal error messages (termination, coverage, …). */
  errors: string[];
}

export interface SessionState {
  /** The backend process: booting → online, or exited with its code. */
  backend: BackendStatus;
  /** A command is currently streaming responses. */
  busy: boolean;
  /** Progress lines for the current command (cleared on command start). */
  runningInfo: string[];
  /**
   * The failure of the *command* itself — the exception that aborted it (a
   * DisplayInfo Error: parse error, a give's type error, …). Distinct from
   * {@link SessionState.diagnostics}, which holds the module's persistent
   * check state; a command can fail with no module errors, and a module can
   * carry errors while every command succeeds.
   */
  error?: string;
  /**
   * The module's current warnings/non-fatal errors, replaced by every
   * AllGoalsWarnings snapshot (cleared on command start — a command that
   * ends without a snapshot leaves the module state unknown, not stale).
   */
  diagnostics: SessionDiagnostics;
  /** Type-checked without errors per the last load's Status response. */
  checked: boolean;
}

export const setBusy = StateEffect.define<boolean>();
export const setError = StateEffect.define<string | undefined>();
export const setChecked = StateEffect.define<boolean>();
export const setDiagnostics = StateEffect.define<SessionDiagnostics>();
export const appendRunningInfo = StateEffect.define<string>();
export const clearRunningInfo = StateEffect.define<null>();
export const setBackendStatus = StateEffect.define<BackendStatus>();

export const sessionModelField = StateField.define<SessionState>({
  create: () => ({
    backend: { state: 'booting' },
    busy: false,
    checked: false,
    runningInfo: [],
    diagnostics: { warnings: [], errors: [] },
  }),
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setBusy)) {
        next = { ...next, busy: effect.value };
      } else if (effect.is(setError)) {
        next = { ...next, error: effect.value };
      } else if (effect.is(setChecked)) {
        next = { ...next, checked: effect.value };
      } else if (effect.is(setDiagnostics)) {
        next = { ...next, diagnostics: effect.value };
      } else if (effect.is(appendRunningInfo)) {
        next = { ...next, runningInfo: [...next.runningInfo, effect.value] };
      } else if (effect.is(clearRunningInfo)) {
        next = { ...next, runningInfo: [] };
      } else if (effect.is(setBackendStatus)) {
        next = { ...next, backend: effect.value };
      }
    }
    // A user edit makes the checked result stale — invalidation is a
    // projection of the document, so it happens here instead of at the
    // command layer. System transactions (load's hole expansion, give's
    // replacement) carry the authoritative state agda just confirmed, so
    // they keep checked; without this, load would clear its own verdict
    // (Status arrives before the End commit that expands the holes).
    if (tr.docChanged && !tr.annotation(systemTransaction)) {
      next = { ...next, checked: false };
    }
    return next;
  },
});

/** Read the session state (fields default when the extension is absent). */
export function getSession(state: { field<T>(f: StateField<T>): T }): SessionState {
  return state.field(sessionModelField);
}

// ---------------------------------------------------------------------------
// Session transactions — the only entry points that change the session state
// ---------------------------------------------------------------------------

/**
 * Mark the session busy and clear the previous command's error,
 * diagnostics, and runningInfo — a fresh conversation; any AllGoalsWarnings
 * that streams in re-establishes the module's diagnostics.
 */
export function commandStartTransaction(): TransactionSpec {
  return {
    effects: [
      setBusy.of(true),
      setError.of(undefined),
      setDiagnostics.of({ warnings: [], errors: [] }),
      clearRunningInfo.of(null),
    ],
  };
}

/** Mark the session idle again, keeping the final error and runningInfo. */
export function commandEndTransaction(): TransactionSpec {
  return { effects: [setBusy.of(false)] };
}

/** Append a progress message (a RunningInfo payload) to the runningInfo. */
export function runningInfoTransaction(message: string): TransactionSpec {
  return { effects: [appendRunningInfo.of(message)] };
}

/** Clear the progress runningInfo (ClearRunningInfo payload). */
export function clearRunningInfoTransaction(): TransactionSpec {
  return { effects: [clearRunningInfo.of(null)] };
}

/** Surface an error message (a DisplayInfo Error payload). */
export function errorTransaction(message: string): TransactionSpec {
  return { effects: [setError.of(message)] };
}

/**
 * Replace the module diagnostics (an AllGoalsWarnings snapshot's warnings
 * and errors arrays, messages only). A full snapshot every time — never
 * merged, so a healed module clears its diagnostics with the same
 * transaction that re-reports its goals.
 */
export function diagnosticsTransaction(diagnostics: SessionDiagnostics): TransactionSpec {
  return { effects: [setDiagnostics.of(diagnostics)] };
}

/** Record the load stream's Status verdict: type-checked without errors. */
export function checkedTransaction(checked: boolean): TransactionSpec {
  return { effects: [setChecked.of(checked)] };
}

/** The backend finished booting and is serving commands. */
export function backendOnlineTransaction(): TransactionSpec {
  return { effects: [setBackendStatus.of({ state: 'online' })] };
}

/** A backend (re)boot started. */
export function backendBootingTransaction(): TransactionSpec {
  return { effects: [setBackendStatus.of({ state: 'booting' })] };
}

/** The backend process terminated with `code`. */
export function backendExitTransaction(code: number): TransactionSpec {
  return { effects: [setBackendStatus.of({ state: 'exited', code })] };
}
