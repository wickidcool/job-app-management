import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dashboard } from './Dashboard';
import { dashboardKeys } from '../hooks/useDashboard';
import { resumeKeys } from '../hooks/useResumes';

/**
 * WIC-2227 — the resume widget's "you have none" claim, for a request that failed or is
 * offline-paused.
 *
 * `Dashboard` read `const { data: resumes = [], isLoading: resumesLoading }` and never
 * read `error`. `DashboardResumeWidget` then defaults both counts to `0`, computes
 * `hasResumes = false`, and renders **"No resumes yet"** with **"Upload Your First
 * Resume"** — the same sentence-level false claim as `ProjectsList`, from the same
 * `= []`-over-`undefined` collapse.
 *
 * ## Why this mounts `Dashboard` and not `DashboardResumeWidget`
 *
 * The widget is a pure component: handing it `error` directly would only prove that the
 * branch it just gained renders, which is the least interesting half. What can actually
 * regress is the **wiring** — `Dashboard` reading the flag off the query and passing it
 * down. A component-level test stays green if that prop is never passed, so it would sit
 * one layer away from the defect. These mount the page and stub `resumeService` beneath
 * the real `useResumes`.
 *
 * See `ProjectsList.unsettled.test.tsx` for why the service rather than the hook is
 * mocked, and why the `queryFn` call counts are asserted.
 */

const GET_RESUMES = vi.fn();
const GET_STATS = vi.fn();

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    resumeService: { getAll: (...a: unknown[]) => GET_RESUMES(...a) },
    dashboardService: { getStats: (...a: unknown[]) => GET_STATS(...a) },
  };
});

/** The claim under test. */
const NO_RESUMES_CLAIM = /No resumes yet/i;
const UPLOAD_FIRST = /Upload Your First Resume/i;

const STATS = {
  stats: {
    total: 0,
    byStatus: {},
    appliedThisWeek: 0,
    appliedThisMonth: 0,
    responseRate: 0,
  },
};

/** A settled measurement whose figures are all distinguishable from the old zeros default. */
const REAL_STATS = {
  stats: {
    total: 7,
    byStatus: { phone_screen: 2, interview: 1 },
    appliedThisWeek: 4,
    appliedThisMonth: 6,
    responseRate: 0.5,
  },
};

function aResume(name = 'Backend Engineer CV', id = 'r1') {
  return { id, name, fileName: `${name}.pdf`, createdAt: new Date(), updatedAt: new Date() };
}

/**
 * Two, so the widget's counts read `2` — a value no other element on this page can
 * produce while the stats fixture is all-zero, and one the old `= []` collapse could
 * never fabricate.
 */
const TWO_RESUMES = [aResume('Backend Engineer CV', 'r1'), aResume('Platform CV', 'r2')];

/**
 * @param seedDashboardStats settle the *dashboard* query from cache before rendering.
 *
 * Load-bearing for the paused test, and the reason this parameter exists at all. The page
 * computes `loading = dashboardPending || resumesPending`, and going offline pauses BOTH
 * queries — so `dashboardPending` alone holds `loading` true, and the resume widget never
 * reaches its empty branch no matter what the resumes flag says. Measured: with both
 * queries live, reverting `resumesPending` to `isLoading` left this file fully green, so
 * the assertion was being satisfied by the sibling query rather than by the fix.
 *
 * Seeding the cache puts the dashboard query in `success`, which isolates the resumes
 * query as the only thing `loading` can be reading.
 *
 * @param staleDashboardStats seed the dashboard query from cache **and backdate it**, so
 * mounting triggers a refetch instead of resting on the cached value.
 *
 * This is the only way to reach `isError` with `data` still defined — the fifth unsettled
 * state, and the one `seedDashboardStats` above cannot produce. The backdate has to exceed
 * the hook's `staleTime: 30000` or `refetchOnMount` finds the entry fresh and never calls
 * `getStats`, which would leave the query in `success` and the test vacuous.
 */
