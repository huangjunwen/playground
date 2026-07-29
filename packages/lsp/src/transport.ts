/** Minimal LSP transport */

export interface LspTransport {
  /**
   * Send a raw LSP message (already-shaped JSON-RPC object) to the peer.
   * Implementations frame the message (e.g. `Content-Length` header) before writing.
   */
  send(msg: Record<string, unknown>): void;

  /**
   * Subscribe to every framed message decoded from the peer.
   * May be called multiple times; each subscription is independent.
   * Returns an unsubscribe function.
   */
  onMessage(handler: (msg: Record<string, unknown>) => void): () => void;
}

/** A transport decorator: wraps a transport and returns a replacement. */
export type LspTransportMiddleware = (inner: LspTransport) => LspTransport;
