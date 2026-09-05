import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { reportsService, type PipelineReportResponse } from '../services/api';
import { renderReportPage, tabUntilFocused } from '../test/reportsKeyboardNav';
import { ReportsPipeline } from './ReportsPipeline';

/**
 * `/reports/pipeline` cards are reachable and activatable by keyboard (WIC-2062).
 *
 * Sibling of `ReportsClosedLoop.keyboardNav.test.tsx`; see that file for the rationale.
 * This page's card is the smallest of the four — its heading is an `<h4>` holding only
 * the job title, with the company on a sibling `<p>` — so the accessible name of the
 * button is the title alone. Two columns are rendered so the assertions also cover that
 * the fix reaches every group, not just the first.
 */

function report(): PipelineReportResponse {
  return {
    groups: [
      {
        status: 'applied',
        count: 1,
        applications: [
          {
            id: 'app-applied',
            jobTitle: 'Data Engineer',
            company: 'Acme',
            location: 'Remote',
            nextAction: 'Await response',
            nextActionDue: '2026-09-20T00:00:00Z',
            updatedAt: '2026-09-04T00:00:00Z',
            createdAt: '2026-08-01T00:00:00Z',
          },
        ],
      },
      {
        status: 'interview',
        count: 1,
        applications: [
          {
            id: 'app-interview',
            jobTitle: 'Site Reliability Engineer',
            company: 'Globex',
            location: null,
            nextAction: null,
            nextActionDue: null,
            updatedAt: '2026-09-04T00:00:00Z',
            createdAt: '2026-08-10T00:00:00Z',
          },
        ],
      },
    ],
    totals: { active: 2, byStatus: { applied: 1, interview: 1 } },
    generatedAt: '2026-09-05T00:00:00Z',
  };
}

function renderPage() {
  vi.spyOn(reportsService, 'getPipeline').mockResolvedValue(report());
  return renderReportPage(<ReportsPipeline />, '/reports/pipeline');
}

describe('ReportsPipeline keyboard navigation', () => {
  it('exposes every column’s card titles as buttons in the accessibility tree', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: 'Data Engineer' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Site Reliability Engineer' })).toBeVisible();
  });

  it('reaches a card by Tab and opens it with Enter', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    const card = await screen.findByRole('button', { name: 'Data Engineer' });
    expect(await tabUntilFocused(user, card)).toBeGreaterThan(0);

    await user.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { name: 'Application app-applied' })).toBeVisible();
    expect(visited).toEqual(['/reports/pipeline', '/applications/app-applied']);
  });

  it('still opens the right card on click', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Site Reliability Engineer' }));

    expect(await screen.findByRole('heading', { name: 'Application app-interview' })).toBeVisible();
    expect(visited).toEqual(['/reports/pipeline', '/applications/app-interview']);
  });

  it('does not navigate from the inert card body', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    // The company line sits outside the heading button, so it must not be an affordance.
    await user.click(await screen.findByText('Remote'));

    expect(visited).toEqual(['/reports/pipeline']);
  });
});