function renderDashboard({
  seedDashboardStats = false,
  staleDashboardStats,
  staleResumes,
}: {
  seedDashboardStats?: boolean;
  staleDashboardStats?: typeof REAL_STATS;
  staleResumes?: ReturnType<typeof aResume>[];
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seedDashboardStats) {
    client.setQueryData(dashboardKeys.stats(), STATS);
  }
  if (staleDashboardStats) {
    client.setQueryData(dashboardKeys.stats(), staleDashboardStats, {
      updatedAt: Date.now() - 120_000,
    });
  }
  if (staleResumes) {
    client.setQueryData(resumeKeys.list(), staleResumes, { updatedAt: Date.now() - 120_000 });
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  GET_RESUMES.mockReset();
  GET_STATS.mockReset();
  GET_STATS.mockResolvedValue(STATS);
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('Dashboard — an unread resume list is not an empty one (WIC-2227)', () => {
  it('CONTROL: when the resumes request settles empty, the widget still says so', async () => {
    // The state the widget is ENTITLED to call empty. Without this, the assertions below
    // would also pass for a widget that had simply lost its empty state.
    GET_RESUMES.mockResolvedValue([]);

    renderDashboard();

    expect(await screen.findByText(NO_RESUMES_CLAIM)).toBeTruthy();
    expect(screen.getByText(UPLOAD_FIRST)).toBeTruthy();
    expect(GET_RESUMES).toHaveBeenCalledTimes(1);
  });

  it('a FAILED resumes request discloses the failure instead of claiming the user has none', async () => {
    GET_RESUMES.mockRejectedValue(new Error('500'));

    renderDashboard();

    expect(await screen.findByText(/Couldn’t load your resumes/i)).toBeTruthy();
    expect(screen.queryByText(NO_RESUMES_CLAIM)).toBeNull();
    expect(screen.queryByText(UPLOAD_FIRST)).toBeNull();
    expect(GET_RESUMES).toHaveBeenCalledTimes(1);
  });

  it('an offline-PAUSED resumes query does not claim the user has no resumes', async () => {
    onlineManager.setOnline(false);
    // The user HAS a resume; rendering the empty state would contradict the fixture.
    GET_RESUMES.mockResolvedValue([aResume()]);

    // Seeded so the RESUMES query is the only unsettled one — see `renderDashboard`.
    renderDashboard({ seedDashboardStats: true });

    await waitFor(() => {
      expect(screen.queryByText(NO_RESUMES_CLAIM)).toBeNull();
    });
    expect(screen.queryByText(UPLOAD_FIRST)).toBeNull();
    // 0 calls is what makes this PAUSED rather than slow.
    expect(GET_RESUMES).toHaveBeenCalledTimes(0);
  });
});

/**
 * WIC-2229 — the half of this page PR #458 left behind.
 *
 * #458 moved `Dashboard` off `isLoading` and gave the *resume widget* an error branch, but
 * `stats` kept its `|| { total: 0, byStatus: {}, … }` fallback. So a failed `GET /dashboard`
 * still rendered four stat cards reading `0 / 0 / 0% / 0` and a "Recent Activity" panel
 * reading `In Progress 0` — presented as measurements of the user's pipeline.
 *
 * `byStatus: {}` made it worse than a plain zero: `stats.byStatus.phone_screen +
 * stats.byStatus.interview` is `undefined + undefined` = `NaN`, and the trailing `|| 0`
 * laundered that into a confident `0`. A `NaN` on screen would at least have looked wrong.
 *
 * The Recent Activity panel is the sharper case, because it had **no loading gate at all** —
 * `DashboardStats` took `loading` and skeletoned, that panel did not. So its zeros were
 * stated during the request as well as after a failed one, which is why the pending case
 * below is asserted and not just the failed one.
 *
 * These mount the page rather than `DashboardStats`, for the reason given at the top of this
 * file: what regresses is the wiring, and a component-level test of the branch the component
 * just gained sits one layer away from that.
 */
describe('Dashboard — an unread pipeline is not a zeroed one (WIC-2229)', () => {
  it('CONTROL: a settled response renders the real figures on both surfaces', async () => {
    // Load-bearing in two directions. It proves the matchers below can tell a figure from
    // its absence at all, and — because every value differs from the old zeros default — it
    // proves the cards are wired to the response rather than to a constant. A `0` asserted
    // without this control is satisfied by a card that renders `0` unconditionally.
    GET_STATS.mockResolvedValue(REAL_STATS);
    GET_RESUMES.mockResolvedValue([]);

    renderDashboard();

    expect(await screen.findByText('7')).toBeTruthy(); // Total
    expect(screen.getByText('50%')).toBeTruthy(); // Response
    // In Review, and In Progress in the Recent Activity panel — both are phone_screen +
    // interview, so both read 3.
    expect(screen.getAllByText('3')).toHaveLength(2);
    expect(screen.getByText(/^In Progress$/)).toBeTruthy();
    expect(GET_STATS).toHaveBeenCalledTimes(1);
  });

  it('a FAILED dashboard request states no figure on either surface', async () => {
    GET_STATS.mockRejectedValue(new Error('500'));
    // Settled, so nothing below can be explained by the SIBLING query still being unsettled
    // — the mistake this file already made once (see `renderDashboard`).
    GET_RESUMES.mockResolvedValue([]);

    renderDashboard();

    expect(await screen.findByText(/Failed to load your dashboard statistics/i)).toBeTruthy();
    expect(screen.getByText(/Couldn’t load your recent activity/i)).toBeTruthy();
    // The fabricated figures, named directly. `0%` is the Response card and cannot be
    // produced by any other element on the page.
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByText(/^In Progress$/)).toBeNull();
    expect(GET_STATS).toHaveBeenCalledTimes(1);
  });

  it('a PENDING dashboard request states no figure in Recent Activity either', async () => {
    // The panel that had no loading gate. A never-resolving promise holds the query in
    // `pending` with `isFetching` true — the state `isLoading` DOES cover, which is exactly
    // why this case can regress independently of the paused one below.
    GET_STATS.mockReturnValue(new Promise(() => {}));
    GET_RESUMES.mockResolvedValue([]);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Checking your recent activity…/)).toBeTruthy();
    });
    expect(screen.queryByText(/^In Progress$/)).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    // Attempted, unlike the paused case.
    expect(GET_STATS).toHaveBeenCalledTimes(1);
  });

  it('an offline-PAUSED dashboard query states no figure on either surface', async () => {
    onlineManager.setOnline(false);
    // Deliberately resolvable, and non-zero: the user HAS a pipeline. Any figure rendered
    // here contradicts data the fixture proves exists.
    GET_STATS.mockResolvedValue(REAL_STATS);
    GET_RESUMES.mockResolvedValue([]);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Checking your recent activity…/)).toBeTruthy();
    });
    expect(screen.queryByText(/^In Progress$/)).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    // 0 calls is what makes this PAUSED rather than slow.
    expect(GET_STATS).toHaveBeenCalledTimes(0);
  });

  /**
   * WIC-2233 item 1 — the fifth unsettled state, which the four above cannot reach.
   *
   * WIC-2229's thesis is that `data` is `undefined` in three states (pending, paused,
   * failed), and every case above holds `data === undefined`. There is a fourth relevant
   * state: React Query's **refetch** error keeps the previous data
   * (`QueryObserverRefetchErrorResult`), so `stats` is defined while `isError` is true.
   *
   * `DashboardStats` gated on `error` alone and so withheld a figure it actually had, while
   * the Recent Activity panel gates on `stats` alone and kept rendering that same cached
   * figure — two surfaces contradicting each other off one query object. `QuickWins` and
   * `AttentionCard` read `dashboardData?.attention` and side with Recent Activity, so
   * stale-preferred is the resolution that makes all four agree with a single change;
   * disclosure-preferred would have needed four.
   *
   * Reachability is ordinary navigation: `staleTime: 30000` with `refetchOnMount` default
   * true means Dashboard → Applications → back after 30s refetches, and a transient failure
   * lands here.
   */
  it('a failed REFETCH keeps the cached figures on every surface, and says they are stale', async () => {
    GET_STATS.mockRejectedValue(new Error('500'));
    GET_RESUMES.mockResolvedValue([]);

    renderDashboard({ staleDashboardStats: REAL_STATS });

    // The disclosure is what makes keeping the figures honest rather than silent.
    expect(await screen.findByText(/last successful load/i)).toBeTruthy();

    // The cached measurement, on BOTH surfaces — `7` is the Total card, and the two `3`s
    // are In Review and Recent Activity's In Progress. Pre-fix the card read the banner
    // and only one `3` survived.
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getAllByText('3')).toHaveLength(2);
    expect(screen.getByText(/^In Progress$/)).toBeTruthy();

    // The no-measurement banner belongs to `error && !stats`, which this is not.
    expect(screen.queryByText(/Failed to load your dashboard statistics/i)).toBeNull();
    expect(screen.queryByText(/Couldn’t load your recent activity/i)).toBeNull();

    // 1 call is what makes this a failed REFETCH rather than a cache read: the seeded entry
    // was backdated past `staleTime`, so the hook really did go back to the network.
    expect(GET_STATS).toHaveBeenCalledTimes(1);
  });
});

