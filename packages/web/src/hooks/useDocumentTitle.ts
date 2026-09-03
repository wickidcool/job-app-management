import { useEffect } from 'react';
import { formatTitle } from '../constants/title';

/**
 * Set `document.title` for as long as the calling component is mounted.
 *
 * The primitive behind the per-route title convention
 * (`docs/design/ROUTE_TITLE_CONVENTION.md`, WIC-1089). It is called in two places:
 * once by `RouteTitle` in the app shell, which passes the matched route's entry from
 * `STATIC_ROUTE_TITLES`; and directly by the six pages whose heading is not knowable
 * from the route table (a URL param, a wizard variant, or an in-page stage).
 *
 * `page` is the bare page name — `Dashboard`, not `Dashboard — Careerpin`. The suffix is
 * `formatTitle`'s job so that the product name lives in exactly one module.
 *
 * Three behaviours the convention requires (§3), all of them load-bearing:
 *
 * 1. **Restore on unmount.** Without it a route that unmounts during a transition leaves
 *    its title up over the next screen.
 * 2. **Never render a partial title.** Callers pass a static fallback while their record
 *    loads, so the tab never reads `undefined — Careerpin`. That is the caller's job, not
 *    this hook's — hence `undefined` here means "leave the title alone", which is what
 *    lets the shell call this unconditionally for routes that set their own title.
 * 3. **Write in an effect, not in render.** Assigning `document.title` during render is a
 *    render-phase side effect and misbehaves under StrictMode's double invocation.
 */
export function useDocumentTitle(page: string | undefined): void {
  useEffect(() => {
    if (page === undefined) return;

    // Read inside the effect, after the previous effect's cleanup has already restored
    // its own predecessor. Capturing this during render would snapshot a title that a
    // sibling effect is about to overwrite, and the restore would then reinstate it.
    const previous = document.title;
    document.title = formatTitle(page);

    return () => {
      document.title = previous;
    };
  }, [page]);
}
