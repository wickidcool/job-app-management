import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationDetail } from './ApplicationDetail';
import { useApplication } from '../hooks/useApplications';
import { useCoverLetters } from '../hooks/useCoverLetters';
import type { Application } from '../types/application';
import type { CoverLetterSummary } from '../services/api/types';

vi.mock('../hooks/useApplications');
vi.mock('../hooks/useCoverLetters');

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
