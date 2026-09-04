import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobFitAnalysisDetail } from './JobFitAnalysisDetail';
import { useJobFitAnalysisById } from '../hooks/useJobFitAnalysis';
import type { JobFitAnalysisSummary } from '../types/jobFit';

/**
 * WIC-2058 AC-1 — the viewer route, which is what makes AC-2's link have somewhere to go.
 *
 * The hook is mocked rather than the service, deliberately narrowly: what this file is for
 * is the four render branches and the two `null`-vs-`0` traps the summary contract carries,
 * not React Query's plumbing. The hook's own contract — `enabled: !!id`, `retry: false`, and
 * the query key — is asserted at the bottom against the real module's shape.
 */
vi.mock('../hooks/useJobFitAnalysis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useJobFitAnalysis')>()),
  useJobFitAnalysisById: vi.fn(),
}));

function analysis(overrides: Partial<JobFitAnalysisSummary> = {}): JobFitAnalysisSummary {
  return {
    id: 'jfa_1',
    applicationId: 'app_1',
    recommendation: 'moderate_fit',
    fitScore: 62,
    summary: 'You match 4 of 6 required skills.',
    confidence: 'high',
    catalogEmpty: false,
    analyzedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

type HookResult = ReturnType<typeof useJobFitAnalysisById>;

function renderPage(state: Partial<HookResult>) {
  vi.mocked(useJobFitAnalysisById).mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    ...state,
  } as HookResult);

  return render(
    <MemoryRouter initialEntries={['/job-fit-analysis/jfa_1']}>
      <Routes>
        <Route path="/job-fit-analysis/:id" element={<JobFitAnalysisDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

const loaded = (over: Partial<JobFitAnalysisSummary> = {}) => ({
  data: { analysis: analysis(over) },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JobFitAnalysisDetail — the heading is structural, not per-branch', () => {
  /**
   * The defect class `routeOutline.render.test.tsx` inventories, asserted here at the unit
   * level too so it reds without running the whole 124-pair sweep. Every branch must carry
   * the `<h1>`; a page whose heading sits below an `isLoading` early return comes back with
   * no top-level heading at all on exactly the branches where a user most needs to know
   * where they are (WCAG 2.1 AA, SC 1.3.1).
   */
  it.each([
    ['loading', { isLoading: true }],
    ['error', { error: new Error('boom') }],
    ['not found', { data: { analysis: null } as unknown as HookResult['data'] }],
    ['loaded', loaded()],
  ])('renders exactly one h1 on the %s branch', (_name, state) => {
    renderPage(state as Partial<HookResult>);

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Job Fit Analysis');
  });
});

describe('JobFitAnalysisDetail — the stored analysis', () => {
  it('renders the verdict, the score, the summary and the confidence', () => {
    renderPage(loaded());

    expect(screen.getByText('Possible fit')).toBeInTheDocument();
    expect(screen.getByText('62% match')).toBeInTheDocument();
    expect(screen.getByText('You match 4 of 6 required skills.')).toBeInTheDocument();
    expect(screen.getByText(/Confidence: high/)).toBeInTheDocument();
  });

  /**
   * AC-4 proper. `fitScore === null` is an analysis that scored nothing — an empty catalog,
   * or a JD naming no required skills — and it is the state that reaches this page with no
   * badge on the row that sent it here. Rendering "0% match" would be a false number and
   * rendering nothing at all would repeat the defect one level down, so the page says why.
   */
  it('explains an unscored analysis instead of showing a number it does not have', () => {
    renderPage(loaded({ fitScore: null, recommendation: null, catalogEmpty: true }));

    expect(screen.queryByText(/% match/)).not.toBeInTheDocument();
    expect(screen.getByText('No recommendation')).toBeInTheDocument();
    expect(screen.getByText(/your catalog was empty/)).toBeInTheDocument();
  });

  it('distinguishes an empty catalog from a job description with no required skills', () => {
    // Both are `fitScore: null`, and telling the user the wrong one sends them to fix
    // something that is not broken. `catalogEmpty` is the only field that separates them,
    // which is why it is on the summary contract at all.
    renderPage(loaded({ fitScore: null, recommendation: null, catalogEmpty: false }));

    expect(screen.getByText(/named no required skills/)).toBeInTheDocument();
  });

  /**
   * The discriminating case for the badge, and the reason the page tests `!= null` rather
   * than truthiness. Under `fitScore ? …` a genuine 0% match renders no badge, so a user
   * whose catalog matched none of the required stack sees the *unscored* screen — a
   * different claim about their catalog than the one the analysis made.
   */
  it('renders a genuine zero as a score, not as unscored', () => {
    renderPage(loaded({ fitScore: 0, recommendation: 'low_fit' }));

    expect(screen.getByText('0% match')).toBeInTheDocument();
    expect(screen.queryByText(/produced no match score/)).not.toBeInTheDocument();
  });

  it('links back to the application the analysis is about', () => {
    renderPage(loaded({ applicationId: 'app_9' }));

    expect(screen.getByRole('link', { name: 'View application' })).toHaveAttribute(
      'href',
      '/applications/app_9'
    );
  });

  /**
   * `application_id` is nullable by contract — analysing a bare job description from
   * `/job-fit-analysis` with no `appId` is a supported flow. Linking unconditionally would
   * produce `/applications/null`, a URL that routes to a page which cannot load.
   */
  it('does not invent an application link for an analysis that has none', () => {
    renderPage(loaded({ applicationId: null }));

    expect(screen.queryByRole('link', { name: 'View application' })).not.toBeInTheDocument();
    expect(screen.getByText('Not linked to an application')).toBeInTheDocument();
  });

  /**
   * A miss and a cross-tenant hit are the same answer from the server — it ANDs the owner
   * term into the read, so a stranger's id and a nonexistent one both come back 404. The
   * page must not promise a distinction that does not exist, and must still offer a way
   * onward rather than being a second dead end.
   */
  it('offers a way onward when the analysis is not there', () => {
    renderPage({ error: new Error('404') });

    expect(screen.getByText(/couldn't find that job fit analysis/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Run a new analysis' })).toHaveAttribute(
      'href',
      '/job-fit-analysis'
    );
  });

  it('reads the id out of the URL and asks for that analysis', () => {
    renderPage(loaded());

    expect(vi.mocked(useJobFitAnalysisById)).toHaveBeenCalledWith('jfa_1');
  });
});
