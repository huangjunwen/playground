/**
 * Support gate — missingSupport on a capable browser is empty, and
 * showSupportCard renders the blocking overlay with one row per missing
 * capability.
 */
import { describe, expect, it } from 'vitest';
import { missingSupport, showSupportCard } from '../../src/ui/support';

describe('browser support gate', () => {
  it('a JSPI-capable browser (the test runner) reports nothing missing', () => {
    // Chromium runs the e2e suite and supports JSPI.
    expect(missingSupport()).toEqual([]);
  });

  it('showSupportCard renders a blocking overlay listing the gaps', () => {
    showSupportCard(['WebAssembly JSPI (JavaScript Promise Integration)']);
    const overlay = document.querySelector('.support-overlay');
    expect(overlay).not.toBeNull();
    const items = [...overlay!.querySelectorAll('li')].map(li => li.textContent);
    expect(items).toEqual(['WebAssembly JSPI (JavaScript Promise Integration)']);
    overlay!.remove();
  });
});
