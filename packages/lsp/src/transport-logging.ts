/** LspTransport decorator that taps inbound/outbound messages for observation. */

import type { LspTransport } from './transport';

/** Sink for observed messages. `dir` is 'out' for send, 'in' for received. */
export type LspLogSink = (dir: 'out' | 'in', msg: Record<string, unknown>) => void;

const defaultSink: LspLogSink = (dir, msg) => {
  console.debug(`[lsp ${dir}]`, msg);
};

/** Wraps a transport, logging every outbound send and inbound message. */
export class LoggingTransport implements LspTransport {
  private readonly _inner: LspTransport;
  private readonly _log: LspLogSink;

  constructor(inner: LspTransport, log: LspLogSink = defaultSink) {
    this._inner = inner;
    this._log = log;
    this._inner.onMessage(msg => {
      this._log('in', msg);
    });
  }

  send(msg: Record<string, unknown>): void {
    this._log('out', msg);
    this._inner.send(msg);
  }

  onMessage(handler: (msg: Record<string, unknown>) => void): () => void {
    return this._inner.onMessage(handler);
  }
}
