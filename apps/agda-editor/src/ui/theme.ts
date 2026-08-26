/**
 * Theme — resolves the persisted preference ('light' | 'dark' |
 * 'system') into the concrete `data-theme` attribute the CSS vars
 * key off. `system` re-resolves through matchMedia, so the document
 * follows the OS until the user pins a side. index.html carries an
 * inline bootstrap that applies the same resolution before first
 * paint; this module owns the attribute afterwards.
 */

import type { ThemePref } from '../model/prefs';

export type ResolvedTheme = 'light' | 'dark';

/** Pure resolution: only 'system' consults the OS preference. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

/** Apply a preference to the document root; returns what it resolved to. */
export function applyTheme(pref: ThemePref): ResolvedTheme {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const resolved = resolveTheme(pref, media.matches);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/**
 * Re-apply on OS theme flips while the preference is 'system'.
 * Returns a disposer.
 */
export function watchSystemTheme(getPref: () => ThemePref, onChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (): void => {
    if (getPref() === 'system') {
      applyTheme('system');
      onChange();
    }
  };
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
