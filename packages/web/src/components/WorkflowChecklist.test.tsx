import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { WorkflowChecklist } from './WorkflowChecklist';

/**
 * Cover for WIC-1533's AC-4, and specifically for the correction made on that
 * card: passing `coverLetterStatus` alone is **not** the fix.
 *
 * A completed step drops its link (`link: hasX ? undefined : …`), so wiring
 * `coverLetterStatus="present"` from `ApplicationDetail` would have turned a
 * wrong-but-clickable row ("Cover Letter" → go write *another* one) into a
 * correct-but-inert one — the checklist would finally read "done" and the
 * letter would still be unreachable. The row has to be repointed at the letter,
 * which means the call site has to supply its id.
 */
function renderChecklist(props: Partial<React.ComponentProps<typeof WorkflowChecklist>> = {}) {
  return render(
    <MemoryRouter>
      <WorkflowChecklist
        applicationId="app_1"
        status="applied"
        hasJobDescription={true}
        {...props}
      />
    </MemoryRouter>
  );
}

describe('WorkflowChecklist — Cover Letter step', () => {
  it('points at the generator when no letter exists', () => {
    renderChecklist({ coverLetterStatus: 'absent' });

    expect(screen.getByRole('link', { name: 'Cover Letter' })).toHaveAttribute(
      'href',
      '/cover-letters/new?appId=app_1'
    );
  });

  it('points at the letter once one exists', () => {
    renderChecklist({ coverLetterStatus: 'present', coverLetterId: 'cl_42' });

    expect(screen.getByRole('link', { name: 'Cover Letter' })).toHaveAttribute(
      'href',
      '/cover-letters/cl_42'
    );
  });

  /**
   * The discriminating assertion. Both of the above pass on a component that
   * ignores `coverLetterId` entirely *if* you only check "is there a link" —
   * the pre-fix component renders a link in the first case and a plain span in
   * the second, and a naive test would call that a pass. This pins the *target*,
   * so the pre-fix behaviour (no link at all when completed) fails here.
   */
  it('does not send a completed step back to the generator', () => {
    renderChecklist({ coverLetterStatus: 'present', coverLetterId: 'cl_42' });

    expect(screen.getByRole('link', { name: 'Cover Letter' })).not.toHaveAttribute(
      'href',
      '/cover-letters/new?appId=app_1'
    );
  });

  /**
   * The id is optional, because a letter can in principle be `'present'` with
   * no id to hand. That must degrade to the old inert row rather than to
   * `/cover-letters/undefined`.
   */
  it('falls back to an inert row when a letter exists but its id is unknown', () => {
    renderChecklist({ coverLetterStatus: 'present', coverLetterId: undefined });

    expect(screen.queryByRole('link', { name: 'Cover Letter' })).not.toBeInTheDocument();
    expect(screen.getByText('Cover Letter')).toBeInTheDocument();
  });

  /**
   * The step count is what makes the row's `completed` flag visible to the
   * user, and it was stuck at "0 of 4" for every application because
   * `ApplicationDetail` passed none of these props (WIC-1536 covers the other
   * two rows). One tick is one quarter.
   */
  it('counts a completed cover letter toward the progress readout', () => {
    const { rerender } = renderChecklist({ coverLetterStatus: 'absent' });
    expect(screen.getByText('0 of 4 steps completed')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <WorkflowChecklist
          applicationId="app_1"
          status="applied"
          hasJobDescription={true}
          coverLetterStatus="present"
          coverLetterId="cl_42"
        />
      </MemoryRouter>
    );
    expect(screen.getByText('1 of 4 steps completed')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });
});

/**
 * WIC-2058 / WIC-1860 — the same defect the Cover Letter suite above closed, on the one
 * row that still had it.
 *
 * `link: hasFitAnalysis ? undefined : …` made ticking the step *remove* the way to see
 * what had been ticked. The correction WIC-1533 recorded applies verbatim: passing
 * `hasFitAnalysis` alone is not the fix, because it turns a wrong-but-clickable row into a
 * correct-but-inert one. The row has to be repointed, so the call site supplies the id.
 *
 * The component half is pinned here and the wiring half in
 * `ApplicationDetail.workflowChecklist.test.tsx`; neither implies the other, which is the
 * same split the Cover Letter step already has.
 */
describe('WorkflowChecklist — Job Fit Analysis step', () => {
  it('points at the generator when no analysis exists', () => {
    renderChecklist({ hasFitAnalysis: false });

    expect(screen.getByRole('link', { name: 'Job Fit Analysis' })).toHaveAttribute(
      'href',
      '/job-fit-analysis?appId=app_1'
    );
  });

  it('points at the analysis once one exists', () => {
    renderChecklist({ hasFitAnalysis: true, jobFitAnalysisId: 'jfa_42', fitScore: 72 });

    expect(screen.getByRole('link', { name: 'Job Fit Analysis' })).toHaveAttribute(
      'href',
      '/job-fit-analysis/jfa_42'
    );
  });

  /**
   * AC-4. The unscored analysis is the state this card exists for: it ticks the step and
   * renders no badge, so it was the row that said "done" and showed nothing. A fix keyed
   * on `fitScore` rather than on the id would pass the cell above and leave this one a
   * dead end, so it is asserted rather than assumed to follow.
   */
  it('links an unscored analysis, which has no badge to offer instead', () => {
    renderChecklist({ hasFitAnalysis: true, jobFitAnalysisId: 'jfa_7', fitScore: null });

    expect(screen.getByRole('link', { name: 'Job Fit Analysis' })).toHaveAttribute(
      'href',
      '/job-fit-analysis/jfa_7'
    );
    expect(screen.queryByText(/% match/)).not.toBeInTheDocument();
  });

  /**
   * The discriminating assertion, mirroring the Cover Letter one: both cells above are
   * satisfied by a component that ignores `jobFitAnalysisId` *if* the test only asks
   * whether a link exists, because the pre-fix component renders a link in the first case
   * and a plain span in the second. Pinning the target is what makes the pre-fix behaviour
   * fail here.
   */
  it('does not send a completed step back to the generator', () => {
    renderChecklist({ hasFitAnalysis: true, jobFitAnalysisId: 'jfa_42' });

    expect(screen.getByRole('link', { name: 'Job Fit Analysis' })).not.toHaveAttribute(
      'href',
      '/job-fit-analysis?appId=app_1'
    );
  });

  /**
   * The id is optional — `hasFitAnalysis` comes from a list read that can settle before
   * the caller has an id in hand — and absence must degrade to the old inert row rather
   * than to `/job-fit-analysis/undefined`.
   */
  it('falls back to an inert row when an analysis exists but its id is unknown', () => {
    renderChecklist({ hasFitAnalysis: true, jobFitAnalysisId: undefined });

    expect(screen.queryByRole('link', { name: 'Job Fit Analysis' })).not.toBeInTheDocument();
    expect(screen.getByText('Job Fit Analysis')).toBeInTheDocument();
  });
});
