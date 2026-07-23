// MessagePort/Worker implementation of the ipc.ts abstractions (RPC + stream),
// plus the `transfer()` marker for zero-copy ArrayBuffer moves across postMessage.

import type {
  CreateRpcClientOptions,
  RpcCallOptions,
  RpcClient,
  RpcMethods,
  RpcServer,
  StreamConsumer,
  StreamProvider,
} from './ipc';

type Transport = Worker | MessagePort;

// ---- Wire format ----

interface RpcRequest {
  id: number;
  method: string;
  args: unknown[];
}

interface RpcError {
  name: string;
  message: string;
  /** Structured data preserved across the wire (e.g. { errno: 44 } for FsError). */
  payload?: unknown;
}

interface RpcResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: RpcError;
}

interface StreamError {
  kind: 'error';
  message: string;
}

interface StreamCancel {
  kind: 'cancel';
  reason?: string;
}

// ---- Transfer marker ----

class Transfer<T extends Transferable> {
  constructor(readonly value: T) {}
}

/** Mark a value to be transferred (zero-copy) instead of structured-cloned. */
export function transfer<T extends Transferable>(value: T): Transfer<T> {
  return new Transfer(value);
}

// ---- Helpers ----

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Peel every `Transfer` marker in `node` (in place) and collect payloads into `out`.
 *  A container (object/Map/Set) is structured-cloned, but an ArrayBuffer nested
 *  inside it is still transferred — it appears in the transfer list. */
function unwrapTransfers(node: unknown, out: Transferable[]): unknown {
  if (node instanceof Transfer) {
    out.push(node.value);
    return node.value;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      node[i] = unwrapTransfers(node[i], out) as unknown;
    }
    return node;
  }
  if (node instanceof Map) {
    for (const [key, val] of node) {
      const unwrapped = unwrapTransfers(val, out);
      if (unwrapped !== val) node.set(key, unwrapped);
    }
    return node;
  }
  if (node instanceof Set) {
    const rebuilt: unknown[] = [];
    let changed = false;
    for (const item of node) {
      const unwrapped = unwrapTransfers(item, out);
      if (unwrapped !== item) changed = true;
      rebuilt.push(unwrapped);
    }
    if (changed) {
      node.clear();
      for (const v of rebuilt) node.add(v);
    }
    return node;
  }
  if (isPlainObject(node)) {
    for (const key of Object.keys(node)) {
      node[key] = unwrapTransfers(node[key], out);
    }
    return node;
  }
  return node;
}

// ---- RPC client ----

export function createRpcClient(
  transport: Transport,
  options: CreateRpcClientOptions = {},
): RpcClient {
  const defaultTimeout = options.defaultTimeout ?? 0;
  let nextId = 0;

  interface PendingEntry {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }
  const pending = new Map<number, PendingEntry>();

  const onMessage = (e: MessageEvent): void => {
    const resp = e.data as RpcResponse | undefined;
    if (!resp || typeof resp.id !== 'number') return;
    const entry = pending.get(resp.id);
    if (!entry) return; // Late response: call already settled (timed out or disposed)
    pending.delete(resp.id);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (resp.ok) {
      entry.resolve(resp.result);
      return;
    }
    const err = resp.error;
    entry.reject(
      err
        ? Object.assign(new Error(err.message), { name: err.name, payload: err.payload })
        : new Error('no error information'),
    );
  };

  transport.addEventListener('message', onMessage as EventListener);
  const startable = transport as { start?: () => void };
  if (startable.start) startable.start();

  function call<T = unknown>(
    method: string,
    args?: unknown[],
    callOpts?: RpcCallOptions,
  ): Promise<T> {
    const id = nextId++;
    const reqArgs = args ? [...args] : [];
    const transferList: Transferable[] = [];
    unwrapTransfers(reqArgs, transferList);
    const req: RpcRequest = { id, method, args: reqArgs };
    const p = new Promise<T>((resolve, reject) => {
      const entry: PendingEntry = {
        resolve: resolve as (v: unknown) => void,
        reject,
      };
      pending.set(id, entry);
      const timeout = callOpts?.timeout ?? defaultTimeout;
      if (timeout > 0) {
        entry.timer = setTimeout(() => {
          if (!pending.delete(id)) return;
          reject(new Error(`rpc '${method}' timed out after ${timeout}ms`));
        }, timeout);
      }
      transport.postMessage(req, transferList);
    });
    // Dispose/timeout reject pending calls asynchronously; pre-attach a no-op
    // rejection handler so the browser does not report "Uncaught (in promise)"
    // for fire-and-forget callers. Awaiters still observe the rejection.
    p.catch(() => {});
    return p;
  }

  function dispose(): void {
    transport.removeEventListener('message', onMessage as EventListener);
    for (const entry of pending.values()) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.reject(new Error('rpc client disposed'));
    }
    pending.clear();
  }

  return { call, dispose };
}

// ---- RPC server ----

