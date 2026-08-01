import { getAssetInfo, resolveAssetPath, resolveAssetUrl } from '@playground/vendor-assets';

/** Vendor-assets family id for the ALS wasm binaries. */
export const ALS_WASM_FAMILY = 'als-wasm';

/** Default variant (asset) within the family. */
export const DEFAULT_ALS_WASM_VARIANT = 'opt';

/** Default ALS workspace path. Drives rootUri and source-path base. */
export const DEFAULT_ALS_WORKSPACE = '/root/workspace';

/** Default LSP client capabilities declared to ALS during initialize handshake. */
export const DEFAULT_ALS_CLIENT_CAPABILITIES = {
  textDocument: {
    publishDiagnostics: {},
    hover: {
      contentFormat: ['markdown', 'plaintext'],
    },
  },
};

/** Default program string for a run env backend. Interpretation follows
 *  {@link Command.program}: web-wasi → wasm URL, node-wasi → absolute host
 *  path, node-native → binary name (PATH). */
export function defaultAlsProgram(runEnvName: string): string {
  switch (runEnvName) {
    case 'web-wasi':
      return resolveAssetUrl(ALS_WASM_FAMILY, DEFAULT_ALS_WASM_VARIANT);
    case 'node-wasi':
      return resolveAssetPath(ALS_WASM_FAMILY, DEFAULT_ALS_WASM_VARIANT);
    case 'node-native':
      return 'als';
    default:
      throw new Error(`defaultAlsProgram: unknown run env name '${runEnvName}'`);
  }
}

/** Default path for the ALS data dir (`Agda_datadir`).
 *  web-wasi and node-wasi run the same versioned wasm, so both live under a
 *  versioned dir (kept apart from other als versions in a shared Vfs).
 *  node-native runs the host `als` binary, so its data dir lives in a fixed
 *  global temp dir. */
export function defaultAgdaDataDir(runEnvName: string): string {
  switch (runEnvName) {
    case 'web-wasi':
    case 'node-wasi': {
      const version = getAssetInfo(ALS_WASM_FAMILY, DEFAULT_ALS_WASM_VARIANT).version;
      return `/data/builtins/${ALS_WASM_FAMILY}-${version}-${DEFAULT_ALS_WASM_VARIANT}`;
    }
    case 'node-native':
      return '/tmp/als-builtin';
    default:
      throw new Error(`defaultAgdaDataDir: unknown run env name '${runEnvName}'`);
  }
}

/** Default HOME for the ALS process, keyed on run env backend. wasi backends
 *  run in a guest fs rooted at '/root'; node-native uses the current host
 *  HOME. */
export function defaultHome(runEnvName: string): string {
  switch (runEnvName) {
    case 'web-wasi':
    case 'node-wasi':
      return '/root';
    case 'node-native':
      return process.env.HOME ?? '';
    default:
      throw new Error(`defaultHome: unknown run env name '${runEnvName}'`);
  }
}
