import { resolveAssetUrl } from '@playground/vendor-assets';
import { expect, test } from 'vitest';

test('resolveAssetUrl works in the browser build pipeline', () => {
  const opt = resolveAssetUrl('als-wasm', 'opt', 'v6');
  const raw = resolveAssetUrl('als-wasm', 'raw', 'v6');
  expect(typeof opt).toBe('string');
  expect(opt.length).toBeGreaterThan(0);
  expect(typeof raw).toBe('string');
  expect(raw.length).toBeGreaterThan(0);
});
