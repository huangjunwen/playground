import {
  type AgdaResponse,
  DEFAULT_ALS_WORKSPACE,
  type IOTCMCommand,
  runAls,
} from '@playground/language-backend-agda';
import type { LspTransport, LspTransportMiddleware } from '@playground/lsp';
import type { RunEnv } from '@playground/run-env';
import { WebWasiRunEnv } from '@playground/run-env/web';

const encoder = new TextEncoder();

/**
 * The slice of {@link AlsSession} the backend forwards to. Declared as an
 * interface so tests can inject a fake; the real {@link AlsSession} is
 * structurally compatible.
 */
export interface AlsSessionLike {
  stream(command: IOTCMCommand): AsyncGenerator<AgdaResponse>;
  request(command: IOTCMCommand): Promise<AgdaResponse[]>;
}

/**
 * The slice of {@link AlsHandle} the backend keeps: the command session
 * plus the optional diagnostics streams. Declared as an interface for the
 * same fake-injection reason; the real {@link AlsHandle} is structurally
 * compatible.
 */
export interface AlsHandleLike {
  session: AlsSessionLike;
  log?: ReadableStream<ArrayBuffer>;
  exit?: Promise<number>;
}

/**
 * Wrap a transport so every outgoing frame (send) and every decoded
 * incoming frame (onMessage subscriptions) is reported to `onFrame`
 * before being forwarded. Pure pass-through otherwise.
 *
 * Exported for tests; {@link Backend.create} is the only app-side caller.
 */
export function lspTapMiddleware(
  onFrame: (outgoing: boolean, msg: Record<string, unknown>) => void,
): LspTransportMiddleware {
  return (inner: LspTransport): LspTransport => ({
    send: msg => {
      onFrame(true, msg);
      inner.send(msg);
    },
    onMessage: handler =>
      inner.onMessage(msg => {
        onFrame(false, msg);
        handler(msg);
      }),
  });
}

/** Split a byte stream into lines and report each one (sans newline). */
export async function stderrLines(
  stream: ReadableStream<ArrayBuffer>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        onLine(buf.slice(0, nl).replace(/\r$/, ''));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
      }
    }
    if (buf.length > 0) onLine(buf);
  } finally {
    reader.releaseLock();
  }
}

export interface BackendOptions {
  workspace?: string;
  /**
   * Override the run-env factory. Defaults to {@link WebWasiRunEnv.create}
   * (browser); tests inject a node run-env instead.
   */
  envFactory?: () => Promise<RunEnv>;
  /**
   * Receives every LSP wire frame in both directions: `outgoing` is true
   * for client → server frames (send), false for server → client.
   */
  onLspFrame?: (outgoing: boolean, msg: Record<string, unknown>) => void;
  /** Receives each line ALS writes to stderr. */
  onLspLog?: (line: string) => void;
  /** Receives the ALS exit code once the process terminates. */
  onLspExit?: (code: number) => void;
}

/**
 * Thin adapter between the editor and the ALS backend.
 *
 * Owns three concerns only:
 *  - lifecycle (create/terminate the run-env + ALS handle),
 *  - sync of a buffer into the worker VFS (per-path), and
 *  - forwarding of command streams.
 *
 * Response interpretation (goals, formatting, telemetry) lives in the
 * caller, NOT here — the backend deliberately stays dumb. The three
 * onLsp* hooks are the only observability it offers; everything else is
 * the caller's business.
 */
export class Backend {
  constructor(
    private readonly runEnv: RunEnv,
    private readonly alsHandle: AlsHandleLike,
  ) {}

  /**
   * Boot the VFS, create the workspace dir, and run `als --setup` +
   * `als --raw`. Caller must {@link terminate} on teardown.
   */
  static async create(opts: BackendOptions): Promise<Backend> {
    const workspace = opts.workspace ?? DEFAULT_ALS_WORKSPACE;
    const runEnv = await (opts.envFactory ?? (() => WebWasiRunEnv.create()))();
    await runEnv.fs.mkdir(workspace, { recursive: true });
    const onCreateLspTransport = opts.onLspFrame ? lspTapMiddleware(opts.onLspFrame) : undefined;
    const alsHandle = await runAls(runEnv, {
      lspWorkspace: workspace,
      onCreateLspTransport,
    });
    if (opts.onLspLog && alsHandle.log) {
      void stderrLines(alsHandle.log, opts.onLspLog).catch(() => {});
    }
    if (opts.onLspExit && alsHandle.exit) {
      alsHandle.exit.then(opts.onLspExit).catch(() => {});
    }
    return new Backend(runEnv, alsHandle);
  }

  /** Write `text` to `path` in the worker VFS. */
  async syncToVfs(path: string, text: string): Promise<void> {
    await this.runEnv.fs.writeFile(path, encoder.encode(text));
  }

  stream(command: IOTCMCommand): AsyncGenerator<AgdaResponse> {
    return this.alsHandle.session.stream(command);
  }

  terminate(): void {
    this.runEnv.terminate();
  }
}
