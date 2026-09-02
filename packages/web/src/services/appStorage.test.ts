import { beforeEach, describe, expect, it } from 'vitest';
import {
  APP_STORAGE_KEYS,
  APP_STORAGE_KEY_PREFIXES,
  clearAppStorage,
  isAppStorageKey,
} from './appStorage';

/**
 * Unit coverage for the sweep itself (WIC-1495). The acceptance-criteria test —
 * populate, sign out through the real `AuthProvider`, assert nothing survives —
 * lives in `contexts/AuthContext.test.tsx`. This file covers the two things that
 * test cannot see: what the sweep must *not* touch, and the index-walk bug that
 * makes a sweep silently partial.
 */

describe('appStorage (WIC-1495)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('registers keys to check at all', () => {
    // Control on the controls below: every assertion here is a statement about a
    // non-empty registry, and all of them pass vacuously against an empty one.
    expect(APP_STORAGE_KEYS.length).toBeGreaterThanOrEqual(4);
    expect(APP_STORAGE_KEY_PREFIXES.length).toBeGreaterThanOrEqual(2);
    expect(new Set(APP_STORAGE_KEYS).size).toBe(APP_STORAGE_KEYS.length);
  });

  it('recognises every registered exact key', () => {
    for (const key of APP_STORAGE_KEYS) {
      expect(isAppStorageKey(key)).toBe(true);
    }
  });

  it('recognises a key family by prefix, whatever the suffix', () => {
    // The point of a family: the suffix is generated at runtime, so no exact-match
    // list can ever enumerate these. Two distinct suffixes, so a hardcoded single
    // string cannot pass this.
    expect(isAppStorageKey('dialogue-wizard-draft-create')).toBe(true);
    expect(isAppStorageKey('dialogue-wizard-draft-enrich-9f3a21b0')).toBe(true);
    // A `wic-` key that is deliberately NOT in the registry: the house prefix is
    // listed as a family precisely so the next one is swept without being added.
    expect(isAppStorageKey('wic-some-future-key')).toBe(true);
  });

  it('does not claim keys the app does not own', () => {
    for (const key of ['', 'theme', 'sentry-session', 'wic', 'auth_token_backup', 'my-wic-thing']) {
      expect(isAppStorageKey(key)).toBe(false);
    }
  });

  it('removes every app-owned key and leaves the rest of the origin alone', () => {
    for (const key of APP_STORAGE_KEYS) localStorage.setItem(key, 'x');
    localStorage.setItem('dialogue-wizard-draft-create', 'x');
    localStorage.setItem('wic-some-future-key', 'x');
    // Not ours. `clearAppStorage` is not `localStorage.clear()` and this is the
    // assertion that keeps it that way.
    localStorage.setItem('unrelated-third-party', 'keep me');

    clearAppStorage();

    expect(Object.keys(localStorage).sort()).toEqual(['unrelated-third-party']);
  });

  it('sweeps adjacent app-owned keys without skipping any (index-walk regression)', () => {
    // `localStorage.key(i)` is index-based, so removing during the walk renumbers
    // everything after the removed entry and the walk skips the next match. With
    // six consecutive owned keys a live-removal sweep leaves three behind. A
    // fixture of one or two owned keys cannot detect this.
    const owned = [
      'dialogue-wizard-draft-a',
      'dialogue-wizard-draft-b',
      'dialogue-wizard-draft-c',
      'dialogue-wizard-draft-d',
      'dialogue-wizard-draft-e',
      'dialogue-wizard-draft-f',
    ];
    for (const key of owned) localStorage.setItem(key, 'x');
    expect(localStorage.length).toBe(owned.length);

    clearAppStorage();

    expect(localStorage.length).toBe(0);
  });

  it('is a no-op on an empty store rather than throwing', () => {
    expect(() => clearAppStorage()).not.toThrow();
    expect(localStorage.length).toBe(0);
  });
});
