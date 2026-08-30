import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationsList } from './ApplicationsList';
import { describeOutline, findOutlineSkips, getOutline } from '../test/headingOutline';

/**
 * WIC-1834 — `/applications` asserts its own rendered heading outline.
 *
 * ## Why this file exists at all
 *
 * `KanbanBoard.test.tsx` already asserts a rendered outline, and its comment said it was
 * asserting *"the `ApplicationsList` shape"*. It was not. Its fixture is
 * `<h1>Applications</h1>` + `<KanbanBoard>` written by hand, and the real page mounts
 * `SavedFilterShortcuts` between those two — which rendered an `<h3>`, so the live route
 * read `h1 -> h3 -> h2`, a skip, on **every** render branch, while the check named after
 * the page stayed green for two months.
 *
 * That is the general failure and it is worth stating plainly: **a rendered-outline
 * assertion certifies the composition it renders, not the route it is named after.** A
 * hand-written approximation of a page has nothing tying it to the page, so it drifts
 * silently, and a green check on a broken page is worse than no check because it stops
 * anyone looking. So this file renders the real `ApplicationsList`, with its real
 * children, and drift becomes impossible by construction rather than by review.
 *
 * ## What this grades that the WIC-1675 route sweep does not
 *
 * `src/test/routeOutline.render.test.tsx` (PR #299) renders all 29 routes across four
 * *data* branches and enforces "no heading-level skip" unconditionally, `/applications`
 * included. This file is deliberately not a second copy of that. It adds two grades the
 * sweep cannot give:
 *
 *   1. **The exact outline, not merely the absence of a skip.** `h1 -> h2 -> h2` has no
 *      skip and would still be wrong here: it is the shape you get when a card stops
 *      nesting under its column. Pinning the sequence is what distinguishes the two, and
 *      it is why `KanbanBoard.test.tsx` pins a shape as well as a skip set.
 *   2. **Interaction branches.** The sweep varies `loading`/`error`/`empty`/`loaded` —
 *      all of which are *data* states. `isFilterPanelOpen` and `SavedFilterShortcuts`'
 *      save dialog are **user** state, so no value of the sweep's dial reaches them. They
 *      are render branches of this page all the same, and WIC-1675's own rule is
 *      per-branch.
 *
 * Today both interaction branches render the same outline as the closed page, because
 * neither `FilterPanel` nor the save dialog emits a heading. **That identity is the thing
 * being pinned** — an `<h3>Filters</h3>` on the panel is the obvious next edit to that
 * component, and it would reopen exactly the defect this card was filed for.
 */

vi.mock('../services/api', async (importOriginal) =>
  (await import('../test/routeOutlineApiMock')).apiMockModule(
    (await importOriginal()) as Record<string, unknown>
  )
);

const { setBranch, setPayloadOverride } = await import('../test/routeOutlineApiMock');
const { renderRoute, stubGlobalFetch } = await import('../test/routeOutlineHarness');

stubGlobalFetch();

/**
 * Two applications in two different columns.
 *
 * Two rather than one on purpose: with a single card the outline cannot distinguish "the
 * card nests under its column" from "the card happens to follow the only column that has
 * one". `Design Engineer` sitting under `Interview` — with the empty `Phone Screen`
 * column between them — is what makes the sequence below load-bearing.
 */
const WHEN = new Date('2026-01-01T00:00:00.000Z');

const APPLICATIONS = [
  {
    id: 'a1',
    jobTitle: 'Staff Engineer',
    company: 'Acme',
    status: 'applied',
    hasDocuments: false,
    version: 1,
    createdAt: WHEN,
    updatedAt: WHEN,
  },
  {
    id: 'a2',
    jobTitle: 'Design Engineer',
    company: 'Globex',
    status: 'interview',
    hasDocuments: false,
    version: 1,
    createdAt: WHEN,
    updatedAt: WHEN,
  },
];

