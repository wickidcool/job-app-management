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
 * what had been ticked. The correction WIC-1533 recorded applies verbatim: passing the
 * step's presence alone is not the fix, because it turns a wrong-but-clickable row into a
 * correct-but-inert one. The row has to be repointed, so the call site supplies the id.
 *
 * These cells took a `hasFitAnalysis` boolean until WIC-2141 replaced it with the same
 * tri-state the other three rows carry. The prop moved; every assertion below is
 * unchanged, and they still fail on a component that ignores `jobFitAnalysisId`.
 *
 * The component half is pinned here and the wiring half in
 * `ApplicationDetail.workflowChecklist.test.tsx`; neither implies the other, which is the
 * same split the Cover Letter step already has.
 */
describe('WorkflowChecklist — Job Fit Analysis step', () => {
  it('points at the generator when no analysis exists', () => {
    renderChecklist({ fitAnalysisStatus: 'absent' });

    expect(screen.getByRole('link', { name: 'Job Fit Analysis' })).toHaveAttribute(
      'href',
      '/job-fit-analysis?appId=app_1'
    );
  });

  it('points at the analysis once one exists', () => {
    renderChecklist({ fitAnalysisStatus: 'present', jobFitAnalysisId: 'jfa_42', fitScore: 72 });

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
    renderChecklist({ fitAnalysisStatus: 'present', jobFitAnalysisId: 'jfa_7', fitScore: null });

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
    renderChecklist({ fitAnalysisStatus: 'present', jobFitAnalysisId: 'jfa_42' });

    expect(screen.getByRole('link', { name: 'Job Fit Analysis' })).not.toHaveAttribute(
      'href',
      '/job-fit-analysis?appId=app_1'
    );
  });

  /**
   * The id is optional — the status comes from a list read that can settle before
   * the caller has an id in hand — and absence must degrade to the old inert row rather
   * than to `/job-fit-analysis/undefined`.
   */
  it('falls back to an inert row when an analysis exists but its id is unknown', () => {
    renderChecklist({ fitAnalysisStatus: 'present', jobFitAnalysisId: undefined });

    expect(screen.queryByRole('link', { name: 'Job Fit Analysis' })).not.toBeInTheDocument();
    expect(screen.getByText('Job Fit Analysis')).toBeInTheDocument();
  });
});

/**
 * WIC-2141 — the Job Fit Analysis row was hardcoded `unknown: false` behind a
 * comment reading "backed by no query at all (WIC-1652), so it is never
 * unknown". WIC-1652 had since given the row a query, so the literal asserted
 * something the data no longer supported. It now takes the same tri-state as
 * the other three, which is what the cells above were migrated onto.
 *
 * These assert the component contract; `ApplicationDetail.artefactLoading.test.tsx`
 * asserts the page wiring. The default matters as much as the states: because
 * the tri-state *replaced* a boolean, a caller that passes nothing must still
 * get the old settled-and-absent row rather than one that loads forever.
 */
describe('WorkflowChecklist — Job Fit Analysis step while its query is in flight (WIC-2141)', () => {
  it('withholds the generator link while the query is in flight', () => {
    renderChecklist({ fitAnalysisStatus: 'unknown' });

    expect(screen.queryByRole('link', { name: 'Job Fit Analysis' })).not.toBeInTheDocument();
  });

  /**
   * The discriminating half. `'absent'` renders this pill on the same props —
   * the application has a job description and no analysis — so a component that
   * ignored the new state entirely fails here.
   */
  it('withholds "Recommended" while the query is in flight, and offers it once settled', () => {
    const { unmount } = renderChecklist({ fitAnalysisStatus: 'unknown' });
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
    unmount();

    renderChecklist({ fitAnalysisStatus: 'absent' });
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('drops an unknown step from the denominator and withholds the percentage', () => {
    renderChecklist({ fitAnalysisStatus: 'unknown' });

    expect(screen.getByText('0 of 3 steps completed')).toBeInTheDocument();
    expect(screen.getByText('Checking 1 more step…')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  /**
   * The tick is driven by the step's state and not by `fitScore`, so an
   * analysis that scored nothing still counts once the query settles. This is
   * the WIC-2058 invariant restated against the new prop, because the migration
   * above is exactly where it could have been lost.
   */
  it('counts an unscored analysis once the query settles', () => {
    renderChecklist({ fitAnalysisStatus: 'present', fitScore: null });

    expect(screen.getByText('1 of 4 steps completed')).toBeInTheDocument();
    expect(screen.queryByText(/% match/)).not.toBeInTheDocument();
  });

  it('defaults to settled-and-absent when the caller passes no status', () => {
    renderChecklist();

    expect(screen.getByText('0 of 4 steps completed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Job Fit Analysis' })).toHaveAttribute(
      'href',
      '/job-fit-analysis?appId=app_1'
    );
  });
});

/**
 * WIC-2153 — the header at a zero denominator.
 *
 * Reachable only since WIC-2141: while the fourth row was hardcoded settled,
 * `totalCount = items.length - unknownCount` had a floor of 1. With four
 * tri-states it can be 0, which is the cold page load, and the header read
 * "0 of 0 steps completed" next to "Checking 4 more steps…".
 *
 * The component-level counterpart to the `all-in-flight` phase in
 * `ApplicationDetail.artefactLoading.test.tsx`: that one proves the page can
 * reach this state, these prove what the component does in it.
 */
describe('WorkflowChecklist — every step unknown (WIC-2153)', () => {
  const allUnknown = {
    fitAnalysisStatus: 'unknown',
    coverLetterStatus: 'unknown',
    resumeVariantStatus: 'unknown',
    interviewPrepStatus: 'unknown',
  } as const;

  it('withholds the count line rather than stating a zero denominator', () => {
    renderChecklist(allUnknown);

    expect(screen.queryByText(/steps completed/)).not.toBeInTheDocument();
    expect(screen.queryByText('0 of 0 steps completed')).not.toBeInTheDocument();
  });

  it('drops "more" from the checking line when no step is known', () => {
    renderChecklist(allUnknown);

    expect(screen.getByText('Checking 4 steps…')).toBeInTheDocument();
  });

  /**
   * The discriminating half. A fix that dropped "more" unconditionally, or
   * suppressed the count line unconditionally, passes both assertions above and
   * fails this one — one known step is enough for both to be correct again.
   */
  it('keeps both lines as soon as one step is known', () => {
    renderChecklist({ ...allUnknown, interviewPrepStatus: 'absent' });

    expect(screen.getByText('0 of 1 steps completed')).toBeInTheDocument();
    expect(screen.getByText('Checking 3 more steps…')).toBeInTheDocument();
  });

  it('withholds the percentage without rendering NaN', () => {
    const { container } = renderChecklist(allUnknown);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
  });
});
