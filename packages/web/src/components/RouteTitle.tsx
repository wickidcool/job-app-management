import { matchRoutes, useLocation } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { HOOK_TITLED_ROUTES, REDIRECT_ROUTES, STATIC_ROUTE_TITLES } from '../constants/title';

/**
 * Every route the app declares, as bare match objects.
 *
 * All three groups are here, not just the statically-titled ones, and that is the whole
 * subtlety of this component. `matchRoutes` ranks candidates, so a set containing only
 * the static routes would rank `/applications/123` against a list that has no
 * `/applications/:id` in it — and the catch-all `*` would win. Every dynamic route in the
 * app would then be titled "That page couldn't be found". Including the hook-titled and
 * redirect paths lets the ranking resolve correctly; they simply carry no title.
 */
const MATCHABLE_ROUTES = [
  ...Object.keys(STATIC_ROUTE_TITLES),
  ...HOOK_TITLED_ROUTES,
  ...REDIRECT_ROUTES,
].map((path) => ({ path }));

/**
 * The one effect in the app shell that applies `STATIC_ROUTE_TITLES`.
 *
 * Renders nothing. Mounted once inside the authenticated shell, it re-matches on every
 * location change and hands the result to `useDocumentTitle` — so a title change costs a
 * table edit, not a visit to a page component.
 *
 * Routes in `HOOK_TITLED_ROUTES` and `REDIRECT_ROUTES` resolve to `undefined` here, which
 * `useDocumentTitle` treats as "leave the title alone": the six hook-titled pages set
 * their own during the same commit, and the two redirects never paint at all.
 *
 * See `docs/design/ROUTE_TITLE_CONVENTION.md` §3 (WIC-1089).
 */
export function RouteTitle() {
  const location = useLocation();
  const matched = matchRoutes(MATCHABLE_ROUTES, location.pathname)?.[0]?.route.path;

  useDocumentTitle(matched ? STATIC_ROUTE_TITLES[matched] : undefined);

  return null;
}
