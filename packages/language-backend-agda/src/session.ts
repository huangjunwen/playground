/**
 * AlsSession — drives ALS's custom `agda` command channel over LSP.
 *
 * ALS carries IOTCM commands and their results over a bespoke `agda` message
 * in both directions: the client sends a command as an `agda` request, and the
 * server streams each Agda response back as a separate server→client `agda`
 * request (acknowledged with null). This class adapts that channel to two
 * command APIs:
 *
 * - `stream()`: an AsyncGenerator that yields each response as it arrives,
 *   stopping at ResponseEnd / ResponseDoneExiting without yielding them.
 *   Caller can consume progressively without waiting for the whole response set.
 *
 * - `request()`: classic batched API that collects all responses into an array
 *   (built on top of stream()).
 *
 * Commands are serialised via an async lock: each call acquires the lock,
 * sends the command, and releases on return (or early consumer break).
 */

import type { LspClient } from '@playground/lsp';
import type { IOTCMCommand } from './protocol/commands';
import { parseAgdaResponse } from './protocol/parser';
import type { AgdaResponse } from './protocol/responses';

export class AlsSession {
  readonly lspClient: LspClient;
  private _tail: Promise<void> | null = null;
  private _handle: ((resp: AgdaResponse) => void) | null = null;

  constructor(client: LspClient) {
    this.lspClient = client;
    client.onServerRequest('agda', params => {
      const resp = parseAgdaResponse(params);
      this._handle?.(resp);
      return null;
    });
  }

  /** Send a command; resolves with all responses collected. */
  async request(command: IOTCMCommand): Promise<AgdaResponse[]> {
    const all: AgdaResponse[] = [];
    for await (const r of this.stream(command)) all.push(r);
    return all;
  }

  /** Send a command and yield each response as it arrives. Stops at ResponseEnd / DoneExiting without yielding the terminal sentinel. */
  async *stream(command: IOTCMCommand): AsyncGenerator<AgdaResponse> {
    const prev = this._tail;
    let next!: () => void;
    this._tail = new Promise<void>(r => {
      next = r;
    });
    if (prev) await prev;

    const queue: AgdaResponse[] = [];
    let notify: (() => void) | null = null;
    let done = false;

    this._handle = (resp: AgdaResponse) => {
      queue.push(resp);
      if (resp.kind === 'End' || resp.kind === 'DoneExiting') done = true;
      notify?.();
    };

    try {
      try {
        await this.lspClient.request('agda', { tag: 'CmdReq', contents: command.raw });
      } catch {
        /* transport error — drain remaining */
      }

      while (true) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        if (done) return;
        await new Promise<void>(r => {
          notify = r;
        });
      }
    } finally {
      this._handle = null;
      next();
    }
  }
}
