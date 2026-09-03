import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApplicationCard } from './ApplicationCard';
import { KanbanBoard } from './KanbanBoard';
import type { Application } from '../types/application';
import { describeOutline, findOutlineSkips, getOutline } from '../test/headingOutline';

/**
 * Regression cover for WIC-1563 (heading-level skip in the Kanban path).
 *
 * `KanbanColumn` rendered its column title as `<h3>`, and `ApplicationCard` renders the
 * job title as `<h3>` too. The chain measured here is `<h1>Applications</h1>` ->
 * `KanbanBoard` (no heading of its own) -> `KanbanColumn`, so the outline read
 * h1 -> h3 -> h3: a skipped level, *and* every card sitting as a structural sibling of its
 * own column rather than inside it. The column's contents were not nested under the column
 * at all — which is precisely the navigation a screen-reader user moves between columns
 * with.
 *
 * The fix is one tag: the column becomes `<h2>`. `ApplicationCard` is left alone. Its
 * `<h3>` was never wrong in itself, only wrong relative to the `<h3>` above it, and with
 * the column at h2 it is already at the right depth at both of its render sites. Per
 * COMPONENT_SPECS §10 neither component takes a `headingLevel` prop: `KanbanColumn` has a
 * single call site, and both of `ApplicationCard`'s want the same level.
 *
 * These assert the outline of the whole rendered tree rather than tag names, because a
 * per-component tag assertion would have called *both* components correct before the fix.
 */

function app(overrides: Partial<Application> & Pick<Application, 'id' | 'jobTitle'>): Application {
  return {
    company: 'Globex',
    status: 'saved',
    hasDocuments: false,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

const APPLICATIONS: Application[] = [
  app({ id: 'a1', jobTitle: 'Staff Engineer', status: 'saved' }),
  app({ id: 'a2', jobTitle: 'Platform Engineer', status: 'applied' }),
  app({ id: 'a3', jobTitle: 'Design Engineer', status: 'interview' }),
];

/**
 * A minimal host for the board: one page-level `<h1>`, then `KanbanBoard`.
 *
 * **This is not the `ApplicationsList` composition, and it must not be described as one**
 * (WIC-1834). It said it was for two months, and it was wrong in a way that mattered: the
 * real page mounts `SavedFilterShortcuts` between the `<h1>` and the board, that panel
 * rendered an `<h3>`, and so the live route read `h1 -> h3 -> h2` — a skip, on every
 * render branch — while this file stayed green. A rendered-outline assertion certifies
 * the composition it renders, not the route it is named after, and nothing ties a
 * hand-written fixture to the page it approximates.
 *
 * The `<h1>` stays because `KanbanBoard`'s columns are only correct *relative to* a page
 * heading, and this file's subject is the board's internal depth — that a column is one
 * level below the page and a card one level below its column. That question is answered
 * at this layer and is worth keeping here.
 *
 * The page's own outline is asserted against the real thing in
 * `src/pages/ApplicationsList.headingOutline.test.tsx`, and every route's is swept in
 * `src/test/routeOutline.render.test.tsx` (WIC-1675).
 */
function renderBoard(applications: Application[]) {
  return render(
    <>
      <h1>Applications</h1>
      <KanbanBoard applications={applications} onStatusChange={() => {}} onCardClick={() => {}} />
    </>
  );
}

describe('Kanban heading outline (WIC-1563)', () => {
  it('has no heading-level skip from the page h1 down to a card title', () => {
    const { container } = renderBoard(APPLICATIONS);

    const outline = getOutline(container);
    const skips = findOutlineSkips(outline);

    expect(skips, `outline: ${describeOutline(outline)}`).toEqual([]);
  });

  it('nests each card under its own column: h1 -> h2 column -> h3 card', () => {
    // The shape, not just the absence of a skip. An outline of h1 -> h2 -> h2 also has no
    // skip, and would still leave the cards as siblings of their columns.
    const { container } = renderBoard(APPLICATIONS);

    expect(describeOutline(getOutline(container))).toBe(
      [
        'h1 "Applications"',
        'h2 "Saved"',
        'h3 "Staff Engineer"',
        'h2 "Applied"',
        'h3 "Platform Engineer"',
        'h2 "Phone Screen"',
        'h2 "Interview"',
        'h3 "Design Engineer"',
        'h2 "Offer"',
        'h2 "Rejected"',
      ].join(' -> ')
    );
  });

  it('puts every column at h2 and every card at h3', () => {
    renderBoard(APPLICATIONS);

    // All six columns render whether or not they hold anything, so this is a fixed count
    // and cannot quietly degrade to "we found the one column we happened to look at".
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Saved',
      'Applied',
      'Phone Screen',
      'Interview',
      'Offer',
      'Rejected',
    ]);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Staff Engineer',
      'Platform Engineer',
      'Design Engineer',
    ]);
  });

  it('stays gap-free with an empty board, where only the column headings render', () => {
    const { container } = renderBoard([]);

    const outline = getOutline(container);
    expect(findOutlineSkips(outline)).toEqual([]);
    expect(outline.map((h) => h.level)).toEqual([1, 2, 2, 2, 2, 2, 2]);
  });

  it('keeps the drag overlay s card legal at h3, its second render site', () => {
    // `KanbanBoard:174` renders `ApplicationCard` directly inside `<DragOverlay>` — a
    // sibling of the column grid rather than a child of a column, so it is the one place
    // the card is not nested under an h2. It is reached only mid-drag, which jsdom cannot
    // produce, so the position is reconstructed here: the overlay follows the columns, and
    // h3 after the last column's h2 is still gap-free.
    const { container } = render(
      <>
        <h1>Applications</h1>
        <div>
          <h2>Rejected</h2>
        </div>
        <div>
          <ApplicationCard
            application={APPLICATIONS[0]}
            variant="kanban"
            draggable={false}
            showQuickActions={false}
          />
        </div>
      </>
    );

    const outline = getOutline(container);
    expect(findOutlineSkips(outline)).toEqual([]);
    expect(outline.map((h) => h.level)).toEqual([1, 2, 3]);
  });
});
