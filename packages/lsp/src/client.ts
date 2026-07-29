/** Generic LSP client: JSON-RPC request/notification API + handshake. */

import type { LspTransport } from './transport';

export interface InitializeParams {
  processId: number | null;
  rootUri: string;
  capabilities: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InitializeResult {
  capabilities: Record<string, unknown>;
  [key: string]: unknown;
}

/** Handler for a server→client Request of a specific method. See {@link LspClient.onServerRequest}. */
export type RequestHandler = (params: unknown) => unknown | Promise<unknown>;

const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

/**
 * Generic LSP client over a {@link LspTransport}. Provides request/notification
 * send/receive pairs mirroring JSON-RPC, plus an `initialize` handshake.
 *
 * `request` auto-assigns an id and tracks the pending Promise; `notify` sends
 * without id. `onServerRequest` / `onServerNotification` register per-method
 * handlers for incoming messages: server Requests get an auto-Response
 * (result/error), unregistered methods get `MethodNotFound` (-32601).
 */
export class LspClient {
  private readonly _transport: LspTransport;
  private _nextId = 1;
  private readonly _pending = new Map<number, Pending>();
  private readonly _reqHandlers = new Map<string, RequestHandler>();
  private readonly _notifHandlers = new Map<string, (params: unknown) => void>();
  private _serverCapabilities: Record<string, unknown> = {};

  constructor(transport: LspTransport) {
    this._transport = transport;
    this._transport.onMessage(msg => this._onMessage(msg));
  }

  /** Server capabilities captured by {@link start}. Empty before handshake. */
  get serverCapabilities(): Record<string, unknown> {
    return this._serverCapabilities;
  }

  /** Perform `initialize` + `initialized` handshake; store server capabilities. `partial` overrides defaults. */
  async start(partial?: Partial<InitializeParams>): Promise<void> {
    const params: InitializeParams = {
      processId: null,
      rootUri: 'file:///',
      capabilities: {},
      ...(partial as Partial<InitializeParams> | undefined),
    };
    const result = await this.request<InitializeResult>('initialize', params);
    this._serverCapabilities = result?.capabilities ? result.capabilities : {};
    this.notify('initialized', {});
  }

  /** Send a client→server Request (auto id) and await the matching Response. */
  request<T>(method: string, params: unknown): Promise<T> {
    const id = this._nextId++;
    return new Promise<T>((resolve, reject) => {
      this._pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Send a client→server Notification (no id, no reply expected). */
  notify(method: string, params: unknown): void {
    this._send({ jsonrpc: '2.0', method, params });
  }

  /**
   * Register a handler for server→client Requests of `method`.
   * Handler return value → auto-sent `{jsonrpc, id, result}`; `return null` is
   * a valid (empty) result — useful for an automatic no-data ACK; throw / reject
   * → `{jsonrpc, id, error:{code:-32603, ...}}`. Unregistered method →
   * `MethodNotFound` (-32601). One handler per method; re-registering replaces.
   * Returns an unsubscribe function.
   */
  onServerRequest(method: string, handler: RequestHandler): () => void {
    this._reqHandlers.set(method, handler);
    return () => {
      if (this._reqHandlers.get(method) === handler) {
        this._reqHandlers.delete(method);
      }
    };
  }

  /**
   * Register a listener for server→client Notifications of `method`.
   * One handler per method; re-registering replaces.
   * Returns an unsubscribe function.
   */
  onServerNotification(method: string, handler: (params: unknown) => void): () => void {
    this._notifHandlers.set(method, handler);
    return () => {
      if (this._notifHandlers.get(method) === handler) {
        this._notifHandlers.delete(method);
      }
    };
  }

  // ---- Internal ----

  private _send(msg: Record<string, unknown>): void {
    this._transport.send(msg);
  }

  private _onMessage(msg: Record<string, unknown>): void {
    // server response
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const id = (msg as { id: number }).id;
      const p = this._pending.get(id);
      if (p) {
        this._pending.delete(id);
        if ('error' in msg) p.reject((msg as { error: unknown }).error);
        else p.resolve((msg as { result: unknown }).result);
      }
      return;
    }
    // server request
    if ('method' in msg && 'id' in msg) {
      void this._handleServerRequest(msg as { id: unknown; method: string; params?: unknown });
      return;
    }
    // server notification
    if ('method' in msg) {
      const { method, params } = msg as { method: string; params?: unknown };
      const h = this._notifHandlers.get(method);
      if (h) {
        try {
          h(params);
        } catch {
          /* isolate handler */
        }
      }
    }
  }

  private async _handleServerRequest(msg: {
    id: unknown;
    method: string;
    params?: unknown;
  }): Promise<void> {
    const { id, method, params } = msg;
    const handler = this._reqHandlers.get(method);
    if (!handler) {
      this._send({
        jsonrpc: '2.0',
        id,
        error: { code: METHOD_NOT_FOUND, message: 'Method not found' },
      });
      return;
    }
    try {
      const result = await handler(params);
      this._send({ jsonrpc: '2.0', id, result });
    } catch (e) {
      this._send({
        jsonrpc: '2.0',
        id,
        error: { code: INTERNAL_ERROR, message: e instanceof Error ? e.message : String(e) },
      });
    }
  }
}
