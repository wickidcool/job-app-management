import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { reportsService, type NeedsActionReportResponse } from '../services/api';
import { renderReportPage, tabUntilFocused } from '../test/reportsKeyboardNav';
import { ReportsNeedsAction } from './ReportsNeedsAction';

/**
 * `/reports/needs-action` cards are reachable and activatable by keyboard (WIC-2062).
 *
 * Sibling of `ReportsClosedLoop.keyboardNav.test.tsx`; see that file for why the router
 * is real rather than a `useNavigate` mock. Here the card was an inline `<div>` in the
 * `applications.map(…)` rather than an extracted component, which is the only difference
 * between the two — the defect and the fix are identical.
 */

function report(): NeedsActionReportResponse {
  return {
    applications: [
      {
        id: 'app-overdue',
        jobTitle: 'Backend Engineer',
        company: 'Acme',
        status: 'applied',
        nextAction: 'Send follow-up email',
        nextActionDue: '2026-09-01T00:00:00Z',
        daysUntilDue: -4,
        urgency: 'overdue',
        contact: 'Dana Reyes',
        updatedAt: '2026-08-28T00:00:00Z',
      },
      {
        id: 'app-soon',
        jobTitle: 'Platform Engineer',
        company: 'Globex',
        status: 'phone_screen',
        nextAction: 'Prep for screen',
        nextActionDue: '2026-09-07T00:00:00Z',
        daysUntilDue: 2,
        urgency: 'due_soon',
        updatedAt: '2026-09-03T00:00:00Z',
      },
    ],
    summary: { overdue: 1, dueSoon: 1, upcoming: 0, total: 2 },
    generatedAt: '2026-09-05T00:00:00Z',
  };
}

function renderPage() {
  vi.spyOn(reportsService, 'getNeedsAction').mockResolvedValue(report());
  return renderReportPage(<ReportsNeedsAction />, '/reports/needs-action');
}

describe('ReportsNeedsAction keyboard navigation', () => {
  it('exposes each card title as a button in the accessibility tree', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: 'Backend Engineer @ Acme' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Platform Engineer @ Globex' })).toBeVisible();
  });

  it('reaches a card by Tab and opens it with Enter', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    const card = await screen.findByRole('button', { name: 'Backend Engineer @ Acme' });
    expect(await tabUntilFocused(user, card)).toBeGreaterThan(0);

    await user.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { name: 'Application app-overdue' })).toBeVisible();
    expect(visited).toEqual(['/reports/needs-action', '/applications/app-overdue']);
  });

  it('still opens the right card on click', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Platform Engineer @ Globex' }));

    expect(await screen.findByRole('heading', { name: 'Application app-soon' })).toBeVisible();
    expect(visited).toEqual(['/reports/needs-action', '/applications/app-soon']);
  });

  it('does not navigate from the inert card body', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    await user.click(await screen.findByText('Send follow-up email'));

    expect(visited).toEqual(['/reports/needs-action']);
  });
});
