import { expect, test } from 'vitest';

test('runs in node', () => {
  expect(typeof window).toBe('undefined');
  expect(typeof process.versions.node).toBe('string');
});
