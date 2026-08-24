import { getAssetInfo, listAssets, listFamilies, resolveAssetUrl } from '@playground/vendor-assets';
import { expect, test } from 'vitest';

test('listFamilies returns registered families', () => {
  expect(listFamilies()).toEqual(['als-wasm']);
});

test('listAssets enumerates the declared assets for als-wasm', () => {
  expect(listAssets('als-wasm').sort()).toEqual(['opt', 'raw']);
});

test('getAssetInfo returns the declared metadata for raw + opt', () => {
  const raw = getAssetInfo('als-wasm', 'raw');
  expect(raw.family).toBe('als-wasm');
  expect(raw.version).toBe('v6');
  expect(raw.asset).toBe('raw');
  expect(raw.filename).toBe('als-2.8.0.wasm');
  expect(raw.sha256!).toMatch(/^[0-9a-f]{64}$/);
  expect(raw.sizeBytes).toBeGreaterThan(0);

  const opt = getAssetInfo('als-wasm', 'opt');
  expect(opt.family).toBe('als-wasm');
  expect(opt.version).toBe('v6');
  expect(opt.asset).toBe('opt');
  expect(opt.filename).toBe('als-2.8.0-opt.wasm');
  expect(opt.sha256!).toMatch(/^[0-9a-f]{64}$/);
  expect(opt.sizeBytes).toBeGreaterThan(0);
});

test('unknown family / asset throws', () => {
  expect(() => listAssets('sqlite-wasm')).toThrow(/Unknown vendor-assets family/);
  expect(() => getAssetInfo('als-wasm', 'debug')).toThrow(/Unknown vendor-assets asset/);
});

test('resolveAssetUrl serves the optimized wasm; raw has no URL', () => {
  const opt = resolveAssetUrl('als-wasm', 'opt');
  expect(typeof opt).toBe('string');
  expect(opt.length).toBeGreaterThan(0);
  // The raw (unoptimized) variant is not globbed into the bundle — node-side
  // callers use resolveAssetPath.
  expect(() => resolveAssetUrl('als-wasm', 'raw')).toThrow(/No vendored file/);
});
