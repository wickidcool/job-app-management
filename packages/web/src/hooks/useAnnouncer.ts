import { useCallback, useState } from 'react';

/**
 * A zero-width space. Appended to force a DOM text change when the same message
 * is announced twice running — see `announce` below. It is invisible on screen
 * and is not spoken by assistive tech, so it changes nothing a user perceives.
 */
const REPEAT_MARKER = '\u200B';

export interface Announcer {
  /** Current live-region text. Pass to `<Announcer message={...} />`. */
  message: string;
  /** Announce an outcome politely. Safe to call with the same text repeatedly. */
  announce: (message: string) => void;
  /** Empty the region. Emptying is silent; it never announces. */
  clear: () => void;
}

/**
 * State for a polite live region that announces an *outcome* the user cannot see.
 *
 * Pair with `<Announcer>` (`../components/Announcer`), which renders the region
 * itself and portals it out of `#root`:
 *
 * ```tsx
 * const { message, announce, clear } = useAnnouncer();
 * // ...
 * announce(`Project ${name} created.`);
 * return <Announcer message={message} />;
 * ```
 *
 * ## Why this exists as a helper
 *
 * The rules a correct live region has to satisfy are non-obvious, and each one
 * has already been rediscovered the hard way in this codebase:
 *
 * - it must be **portalled out of `#root`** or it silently defeats
 *   `#root[aria-hidden]` behind every dialog (`Announcer` handles this);
 * - it must be **permanently mounted** and only change text, because assistive
 *   tech announces *updates* to a region already in the accessibility tree;
 * - it must **wrap nothing focusable**, or the exemption leaks a live control
 *   behind every dialog (WIC-1155, `EmptyState`);
 * - re-setting an **identical string** announces nothing at all, because there
 *   is no DOM change to notice.
 *
 * `ACCESSIBILITY.md` → *Where app-level live regions must be mounted* carries
 * the full rationale. Reach for this helper rather than a fifth hand-rolled copy.
 *
 * ## What this is *not* for
 *
 * Regions whose text is **derived from render state** — a progress indicator's
 * "Step 2 of 5", a board's drag announcer — are content, not outcome reporting.
 * They are already correct rendered in place and should stay that way
 * (`wizard/ProgressIndicator`, `OnboardingProgressIndicator`, `KanbanBoard`).
 * This helper is for the case where something *happened* and the DOM change
 * alone does not say so.
 */
export function useAnnouncer(): Announcer {
  const [message, setMessage] = useState('');

  const announce = useCallback((next: string) => {
    setMessage((current) => {
      // Assistive tech announces a *change* to the region's contents, so setting
      // the same string twice is silent — which is exactly what "created Acme,
      // then created Acme again" produces. Alternate an unspoken character so
      // consecutive identical outcomes still read as two distinct updates.
      if (current.replace(REPEAT_MARKER, '') !== next) return next;
      return current.endsWith(REPEAT_MARKER) ? next : next + REPEAT_MARKER;
    });
  }, []);

  const clear = useCallback(() => setMessage(''), []);

  return { message, announce, clear };
}
