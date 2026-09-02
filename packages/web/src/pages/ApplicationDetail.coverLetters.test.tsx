import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationDetail } from './ApplicationDetail';
import { useApplication } from '../hooks/useApplications';
import { useCoverLetters } from '../hooks/useCoverLetters';
import { useResumeVariants } from '../hooks/useResumeVariants';
import { useInterviewPrepByApplication } from '../hooks/useInterviewPrep';
import { TARGETED_LIST_PAGE_MAX } from '../constants/applicationMatch';
import type { Application } from '../types/application';
import type { CoverLetterSummary } from '../services/api/types';

vi.mock('../hooks/useApplications');
vi.mock('../hooks/useCoverLetters');
// WIC-1536 gave the page two more data sources, for the workflow checklist.
// This file asserts nothing about them, but they are real `useQuery` calls now
// and would throw without a `QueryClientProvider`, so they are stubbed empty
// here. Their coverage lives in `ApplicationDetail.workflowChecklist.test.tsx`.
vi.mock('../hooks/useResumeVariants');
vi.mock('../hooks/useInterviewPrep');

/**
 * WIC-1533 AC-1 and AC-2, asserted where the user actually is.
 *
 * `/cover-letters/:id` was only ever reached by the redirect `CoverLetterNew`
 * fires immediately after generation, on the branch taken when no application
 * id is present. Every application-attached path took the *other* branch and
 * landed back here — on a page containing zero references to cover letters. The
 * letter was then unreachable by any means for the rest of its life.
 *
 * These tests assert a **control on the page**, reached by rendering the route
 * cold rather than by completing a generation flow. That is the distinction
 * AC-2 draws: a post-action redirect is not an entry point, because it cannot
 * be used a second time.
 */
const application: Application = {
  id: 'app_1',
  jobTitle: 'Staff Engineer',
  company: 'Acme',
  status: 'applied',
  hasDocuments: false,
  version: 1,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  jobDescription: 'Build things.',
};

function letter(overrides: Partial<CoverLetterSummary> = {}): CoverLetterSummary {
  return {
    id: 'cl_1',
    status: 'finalized',
    title: 'Cover Letter - Staff Engineer at Acme',
    targetCompany: 'Acme',
    targetRole: 'Staff Engineer',
    tone: 'professional',
    lengthVariant: 'standard',
    preview: 'Dear hiring manager…',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    ...overrides,
  };
}

function renderDetail(coverLetters: CoverLetterSummary[]) {
  vi.mocked(useApplication).mockReturnValue({
    data: application,
    isLoading: false,
  } as ReturnType<typeof useApplication>);

  vi.mocked(useCoverLetters).mockReturnValue({
    data: coverLetters,
    isLoading: false,
  } as ReturnType<typeof useCoverLetters>);

  vi.mocked(useResumeVariants).mockReturnValue({
    data: { variants: [] },
    isLoading: false,
  } as unknown as ReturnType<typeof useResumeVariants>);

  vi.mocked(useInterviewPrepByApplication).mockReturnValue({
    data: null,
    isLoading: false,
  } as ReturnType<typeof useInterviewPrepByApplication>);

  return render(
    <MemoryRouter initialEntries={['/applications/app_1']}>
      <Routes>
        <Route path="/applications/:id" element={<ApplicationDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

function coverLetterSection() {
  return screen.getByRole('heading', { name: 'Cover Letters' }).closest('div')!
    .parentElement as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ApplicationDetail — Cover Letters section', () => {
  it('links to the letter written for this application', () => {
    renderDetail([letter()]);

    // The accessible name spans both the title and the status/date meta, which
    // is deliberate — a screen-reader user hears "…Finalized, 6 days ago"
    // rather than an undifferentiated list of identically-titled letters.
    const link = within(coverLetterSection()).getByRole('link', {
      name: /^Cover Letter - Staff Engineer at Acme/,
    });
    expect(link).toHaveAttribute('href', '/cover-letters/cl_1');
  });

  /**
   * The AC-2 assertion. Nothing here completed a generation flow — the route
   * was rendered cold, which is what "navigate away and come back" looks like.
   */
  it('offers the link on a cold render, with no generation having just happened', () => {
    renderDetail([letter()]);

    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toContain(
      '/cover-letters/cl_1'
    );
  });

  it('does not show letters belonging to a different role at the same company', () => {
    renderDetail([letter({ id: 'cl_other', targetRole: 'Engineering Manager' })]);

    expect(
      screen.queryByRole('link', { name: /Cover Letter - Staff Engineer at Acme/ })
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).not.toContain(
      '/cover-letters/cl_other'
    );
  });

  it('invites the user to write one when none exists, without claiming completion', () => {
    renderDetail([]);

    const section = coverLetterSection();
    expect(within(section).getByText(/No cover letters yet for this role/)).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Write a new one' })).toHaveAttribute(
      'href',
      '/cover-letters/new?appId=app_1'
    );
    expect(screen.getByText('0 of 4 steps completed')).toBeInTheDocument();
  });

  /**
   * AC-4 through the real call site rather than through the component in
   * isolation: the checklist row must tick *and* repoint at the letter, which
   * is only possible because `ApplicationDetail` now has the id to pass down.
   */
  it('ticks the checklist step and repoints it at the letter', () => {
    renderDetail([letter()]);

    expect(screen.getByText('1 of 4 steps completed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cover Letter' })).toHaveAttribute(
      'href',
      '/cover-letters/cl_1'
    );
  });

  /**
   * The page cap, asserted at the only place that can be wrong: the arguments
   * this page passes to the query.
   *
   * The exact `(company, role)` predicate runs on whatever page the server
   * returned. The only server-side narrowing available is `?company=`, an
   * `ilike '%…%'`, so letters for every other role at this company — and at
   * every company whose name contains it — share that page, ordered
   * `created_at desc`. At the endpoint's default of 20 rows, an application
   * with 20 newer sibling letters gets a page containing none of its own: the
   * section renders "No cover letters yet for this role" and the checklist row
   * falls back to `/cover-letters/new`. That is this card's own defect
   * reappearing at the tail of the list, and **no assertion over rendered
   * output can see it**, because the rendering is correct for the data it was
   * handed. It has to be asserted on the request.
   *
   * `coverLetters.list.test.ts` carries the other half — that the limit
   * survives as far as the request URL.
   */
  it('asks the server for the maximum page, not the default 20', () => {
    renderDetail([letter()]);

    expect(vi.mocked(useCoverLetters)).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'Acme', limit: TARGETED_LIST_PAGE_MAX }),
      expect.anything()
    );
    expect(TARGETED_LIST_PAGE_MAX).toBeGreaterThan(20);
  });

  /**
   * The checklist links the *newest* letter, and the section lists all of them.
   * A user who regenerated should land on what they last produced.
   */
  it('links the newest letter from the checklist when several exist', () => {
    renderDetail([
      letter({ id: 'cl_old', title: 'Older draft', createdAt: '2026-08-03T00:00:00.000Z' }),
      letter({ id: 'cl_new', title: 'Newer draft', createdAt: '2026-08-09T00:00:00.000Z' }),
    ]);

    expect(screen.getByRole('link', { name: 'Cover Letter' })).toHaveAttribute(
      'href',
      '/cover-letters/cl_new'
    );
    const section = coverLetterSection();
    expect(within(section).getByRole('link', { name: /^Newer draft/ })).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /^Older draft/ })).toBeInTheDocument();
  });
});
