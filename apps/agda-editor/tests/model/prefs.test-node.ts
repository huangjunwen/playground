/**
 * Prefs — the persisted preference blob: parsing (anything unusable
 * falls back to the defaults), the storage round-trip, and the
 * never-throws contract for missing/corrupt/unavailable storage.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  loadPrefs,
  PREFS_KEY,
  type PrefsStorage,
  parsePrefs,
  savePrefs,
} from '../../src/model/prefs';

function fakeStore(initial: Record<string, string> = {}): PrefsStorage & {
  dump(): Record<string, string>;
} {
  const data = { ...initial };
  return {
    getItem: key => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    dump: () => data,
  };
}

describe('parsePrefs', () => {
  it('falls back to the defaults on null, corrupt, or non-object input', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('42')).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid fields and drops unknown or wrong-typed ones', () => {
    expect(parsePrefs(JSON.stringify({ theme: 'dark', vim: true }))).toEqual({
      theme: 'dark',
      vim: true,
    });
    expect(parsePrefs(JSON.stringify({ theme: 'solarized', vim: 'yes' }))).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ theme: 'light' }))).toEqual({ theme: 'light', vim: false });
  });
});

describe('loadPrefs', () => {
  it('round-trips what savePrefs wrote', () => {
    const store = fakeStore();
    const prefs = { theme: 'dark' as const, vim: true };
    expect(savePrefs(prefs, store).ok).toBe(true);
    expect(store.dump()[PREFS_KEY]).toBe(JSON.stringify(prefs));
    expect(loadPrefs(store)).toEqual(prefs);
  });

  it('newest save wins', () => {
    const store = fakeStore();
    savePrefs({ theme: 'dark', vim: false }, store);
    savePrefs({ theme: 'light', vim: true }, store);
    expect(loadPrefs(store)).toEqual({ theme: 'light', vim: true });
  });

  it('defaults on an empty store', () => {
    expect(loadPrefs(fakeStore())).toEqual(DEFAULT_PREFS);
  });

  it('never throws on a corrupt blob', () => {
    const store = fakeStore({ [PREFS_KEY]: '{oops' });
    expect(loadPrefs(store)).toEqual(DEFAULT_PREFS);
  });
});

describe('savePrefs failures', () => {
  it('reports a throwing store instead of raising', () => {
    const store: PrefsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    const result = savePrefs({ theme: 'dark', vim: false }, store);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('quota exceeded');
  });

  it('reports an unavailable store', () => {
    expect(savePrefs({ theme: 'dark', vim: false }, undefined).ok).toBe(false);
    expect(loadPrefs(undefined)).toEqual(DEFAULT_PREFS);
  });

  it('a throwing getItem also falls back to defaults', () => {
    const store: PrefsStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    };
    expect(loadPrefs(store)).toEqual(DEFAULT_PREFS);
  });
});
