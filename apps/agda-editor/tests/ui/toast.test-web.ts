/**
 * Toast — the transient warning banner over the editor, driven against a
 * real DOM: show + text, singleton reuse (no stacking), and the auto-hide
 * timer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast } from '../../src/ui/toast';

function editor(): HTMLElement {
  let host = document.getElementById('editor');
  if (host === null) {
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  }
  return host;
}

beforeEach(() => {
  editor().replaceChildren();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('showToast', () => {
  it('shows the text over the editor', () => {
    showToast('give: no goal under cursor');

    const el = document.getElementById('toast');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe('give: no goal under cursor');
    expect(el!.classList.contains('show')).toBe(true);
  });

  it('reuses one element — a second warning replaces, never stacks', () => {
    showToast('first');
    showToast('second');

    const all = document.querySelectorAll('#toast');
    expect(all).toHaveLength(1);
    expect(all[0]!.textContent).toBe('second');
    expect(all[0]!.classList.contains('show')).toBe(true);
  });

  it('fades out after the timeout', () => {
    showToast('transient');
    const el = document.getElementById('toast')!;
    expect(el.classList.contains('show')).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(el.classList.contains('show')).toBe(false);
  });

  it('a re-show inside the window survives the first timer', () => {
    showToast('first');
    vi.advanceTimersByTime(2000);
    showToast('second');
    vi.advanceTimersByTime(2000); // only 2s after the re-show
    const el = document.getElementById('toast')!;
    expect(el.classList.contains('show')).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(el.classList.contains('show')).toBe(false);
  });
});