export function createRpcServer(transport: Transport, methods: RpcMethods): RpcServer {
  const onMessage = (e: MessageEvent): void => {
    const req = e.data as RpcRequest | undefined;
    if (!req || typeof req.id !== 'number' || typeof req.method !== 'string') return;

    const fn = methods[req.method];
    if (typeof fn !== 'function') {
      transport.postMessage({
        id: req.id,
        ok: false,
        error: { name: 'TypeError', message: `unknown method '${req.method}'` },
      } as RpcResponse);
      return;
    }

    void (async () => {
      try {
        const raw = await fn(...req.args);
        const transferList: Transferable[] = [];
        const result = unwrapTransfers(raw, transferList);
        transport.postMessage({ id: req.id, ok: true, result } as RpcResponse, transferList);
      } catch (err) {
        const error: RpcError =
          err instanceof Error
            ? {
                name: err.name,
                message: err.message,
                payload: (err as { payload?: unknown }).payload,
              }
            : { name: 'Error', message: String(err) };
        transport.postMessage({ id: req.id, ok: false, error } as RpcResponse);
      }
    })();
  };

  transport.addEventListener('message', onMessage as EventListener);
  const startable = transport as { start?: () => void };
  if (startable.start) startable.start();
  return {
    dispose() {
      transport.removeEventListener('message', onMessage as EventListener);
    },
  };
}

// ---- Stream provider ----

// Sends: ArrayBuffer[] | null(eof) | StreamError
// Receives: StreamCancel
export function createStreamProvider(transport: Transport): StreamProvider {
  let closed = false;
  /** Buffered chunks flushed on the next microtask. An empty array means no
   *  flush is scheduled; the first write of a batch schedules one. */
  let pending: ArrayBuffer[] = [];

  /** Flush all buffered chunks in a single postMessage. Called from a microtask
   *  (for normal writes) or synchronously from close/error (to flush before
   *  the EOF/error marker). */
  function flush(): void {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    transport.postMessage(batch, batch);
  }

  const provider: StreamProvider = {
    onCancel: undefined,
    write(chunk) {
      if (closed) throw new Error('stream provider is closed');
      const wasEmpty = pending.length === 0;
      pending.push(chunk);
      if (wasEmpty) queueMicrotask(flush);
    },
    close() {
      if (closed) return;
      closed = true;
      flush();
      transport.postMessage(null);
      transport.removeEventListener('message', onMessage as EventListener);
    },
    error(message = 'stream error') {
      if (closed) return;
      closed = true;
      flush();
      transport.postMessage({ kind: 'error', message } as StreamError);
      transport.removeEventListener('message', onMessage as EventListener);
    },
  };

  const onMessage = (e: MessageEvent): void => {
    const msg = e.data;
    if (msg && typeof msg === 'object' && (msg as StreamCancel).kind === 'cancel') {
      closed = true;
      transport.removeEventListener('message', onMessage as EventListener);
      provider.onCancel?.((msg as StreamCancel).reason);
    }
  };
  transport.addEventListener('message', onMessage as EventListener);
  const startable = transport as { start?: () => void };
  if (startable.start) startable.start();

  return provider;
}

// ---- Stream consumer ----

/** Thrown by StreamConsumer.read() after cancel(): distinguishes an intentional
 *  teardown from a genuine stream error (mirrors the AbortError convention). */
export class CancelledError extends Error {
  constructor(reason?: string) {
    super(reason ? `stream consumer cancelled: ${reason}` : 'stream consumer cancelled');
    this.name = 'CancelledError';
  }
}

// Sends: StreamCancel
// Receives: ArrayBuffer[] | null(eof) | StreamError
export function createStreamConsumer(transport: Transport): StreamConsumer {
  let eof = false;
  let err: Error | null = null;
  const queue: ArrayBuffer[] = [];
  let pendingReader: {
    resolve: (v: ArrayBuffer | null) => void;
    reject: (e: Error) => void;
  } | null = null;

  const pump = (): void => {
    if (!pendingReader) return;
    if (queue.length > 0) {
      const reader = pendingReader;
      pendingReader = null;
      reader.resolve(queue.shift()!);
      return;
    }
    if (eof) {
      const reader = pendingReader;
      pendingReader = null;
      reader.resolve(null);
      return;
    }
    if (err) {
      const reader = pendingReader;
      pendingReader = null;
      reader.reject(err);
      return;
    }
  };

  const onMessage = (e: MessageEvent): void => {
    const msg = e.data;
    if (Array.isArray(msg)) {
      // Batched delivery from a provider that coalesced multiple writes.
      queue.push(...(msg as ArrayBuffer[]));
    } else if (msg == null) {
      eof = true;
      transport.removeEventListener('message', onMessage as EventListener);
    } else if (typeof msg === 'object' && (msg as StreamError).kind === 'error') {
      err = new Error((msg as StreamError).message);
      transport.removeEventListener('message', onMessage as EventListener);
    }
    pump();
  };
  transport.addEventListener('message', onMessage as EventListener);
  const startable = transport as { start?: () => void };
  if (startable.start) startable.start();

  return {
    read() {
      if (err) throw err;
      if (eof) return null;
      if (pendingReader) throw new Error('StreamConsumer: only one reader allowed at a time');
      if (queue.length > 0) return queue.shift()!;
      return new Promise<ArrayBuffer | null>((resolve, reject) => {
        pendingReader = { resolve, reject };
      });
    },
    cancel(reason) {
      if (err || eof) return;
      err = new CancelledError(reason);
      transport.postMessage({ kind: 'cancel', reason } as StreamCancel);
      transport.removeEventListener('message', onMessage as EventListener);
      pump();
    },
  };
}
