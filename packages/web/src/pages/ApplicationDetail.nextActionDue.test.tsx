import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationDetail } from './ApplicationDetail';

/**
 * WIC-2267 — the "Next Action Due" date, asserted through the rendered page.
 *
 * This is the one site in the four the card names that a **user can actually reach**:
 * `/applications/:id` is a live route, whereas `/reports/pipeline` is a `<Navigate>` and
 * `ReportsPipeline` renders for nobody. So this file is the regression guard that matters,
 * and it deliberately goes through `render` rather than calling the formatter directly —
 * `utils/parseDateOnly.test.ts` already pins the helper, and a helper can be correct while
 * the page still calls `new Date()`. Reverting `ApplicationDetail.tsx` alone reds this file
 * and nothing else.
 *
 * ⚠️ TZ IS PINNED TO A NEGATIVE-OFFSET ZONE AND THAT IS LOad-BEARING. Under the default UTC
 * test environment `new Date('2026-01-01')` and local midnight coincide, so every assertion
 * below passes against the broken code. An assertion that cannot fail is not a guard — the
 * `utcControl` test at the end pins exactly that, so if the pinning ever stops taking effect
 * the control goes green while the real tests do too, and the pair reads as suspicious
 * rather than as proof.
 *
 * The fixture value is a bare `YYYY-MM-DD` because that is what the wire carries:
 * `next_action_due` is a Postgres `date` column (`schema.ts:52`, `mode: 'string'`) and the
 * service passes it through unformatted (`reports.service.ts:146,227`).
 */
const originalTZ = process.env.TZ;

const APPLICATION = {
  id: 'app_1',
  jobTitle: 'Staff Engineer',
  company: 'Acme',
  status: 'applied',
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  nextAction: 'Follow up with recruiter',
  // New Year's Day: the value that made the old parse render the wrong day, month AND year.
  nextActionDue: '2026-01-01',
};

function respond(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function stubFetch(application: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname.endsWith('/applications/app_1')) {
        return respond({ application });
      }
      return respond({});
    })
  );
}

beforeEach(() => {
  stubFetch(APPLICATION);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.TZ = originalTZ;
});

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/applications/app_1']}>
        <Routes>
          <Route path="/applications/:id" element={<ApplicationDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ApplicationDetail — Next Action Due renders the stored calendar day', () => {
  it('renders the stored day in America/New_York, not the day before', async () => {
    process.env.TZ = 'America/New_York';
    renderDetail();

    // Was "Dec 31, 2025" before the fix.
    await waitFor(() => expect(screen.getByText('Jan 1, 2026')).toBeInTheDocument());
    expect(screen.queryByText('Dec 31, 2025')).not.toBeInTheDocument();
  });

  it('renders the stored day in America/Los_Angeles', async () => {
    process.env.TZ = 'America/Los_Angeles';
    renderDetail();

    await waitFor(() => expect(screen.getByText('Jan 1, 2026')).toBeInTheDocument());
    expect(screen.queryByText('Dec 31, 2025')).not.toBeInTheDocument();
  });

  it('renders the stored day in a positive-offset zone', async () => {
    process.env.TZ = 'Asia/Tokyo';
    renderDetail();

    await waitFor(() => expect(screen.getByText('Jan 1, 2026')).toBeInTheDocument());
  });

  it('falls back to the raw value instead of throwing on an unparseable date', async () => {
    // date-fns `format` throws RangeError on an invalid Date, so before the fix a malformed
    // column value took the whole route down — this is the only site that formatted the
    // field with no guard.
    process.env.TZ = 'America/New_York';
    vi.unstubAllGlobals();
    stubFetch({ ...APPLICATION, nextActionDue: 'not-a-date' });
    renderDetail();

    await waitFor(() => expect(screen.getByText('Next Action Due')).toBeInTheDocument());
    expect(screen.getByText('not-a-date')).toBeInTheDocument();
  });

  it('utcControl: the same assertion is clean under UTC', async () => {
    // Must stay green against BOTH the fixed and the broken code — it is the proof that the
    // three tests above owe their failure to the zone, not to the fixture.
    process.env.TZ = 'UTC';
    renderDetail();

    await waitFor(() => expect(screen.getByText('Jan 1, 2026')).toBeInTheDocument());
  });
});
