import { expect, test } from 'vitest';

test('runs in real browser', () => {
  expect(typeof window).toBe('object');
  expect(navigator.userAgent).toContain('Chrome');
});
