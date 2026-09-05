import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { reportsService, type ClosedLoopReportResponse } from '../services/api';
import { renderReportPage, tabUntilFocused } from '../test/reportsKeyboardNav';
import { ReportsClosedLoop } from './ReportsClosedLoop';

/**
 * `/reports/closed-loop` cards are reachable and activatable by keyboard (WIC-2062).
 *
 * `ClosedAppCard` used to be a bare `<div onClick={…} className="cursor-pointer">` with no
 * `tabIndex`, no `role` and no key handler — mouse-only, and absent from the accessibility
 * tree. Navigation now hangs off a real `<button>` inside the card's `<h3>`, following the
 * `ResumeVariantCard` precedent (WIC-1942) rather than putting a role on the wrapper.
 *
 * Nothing pinned this page's behaviour before. `ReportsByFitTier.test.tsx` is the only
 * pre-existing test on any report page, and it covers empty-state copy on a different
 * route; none of these four pages had a test, and no e2e spec touches reports. So the only
 * thing that would have caught a regression was the `jsx-a11y` warning count — which says
 * a rule fired somewhere in the file, not that a user can reach the card.
 */

function report(): ClosedLoopReportResponse {
  return {
    applications: [
      {
        id: 'app-offer',
        jobTitle: 'Staff Engineer',
        company: 'Acme',
        status: 'offer',
        closedAt: '2026-08-20T00:00:00Z',
        previousStatus: 'interview',
        daysInPipeline: 42,
        salaryRange: '$200k - $240k',
        compTarget: '$220k',
      },
      {
        id: 'app-rejected',
        jobTitle: 'Principal Engineer',
        company: 'Globex',
        status: 'rejected',
        closedAt: '2026-08-18T00:00:00Z',
        previousStatus: 'phone_screen',
        daysInPipeline: 17,
      },
    ],
    summary: {
      total: 2,
      offers: 1,
      rejections: 1,
      withdrawn: 0,
      rejectionsByStage: [{ stage: 'phone_screen', count: 1, percentage: 100 }],
      averageTimeToClose: 30,
    },
    generatedAt: '2026-09-05T00:00:00Z',
  };
}

/**
 * Spy on the real service method rather than declaring a `vi.mock` factory. A factory is
 * an allowlist: it keeps passing when the page starts calling a second method, because it
 * silently supplies `undefined`. `restoreMocks: true` in `vitest.config.ts` undoes the spy.
 */
function renderPage() {
  vi.spyOn(reportsService, 'getClosedLoop').mockResolvedValue(report());
  return renderReportPage(<ReportsClosedLoop />, '/reports/closed-loop');
}

describe('ReportsClosedLoop keyboard navigation', () => {
  it('exposes each card title as a button in the accessibility tree', async () => {
    renderPage();

    // `getByRole('button')` is the assertion, not a `getByText` on the same string: the
    // defect was precisely that the card carried its affordance without any role, so it
    // was findable by text the whole time it was unusable.
    expect(await screen.findByRole('button', { name: 'Staff Engineer @ Acme' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Principal Engineer @ Globex' })).toBeVisible();
  });

  it('reaches a card by Tab and opens it with Enter', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    const card = await screen.findByRole('button', { name: 'Staff Engineer @ Acme' });
    expect(await tabUntilFocused(user, card)).toBeGreaterThan(0);

    await user.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { name: 'Application app-offer' })).toBeVisible();
    expect(visited).toEqual(['/reports/closed-loop', '/applications/app-offer']);
  });

  it('still opens the right card on click', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Principal Engineer @ Globex' }));

    expect(await screen.findByRole('heading', { name: 'Application app-rejected' })).toBeVisible();
    expect(visited).toEqual(['/reports/closed-loop', '/applications/app-rejected']);
  });

  it('does not navigate from the inert card body', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    // The control for "the handler moved rather than being duplicated". Re-adding an
    // `onClick` to the wrapper `<div>` would reinstate the lint pair *and* make this
    // text clickable, so this fails where a count of green checks would not.
    await user.click(await screen.findByText('42 days in pipeline'));

    expect(visited).toEqual(['/reports/closed-loop']);
  });
});
