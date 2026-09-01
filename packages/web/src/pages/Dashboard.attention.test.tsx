import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Dashboard } from './Dashboard';
import type { DashboardResponse } from '../services/api/types';

/**
 * WIC-1478 regression suite.
 *
 * The defect: the Dashboard's attention/quick-win detectors ran over the array
 * returned by `useApplications()`, which is a *page* of applications ordered by
 * most-recently-updated (`GET /api/applications` defaults to `limit=50`). The
 * detectors then filtered that page for the *least* recently updated rows — so
 * once an account exceeded a page, every genuinely stale row had already been
 * dropped before the filter ran, and the warning silently stopped rendering.
 *
 * The fix moves those aggregates server-side, next to the `GROUP BY status`
 * count that was already correct. These tests pin that: the rendered numbers
 * must come from the server's full-table counts, and must not be reachable
 * from any page of applications.
 *
 * Nothing here is mocked below the network boundary — `fetch` is stubbed and
 * the real `apiClient`, services, hooks and components run on top of it.
 */

const TOTAL_APPLICATIONS = 150;
const STALE_APPLICATIONS = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The attention row renders `{message} →`, so match the message, not the whole node. */
const STALE_WARNING = new RegExp(
  `^${STALE_APPLICATIONS} applications need follow-up \\(>7 days\\)`
);

interface SeedRow {
  id: string;
  jobTitle: string;
  company: string;
  status: string;
  jobDescription: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 150 applications, 40 of which have not been touched in 30 days.
 *
 * Returned newest-first, exactly as the API orders them (`desc(updatedAt)`), so
 * the 40 stale rows sit at the very end — past the server's default page size.
 */
function seedApplications(): SeedRow[] {
  const now = Date.now();
  return Array.from({ length: TOTAL_APPLICATIONS }, (_, i) => {
    const isStale = i >= TOTAL_APPLICATIONS - STALE_APPLICATIONS;
    const updatedAt = new Date(now - (isStale ? 30 * DAY_MS : i * 60 * 1000)).toISOString();
    return {
      id: `app-${String(i).padStart(3, '0')}`,
      jobTitle: `Engineer ${i}`,
      company: `Company ${i}`,
      status: 'applied',
      jobDescription: 'A job description.',
      version: 1,
      createdAt: new Date(now - 60 * DAY_MS).toISOString(),
      updatedAt,
    };
  });
}

/**
 * The dashboard payload a correct server produces for that seed: counts over the
 * whole table, plus a short sample list for rendering individual rows.
 */
function seedDashboardResponse(rows: SeedRow[]): DashboardResponse {
  const staleRows = rows.filter((r) => Date.now() - Date.parse(r.updatedAt) > 7 * DAY_MS);
  return {
    stats: {
      total: rows.length,
      byStatus: {
        saved: 0,
        applied: rows.length,
        phone_screen: 0,
        interview: 0,
        offer: 0,
        rejected: 0,
        withdrawn: 0,
      },
      appliedThisWeek: 0,
      appliedThisMonth: 0,
      // WIC-1514: the unit of `responseRate` is owned by `DashboardResponse`.
      // Indexing the type keeps this fixture correct both before and after the
      // ratio brand lands (PR #165), without importing a module this branch lacks.
      responseRate: 0 as DashboardResponse['stats']['responseRate'],
    },
    recentActivity: [],
    attention: {
      staleThresholdDays: 7,
      savedThresholdDays: 3,
      counts: {
        interviewing: 0,
        stale: staleRows.length,
        staleActive: staleRows.length,
        missingJobDescription: 0,
        staleSaved: 0,
      },
      samples: {
        interviewing: [],
        staleActive: staleRows.slice(-2).map((r) => ({
          id: r.id,
          jobTitle: r.jobTitle,
          company: r.company,
          status: 'applied' as const,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        missingJobDescription: [],
        staleSaved: [],
      },
    },
  };
}

interface RecordedRequest {
  path: string;
  limit: string | null;
  page: string | null;
}

function installFetchStub(rows: SeedRow[], dashboard: DashboardResponse) {
  const requests: RecordedRequest[] = [];

  const stub = vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input.toString();
    const url = new URL(raw, 'http://localhost');
    requests.push({
      path: url.pathname,
      limit: url.searchParams.get('limit'),
      page: url.searchParams.get('page'),
    });

    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url.pathname.endsWith('/dashboard')) return json(dashboard);
    if (url.pathname.endsWith('/resumes')) return json({ resumes: [] });

    if (url.pathname.endsWith('/applications')) {
      // Faithful to the server: page size capped at 100, newest-updated first,
      // opaque cursor, and `nextPage` omitted on the last page.
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100);
      const offset = Number(url.searchParams.get('page') ?? 0);
      const slice = rows.slice(offset, offset + limit);
      const next = offset + limit < rows.length ? String(offset + limit) : undefined;
      return json({ applications: slice, nextPage: next, totalCount: rows.length });
    }

    return json({});
  });

  vi.stubGlobal('fetch', stub);
  return requests;
}

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Dashboard attention card over a paged account (WIC-1478)', () => {
  let rows: SeedRow[];
  let requests: RecordedRequest[];

  beforeEach(() => {
    localStorage.setItem('auth_token', 'test-token');
    rows = seedApplications();
    requests = installFetchStub(rows, seedDashboardResponse(rows));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('the seed is one where a page-scoped scan finds nothing — the discriminator', () => {
    // This is not an assertion about the component; it is the negative control
    // for the whole file. If the first server page happened to contain a stale
    // row, the tests below would pass with or without the fix.
    const firstPage = rows.slice(0, 50);
    const staleInFirstPage = firstPage.filter(
      (r) => Date.now() - Date.parse(r.updatedAt) > 7 * DAY_MS
    );

    expect(rows).toHaveLength(TOTAL_APPLICATIONS);
    expect(staleInFirstPage).toHaveLength(0);
    expect(rows.filter((r) => Date.now() - Date.parse(r.updatedAt) > 7 * DAY_MS)).toHaveLength(
      STALE_APPLICATIONS
    );
  });

  // AC-N1c
  it(`reports all ${STALE_APPLICATIONS} stale applications, not the 0 visible on the first page`, async () => {
    renderDashboard();

    expect(await screen.findByText(STALE_WARNING)).toBeInTheDocument();
    expect(screen.queryByText('All applications are up to date!')).not.toBeInTheDocument();
  });

  // AC-N1a — the count cannot have come from a page, because no page was fetched.
  it('sources the attention numbers from /dashboard without listing applications at all', async () => {
    renderDashboard();
    await screen.findByText(STALE_WARNING);

    expect(requests.some((r) => r.path.endsWith('/dashboard'))).toBe(true);
    expect(requests.filter((r) => r.path.endsWith('/applications'))).toHaveLength(0);
  });

  it('still reports the server total, not the number of rows it happens to hold', async () => {
    renderDashboard();
    await screen.findByText(STALE_WARNING);

    expect(await screen.findByText(String(TOTAL_APPLICATIONS))).toBeInTheDocument();
  });

  it('does not claim everything is up to date before the aggregates arrive', () => {
    // Never resolves: the dashboard query stays pending for the whole test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );
    renderDashboard();

    expect(screen.queryByText('All applications are up to date!')).not.toBeInTheDocument();
    expect(screen.queryByText('All caught up!')).not.toBeInTheDocument();
  });
});
