import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobFitAnalysis } from './JobFitAnalysis';
import { useJobFitAnalysis } from '../hooks/useJobFitAnalysis';
import { useApplication } from '../hooks/useApplications';

vi.mock('../hooks/useJobFitAnalysis');
vi.mock('../hooks/useApplications');

/**
 * WIC-1835 — the `appId` in the URL has to survive the API boundary.
 *
 * ## Why this is asserted on the request and not on anything rendered
 *
 * `WorkflowChecklist` links its "Job Fit Analysis" step at
 * `/job-fit-analysis?appId={id}`, and this page has read that param since it
 * was written (`searchParams.get('appId')`) — but only to *pre-fill* the job
 * description. The analyze call itself carried `jobDescriptionText` or
 * `jobDescriptionUrl` and nothing else, so the association the browser already
 * had was dropped at the API boundary and the stored analysis belonged to no
 * application.
 *
 * Nothing on this page renders differently either way. The consequence is a
 * page away: an analysis with a null `application_id` can never satisfy
 * `GET /catalog/job-fit/analyses?applicationId=…`, so `ApplicationDetail`'s
 * checklist keeps offering to create the analysis the user has just run. The
 * only place the defect is observable at this end is the request payload, which
 * is what these cases read.
 *
 * ## Why both cases are needed
 *
 * The positive case alone passes on a page that sends `applicationId`
 * unconditionally, which would put a literal `undefined` on the bare flow; the
 * negative case alone passes on the pre-fix page that never sends it at all.
 *
 * The application record is left *unloaded* in both. The id can therefore only
 * have come from the URL — an implementation reading `application?.id` instead
 * would send nothing here, which is a real state and not a contrived one: the
 * user can paste a description and submit before the fetch resolves.
 */

/** Long enough to clear the page's own 100-character minimum. */
const JOB_DESCRIPTION =
  'We are hiring a staff engineer to own our TypeScript platform, its deployment pipeline, and the ' +
  'teams that depend on both. Postgres and React throughout.';

const analyze = vi.fn();

async function submitAnalysis(search: string) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[`/job-fit-analysis${search}`]}>
      <Routes>
        <Route path="/job-fit-analysis" element={<JobFitAnalysis />} />
      </Routes>
    </MemoryRouter>
  );

  await user.type(screen.getByLabelText('Job Description'), JOB_DESCRIPTION);
  await user.click(screen.getByRole('button', { name: /Analyze Fit/ }));

  await waitFor(() => expect(analyze).toHaveBeenCalled());
  return analyze.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(useJobFitAnalysis).mockReturnValue({
    mutate: analyze,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useJobFitAnalysis>);

  vi.mocked(useApplication).mockReturnValue({
    data: undefined,
    isLoading: false,
  } as ReturnType<typeof useApplication>);
});

describe('JobFitAnalysis — the application the analysis is about', () => {
  it('sends the appId from the URL so the analysis can be found again', async () => {
    const request = await submitAnalysis('?appId=app_1');

    expect(request).toMatchObject({
      jobDescriptionText: JOB_DESCRIPTION,
      applicationId: 'app_1',
    });
  });

  /**
   * Analysing a bare job description with no application in hand is a supported
   * flow — every entry point except the checklist arrives here without an
   * `appId`. The field must then be absent rather than present and empty: the
   * endpoint validates it as `.min(1)`, so `''` is a 400 that would turn the
   * supported flow into a broken one.
   */
  it('omits it entirely when the page was reached without one', async () => {
    const request = await submitAnalysis('');

    expect(request).toHaveProperty('jobDescriptionText', JOB_DESCRIPTION);
    expect(request.applicationId).toBeUndefined();
  });
});
