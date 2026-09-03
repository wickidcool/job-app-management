import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationDetail } from './ApplicationDetail';

/**
 * WIC-1533 — the page cap, asserted on user-visible output rather than on a
 * query argument.
 *
 * `ApplicationDetail.coverLetters.test.tsx` mocks `useCoverLetters` wholesale,
 * which is right for the entry-point assertions but structurally blind to this
 * defect: it hands the page a list that has already been chosen, so no server
 * paging ever happens and the page renders correctly for the data it was
 * given. The bug lives entirely in *which rows the server was asked for*.
 *
 * So this file runs the real hook and the real service against a `fetch` that
 * replays the list endpoint's actual semantics, measured on `main` @ `881cb0f`:
 *
 * - `?company=` is `ilike '%company%'` — a substring match, not equality;
 * - rows are ordered `created_at desc`;
 * - the page is `Math.min(params.limit ?? 20, 100)`.
 *
 * The fixture is the failing case in full: one letter for *this* role, the
 * oldest of its company, behind 20 newer letters for other roles at the same
 * company. Under the endpoint's default page of 20 the user's own letter is
 * not in the response at all, the section reads "No cover letters yet for this
 * role" and the checklist row stays unticked — WIC-1533's own defect,
 * reappearing at the tail of the list. Dropping `limit` from the
 * `useCoverLetters` call in `ApplicationDetail` reds this file.
 *
 * The replay is the one soft spot here: it is a local model of an external
 * service, and a change to the endpoint's paging or filter semantics would
 * make it silently optimistic. That is why it is the *third* guard and not the
 * only one — the two argument-level assertions (here and in
 * `services/api/coverLetters.list.test.ts`) pin the request itself, which no
 * model of the server can misrepresent.
 */
const APPLICATION = {
  id: 'app_1',
  jobTitle: 'Staff Engineer',
  company: 'Acme',
  status: 'applied',
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  jobDescription: 'Build things.',
};

const OWN_LETTER = {
  id: 'cl_mine',
  status: 'finalized',
  title: 'Cover Letter - Staff Engineer at Acme',
  targetCompany: 'Acme',
  targetRole: 'Staff Engineer',
  tone: 'professional',
  lengthVariant: 'standard',
  preview: 'Dear hiring manager…',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/** 20 letters for other roles at the same company, all newer than the above. */
const SIBLING_LETTERS = Array.from({ length: 20 }, (_, i) => ({
  ...OWN_LETTER,
  id: `cl_other_${i}`,
  title: `Cover Letter - Other Role ${i} at Acme`,
  targetRole: `Other Role ${i}`,
  createdAt: `2026-08-${String(2 + i).padStart(2, '0')}T00:00:00.000Z`,
  updatedAt: `2026-08-${String(2 + i).padStart(2, '0')}T00:00:00.000Z`,
}));

const ALL_LETTERS = [OWN_LETTER, ...SIBLING_LETTERS];

/** The list endpoint's real behaviour, not a convenience stub. */
function listCoverLetters(url: URL) {
  const company = url.searchParams.get('company');
  const substringMatched = ALL_LETTERS.filter((letter) =>
    company ? letter.targetCompany.toLowerCase().includes(company.toLowerCase()) : true
  );
  const newestFirst = [...substringMatched].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const requested = url.searchParams.get('limit');
  const limit = Math.min(requested ? Number(requested) : 20, 100);
  return newestFirst.slice(0, limit);
}

function respond(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      // The client's baseURL is relative, so a base is required to parse.
      const url = new URL(input, 'http://localhost');
      if (url.pathname.endsWith('/applications/app_1')) {
        return respond({ application: APPLICATION });
      }
      if (url.pathname.endsWith('/cover-letters')) {
        return respond({ coverLetters: listCoverLetters(url) });
      }
      return respond({});
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe('ApplicationDetail — a letter behind a full page of siblings', () => {
  it('still reaches the letter the endpoint default would have truncated away', async () => {
    renderDetail();

    await waitFor(() => expect(screen.getByText('Cover Letters')).toBeInTheDocument());

    await waitFor(() =>
      expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toContain(
        '/cover-letters/cl_mine'
      )
    );
    expect(screen.queryByText(/No cover letters yet for this role/)).not.toBeInTheDocument();
    expect(screen.getByText('1 of 4 steps completed')).toBeInTheDocument();
  });

  /**
   * The control on the control. If the fixture ever stopped straddling the
   * default page — fewer siblings, or the letter no longer oldest — the test
   * above would pass for a reason unrelated to the cap and would quietly stop
   * guarding anything. Assert the premise it depends on.
   */
  it('is a fixture that genuinely fails at the endpoint default', () => {
    const page = listCoverLetters(new URL('http://localhost/api/cover-letters?company=Acme'));

    expect(page).toHaveLength(20);
    expect(page.map((letter) => letter.id)).not.toContain('cl_mine');
  });
});
