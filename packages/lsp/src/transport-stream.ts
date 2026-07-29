/** LSP message transport over byte streams (ReadableStream / WritableStream). */

import { encodeLspMessage, LspFrameDecoder } from './frame-codec';
import type { LspTransport } from './transport';

/** LspTransport backed by byte streams — transport-agnostic, works with any WritableStream/ReadableStream pair. */
export class ByteStreamLspTransport implements LspTransport {
  private readonly decoder!: LspFrameDecoder;
  private readonly handlers = new Set<(msg: Record<string, unknown>) => void>();
  private readonly inputWriter: WritableStreamDefaultWriter<ArrayBuffer>;

  constructor(input: WritableStream<ArrayBuffer>, output: ReadableStream<ArrayBuffer>) {
    this.inputWriter = input.getWriter();
    this.decoder = new LspFrameDecoder(
      msg => {
        if (msg && typeof msg === 'object') {
          this._dispatch(msg as Record<string, unknown>);
        }
      },
      err => console.warn('[lsp-transport]', err),
    );

    const reader = output.getReader();
    void (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          this.decoder.push(new Uint8Array(value));
        }
      } catch {
        // stream closed/errored (e.g. host disposed) — drain silently
      }
    })();
  }

  send(msg: Record<string, unknown>): void {
    void this.inputWriter.write(encodeLspMessage(msg).buffer as ArrayBuffer);
  }

  onMessage(handler: (msg: Record<string, unknown>) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private _dispatch(msg: Record<string, unknown>): void {
    for (const h of this.handlers) {
      try {
        h(msg);
      } catch {
        /* continue to next handler */
      }
    }
  }
}
