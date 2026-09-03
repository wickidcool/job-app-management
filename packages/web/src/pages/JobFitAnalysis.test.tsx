import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { JobFitAnalysis } from './JobFitAnalysis';
import { getOutline, findOutlineSkips } from '../test/headingOutline';
import type { AnalyzeJobFitResponse } from '../types/jobFit';

/**
 * `/job-fit-analysis` dropped its h1 in two of its states (WIC-1099 §3).
 *
 * The component returns from five places, and each return is a separate document outline.
 * Two of them — analyzing and error — opened at h2 *instead of*, not below, the h1, so the
 * route had no top-level heading while an analysis was running and none when it had failed.
 * The failed state is the one that matters: it is precisely when a user needs to orient.
 *
 * A per-file grep for `<h1` sees this file and reports it clean, because two of the five
 * branches do render one. That is the shape of the defect and the reason every case below
 * drives the component into a specific branch and reads *that* branch's outline.
 *
 * The fix is the second option in the ticket rather than the first: one persistent h1 for
 * the route, emitted by `JobFitAnalysisFrame`, with the stage speaking at h2 beneath it.
 * Promoting the two h2s instead would have left the route's accessible name changing under
 * the user as an async stage advanced — `Job Fit Analysis`, then `Job Fit Analysis Results`,
 * with two more strings in between.
 *
 * The application-loading branch is a fifth outline the ticket's audit did not reach; it was
 * headingless too, and it is covered here for the same reason.
 */
const mockApplication = { data: undefined as unknown, isLoading: false };
const mockMutation = {
  mutate: vi.fn(),
  isPending: false,
  error: null as unknown,
};

vi.mock('../hooks/useApplications', () => ({
  useApplication: () => mockApplication,
}));

vi.mock('../hooks/useJobFitAnalysis', () => ({
  useJobFitAnalysis: () => mockMutation,
}));

const RESULTS: AnalyzeJobFitResponse = {
  id: 'jfa_1',
  applicationId: null,
  recommendation: 'moderate_fit',
  fitScore: 62,
  summary: 'A reasonable match with two gaps.',
  confidence: 'medium',
  parsedJd: {
    roleTitle: 'Senior Engineer',
    seniority: 'senior',
    seniorityConfidence: 'high',
    requiredStack: ['typescript'],
    niceToHaveStack: [],
    industries: [],
    teamScope: null,
    location: null,
    compensation: null,
  },
  strongMatches: [],
  partialMatches: [],
  gaps: [],
  recommendedStarEntries: [],
  catalogEmpty: false,
  analysisTimestamp: '2026-08-29T00:00:00.000Z',
};

function renderJobFit() {
  return render(
    <MemoryRouter initialEntries={['/job-fit-analysis']}>
      <JobFitAnalysis />
    </MemoryRouter>
  );
}

/**
 * Fill the form and submit it, which is the only way into the non-input branches.
 *
 * The `mutate` assertion is the point: react-hook-form validates asynchronously, so a
 * fire-and-forget click returns before the stage has moved, and every branch case would
 * then read the input stage's outline and pass. Waiting on the call the component makes
 * is what makes "we reached this branch" a fact rather than a hope.
 */
async function submitAnalysis() {
  fireEvent.change(screen.getByLabelText('Job Description'), {
    target: { value: 'x'.repeat(200) },
  });
  fireEvent.click(screen.getByRole('button', { name: /analyze fit/i }));
  await waitFor(() => expect(mockMutation.mutate).toHaveBeenCalled());
}

beforeEach(() => {
  mockApplication.data = undefined;
  mockApplication.isLoading = false;
  mockMutation.isPending = false;
  mockMutation.error = null;
  mockMutation.mutate = vi.fn();
});

const ROUTE_NAME = 'Job Fit Analysis';

