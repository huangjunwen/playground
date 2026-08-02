/**
 * Unit tests for defaults.ts — env.name-driven resolution of program,
 * Agda_datadir, and HOME; plus the exported constants.
 *
 * `@playground/vendor-assets` is mocked so these tests are hermetic (they do
 * not depend on the ~90 MB wasm being vendored locally) while still proving
 * the wiring: each default calls the right resolver with ALS_WASM_FAMILY +
 * DEFAULT_ALS_WASM_VARIANT, and the data-dir format embeds the asset version.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@playground/vendor-assets', () => ({
  resolveAssetUrl: (family: string, asset: string) => `mock-url:${family}/${asset}`,
  resolveAssetPath: (family: string, asset: string) => `/mock/path/${family}/${asset}`,
  getAssetInfo: (family: string, asset: string) => ({
    family,
    version: 'vMOCK',
    asset,
    filename: 'mock.wasm',
  }),
}));

import {
  ALS_WASM_FAMILY,
  DEFAULT_ALS_CLIENT_CAPABILITIES,
  DEFAULT_ALS_WASM_VARIANT,
  DEFAULT_ALS_WORKSPACE,
  defaultAgdaDataDir,
  defaultAlsProgram,
  defaultHome,
} from '../src/defaults';

const isNode = typeof process !== 'undefined';

describe('constants', () => {
  it('exposes the wasm family + default variant', () => {
    expect(ALS_WASM_FAMILY).toBe('als-wasm');
    expect(DEFAULT_ALS_WASM_VARIANT).toBe('opt');
  });

  it('exposes the default workspace path', () => {
    expect(DEFAULT_ALS_WORKSPACE).toBe('/root/workspace');
  });

  it('exposes default client capabilities (publishDiagnostics + hover)', () => {
    expect(DEFAULT_ALS_CLIENT_CAPABILITIES).toEqual({
      textDocument: {
        publishDiagnostics: {},
        hover: { contentFormat: ['markdown', 'plaintext'] },
      },
    });
  });
});

describe('defaultAlsProgram', () => {
  it('resolves web-wasi to a wasm URL via resolveAssetUrl', () => {
    expect(defaultAlsProgram('web-wasi')).toBe(
      `mock-url:${ALS_WASM_FAMILY}/${DEFAULT_ALS_WASM_VARIANT}`,
    );
  });

  it('resolves node-wasi to a host path via resolveAssetPath', () => {
    expect(defaultAlsProgram('node-wasi')).toBe(
      `/mock/path/${ALS_WASM_FAMILY}/${DEFAULT_ALS_WASM_VARIANT}`,
    );
  });

  it('resolves node-native to the bare binary name', () => {
    expect(defaultAlsProgram('node-native')).toBe('als');
  });

  it('throws on an unknown run env name', () => {
    expect(() => defaultAlsProgram('deno')).toThrow(/unknown run env name 'deno'/);
  });
});

describe('defaultAgdaDataDir', () => {
  const versioned = `/data/builtins/${ALS_WASM_FAMILY}-vMOCK-${DEFAULT_ALS_WASM_VARIANT}`;

  it('web-wasi and node-wasi share the versioned dir (same wasm binary)', () => {
    expect(defaultAgdaDataDir('web-wasi')).toBe(versioned);
    expect(defaultAgdaDataDir('node-wasi')).toBe(versioned);
    expect(defaultAgdaDataDir('web-wasi')).toBe(defaultAgdaDataDir('node-wasi'));
  });

  it('node-native uses a fixed global temp dir', () => {
    expect(defaultAgdaDataDir('node-native')).toBe('/tmp/als-builtin');
  });

  it('throws on an unknown run env name', () => {
    expect(() => defaultAgdaDataDir('deno')).toThrow(/unknown run env name 'deno'/);
  });
});

describe('defaultHome', () => {
  it('wasi backends run in a guest fs rooted at /root', () => {
    expect(defaultHome('web-wasi')).toBe('/root');
    expect(defaultHome('node-wasi')).toBe('/root');
  });

  it.skipIf(!isNode)('node-native derives HOME from the current process env', () => {
    const saved = process.env.HOME;
    try {
      process.env.HOME = '/users/test';
      expect(defaultHome('node-native')).toBe('/users/test');
    } finally {
      process.env.HOME = saved;
    }
  });

  it.skipIf(!isNode)('node-native falls back to empty string when HOME is unset', () => {
    const saved = process.env.HOME;
    try {
      delete process.env.HOME;
      expect(defaultHome('node-native')).toBe('');
    } finally {
      process.env.HOME = saved;
    }
  });

  it('throws on an unknown run env name', () => {
    expect(() => defaultHome('deno')).toThrow(/unknown run env name 'deno'/);
  });
});
