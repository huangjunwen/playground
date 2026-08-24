/**
 * LSP wire events — the application-level consumer of the backend event
 * hooks. The backend stays dumb: onLspFrame and onLspLog only report raw
 * frames and lines. This module is the single place that owns the
 * event-kind vocabulary for the LSP wire (lsp::i / lsp::o / lsp::e),
 * turning each report into an observability-model event spec.
 */

import type { TransactionSpec } from '@codemirror/state';
import { appendEventTransaction } from '../model/observability-model';

/**
 * Debug event for one wire frame: `lsp::o` when the client sends it
 * to the server, `lsp::i` when it arrives from the server.
 */
export function lspFrameEvent(outgoing: boolean, msg: Record<string, unknown>): TransactionSpec {
  return appendEventTransaction('debug', `lsp::${outgoing ? 'o' : 'i'}`, msg);
}

/**
 * Debug event for one line the LSP server process wrote to its
 * error stream (`lsp::e`).
 */
export function lspLogEvent(line: string): TransactionSpec {
  return appendEventTransaction('debug', 'lsp::e', { line });
}