describe('/job-fit-analysis heading outline, per branch (WIC-1099 §3)', () => {
  it('names the route in an h1 at the input stage', () => {
    renderJobFit();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ROUTE_NAME);
  });

  it('keeps the h1 while the analysis is running', async () => {
    // `mutate` is a no-op here, so the component sits in the stage it set synchronously
    // before calling it — which is what a user sees for the ~10-15 seconds the screen
    // itself advertises.
    renderJobFit();
    await submitAnalysis();

    expect(screen.getByText('Analyzing Job Fit...')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ROUTE_NAME);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Analyzing Job Fit...');
  });

  it('keeps the h1 when the analysis has failed — the state the ticket calls the one that matters', async () => {
    mockMutation.mutate = vi.fn((_request, { onError }) => onError(new Error('boom')));
    renderJobFit();
    await submitAnalysis();

    expect(screen.getByText('Analysis Failed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ROUTE_NAME);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Analysis Failed');
  });

  it('keeps the h1 while the prefill application is loading', () => {
    mockApplication.isLoading = true;
    renderJobFit();

    expect(screen.getByText('Loading application data...')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ROUTE_NAME);
  });

  it('holds the route’s name still across the input → results transition', async () => {
    // The §3 argument for a persistent h1 over promoting the stage headings. Before this,
    // the accessible page name changed from `Job Fit Analysis` to `Job Fit Analysis Results`
    // when the request came back — a rename with no user action behind it.
    mockMutation.mutate = vi.fn((_request, { onSuccess }) => onSuccess(RESULTS));
    renderJobFit();

    const before = screen.getByRole('heading', { level: 1 }).textContent;
    await submitAnalysis();
    const after = screen.getByRole('heading', { level: 1 }).textContent;

    expect(before).toBe(after);
    expect(after).toBe(ROUTE_NAME);
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('Results');
  });

  it('opens at h1 and never skips a level, in every one of the five branches', async () => {
    const branches: Array<[string, () => Promise<void>]> = [
      ['input', async () => {}],
      ['analyzing', () => submitAnalysis()],
      [
        'error',
        async () => {
          mockMutation.mutate = vi.fn((_r, { onError }) => onError(new Error('boom')));
          await submitAnalysis();
        },
      ],
      [
        'results',
        async () => {
          mockMutation.mutate = vi.fn((_r, { onSuccess }) => onSuccess(RESULTS));
          await submitAnalysis();
        },
      ],
    ];

    for (const [name, drive] of branches) {
      const view = renderJobFit();
      await drive();

      const outline = getOutline(view.container);
      expect(outline.length, `${name}: rendered no headings at all`).toBeGreaterThan(0);
      expect(outline[0].level, `${name}: outline does not open at h1`).toBe(1);
      expect(outline[0].text, `${name}: h1 does not name the route`).toBe(ROUTE_NAME);
      expect(findOutlineSkips(outline), `${name}: outline skips a level`).toEqual([]);

      view.unmount();
    }

    // The fifth branch needs different state, so it is driven separately rather than being
    // silently dropped from the loop.
    mockApplication.isLoading = true;
    const loading = renderJobFit();
    const outline = getOutline(loading.container);
    expect(outline[0].level).toBe(1);
    expect(outline[0].text).toBe(ROUTE_NAME);
    expect(findOutlineSkips(outline)).toEqual([]);
  });

  it('reaches a distinct stage in each branch, so the sweep above is not four copies of one screen', async () => {
    // The control on the control. Every case above asserts the same h1, which is exactly what
    // a broken driver would also produce: if `submitAnalysis()` silently stopped submitting,
    // all four branches would render the input stage and the sweep would stay green while
    // testing nothing. These are the stage-specific strings, one per branch.
    const seen: string[] = [];

    const view = renderJobFit();
    seen.push(view.container.querySelector('form') ? 'input' : 'no-form');
    await submitAnalysis();
    seen.push(screen.getByText('Analyzing Job Fit...').textContent ?? '');
    view.unmount();

    mockMutation.mutate = vi.fn((_r, { onError }) => onError(new Error('boom')));
    const errored = renderJobFit();
    await submitAnalysis();
    seen.push(screen.getByText('Analysis Failed').textContent ?? '');
    errored.unmount();

    mockMutation.mutate = vi.fn((_r, { onSuccess }) => onSuccess(RESULTS));
    renderJobFit();
    await submitAnalysis();
    seen.push(screen.getByRole('heading', { level: 2 }).textContent ?? '');

    expect(seen).toEqual(['input', 'Analyzing Job Fit...', 'Analysis Failed', 'Results']);
  });
});
