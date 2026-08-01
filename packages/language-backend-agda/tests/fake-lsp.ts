/**
 * FakeLspTransport — in-process LspTransport stand-in for session unit tests.
 *
 * Captures all sent messages (filterable via `agdaCommands`), auto-responds to
 * client→server Requests (initialize → capabilities; `agda` → null, like ALS)
 * so LspClient.start()/request() resolve, and lets tests inject synthetic
 * AgdaResponse values through a real `LspClient`.
 *
 * Pair with `createFakeLsp()` to get a wired `{ lsp, transport }` tuple.
 */

import type { LspTransport } from '@playground/lsp';
import { LspClient } from '@playground/lsp';

export class FakeLspTransport implements LspTransport {
  sent: Record<string, unknown>[] = [];
  private _handlers = new Set<(m: Record<string, unknown>) => void>();
  private _nextSrvId = 0;

  send(msg: Record<string, unknown>): void {
    this.sent.push(msg);
    // Auto-respond to any client→server Request (method + id) so
    // LspClient.request() resolves. initialize gets capabilities; the `agda`
    // command channel (and any other method) replies null like real ALS.
    // Deferred so LspClient registers the pending entry before the Response.
    const method = msg.method;
    if (typeof method === 'string' && 'id' in msg) {
      const id = msg.id as number;
      const result = method === 'initialize' ? { capabilities: {} } : null;
      queueMicrotask(() => {
        for (const h of this._handlers) {
          h({ jsonrpc: '2.0', id, result });
        }
      });
    }
  }

  onMessage(h: (m: Record<string, unknown>) => void): () => void {
    this._handlers.add(h);
    return () => {
      this._handlers.delete(h);
    };
  }

  /** Agda commands sent via sendMessage({ method:'agda', params:{ tag:'CmdReq', contents } }). */
  get agdaCommands(): Array<{ raw: string }> {
    return this.sent
      .filter(m => m.method === 'agda')
      .map(m => ({
        raw: (m.params as { tag: string; contents?: string } | undefined)?.contents ?? '',
      }));
  }

  /** Inject a server→client `agda` Request with raw wire params. */
  injectWire(params: Record<string, unknown>): void {
    const msg = {
      jsonrpc: '2.0',
      id: ++this._nextSrvId,
      method: 'agda',
      params,
    };
    for (const h of this._handlers) h(msg);
  }

  /** Inject a native agda response wrapped in ResponseJSONRaw. */
  injectNative(inner: Record<string, unknown>): void {
    this.injectWire({ tag: 'ResponseJSONRaw', contents: inner });
  }

  /** Inject an End sentinel (bare ResponseEnd, ALS-injected). */
  injectEnd(): void {
    this.injectWire({ tag: 'ResponseEnd' });
  }
}

/** Wires a fresh FakeLspTransport to a real LspClient. */
export function createFakeLsp(): { lsp: LspClient; transport: FakeLspTransport } {
  const transport = new FakeLspTransport();
  const lsp = new LspClient(transport);
  return { lsp, transport };
}
