/**
 * The canonical registry of `localStorage` keys this app owns, and the sweep that
 * clears them.
 *
 * Every key here holds user data on the user's own disk, in plaintext. Before
 * WIC-1495, `signOut` cleared exactly one of the five that existed, so on a shared
 * or borrowed machine the next person to open the app was offered the previous
 * user's recent searches (company names, role titles, contact names), their saved
 * filters, and their onboarding progress — with no session required. `AuthContext`
 * had already reasoned about that exact threat for the analytics identity, in the
 * same function, and swept only the token.
 *
 * Adding a key: declare it here, import it at the call site, and it is swept by
 * construction. `test/appStorageRegistry.test.ts` fails if a `localStorage` key
 * string is introduced anywhere else in `src/`, which is what keeps that true.
 *
 * Scope note: `sessionStorage` is deliberately untouched. Its one key
 * (`wic_analytics_session_id`, `services/analytics.ts`) is already rotated on
 * logout by `reset()`, and sessionStorage does not outlive the tab in the first
 * place — the shared-browser exposure this module exists to close is specific to
 * `localStorage`.
 */

/** The Supabase JWT. Read by the API client on every authenticated request. */
export const AUTH_TOKEN_KEY = 'auth_token';

/** Command-palette search history (`CommandPalette.tsx`). */
export const RECENT_SEARCHES_KEY = 'wic-recent-searches';

/** User-defined application-list filter shortcuts (`SavedFilterShortcuts.tsx`). */
export const SAVED_FILTERS_KEY = 'wic-saved-filters';

/** Onboarding wizard step and resume-upload flag (`OnboardingModal.tsx`). */
export const ONBOARDING_PROGRESS_KEY = 'onboarding_progress';

/** Every app-owned key with a fixed, exact name. */
export const APP_STORAGE_KEYS = [
  AUTH_TOKEN_KEY,
  RECENT_SEARCHES_KEY,
  SAVED_FILTERS_KEY,
  ONBOARDING_PROGRESS_KEY,
] as const;

/**
 * App-owned key *families*. Any stored key beginning with one of these prefixes
 * belongs to the app, whatever its suffix — an exact-match list cannot reach them.
 *
 * - `wic-` is the house prefix. It already covers two of the exact keys above; it
 *   is listed as a family as well so that a future `wic-`-prefixed key is swept
 *   even if whoever adds it forgets to register it.
 * - `dialogue-wizard-draft-` is **legacy**. WIC-1495 deleted its only writer, but
 *   copies written by earlier releases are still sitting on users' disks, keyed
 *   per wizard variant and per file, and this entry is the only thing that ever
 *   reaches them — they are cleared on that user's next sign-out. Do not remove it
 *   as dead weight just because nothing writes the key any more.
 */
export const APP_STORAGE_KEY_PREFIXES = ['wic-', 'dialogue-wizard-draft-'] as const;

/** Whether `key` belongs to this app, by exact name or by key family. */
export function isAppStorageKey(key: string): boolean {
  return (
    (APP_STORAGE_KEYS as readonly string[]).includes(key) ||
    APP_STORAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * Removes every app-owned key from `localStorage`.
 *
 * Deliberately not `localStorage.clear()`: the origin is shared with anything else
 * served from it, and clearing keys we do not own is not ours to do.
 *
 * Enumerates what is actually stored rather than iterating the registry, so key
 * families are swept whatever suffix they were written with. The keys are
 * collected before any removal because `localStorage.key(i)` is index-based and
 * removing during the walk renumbers everything after the removed entry — a live
 * removal skips every second match.
 *
 * Never throws: `localStorage` access itself raises in private-mode and sandboxed
 * contexts, and a failed cleanup must not take the logout down with it.
 */
export function clearAppStorage(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const owned: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key !== null && isAppStorageKey(key)) owned.push(key);
    }
    for (const key of owned) window.localStorage.removeItem(key);
  } catch {
    /* localStorage can throw in private-mode / sandboxed contexts */
  }
}
