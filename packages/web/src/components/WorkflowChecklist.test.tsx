import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { WorkflowChecklist } from './WorkflowChecklist';

/**
 * Cover for WIC-1533's AC-4, and specifically for the correction made on that
 * card: passing `hasCoverLetter` alone is **not** the fix.
 *
 * A completed step drops its link (`link: hasX ? undefined : …`), so wiring
 * `hasCoverLetter={true}` from `ApplicationDetail` would have turned a
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
    renderChecklist({ hasCoverLetter: false });

    expect(screen.getByRole('link', { name: 'Cover Letter' })).toHaveAttribute(
      'href',
      '/cover-letters/new?appId=app_1'
    );
  });

  it('points at the letter once one exists', () => {
    renderChecklist({ hasCoverLetter: true, coverLetterId: 'cl_42' });

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
    renderChecklist({ hasCoverLetter: true, coverLetterId: 'cl_42' });

    expect(screen.getByRole('link', { name: 'Cover Letter' })).not.toHaveAttribute(
      'href',
      '/cover-letters/new?appId=app_1'
    );
  });

  /**
   * The id is optional, because `hasCoverLetter` can in principle be true with
   * no id to hand. That must degrade to the old inert row rather than to
   * `/cover-letters/undefined`.
   */
  it('falls back to an inert row when a letter exists but its id is unknown', () => {
    renderChecklist({ hasCoverLetter: true, coverLetterId: undefined });

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
    const { rerender } = renderChecklist({ hasCoverLetter: false });
    expect(screen.getByText('0 of 4 steps completed')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <WorkflowChecklist
          applicationId="app_1"
          status="applied"
          hasJobDescription={true}
          hasCoverLetter={true}
          coverLetterId="cl_42"
        />
      </MemoryRouter>
    );
    expect(screen.getByText('1 of 4 steps completed')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });
});
