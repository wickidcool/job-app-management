import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from './CommandPalette';
import { FILTER_SHORTCUT_LABELS } from '../constants/filterShortcuts';
import type { Application } from '../types/application';

/**
 * Regression cover for WIC-1850.
 *
 * Every result row in the palette is a `<button>` wrapping a type emoji and the result
 * title. The emoji sat in a plain layout `<div>` with no `aria-hidden`, so it joined the
 * button's *accessible name* and a screen reader announced the glyph's Unicode name before
 * every title — "briefcase Senior Engineer, button". The palette is arrow-key navigated, so
 * that is heard once per keystroke.
 *
 * The fix is deliberately not the one WIC-1846 applied to `SavedFilterShortcuts`. There the
 * glyph was pure decoration, because `isPredefined` was already conveyed by the absence of
 * a delete control. Here the emoji is the *only* signal distinguishing one result type from
 * another: `getResultBgColor` is purely visual, and `subtitle` carries no type at all for
 * `suggestion` and `recent` (neither has one) and nothing type-shaped for `application` (it
 * is the company). So `aria-hidden` alone would have silently dropped a distinction sighted
 * users keep, and the glyph is replaced by an `sr-only` type label instead of just muted.
 *
 * Every assertion below is on the **exact** accessible name. That is load-bearing twice
 * over: a substring matcher passes with the emoji still in the name, which is the defect,
 * and it also passes with the type label missing, which is the fix's other half.
 */

const { APPLICATIONS } = vi.hoisted(() => ({
  APPLICATIONS: [
    {
      id: 'app-1',
      jobTitle: 'Senior Engineer',
      company: 'Acme Corp',
      status: 'applied',
      hasDocuments: false,
      version: 1,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    {
      id: 'app-2',
      jobTitle: 'Staff Engineer',
      company: 'Acme Corp',
      status: 'phone_screen',
      hasDocuments: false,
      version: 1,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  ] as Application[],
}));

vi.mock('../hooks/useApplications', () => ({
  useApplications: () => ({ data: APPLICATIONS }),
}));

const RECENT_SEARCHES_KEY = 'wic-recent-searches';

function renderPalette() {
  render(
    <MemoryRouter>
      <CommandPalette open onOpenChange={vi.fn()} />
    </MemoryRouter>
  );
  return screen.getByRole('dialog');
}

/**
 * Asserts the whole fix on one row at once, because the halves are only correct together.
 *
 * A row that dropped the `sr-only` label passes the emoji checks; a row that deleted the
 * glyph passes the name check. Splitting these into separate tests is what would let either
 * regression through, so `expectedName` and the still-rendered-and-still-hidden guard are
 * checked on the same element.
 */
function expectRow(scope: HTMLElement, expectedName: string, glyph: string) {
  const button = within(scope).getByRole('button', { name: expectedName });

  // Exact, not substring: `getByRole` above already matched exactly, and this restates it
  // so the failure message names the accessible name it actually computed.
  expect(button).toHaveAccessibleName(expectedName);

  const decoration = button.querySelector('[aria-hidden="true"]');
  expect(decoration, `no aria-hidden decoration inside "${expectedName}"`).not.toBeNull();
  expect(decoration).toHaveTextContent(glyph);

  return button;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('CommandPalette — result rows announce their type as a word, not a glyph (WIC-1850)', () => {
  it('announces a suggested filter by type, with the caller-supplied icon hidden', () => {
    const dialog = renderPalette();

    // `SUGGESTED_FILTERS` all set `result.icon`, so these exercise the override path at
    // CommandPalette's `getResultIcon` early return — not the `switch`. A fix applied only
    // to the switch would leave exactly these four rows announcing their emoji.
    expectRow(dialog, `Suggested filter: ${FILTER_SHORTCUT_LABELS.interviewing}`, '🤝');
    expectRow(dialog, `Suggested filter: ${FILTER_SHORTCUT_LABELS.needsFollowUp}`, '⏰');
    expectRow(dialog, `Suggested filter: ${FILTER_SHORTCUT_LABELS.applied}`, '📤');
    expectRow(dialog, `Suggested filter: ${FILTER_SHORTCUT_LABELS.activeOffers}`, '🎉');
  });

  it('announces a recent search by type', () => {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['remote backend']));

    expectRow(renderPalette(), 'Recent search: remote backend', '🕐');
  });

  it('announces a recent application by type, keeping its subtitle', () => {
    expectRow(renderPalette(), 'Application: Senior Engineer Acme Corp', '💼');
  });

  it('announces applications and companies by type in the searched results list', async () => {
    const dialog = renderPalette();

    await userEvent.type(screen.getByRole('textbox'), 'acme');

    // The searched branch is one flat "Results" list mixing types with no grouping of any
    // kind, which is why grouping under headings was rejected as the fix: there is nothing
    // to group by here, and this is the branch where the types are actually interleaved.
    expectRow(dialog, 'Application: Senior Engineer Acme Corp • applied', '💼');
    expectRow(dialog, 'Application: Staff Engineer Acme Corp • phone screen', '💼');
    expectRow(dialog, 'Company: Acme Corp 2 applications', '🏢');
  });

  it('leaves no result row announcing a glyph', async () => {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['remote backend']));
    const dialog = renderPalette();

    // A catch-all over every rendered row, so a fifth call site added later without the
    // shared badge fails here even if no case above names it. The emoji ranges cover the
    // five glyphs the switch can return plus the four caller-supplied ones.
    const glyphs = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{23F0}-\u{23FF}]/u;

    // Positive control. `queryAllByRole` below is only evidence of anything if the glyphs
    // are on the page at all, and a fix that deleted them would otherwise pass silently.
    for (const button of within(dialog).getAllByRole('button')) {
      expect(button.textContent, 'row rendered with no glyph — decoration was deleted').toMatch(
        glyphs
      );
    }

    // A name matcher, so this reads accessible names rather than DOM text.
    expect(within(dialog).queryAllByRole('button', { name: glyphs })).toHaveLength(0);

    await userEvent.type(screen.getByRole('textbox'), 'acme');
    expect(within(dialog).queryAllByRole('button', { name: glyphs })).toHaveLength(0);
  });

  it('hides the decorative glyph on the empty state, which needs no spoken replacement', async () => {
    const dialog = renderPalette();

    await userEvent.type(screen.getByRole('textbox'), 'nothing matches this');

    // Unlike the row glyphs, this one has a visible text equivalent directly below it, so
    // `aria-hidden` with no `sr-only` label is the whole fix.
    expect(within(dialog).getByText('No results found')).toBeInTheDocument();
    const decoration = dialog.querySelector('[aria-hidden="true"]');
    expect(decoration).toHaveTextContent('🔍');
  });
});
