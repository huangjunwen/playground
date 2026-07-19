import {
  getAssetInfo,
  listAssets,
  listFamilies,
  resolveAssetUrl,
} from '@playground/vendor-assets';
import { expect, test } from 'vitest';

test('listFamilies returns registered families', () => {
  expect(listFamilies()).toEqual(['als-wasm']);
});

test('listAssets enumerates the declared assets for als-wasm', () => {
  expect(listAssets('als-wasm').sort()).toEqual(['opt', 'raw']);
});

test('getAssetInfo returns the declared metadata for raw + opt', () => {
  const raw = getAssetInfo('als-wasm', 'raw');
  expect(raw.filename).toBe('als-2.8.0.wasm');
  expect(raw.sha256!).toMatch(/^[0-9a-f]{64}$/);
  expect(raw.sizeBytes).toBeGreaterThan(0);

  const opt = getAssetInfo('als-wasm', 'opt');
  expect(opt.filename).toBe('als-2.8.0-opt.wasm');
  expect(opt.sha256!).toMatch(/^[0-9a-f]{64}$/);
  expect(opt.sizeBytes).toBeGreaterThan(0);
});

test('unknown family / asset throws', () => {
  expect(() => listAssets('sqlite-wasm')).toThrow(/Unknown vendor-assets family/);
  expect(() => getAssetInfo('als-wasm', 'debug')).toThrow(/Unknown vendor-assets asset/);
});

test('resolveAssetUrl returns a non-empty URL for raw + opt', () => {
  const raw = resolveAssetUrl('als-wasm', 'raw');
  const opt = resolveAssetUrl('als-wasm', 'opt');
  expect(typeof raw).toBe('string');
  expect(raw.length).toBeGreaterThan(0);
  expect(typeof opt).toBe('string');
  expect(opt.length).toBeGreaterThan(0);
});
