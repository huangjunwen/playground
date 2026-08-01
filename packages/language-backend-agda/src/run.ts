import { ByteStreamLspTransport, LspClient, type LspTransportMiddleware } from '@playground/lsp';
import type { RunEnv } from '@playground/run-env';
import {
  DEFAULT_ALS_CLIENT_CAPABILITIES,
  DEFAULT_ALS_WORKSPACE,
  defaultAgdaDataDir,
  defaultAlsProgram,
  defaultHome,
} from './defaults';
import { AlsSession } from './session';

/** Interface to a running ALS instance. */
export interface AlsHandle {
  /** Agda command/response session layered over the LSP client. */
  session: AlsSession;
  /** ALS stderr, exposed for diagnostics. */
  log?: ReadableStream<ArrayBuffer>;
  /** Resolves with the process exit code once ALS terminates. */
  exit?: Promise<number>;
}

/** Options for {@link runAls}. */
export interface AlsRunOptions {
  /** Resolved program string (wasm URL / path / binary name). Defaults to the
   *  run env's default program — see {@link defaultAlsProgram}. When passed,
   *  the caller owns the resolution. */
  program?: string;
  /** Override for the ALS data dir (`Agda_datadir`). Defaults to the run env's
   *  default — see {@link defaultAgdaDataDir}. */
  agdaDataDir?: string;
  /** HOME for the ALS process. Defaults to the run env's default — see
   *  {@link defaultHome}. */
  home?: string;
  /** Extra env vars merged over the runner defaults (Agda_datadir, HOME). */
  env?: Record<string, string>;
  /** Wrap the base transport before the LspClient is constructed. */
  onCreateLspTransport?: LspTransportMiddleware;
  /** Runs after the handle is built but before the initialize handshake. */
  onSetup?: (handle: AlsHandle) => void;
  /**
   * Absolute workspace path in the env fs (e.g. '/root/workspace'). Drives the
   * LSP initialize rootUri and is the base callers use to build source paths.
   * Defaults to {@link DEFAULT_ALS_WORKSPACE}.
   */
  lspWorkspace?: string;
  /** Client capabilities declared to ALS during initialize handshake.
   *  Defaults to {@link DEFAULT_ALS_CLIENT_CAPABILITIES}. */
  lspCapabilities?: Record<string, unknown>;
}

/**
 * Run ALS on any {@link RunEnv}. Handles the two-phase lifecycle
 * (setup → main LSP service) and the LSP initialize handshake.
 *
 * The caller owns the `RunEnv` lifecycle (creation and termination) —
 * {@link AlsHandle} has no lifecycle control.
 */
export async function runAls(runEnv: RunEnv, opts: AlsRunOptions = {}): Promise<AlsHandle> {
  const {
    program = defaultAlsProgram(runEnv.name),
    agdaDataDir = defaultAgdaDataDir(runEnv.name),
    home = defaultHome(runEnv.name),
    env,
    onCreateLspTransport,
    onSetup,
    lspWorkspace = DEFAULT_ALS_WORKSPACE,
    lspCapabilities = DEFAULT_ALS_CLIENT_CAPABILITIES,
  } = opts;

  const cmdEnv = { Agda_datadir: agdaDataDir, HOME: home, ...env };
  const sentinel = `${agdaDataDir}/.setup-done`;

  let needsSetup = true;
  try {
    await runEnv.fs.stat(sentinel);
    needsSetup = false;
  } catch {
    /* sentinel missing → setup needed */
  }

  if (needsSetup) {
    console.log('[als-runner] phase 1: als --setup');
    const setupHandle = runEnv.run({ program, args: ['als', '--setup'], env: cmdEnv });
    await setupHandle.exit;
    await runEnv.fs.writeFile(sentinel, new Uint8Array(0));
  }

  console.log('[als-runner] phase 2: als (LSP service)');
  const mainHandle = runEnv.run({ program, args: ['als', '--raw'], env: cmdEnv });
  const base = new ByteStreamLspTransport(mainHandle.stdin, mainHandle.stdout);
  const transport = onCreateLspTransport ? onCreateLspTransport(base) : base;
  const lspClient = new LspClient(transport);
  const handle: AlsHandle = {
    session: new AlsSession(lspClient),
    exit: mainHandle.exit,
    log: mainHandle.stderr,
  };
  onSetup?.(handle);
  await lspClient.start({
    rootUri: `file://${lspWorkspace}`,
    capabilities: lspCapabilities,
  });
  return handle;
}
