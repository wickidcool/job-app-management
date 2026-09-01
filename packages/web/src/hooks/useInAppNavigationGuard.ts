import { useCallback, useEffect, useState } from 'react';

import { useNavigationGuardControls } from '../contexts/CommandPaletteContext';

/**
 * Intercepts in-app link navigation while `enabled` is true, so a caller can
 * confirm before the user loses unsaved work.
 *
 * ## Why this is not `useBlocker`
 *
 * React Router ships exactly this as `useBlocker`, and it is the right tool —
 * but it throws `useBlocker must be used within a data router` unless the app
 * is mounted through `createBrowserRouter`/`RouterProvider`. `App.tsx:66`
 * mounts a plain `<BrowserRouter>`, so `useBlocker` is unavailable here and
 * migrating the router is a whole-app change, not a wizard change (WIC-1765).
 *
 * ## What this covers, and what it does not
 *
 * Covered: left-clicks on anchor elements whose `href` is an in-app absolute
 * path (a leading `/`) — which is how `TopNavigation`/`MobileNavigation` move
 * between routes.
 *
 * How much that is worth depends on the caller, and for the dialogue wizard it
 * is currently *defence in depth rather than the load-bearing path*. WIC-1181
 * made `WizardContainer` a modal Radix `Dialog.Content`, which traps focus and
 * marks the rest of the app `aria-hidden` with pointer events off — so the app
 * nav is not reachable from inside the open wizard at all. An earlier revision
 * of this comment justified the hook by the wizard having *no* focus trap; that
 * was true when it was written and is not true now. It is kept because the
 * guarantee is Radix's, not this hook's: any anchor rendered *inside* the
 * wizard, and any non-modal caller, still needs it.
 *
 * Also covered, and this is the path that actually matters for the wizard
 * today: the ⌘/Ctrl+K command palette. Its shortcut listener is on `window`,
 * so the palette opens *over* the modal and navigates programmatically — no
 * click, nothing for the listener above to see. It is wired through
 * `registerNavigationGuard` on `CommandPaletteContext` instead, and both halves
 * funnel into the same `pendingHref`. Measured: with the wizard open, the
 * palette's search box is present and has no `aria-hidden` ancestor.
 *
 * NOT covered: browser back/forward, and any future programmatic `navigate()`
 * caller that does not consult `requestNavigation`. Neither can be intercepted
 * generically without migrating to a data router. Do not describe this guard as
 * total.
 *
 * Modified clicks (new tab/window), `target="_blank"`, `download`, and
 * off-origin hrefs are deliberately left alone: none of them discard the
 * in-page wizard state.
 */
export function useInAppNavigationGuard(enabled: boolean) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const { registerNavigationGuard } = useNavigationGuardControls();

  useEffect(() => {
    if (!enabled) return;

    const onClick = (event: MouseEvent) => {
      // Only a plain left-click actually navigates this tab away.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if (event.defaultPrevented) return;

      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      // `getAttribute` rather than `.href`, which the DOM resolves to absolute.
      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/')) return;

      event.preventDefault();
      event.stopPropagation();
      setPendingHref(href);
    };

    // Capture phase, so we run before React Router's own click handler and
    // before any component-level `onClick` calls `preventDefault` itself.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [enabled]);

  // The programmatic half. The command palette asks before it navigates, so
  // both halves land in the same `pendingHref` and the caller renders one
  // confirmation regardless of which path the user took.
  useEffect(() => {
    if (!enabled) return;

    registerNavigationGuard((href) => {
      setPendingHref(href);
      return true;
    });
    return () => registerNavigationGuard(null);
  }, [enabled, registerNavigationGuard]);

  const clearPendingNavigation = useCallback(() => setPendingHref(null), []);

  return { pendingHref, clearPendingNavigation };
}
