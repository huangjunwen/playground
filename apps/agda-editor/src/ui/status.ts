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
 *           empty goals panel composes it. The verdict carries the
 *           item counts behind it — the sidebar row shows them as the
 *           detail suffix, the output panel's diagnostics head reuses
 *           the same formatting.
 */

import type { EditorState } from '@codemirror/state';
import { getSession } from '../model/session-model';

export type BackendView = { label: string; tone: 'booting' | 'online' | 'exited' };

export interface VerdictCounts {
  /** The command exception counts as one error. */
  errors: number;
  warnings: number;
}

export type VerdictView = { kind: 'error' | 'warning' | 'checked'; counts: VerdictCounts };

export interface StatusCluster {
  backend: BackendView;
  busy: boolean;
  verdict?: VerdictView;
}

/** `2 errors, 1 warning` — empty when there is nothing to count. */
export function verdictDetail(counts: VerdictCounts): string {
  const parts: string[] = [];
  if (counts.errors > 0) parts.push(`${counts.errors} error${counts.errors === 1 ? '' : 's'}`);
  if (counts.warnings > 0)
    parts.push(`${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}`);
  return parts.join(', ');
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
    const counts: VerdictCounts = {
      errors: session.diagnostics.errors.length + (session.error === undefined ? 0 : 1),
      warnings: session.diagnostics.warnings.length,
    };
    if (counts.errors > 0) {
      verdict = { kind: 'error', counts };
    } else if (counts.warnings > 0) {
      verdict = { kind: 'warning', counts };
    } else if (session.checked) {
      verdict = { kind: 'checked', counts };
    }
  }

  return { backend, busy: session.busy, verdict };
}
