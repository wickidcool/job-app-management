/**
 * The `services/api` stand-in for the rendered-outline sweep (WIC-1675).
 *
 * This lives apart from `routeOutlineHarness.tsx`, and imports **nothing**, for one
 * mechanical reason: `vi.mock`'s factory is hoisted above every import in the file that
 * declares it, so the factory can only reach a module it pulls in itself. Pointing it at
 * the harness instead would import `AuthProvider`/`OnboardingProvider`, and
 * `OnboardingContext` imports `services/api` — the very module being mocked — so the
 * factory would be re-entered while it was still initialising. That failure reports as
 * `Cannot access '__vi_import_0__' before initialization`, which names neither the cycle
 * nor the file that closed it.
 *
 * Keep this file import-free.
 */

/** The four states every data-backed page can be in. */
export type Branch = 'loading' | 'error' | 'empty' | 'loaded';

export const BRANCHES: readonly Branch[] = ['loading', 'error', 'empty', 'loaded'] as const;

/**
 * Which branch the mocked API is currently selecting.
 *
 * Module-level rather than a parameter because the stub is reached through a hoisted
 * mock factory, so there is no call site to thread it through.
 */
let branch: Branch = 'loading';

export function setBranch(next: Branch): void {
  branch = next;
}

export function currentBranch(): Branch {
  return branch;
}

/**
 * A row shaped to satisfy the widest union of fields the pages read.
 *
 * Deliberately over-provided. A page that destructures a field this object lacks throws,
 * and a throw during `loaded` would otherwise read as "this route has no headings" — a
 * silent downgrade of the strongest branch into the weakest. `renderEveryBranch` turns
 * that into an explicit, named failure instead, but the cheapest fix is to not trip it.
 */
/**
 * Date-valued fields are real `Date` objects, not ISO strings.
 *
 * `ProjectsList`, `ProjectDetail` and `ResumeManager` call `.toLocaleDateString()` on
 * these directly rather than wrapping them in `new Date(...)`, so a string throws. The
 * report pages wrap, and wrapping a `Date` is fine, so `Date` satisfies both callers.
 */
const WHEN = new Date('2026-01-01T00:00:00.000Z');

const ROW: Record<string, unknown> = {
  id: 'row-1',
  applicationId: 'row-1',
  resumeId: 'row-1',
  projectId: 'row-1',
  variantId: 'row-1',
  fileName: 'notes.md',
  path: 'notes.md',
  fileSize: 1024,
  name: 'Row one',
  title: 'Row one',
  label: 'Row one',
  jobTitle: 'Staff Engineer',
  company: 'Acme',
  companyName: 'Acme',
  location: 'Remote',
  status: 'applied',
  version: 1,
  createdAt: WHEN,
  updatedAt: WHEN,
  uploadedAt: WHEN,
  appliedDate: WHEN,
  closedAt: WHEN,
  interviewDate: WHEN,
  lastPracticedAt: WHEN,
  generatedAt: WHEN,
  content: 'body',
  body: 'body',
  text: 'body',
  summary: 'summary',
  notes: '',
  tags: [],
  skills: [],
  requirements: [],
  questions: [],
  count: 0,
  total: 0,
  daysStale: 40,
  fitScore: 0,
  score: 0,
  tier: 'strong',
};
/**
 * The value every mocked service method resolves to, for the current branch.
 *
 * One shape has to serve calls that expect an array, a paginated envelope and a single
 * record, because the seam is generic — an array carrying the envelope and scalar fields
 * as own properties satisfies all three at once.
 */
function payload(): unknown {
  const rows = branch === 'loaded' ? [ROW] : [];
  return Object.assign([...rows], ROW, {
    items: rows,
    data: rows,
    results: rows,
    entries: rows,
    files: rows,
    applications: rows,
    resumes: rows,
    projects: rows,
    variants: rows,
    coverLetters: rows,
    exports: rows,
    groups: rows,
    // Singular envelope keys, for detail routes. `ResumeVariantDetail` does
    // `const { variant } = data`, so the row has to be reachable under its own name as
    // well as positionally. These stay populated on the `empty` branch: setting them to
    // `null` instead makes the page throw rather than take its not-found path, because
    // its guard is `if (error || !data)` and `{ variant: null }` is a truthy `data`.
    application: ROW,
    project: ROW,
    resume: ROW,
    variant: ROW,
    coverLetter: ROW,
    prep: ROW,
    file: ROW,
    total: rows.length,
    count: rows.length,
    nextCursor: null,
    hasMore: false,
  });
}

/**
 * A route-specific replacement for the generic payload.
 *
 * The generic shape above covers the list pages, but several routes read a nested object
 * — `data.summary.byStatus` on the report pages — and a page that reads through a missing
 * nesting level *throws*. That is caught and named by `forEachBranch` rather than being
 * silently scored as "this branch has no headings", but the branch is still unmeasured
 * until a fixture exists, so these are supplied per route rather than guessed at globally.
 */
let payloadOverride: ((forBranch: Branch) => unknown) | null = null;

export function setPayloadOverride(next: ((forBranch: Branch) => unknown) | null): void {
  payloadOverride = next;
}

/**
 * `loading` returns a promise that never settles, which holds every `useQuery` in
 * `isLoading` without any timer control. The others settle immediately.
 */
function methodStub(): unknown {
  if (branch === 'loading') return new Promise(() => {});
  if (branch === 'error') return Promise.reject(new Error('outline-harness: API failure'));
  return Promise.resolve(payloadOverride ? payloadOverride(branch) : payload());
}

/**
 * A stand-in for one service: any method name, returning the current branch's payload.
 *
 * A `Proxy` rather than an object of named methods, because the method *names* are what
 * differ most between services (`getAll`, `getById`, `getPipeline`, `getStale`, …) and
 * enumerating them would be an allowlist whose staleness is invisible.
 */
function serviceStub(): unknown {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'then') return undefined; // never look thenable to `await`
        return () => methodStub();
      },
    }
  );
}

/**
 * The mocked `services/api` module namespace, derived from the real one.
 *
 * `actual` must be the genuine module (`vi.mock`'s `importOriginal`). The export *names*
 * come from it and the export *values* are all stubs, which is the only combination that
 * works here:
 *
 *   - Hand-listing the twelve service names would be an allowlist. A thirteenth service
 *     would keep resolving to the real implementation, and the page would quietly render
 *     against it — a mock that fails open.
 *   - A bare `Proxy` with a `get` trap does not work either, and that failure is worth
 *     recording because it is silent in exactly the wrong way. Vitest validates each
 *     named import against the namespace's **own keys**, not its `get` trap, so a proxy
 *     reporting only `__esModule` makes every import throw *inside the query function*.
 *     React Query catches it, and the page renders its **error** branch — on all four
 *     branches. The sweep stays green, reports four branches covered, and has actually
 *     measured one. Found by probing `useReportsStale` directly:
 *     `isError=true, err=No "reportsService" export is defined on the mock`.
 *
 * Deriving the keys keeps the mock exhaustive by construction while satisfying that
 * validation.
 */
export function apiMockModule(actual: Record<string, unknown>): Record<string, unknown> {
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    mocked[key] = serviceStub();
  }
  return mocked;
}
