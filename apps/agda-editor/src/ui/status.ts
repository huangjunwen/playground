/**
 * Status cluster — orthogonal projections of the session model, one
 * per session-panel line. Nothing is masked by anything else:
 *
 *  backend  the process lifecycle: booting / online / exited (code N)
 *  busy     a command is streaming — the spinner icon; absent = idle
 *  verdict  present only when idle and only when agda has one worth
 *           showing: an error (the command's exception or the module's
 *           non-fatal check errors), a warning (the module's benign
 *           warnings), or a clean check (a running command has no
 *           verdict yet, and a stale/no-verdict state renders nothing).
 *           "All Done" is not a verdict of its own: checked plus an
 *           empty goals panel composes it.
 */

import type { EditorState } from '@codemirror/state';
import { getSession } from '../model/session-model';

export type BackendView = { label: string; tone: 'booting' | 'online' | 'exited' };

export type VerdictView = { kind: 'error' | 'warning' | 'checked' };

export interface StatusCluster {
  backend: BackendView;
  busy: boolean;
  verdict?: VerdictView;
}

export function statusCluster(state: EditorState): StatusCluster {
  const session = getSession(state);
  const backend: BackendView =
    session.backend.state === 'online'
      ? { label: 'online', tone: 'online' }
      : session.backend.state === 'booting'
        ? { label: 'booting', tone: 'booting' }
        : { label: `exited (${session.backend.code})`, tone: 'exited' };

  let verdict: VerdictView | undefined;
  if (!session.busy) {
    if (session.error !== undefined || session.diagnostics.errors.length > 0) {
      verdict = { kind: 'error' };
    } else if (session.diagnostics.warnings.length > 0) {
      verdict = { kind: 'warning' };
    } else if (session.checked) {
      verdict = { kind: 'checked' };
    }
  }

  return { backend, busy: session.busy, verdict };
}
