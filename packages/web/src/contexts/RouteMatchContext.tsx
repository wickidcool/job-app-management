import type { ReactNode } from 'react';
import { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react';

interface RouteMatchContextType {
  /** True while the current URL matched no route and the 404 page is rendering. */
  unmatched: boolean;
  setUnmatched: (unmatched: boolean) => void;
}

const RouteMatchContext = createContext<RouteMatchContextType | undefined>(undefined);

/**
 * Tracks whether the current URL matched a real route.
 *
 * Navigation chrome cannot answer that question from the pathname alone. The nav
 * predicates are `startsWith` matches, and they have to be: `/applications/:id`
 * and `/applications/new` are genuine children of the Applications tab and must
 * keep it highlighted. But the same rule fires on `/reports/pipelin`, which
 * matches no route at all — the nav asserts "you are on Reports" (down to
 * `aria-current="page"`) while the page below it says the page was not found.
 *
 * Only the router knows a path fell through to the catch-all, so the catch-all
 * says so: `NotFound` reports itself via `useReportRouteUnmatched`, and the nav
 * reads it back via `useRouteUnmatched` to suppress every active state.
 */
export function RouteMatchProvider({ children }: { children: ReactNode }) {
  const [unmatched, setUnmatched] = useState(false);
  const value = useMemo(() => ({ unmatched, setUnmatched }), [unmatched]);

  return <RouteMatchContext.Provider value={value}>{children}</RouteMatchContext.Provider>;
}

/**
 * Whether the current path fell through to the 404 page.
 *
 * Returns `false` with no provider above, rather than throwing. The consumers are
 * three navigation components that also render in isolation (unit tests, and any
 * future story or embed); "nothing is known to be unmatched" is both the safe
 * default and exactly the behaviour those callers had before this context existed.
 * The end-to-end wiring is pinned by an e2e regression test instead, which is the
 * only place a silently-missing provider could actually cost a user anything.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useRouteUnmatched(): boolean {
  return useContext(RouteMatchContext)?.unmatched ?? false;
}

/**
 * Declares, for as long as the calling component is mounted, that the current
 * path matched no route. Intended for exactly one caller: the catch-all page.
 *
 * `useLayoutEffect`, not `useEffect`: the nav is a sibling that has already been
 * committed with its stale active tab by the time this runs, and a layout effect
 * flushes the correction before the browser paints. With `useEffect` the user
 * would see one frame of a highlighted tab on a page that does not exist.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useReportRouteUnmatched(): void {
  const setUnmatched = useContext(RouteMatchContext)?.setUnmatched;

  useLayoutEffect(() => {
    if (!setUnmatched) return;
    setUnmatched(true);
    return () => setUnmatched(false);
  }, [setUnmatched]);
}
