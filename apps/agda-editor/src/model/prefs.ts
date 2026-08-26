/**
 * Prefs — the persisted user preferences (color theme, vim mode),
 * stored as one JSON blob under a single localStorage key. The loader
 * merges whatever it finds over the defaults and never throws: a
 * missing, corrupt, or unavailable store just yields the defaults,
 * and saving reports failure instead of raising. An inline bootstrap
 * script in index.html reads the same key before first paint so the
 * theme never flashes.
 */

export type ThemePref = 'light' | 'dark' | 'system';

export interface Prefs {
  theme: ThemePref;
  vim: boolean;
}

export const DEFAULT_PREFS: Prefs = { theme: 'system', vim: false };

export const PREFS_KEY = 'agda-editor:prefs';

/** The slice of Storage the store needs (injectable for tests). */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PrefsStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // sandboxed iframe & friends: no storage at all
  }
}

/** Parse a stored blob into prefs; anything unusable falls back. */
export function parsePrefs(raw: string | null): Prefs {
  if (raw === null) return { ...DEFAULT_PREFS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_PREFS };
  const blob = parsed as Partial<Prefs> & Record<string, unknown>;
  const theme: ThemePref =
    blob.theme === 'light' || blob.theme === 'dark' || blob.theme === 'system'
      ? blob.theme
      : DEFAULT_PREFS.theme;
  const vim = typeof blob.vim === 'boolean' ? blob.vim : DEFAULT_PREFS.vim;
  return { theme, vim };
}

export function loadPrefs(from?: PrefsStorage): Prefs {
  const store = from ?? defaultStorage();
  if (store === undefined) return { ...DEFAULT_PREFS };
  try {
    return parsePrefs(store.getItem(PREFS_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs, to?: PrefsStorage): { ok: boolean; error?: string } {
  const store = to ?? defaultStorage();
  if (store === undefined) return { ok: false, error: 'storage unavailable' };
  try {
    store.setItem(PREFS_KEY, JSON.stringify(prefs));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
