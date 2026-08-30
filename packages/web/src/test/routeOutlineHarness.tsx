/**
 * Harness for the per-route rendered-outline check (WIC-1675, layer 2 of WIC-1483).
 *
 * Layer 1 (`eslint-plugin-jsx-a11y`, PR #226) cannot close this and does not claim to:
 * there is no `heading-order` rule in the plugin, and heading order is not a property of
 * any single element, so a per-file lint is structurally blind to it. The defect class is
 * *compositional* — `/cover-letters/new` was the proof, where the page file had no heading
 * and the child component had the `<h2>`, and **neither file was defective on its own**.
 *
 * So this renders each route for real and reads the outline the browser would build.
 *
 * ## Why the API barrel is the mock seam
 *
 * Every page reaches data through a hook in `src/hooks/`, and every one of those hooks
 * reaches `src/services/api`. Mocking that one barrel leaves the page, its child
 * components, its hooks and React Query all real, while giving a single dial that selects
 * which render branch the page takes:
 *
 *   - `loading` — the request never settles, so every `useQuery` stays `isLoading`;
 *   - `error`   — it rejects, selecting the error branch;
 *   - `empty`   — it resolves to a collection with no rows;
 *   - `loaded`  — it resolves to one row.
 *
 * Mocking the *hooks* instead would have been easier to write and much weaker: it is an
 * allowlist, and a page that grows a thirteenth hook would silently render unmocked. The
 * barrel is a chokepoint, so a new service reaches this harness by construction rather
 * than by someone remembering to add it.
 *
 * ## Why pages mount directly rather than through `App`
 *
 * `App` is a `BrowserRouter` behind `ProtectedRoute`, and it also mounts `OnboardingModal`
 * and `CommandPalette`, both of which can contribute headings that belong to no route.
 * Mounting the page component keeps the measured outline the *route's*.
 *
 * That trades away one thing, and it is the thing AC-3 turns on: it cannot see a heading
 * an ancestor supplies. That premise is not assumed here — `routeOutline.source.test.ts`
 * pins it directly, asserting the chrome files emit no heading of any level, so "the page
 * owns its `<h1>`" stays a measured fact rather than a comment.
 */

/* eslint-disable react-refresh/only-export-components --
   This is a test harness, not a component module. It is `.tsx` only because the provider
   stack it mounts is JSX, and it exports no component at all — every export is a helper
   the outline tests call. Fast refresh never sees this file, so the rule has nothing to
   protect here. Scoped to this file rather than added to eslint.config.js as a test-glob
   override, to avoid colliding with WIC-1483/PR #226, which is editing that config. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

import { getOutline, type OutlineEntry } from './headingOutline';
import {
  BRANCHES as ALL_BRANCHES,
  setBranch as selectBranch,
  setPayloadOverride,
  type Branch,
} from './routeOutlineApiMock';

import { AuthProvider } from '../contexts/AuthContext';
import { OnboardingProvider } from '../contexts/OnboardingContext';

export { BRANCHES, setBranch, currentBranch, apiMockModule } from './routeOutlineApiMock';
export type { Branch } from './routeOutlineApiMock';

/** Fresh client per render: a shared cache would leak one branch's data into the next. */
function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderRouteOptions {
  /** The URL to mount at, so `useParams` and `useSearchParams` see real values. */
  path: string;
  /** The route pattern, when the page reads `:id`-style params. Defaults to `path`. */
  pattern?: string;
  /**
   * A route-specific API payload, when the generic one is the wrong shape.
   *
   * Supplying one is not optional politeness: a page that reads through a nesting level
   * the generic payload lacks throws, and an unrendered branch is an unmeasured branch.
   */
  payload?: (forBranch: Branch) => unknown;
}

/**
 * Mount one page at one URL, with the API dialled to `branch`.
 *
 * Console noise is suppressed for the duration: the `error` branch legitimately logs, and
 * a wall of expected stack traces makes a real failure harder to find, not easier.
 */
export interface RouteRender {
  result: RenderResult;
  queryClient: QueryClient;
}

export function renderRoute(element: ReactElement, options: RenderRouteOptions): RouteRender {
  const { path, pattern = path } = options;
  const queryClient = newQueryClient();

  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OnboardingProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={pattern} element={element} />
            </Routes>
          </MemoryRouter>
        </OnboardingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );

  return { result, queryClient };
}

/**
 * `AuthProvider` calls `fetch` directly on mount rather than going through the API
 * barrel, so the barrel mock does not cover it. jsdom has no `fetch` implementation
 * worth the name, and an unhandled rejection here surfaces as an unrelated failure in
 * whichever test happens to be running when it lands.
 */
export function stubGlobalFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      })
    )
  );
}

