import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { reportsService, type StaleReportResponse } from '../services/api';
import { renderReportPage, tabUntilFocused } from '../test/reportsKeyboardNav';
import { ReportsStale } from './ReportsStale';

/**
 * `/reports/stale` cards are reachable by keyboard, and the two controls nested inside a
 * card still do their own thing, once each (WIC-2062).
 *
 * This is the one of the four pages that carried nested interactives: a "View job posting"
 * `<a>` and a "Set Next Action" `<button>`, both of which had `onClick={(e) =>
 * e.stopPropagation()}` for the sole purpose of escaping the wrapper `<div>`'s navigate
 * handler. Moving navigation onto a button inside the heading makes the wrapper inert, so
 * both `stopPropagation` calls became dead code and were deleted.
 *
 * Deleting them is the only part of this change that could regress something that used to
 * work, so it gets its own coverage: with a live wrapper handler and no `stopPropagation`,
 * clicking either nested control would fire its own action *and* the wrapper's. For the
 * link that means an unwanted in-app navigation; for the button it means navigating twice
 * to the same URL, which leaves the rendered page identical and needs a check on the
 * history stack rather than on the location. Both are pinned below.
 *
 * All three guards were validated against a mutant that restores the wrapper's `onClick`,
 * rather than only against the pre-fix tree — the pre-fix tree still had `stopPropagation`,
 * so it cannot tell a working guard from a vacuous one.
 */

const JOB_URL = 'https://jobs.example.com/posting/42';

function report(): StaleReportResponse {
  return {
    applications: [
      {
        id: 'app-stale',
        jobTitle: 'Infrastructure Engineer',
        company: 'Acme',
        status: 'applied',
        daysSinceUpdate: 31,
        lastStatusChange: '2026-08-05T00:00:00Z',
        contact: 'Dana Reyes',
        url: JOB_URL,
        updatedAt: '2026-08-05T00:00:00Z',
      },
      {
        id: 'app-stale-no-url',
        jobTitle: 'Security Engineer',
        company: 'Globex',
        status: 'phone_screen',
        daysSinceUpdate: 22,
        lastStatusChange: '2026-08-14T00:00:00Z',
        url: null,
        updatedAt: '2026-08-14T00:00:00Z',
      },
    ],
    summary: { total: 2, byStatus: { applied: 1, phone_screen: 1 }, averageDaysStale: 26 },
    generatedAt: '2026-09-05T00:00:00Z',
  };
}

function renderPage() {
  vi.spyOn(reportsService, 'getStale').mockResolvedValue(report());
  return renderReportPage(<ReportsStale />, '/reports/stale');
}

/** The card containing a given title, so the nested controls can be scoped to one row. */
async function staleCard(title: string) {
  const heading = await screen.findByRole('heading', { name: title });
  const card = heading.closest('div.rounded-lg');
  if (!card) throw new Error(`no card wrapper found for ${title}`);
  return within(card as HTMLElement);
}

describe('ReportsStale keyboard navigation', () => {
  it('exposes each card title as a button in the accessibility tree', async () => {
    renderPage();

    expect(
      await screen.findByRole('button', { name: 'Infrastructure Engineer @ Acme' })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Security Engineer @ Globex' })).toBeVisible();
  });

  it('reaches a card by Tab and opens it with Enter', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    const card = await screen.findByRole('button', { name: 'Infrastructure Engineer @ Acme' });
    expect(await tabUntilFocused(user, card)).toBeGreaterThan(0);

    await user.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { name: 'Application app-stale' })).toBeVisible();
    expect(visited).toEqual(['/reports/stale', '/applications/app-stale']);
  });

  it('still opens the right card on click', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Security Engineer @ Globex' }));

    expect(
      await screen.findByRole('heading', { name: 'Application app-stale-no-url' })
    ).toBeVisible();
    expect(visited).toEqual(['/reports/stale', '/applications/app-stale-no-url']);
  });

  it('does not navigate from the inert card body', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    await user.click(await screen.findByText('Contact:'));

    expect(visited).toEqual(['/reports/stale']);
  });

  // The two regression cases the deleted `stopPropagation` calls used to cover.
  it('leaves the nested "View job posting" link pointing outward, with no in-app navigation', async () => {
    const user = userEvent.setup();
    const { visited } = renderPage();

    const card = await staleCard('Infrastructure Engineer @ Acme');
    const link = card.getByRole('link', { name: /View job posting/ });
    expect(link).toHaveAttribute('href', JOB_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    // jsdom does not perform the outbound navigation, which is what makes this readable:
    // if the router moved, the only thing that could have moved it is a handler on the
    // card wrapper — the exact defect `stopPropagation` was there to paper over.
    await user.click(link);

    expect(visited).toEqual(['/reports/stale']);
  });

  it('pushes exactly one history entry from the nested "Set Next Action" button', async () => {
    const user = userEvent.setup();
    renderPage();

    const card = await staleCard('Infrastructure Engineer @ Acme');
    await user.click(card.getByRole('button', { name: 'Set Next Action' }));
    expect(await screen.findByRole('heading', { name: 'Application app-stale' })).toBeVisible();

    // One Back returns to the report — which is true iff the click pushed one entry.
    //
    // The assertion is on the history *stack*, deliberately, and this is the one place
    // in these tests where the obvious check does not work. The wrapper handler and this
    // button both navigated to the *same* URL, so a duplicate leaves the rendered page
    // and `location.pathname` byte-identical; and the harness's `visited` recorder cannot
    // see it either, because React batches both `navigate()` calls into a single render.
    // Verified against a mutant that restores the wrapper's `onClick`: a `visited`-based
    // assertion here stayed green, this one reds and lands back on "Application app-stale".
    await user.click(screen.getByRole('button', { name: 'Go back' }));

    expect(await screen.findByRole('heading', { name: 'Stale Applications' })).toBeVisible();
  });
});
