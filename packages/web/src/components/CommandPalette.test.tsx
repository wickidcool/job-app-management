import * as Dialog from '@radix-ui/react-dialog';
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

/**
 * Regression cover for WIC-1851.
 *
 * `Dialog.Content` rendered with no `Dialog.Title` and no `Dialog.Description`, so the
 * palette opened as an unnamed "dialog" — a screen reader announced the role and nothing
 * else, on the surface a keyboard-first user reaches most often. WCAG 2.1 AA, SC 4.1.2.
 *
 * Sibling of the WIC-1850 suite above and deliberately separate from it: that one is about
 * the accessible name of each result *row*, this one about the name of the *container*.
 *
 * Neither `Dialog.Title` nor `Dialog.Description` may take an `id` prop. Radix's warnings
 * resolve `context.titleId` / `context.descriptionId` through `getElementById`
 * (@radix-ui/react-dialog 1.1.15, `dist/index.mjs:295` and `:308`), so an overridden id
 * leaves that lookup empty and the console warning fires against correct markup. The
 * console guard below is what pins that, which is why it asserts on the message text rather
 * than merely on the accessible name.
 */
const DIALOG_NAME = 'Quick search';
const DIALOG_DESCRIPTION =
  'Type to search applications, companies, and statuses. Use the up and down arrow keys ' +
  'to move between results, and Enter to open one.';

/** Both Radix warnings, verbatim enough to match and loose enough to survive a reword. */
const RADIX_TITLE_WARNING = /requires a `DialogTitle`/;
const RADIX_DESCRIPTION_WARNING = /Missing `Description` or `aria-describedby=\{undefined\}`/;

function spyOnConsole() {
  // `restoreMocks: true` in vitest.config.ts puts these back after every test.
  return {
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  };
}

/**
 * The first argument of each recorded call, stringified.
 *
 * Structurally typed rather than `ReturnType<typeof vi.spyOn>`: that alias leaves the spy's
 * generics unresolved, so `mock.calls` degrades to an implicit `any` and `tsc -b` fails the
 * build under `noImplicitAny` while vitest itself runs perfectly happily.
 */
const calls = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]));

describe('CommandPalette — the dialog announces what it is (WIC-1851)', () => {
  it('gives the dialog an exact accessible name and description', () => {
    const dialog = renderPalette();

    // Exact, not substring, for the same reason the row assertions above are exact: a
    // substring matcher passes for a name that has picked up the search field, the footer
    // or a result title, which is the failure mode `aria-labelledby` makes easy.
    expect(dialog).toHaveAccessibleName(DIALOG_NAME);
    expect(dialog).toHaveAccessibleDescription(DIALOG_DESCRIPTION);
  });

  it('keeps both of them out of the visual design', () => {
    const dialog = renderPalette();

    // The palette's whole visual design is that it appears with nothing above the search
    // field, so the title has to be `sr-only`. Guarding it here means a later "let's show
    // the title" change has to be a deliberate one.
    expect(within(dialog).getByText(DIALOG_NAME)).toHaveClass('sr-only');
    expect(within(dialog).getByText(DIALOG_DESCRIPTION)).toHaveClass('sr-only');
  });

  it('emits neither Radix accessibility warning on mount', () => {
    const spies = spyOnConsole();

    renderPalette();

    expect(calls(spies.error).filter((m) => RADIX_TITLE_WARNING.test(m))).toEqual([]);
    expect(calls(spies.warn).filter((m) => RADIX_DESCRIPTION_WARNING.test(m))).toEqual([]);
  });

  it('positive control: an unnamed Radix dialog does still emit both warnings', () => {
    // Without this the test above is not evidence of anything — it would pass just as
    // happily against a Radix version that had stopped warning, or a broken spy. It also
    // pins the id-override trap: swap `Dialog.Title` here for one with an `id` prop and
    // this control keeps firing while the markup looks correct.
    const spies = spyOnConsole();

    render(
      <Dialog.Root open>
        <Dialog.Portal>
          <Dialog.Content>unnamed</Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );

    expect(calls(spies.error).some((m) => RADIX_TITLE_WARNING.test(m))).toBe(true);
    expect(calls(spies.warn).some((m) => RADIX_DESCRIPTION_WARNING.test(m))).toBe(true);
  });
});

describe('CommandPalette — the footer key hints are spoken as key names (WIC-1851)', () => {
  /**
   * Asserts both halves on the same element, for the WIC-1850 reason: a fix that deleted the
   * glyph passes a text-only check, and a fix that dropped the `sr-only` name passes a
   * glyph-only one. `↑↓` and `↵` are the instruction, not decoration — without them the
   * footer reads "to navigate … to select" — so `aria-hidden` alone would be a removal.
   */
  function expectKeyHint(scope: HTMLElement, glyph: string, spokenName: string) {
    const decoration = within(scope).getByText(glyph);
    expect(decoration, `${glyph} is announced by its Unicode name`).toHaveAttribute(
      'aria-hidden',
      'true'
    );

    const spoken = within(scope).getByText(spokenName);
    expect(spoken).toHaveClass('sr-only');

    // Same `<kbd>`, so the pair cannot drift apart into two unrelated hints.
    const key = decoration.closest('kbd');
    expect(key, `${glyph} is not inside a <kbd>`).not.toBeNull();
    expect(spoken.closest('kbd')).toBe(key);
  }

  it('replaces the arrow and return glyphs with the keys they mean', () => {
    const dialog = renderPalette();

    // ↵ is "downwards arrow with corner leftwards" to a screen reader, which is not a key
    // any listener can go and find.
    expectKeyHint(dialog, '↑↓', 'Up and down arrow keys');
    expectKeyHint(dialog, '↵', 'Enter');
  });

  it('leaves the ESC hint alone, because it already spells its key', () => {
    // The control case for the rule: this `<kbd>` needs no treatment, and a blanket sweep
    // over every `<kbd>` in the file would have given it a redundant one.
    expect(within(renderPalette()).getByText('ESC')).not.toHaveAttribute('aria-hidden');
  });
});