/**
 * WIC-2236 — the same fourth state as WIC-2233 item 1, on the sibling query.
 *
 * `useResumes` carries the identical `staleTime: 30000` with `refetchOnMount` left at its
 * default, so the reachability argument is the one WIC-2233 established for `useDashboard`:
 * Dashboard → elsewhere → back after 30s, transient failure. React Query's refetch error
 * keeps the previous data, so the widget holds a real measurement while `isError` is true.
 *
 * This one degraded in the *safe* direction — an honest disclosure hiding a figure it had,
 * not a false claim — which is why it is smaller than WIC-2233 item 1, and why nothing on
 * the page contradicted it: no other surface renders resume counts. It is still worth
 * fixing, because the two sibling components had ended up with opposite rules while each
 * one's doc comment cited the other as its precedent.
 *
 * ## The caller side comes first, and is the half a guard change alone would have missed
 *
 * `error && !masterResumeCount` would have been wrong. `Dashboard` read
 * `const { data: resumes = [] }` and passed `resumes.length`, so the `= []` default had
 * already collapsed "no measurement" into a measured `0` before the widget saw it — the
 * same collapse WIC-2229 removed from the stats path. The counts are now
 * `number | undefined` and the guard is `error && !measured`.
 */
describe('Dashboard — a failed resumes refetch does not hide counts it is holding (WIC-2236)', () => {
  it('CONTROL: over the same warm cache, a refetch that SUCCEEDS renders the counts', async () => {
    // Load-bearing in the same two directions as the WIC-2229 control: it proves `2` is
    // findable at all, and — because the value is the fixture's length rather than a
    // constant — that the widget is wired to the response. It also pins the withholding
    // below to the error branch rather than to the cache seeding.
    GET_RESUMES.mockResolvedValue(TWO_RESUMES);

    renderDashboard({ seedDashboardStats: true, staleResumes: TWO_RESUMES });

    await waitFor(() => expect(GET_RESUMES).toHaveBeenCalledTimes(1));
    // Master resumes and Exports, both fed from the one array.
    await waitFor(() => expect(screen.getAllByText('2')).toHaveLength(2));
    expect(screen.queryByText(/Couldn’t load your resumes/i)).toBeNull();
    // No staleness note, because nothing is stale.
    expect(screen.queryByText(/most recent successful load/i)).toBeNull();
  });

  it('a failed REFETCH keeps the resume counts, and says they are stale', async () => {
    GET_RESUMES.mockRejectedValue(new Error('500'));
    // Seeded fresh, so the RESUMES query is the only unsettled one and `loading` cannot be
    // what is holding the widget off its counts — see `renderDashboard`.
    renderDashboard({ seedDashboardStats: true, staleResumes: TWO_RESUMES });

    // The disclosure is what makes keeping the figures honest rather than silent.
    expect(await screen.findByText(/most recent successful load/i)).toBeTruthy();

    // The cached measurement, on both rows. Pre-fix the widget rendered the banner and
    // neither `2` survived.
    expect(screen.getAllByText('2')).toHaveLength(2);
    expect(screen.getByText(/Master resumes/i)).toBeTruthy();

    // The no-measurement banner belongs to `error && !measured`, which this is not.
    expect(screen.queryByText(/Couldn’t load your resumes/i)).toBeNull();
    // And keeping the counts must not have reintroduced the WIC-2227 false claim.
    expect(screen.queryByText(NO_RESUMES_CLAIM)).toBeNull();

    // 1 call is what makes this a failed REFETCH rather than a cache read: the seeded
    // entry was backdated past `staleTime`, so the hook really did go back to the network.
    expect(GET_RESUMES).toHaveBeenCalledTimes(1);
  });
});

