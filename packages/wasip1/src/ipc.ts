// IPC abstractions: an RPC interface (request/response) and a unidirectional
// byte-stream interface, both transport-agnostic. Any transport that satisfies
// these interfaces can drive the consumers (e.g. fd-pipe) without change.

// ---- RPC ----

export interface RpcCallOptions {
  /** Per-call timeout in ms; overrides the client default. */
  timeout?: number;
}

export interface RpcClient {
  call<T = unknown>(method: string, args?: unknown[], options?: RpcCallOptions): Promise<T>;
  /** Reject all pending calls and stop listening. */
  dispose(): void;
}

export interface CreateRpcClientOptions {
  /** Default per-call timeout in ms. 0 (default) = no timeout. */
  defaultTimeout?: number;
}

// biome-ignore lint/suspicious/noExplicitAny: RPC dispatch is dynamically typed
export type RpcMethods = Record<string, (...args: any[]) => unknown>;

export interface RpcServer {
  /** Stop listening. */
  dispose(): void;
}

// ---- Stream ----

export interface StreamProvider {
  /** Buffer `chunk` for delivery. The implementation may detach (transfer) it on flush. */
  write(chunk: ArrayBuffer): void;
  /** Signal EOF. Flushes any buffered chunks first. */
  close(): void;
  /** Fail the consumer side. Flushes any buffered chunks first. */
  error(message?: string): void;
  /** Invoked when the consumer cancels. */
  onCancel?: (reason?: string) => void;
}

export interface StreamConsumer {
  /** Request the next chunk. When data is already available returns it directly
   *  (`ArrayBuffer`); otherwise returns a `Promise` that resolves when data
   *  arrives. Returns `null` at EOF.
   *
   *  Errors are raised synchronously (throw) when the implementation detects a
   *  failure inline, or asynchronously (Promise rejection) when the error is
   *  discovered later. Either way the caller uses `await` + try/catch — `await`
   *  converts a sync throw into a rejection just like a Promise rejection.
   *
   *  Single-reader: a second `read()` while one is still pending is an error. */
  read(): Promise<ArrayBuffer | null> | ArrayBuffer | null;
  /** Tell the provider to stop. */
  cancel(reason?: string): void;
}

// ---- Web Stream adapters ----

/** Wrap a provider as a WritableStream<ArrayBuffer>. */
export function toWritableStream(
  provider: StreamProvider,
  strategy?: QueuingStrategy<ArrayBuffer>,
): WritableStream<ArrayBuffer> {
  let controller!: WritableStreamDefaultController;
  return new WritableStream<ArrayBuffer>(
    {
      start(c) {
        controller = c;
        provider.onCancel = reason =>
          controller.error(new Error(`stream cancelled by consumer${reason ? `: ${reason}` : ''}`));
      },
      write(chunk) {
        provider.write(chunk);
      },
      close() {
        provider.close();
      },
      abort(reason) {
        provider.error(reason instanceof Error ? reason.message : String(reason));
      },
    },
    strategy,
  );
}

/** Wrap a consumer as a ReadableStream<ArrayBuffer>. */
export function toReadableStream(
  consumer: StreamConsumer,
  strategy?: QueuingStrategy<ArrayBuffer>,
): ReadableStream<ArrayBuffer> {
  return new ReadableStream<ArrayBuffer>(
    {
      pull(controller) {
        const onValue = (chunk: ArrayBuffer | null) => {
          if (chunk === null) controller.close();
          else controller.enqueue(chunk);
        };
        const onError = (e: unknown) => {
          controller.error(e instanceof Error ? e : new Error(String(e)));
        };
        try {
          const result = consumer.read();
          if (result instanceof Promise) return result.then(onValue, onError);
          onValue(result);
        } catch (e) {
          onError(e);
        }
      },
      cancel(reason) {
        consumer.cancel(String(reason));
      },
    },
    strategy,
  );
}