export interface BranchRender {
  branch: Branch;
  /** The document subtree to read the outline from. See `outlineRoot` below. */
  root: HTMLElement;
  result: RenderResult;
}

export interface BranchOutline {
  branch: Branch;
  outline: OutlineEntry[];
}

/**
 * The element a route's outline must be read from.
 *
 * `baseElement` (the document body), **not** `container`. `ApplicationNew` is the reason
 * and it is not a special case: its entire page body is a Radix `Dialog`, which renders
 * through a portal attached to `document.body`. Scoped to `container`, that route
 * measures as *zero headings on all four branches* — indistinguishable, to every
 * assertion downstream, from a page that genuinely renders no heading.
 *
 * Reading from the body is also the more faithful choice: a portalled dialog is in the
 * accessibility tree, so it is in the outline a screen reader builds.
 */
export function outlineRoot(result: RenderResult): HTMLElement {
  return result.baseElement;
}

/**
 * Wait until the branch a render *claims* to be is the branch it *is*.
 *
 * Two failures made this the load-bearing function in the harness, and both were silent.
 *
 * 1. Reading synchronously after `render` catches every query still pending, so all four
 *    branches measure as `loading` — the sweep reports four branches covered and has
 *    measured one. Seen on `/projects`, where all four returned a byte-identical
 *    429-character loading skeleton.
 * 2. Flushing a fixed number of ticks instead *mostly* works, which is worse. Two
 *    consecutive sweeps of the same tree disagreed on three routes — `/reports/stale`
 *    `loaded` came back `h1 -> h3` once and "no headings at all" the next time. A check
 *    that reports a different defect set per run cannot be a build gate.
 *
 * So this waits on the actual condition — React Query reporting no in-flight fetches —
 * rather than on elapsed ticks. The `loading` branch is excluded by construction: its
 * requests never settle, so `isFetching()` never reaches 0 and waiting for it would hang.
 * One flush is still needed there to let the pending state paint.
 *
 * ## What the suite actually pins here, stated honestly
 *
 * Removing `settle()` from the sweep entirely is caught hard: non-empty outlines fall from
 * 97 to 68, well under the ≥87 floor. But the `waitFor` block *on its own* is **not**
 * pinned — deleting it while keeping the two `act()` flushes leaves the suite green across
 * consecutive runs, because in this environment the mock resolves within a single
 * macrotask and the flushes are enough. So the `waitFor` is insurance against a resolution
 * that needs more than one tick (a real chain of dependent queries, a slower CI box), not
 * something a failing test would tell you about if it were removed today. Do not read the
 * green suite as evidence that this specific block is load-bearing right now.
 */
async function settle(queryClient: QueryClient, forBranch: Branch): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  if (forBranch === 'loading') return;

  await waitFor(() => {
    if (queryClient.isFetching() !== 0) throw new Error('queries still in flight');
  });

  // A final flush so the re-render triggered by the last resolution is committed before
  // the outline is read.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Render `element` once per branch, returning each mounted result.
 *
 * A page that throws on some branch fails *here*, named. Left to itself, React would
 * unmount the tree and the caller would read an empty container — i.e. an outline of
 * zero headings, which several of the assertions downstream would pass. A branch that
 * cannot render must not be able to look like a branch with a clean outline.
 */
export async function forEachBranch(
  factory: () => ReactElement,
  options: RenderRouteOptions,
  visit: (rendered: BranchRender) => void | Promise<void>
): Promise<void> {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  try {
    setPayloadOverride(options.payload ?? null);
    for (const next of ALL_BRANCHES) {
      selectBranch(next);
      let result: RenderResult;
      try {
        const rendered = renderRoute(factory(), options);
        result = rendered.result;
        await settle(rendered.queryClient, next);
      } catch (cause) {
        throw new Error(
          `${options.path} threw while rendering its "${next}" branch: ${String(cause)}`,
          { cause }
        );
      }

      try {
        await visit({ branch: next, root: outlineRoot(result), result });
      } finally {
        // Unmount before the next branch, always. The outline is read from
        // `document.body` so that portalled dialogs are visible (see `outlineRoot`),
        // and `document.body` is *shared* across renders — a leaked mount would put the
        // previous branch's headings in the next branch's outline, and a page whose
        // first branch is clean would go on looking clean no matter what followed.
        result.unmount();
      }
    }
  } finally {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    setPayloadOverride(null);
    selectBranch('loading');
  }
}

/** The rendered outline of each branch, captured while that branch is mounted. */
export async function collectOutlines(
  factory: () => ReactElement,
  options: RenderRouteOptions
): Promise<BranchOutline[]> {
  const collected: BranchOutline[] = [];
  await forEachBranch(factory, options, ({ branch, root }) => {
    collected.push({ branch, outline: getOutline(root) });
  });
  return collected;
}