/**
 * WIC-2236, second observation — `QuickWins` kept saying it was still checking after the
 * request it describes had permanently failed.
 *
 * Not a *figure* claim, so it sits outside the WIC-2229 heading's stated scope, but it is
 * a progress claim that outlives its request, on the same query object as two surfaces
 * three inches away that do report the failure. `AttentionCard` was already correct — it
 * gates its all-clear on `attention` being defined and says nothing otherwise.
 */
describe('Dashboard — a failed request is not a request in progress (WIC-2236)', () => {
  it('CONTROL: while the dashboard request is genuinely pending, QuickWins says so', async () => {
    // Without this, the assertion below is also satisfied by a card that simply lost its
    // pending copy.
    GET_STATS.mockReturnValue(new Promise(() => {}));
    GET_RESUMES.mockResolvedValue([]);

    renderDashboard();

    await waitFor(() => expect(screen.getByText(/Checking your applications…/)).toBeTruthy());
    expect(screen.queryByText(/Couldn’t load your quick wins/i)).toBeNull();
  });

  it('a FAILED dashboard request retires the "checking" claim instead of leaving it up', async () => {
    GET_STATS.mockRejectedValue(new Error('500'));
    GET_RESUMES.mockResolvedValue([]);

    renderDashboard();

    expect(await screen.findByText(/Couldn’t load your quick wins/i)).toBeTruthy();
    expect(screen.queryByText(/Checking your applications…/)).toBeNull();
    // Retiring the progress claim must not promote the card to an all-clear it has not
    // measured — the direction `AttentionCard` already got right.
    expect(screen.queryByText(/All caught up/i)).toBeNull();
    expect(GET_STATS).toHaveBeenCalledTimes(1);
  });
});
