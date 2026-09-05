import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CatalogBrowseView } from './CatalogBrowseView';
import { tabUntilFocused } from '../../test/reportsKeyboardNav';
import { catalogService } from '../../services/api';
import type { CatalogDiff } from '../../types/catalog';

/**
 * The `/catalog` pending-diff card is reachable by keyboard (WIC-2073).
 *
 * The card was a bare `<div onClick={() => handleDiffClick(diff)} className="cursor-pointer">`
 * — `click-events-have-key-events` + `no-static-element-interactions`, the same shape WIC-2062
 * fixed on the four `Reports*` pages. Opening a diff to review it was mouse-only: WCAG 2.1.1.
 *
 * Opening now hangs off a real `<button>` inside the card's existing `<h2>`, per the
 * `ResumeVariantCard` (WIC-1942) precedent, rather than a `role=` on the wrapper.
 *
 * ⚠️ The wrapper going inert has a consequence that is easy to miss and is the reason this
 * file asserts on "Review Changes" as well as on the heading: that button carried NO `onClick`
 * of its own and worked purely by bubbling to the wrapper. Making the wrapper inert without
 * giving it a handler would have left a visible, focusable, correctly-labelled button that
 * silently does nothing — a worse defect than the one being fixed, and one that every
 * assertion about the heading button would still pass. It now has its own handler.
 */

function diff(overrides: Partial<CatalogDiff> = {}): CatalogDiff {
  return {
    id: 'diff-1',
    sourceType: 'resume',
    sourceId: 'resume-1',
    createdAt: '2026-09-05T00:00:00Z',
    summary: {
      summary: 'Three new companies and one updated tag.',
      totalChanges: 4,
      newCount: 3,
      updatedCount: 1,
      deletedCount: 0,
      pendingReviewCount: 0,
    },
    changes: [],
    pendingReviews: [],
    ...overrides,
  };
}

function renderView() {
  vi.spyOn(catalogService, 'listDiffs').mockResolvedValue([diff()]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CatalogBrowseView />
    </QueryClientProvider>
  );
}

/** The card heading's accessible name — an emoji, then the source type, then "Update". */
const CARD_BUTTON = /Resume Update/;

/** Rendered only once a diff is open, so it reads the modal rather than the card. */
const MODAL_HEADING = 'Catalog Change Review';

describe('CatalogBrowseView keyboard navigation', () => {
  it('exposes the diff card title as a button in the accessibility tree', async () => {
    renderView();

    expect(await screen.findByRole('button', { name: CARD_BUTTON })).toBeVisible();
    // Still an h2, so /catalog's outline is unchanged (WIC-1675 AC-2).
    expect(screen.getByRole('heading', { name: CARD_BUTTON })).toBeVisible();
  });

  it('reaches the card by Tab and opens the diff with Enter', async () => {
    const user = userEvent.setup();
    renderView();

    const card = await screen.findByRole('button', { name: CARD_BUTTON });
    expect(await tabUntilFocused(user, card)).toBeGreaterThan(0);

    await user.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { name: MODAL_HEADING })).toBeVisible();
  });

  it('still opens the diff on click', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByRole('button', { name: CARD_BUTTON }));

    expect(await screen.findByRole('heading', { name: MODAL_HEADING })).toBeVisible();
  });

  it('opens the diff from the nested "Review Changes" button, which no longer bubbles', async () => {
    const user = userEvent.setup();
    renderView();

    // The regression guard for the inert wrapper. Before this change the button had no
    // handler at all and depended on the wrapper's; delete the handler it was given and this
    // is the only test in the file that fails.
    await user.click(await screen.findByRole('button', { name: 'Review Changes' }));

    expect(await screen.findByRole('heading', { name: MODAL_HEADING })).toBeVisible();
  });

  it('does not open the diff from the inert card body', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByText('Three new companies and one updated tag.'));

    expect(screen.queryByRole('heading', { name: MODAL_HEADING })).not.toBeInTheDocument();
  });
});
