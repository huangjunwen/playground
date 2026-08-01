/**
 * FakeRunEnv — in-process RunEnv for `runAls` unit tests.
 *
 * Replaces a real wasm/native backend with an in-memory Fs and a RunHandle
 * whose stdout speaks LSP/JSON-RPC over `Content-Length` framing. The fake
 * server auto-responds to client→server requests (initialize → capabilities,
 * any other method → null, like ALS) so `runAls`'s initialize handshake
 * resolves without a real ALS binary.
 *
 * Captures every Command and every client→server message for assertions.
 * `als --setup` handles have their exit auto-resolved (setup is a one-shot
 * the runner awaits); the main (`als --raw`) handle stays alive like a real
 * server — close it via {@link FakeRunEnv.closeAll} to unwind the transport
 * read loop at teardown.
 */

import { encodeLspMessage, LspFrameDecoder } from '@playground/lsp';
import type { Command, DirEntry, Fs, RunEnv, RunHandle, StatInfo } from '@playground/run-env';

/** Minimal in-memory Fs — supports the sentinel stat/writeFile path. */
class MemFs implements Fs {
  private readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>(['/']);

  async readFile(path: string): Promise<Uint8Array> {
    const f = this.files.get(path);
    if (!f) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }
  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }
  async stat(path: string): Promise<StatInfo> {
    const f = this.files.get(path);
    if (f) return { size: f.byteLength, isDirectory: false };
    if (this.dirs.has(path)) return { size: 0, isDirectory: true };
    throw new Error(`ENOENT: ${path}`);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.dirs.delete(path);
  }
  async listDir(): Promise<DirEntry[]> {
    return [];
  }
  async rename(oldPath: string, newPath: string): Promise<void> {
    const f = this.files.get(oldPath);
    if (f) {
      this.files.set(newPath, f);
      this.files.delete(oldPath);
    }
  }
}

/** RunHandle whose stdout is driven by a fake LSP server. */
export interface FakeRunHandle extends RunHandle {
  /** Client→server messages decoded from stdin (requests + notifications). */
  readonly sent: Record<string, unknown>[];
  /** Resolve the exit promise (simulates process exit). */
  resolveExit(code: number): void;
  /** Close stdout — unwinds the transport's read loop. */
  close(): void;
}

function createFakeRunHandle(): FakeRunHandle {
  const sent: Record<string, unknown>[] = [];
  let stdoutCtrl!: ReadableStreamDefaultController<ArrayBuffer>;

  const stdout = new ReadableStream<ArrayBuffer>({
    start(c) {
      stdoutCtrl = c;
    },
  });

  const decoder = new LspFrameDecoder(msg => {
    if (msg && typeof msg === 'object') handleClientMessage(msg as Record<string, unknown>);
  });

  const stdin = new WritableStream<ArrayBuffer>({
    write(chunk) {
      decoder.push(new Uint8Array(chunk));
    },
  });

  function sendToClient(msg: Record<string, unknown>): void {
    stdoutCtrl.enqueue(encodeLspMessage(msg).buffer as ArrayBuffer);
  }

  function handleClientMessage(msg: Record<string, unknown>): void {
    sent.push(msg);
    if ('id' in msg && 'method' in msg) {
      const result = msg.method === 'initialize' ? { capabilities: {} } : null;
      sendToClient({ jsonrpc: '2.0', id: msg.id, result });
    }
  }

  const stderr = new ReadableStream<ArrayBuffer>({
    start(c) {
      c.close();
    },
  });

  let exitResolve!: (code: number) => void;
  const exit = new Promise<number>(resolve => {
    exitResolve = resolve;
  });

  return {
    stdin,
    stdout,
    stderr,
    exit,
    sent,
    resolveExit: exitResolve,
    close: () => stdoutCtrl.close(),
  };
}

/** In-process RunEnv for runAls unit tests. */
export class FakeRunEnv implements RunEnv {
  readonly name: string;
  readonly fs: Fs = new MemFs();
  readonly commands: Command[] = [];
  readonly runHandles: FakeRunHandle[] = [];
  terminated = false;

  constructor(name = 'web-wasi') {
    this.name = name;
  }

  run(cmd: Command): RunHandle {
    const handle = createFakeRunHandle();
    this.commands.push(cmd);
    this.runHandles.push(handle);
    // `als --setup` is a one-shot whose exit the runner awaits before phase 2.
    if (cmd.args.includes('--setup')) {
      queueMicrotask(() => handle.resolveExit(0));
    }
    return handle;
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Close every handle's stdout — call in afterEach to unwind read loops. */
  closeAll(): void {
    for (const h of this.runHandles) h.close();
  }

  /** The phase-2 (`als --raw`) handle: the last one run. */
  get mainHandle(): FakeRunHandle | undefined {
    return this.runHandles[this.runHandles.length - 1];
  }

  /** True if a setup phase ran (sentinel was missing). */
  get ranSetup(): boolean {
    return this.commands.some(c => c.args.includes('--setup'));
  }
}