/**
 * The outline `/applications` renders once its data has arrived.
 *
 * `KanbanBoard` renders all six columns whether or not they hold anything, so the empty
 * ones appear here too. Written out in full rather than as a level sequence: a level-only
 * form (`h1 -> h2 -> h2 -> ...`) cannot tell "the shortcuts panel is above the board"
 * from "it is below it", and the *position* of `Filter Shortcuts` is the entire subject
 * of this card.
 */
const LOADED_OUTLINE = [
  'h1 "Applications"',
  'h2 "Filter Shortcuts"',
  'h2 "Saved"',
  'h2 "Applied"',
  'h3 "Staff Engineer"',
  'h2 "Phone Screen"',
  'h2 "Interview"',
  'h3 "Design Engineer"',
  'h2 "Offer"',
  'h2 "Rejected"',
].join(' -> ');

/** Mount the real page at a real URL and wait until its data has settled. */
async function renderApplications(path = '/applications') {
  const { result } = renderRoute(<ApplicationsList />, { path, pattern: '/applications' });

  // The board renders its columns immediately, so waiting on a column heading would not
  // distinguish "loaded" from "still fetching". A card title only exists once the query
  // has resolved.
  await screen.findByRole('heading', { level: 3, name: 'Staff Engineer' });

  return result;
}

beforeEach(() => {
  setBranch('loaded');
  setPayloadOverride(() => APPLICATIONS);
  window.localStorage.clear();
});

afterEach(() => {
  setPayloadOverride(null);
  setBranch('loading');
  window.localStorage.clear();
});

describe('ApplicationsList heading outline (WIC-1834)', () => {
  it('renders h1 -> h2 shortcuts -> h2 column -> h3 card, through the real composition', async () => {
    const result = await renderApplications();

    expect(describeOutline(getOutline(result.baseElement))).toBe(LOADED_OUTLINE);
  });

  it('mounts the shortcuts panel the hand-written KanbanBoard fixture omits', async () => {
    // The specific omission that let the skip live. Asserted separately from the shape
    // above so that a failure says *which* of the two properties broke: the shape pin
    // alone would report a diff of ten lines for a missing panel and for a reordered
    // board alike.
    const result = await renderApplications();
    const outline = getOutline(result.baseElement);

    const shortcuts = outline.find((h) => h.text === 'Filter Shortcuts');

    expect(shortcuts, 'SavedFilterShortcuts renders no heading on the page').toBeDefined();
    expect(shortcuts?.level, 'the panel sits directly under the page h1').toBe(2);
    expect(outline.indexOf(shortcuts!)).toBe(1);
  });

  it('has no heading-level skip with the filter panel open (an interaction branch)', async () => {
    const user = userEvent.setup();
    const result = await renderApplications();

    await user.click(screen.getByRole('button', { name: 'Show filters' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Hide filters' })).toBeInTheDocument();
    });

    const outline = getOutline(result.baseElement);

    expect(findOutlineSkips(outline), `outline: ${describeOutline(outline)}`).toEqual([]);
    // FilterPanel contributes no heading today, and this is what says so if it grows one
    // at the wrong level.
    expect(describeOutline(outline)).toBe(LOADED_OUTLINE);
  });

  it('has no heading-level skip with the save-shortcut dialog open (an interaction branch)', async () => {
    const user = userEvent.setup();

    // `?status=` seeds the page's filters, which is what makes `hasActiveFilters` true and
    // renders "+ Save Current" at all. Reaching this branch through the URL rather than by
    // driving the filter panel keeps the test about the outline rather than about
    // FilterPanel's controlled-state wiring, which WIC-1612 already covers.
    const result = await renderApplications('/applications?status=interview');

    await user.click(screen.getByRole('button', { name: '+ Save Current' }));
    await waitFor(() => {
      expect(within(result.baseElement).getByLabelText('Save current filters as:')).toBeVisible();
    });

    const outline = getOutline(result.baseElement);

    expect(findOutlineSkips(outline), `outline: ${describeOutline(outline)}`).toEqual([]);
    expect(describeOutline(outline)).toBe(LOADED_OUTLINE);
  });
});
