import { useCallback, useEffect, useState } from 'react';

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
 * path (a leading `/`) — which is how
 * `TopNavigation`/`MobileNavigation` move between routes. That matters for the
 * dialogue wizard specifically because it renders no focus trap (pending
 * WIC-1181), so a keyboard user can tab out of the overlay and reach the nav.
 *
 * NOT covered: programmatic `navigate()` calls that never dispatch a click —
 * most visibly the global Cmd+K command palette — and browser back/forward.
 * Neither can be intercepted without a data router. Tracked as a follow-up;
 * do not describe this guard as total.
 *
 * Modified clicks (new tab/window), `target="_blank"`, `download`, and
 * off-origin hrefs are deliberately left alone: none of them discard the
 * in-page wizard state.
 */
export function useInAppNavigationGuard(enabled: boolean) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);

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

  const clearPendingNavigation = useCallback(() => setPendingHref(null), []);

  return { pendingHref, clearPendingNavigation };
}
