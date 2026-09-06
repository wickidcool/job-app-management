import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from './CommandPalette';
import { FILTER_SHORTCUT_LABELS } from '../constants/filterShortcuts';
import type { Application } from '../types/application';

/**
 * Regression cover for WIC-2179.
 *
 * `CommandPalette` read only `data` from `useApplications()` and defaulted it to `[]`:
 *
 *     const { data: applications = [] } = useApplications();
 *
 * `data` is `undefined` while the query is in flight AND when it has failed, so that one
 * default collapsed three different states into one empty array — "we don't know yet",
 * "we couldn't find out", and "there are genuinely none" — which the results region then
 * rendered as the flat claim **"No results found"**.
 *
 * THE MEASUREMENT THAT DEFINES THE DEFECT. Re-derived at base `66ae5778`, and stated with
 * the node named so it can be re-run — an earlier revision of this docstring said
 * "byte-identical across all 1546 characters" without saying *what* was measured, which
 * made the figure unreproducible (a reviewer re-measuring got 2162). The node is the
 * palette's `role="dialog"` subtree, and the quantity is `announcedText()` below:
 *
 *   - announced text, in flight vs settled-and-genuinely-empty: **234 characters, equal —
 *     zero differing characters.** The palette said the identical thing in both states.
 *   - for reference, the raw markup of the same node (Radix's per-mount generated ids
 *     normalised) was 1540 characters of `innerHTML` / 2162 of `outerHTML`, differing in
 *     **13** — every one of them inside the search input's own `value` attribute, i.e. the
 *     user's keystrokes, not anything the palette was telling them.
 *
 * The announced-text figure is the one that matters and the one carrying no caveat: on the
 * channel that actually reaches the user there was no difference at all. That exact
 * identity is what `ANNOUNCES something different ...` below pins.
 *
 * ⚠️ AND THE FIRST VERSION OF THAT ASSERTION DID NOT WORK, which is worth recording rather
 * than quietly fixing. It compared normalised `innerHTML`, and the docstring here claimed
 * it was the sharpest test in the file — the one to keep if any other were dropped. The
 * mutant matrix said otherwise: reverting the empty state's sentence to the unconditional
 * "No results found" (mutant C — the exact original defect) left it **GREEN**, killing only
 * the two `not.toHaveTextContent` tests. The empty state's glyph is picked by a *separate*
 * expression from its sentence, so the markup still differed on `⏳` vs `🔍` — an
 * `aria-hidden` decoration announced to nobody, which a sighted user cannot read a state
 * off either when the sentence beneath it says the opposite. An assertion that reads as
 * "the two states must diverge" was in fact satisfied by a difference carrying no
 * information at all. It now compares **announced text**, with every `aria-hidden` subtree
 * stripped, and mutant C kills it.
 *
 * WHY IT IS WORTH FIXING RATHER THAN TOLERATING AS A FLASH. Two reasons, and the second is
 * the one that matters:
 *   - The palette is opened with Cmd+K, i.e. deliberately and fast, typically the instant
 *     a page is usable. The in-flight window is exactly when it is used.
 *   - **The error state is not transient at all.** `isError` leaves `data` `undefined`
 *     forever, so a user whose applications request failed was told, permanently and with
 *     no other signal anywhere in the palette, that they had no matching applications.
 *
 * THE NEGATIVE CONTROL IS LOAD-BEARING. `still says "No results found" when the query has
 * genuinely settled empty` is what stops the fix from being "delete the empty state". The
 * honest empty state is correct and must survive; only the two dishonest ones change.
 */

const { STATE } = vi.hoisted(() => ({
  STATE: { isPending: false, isError: false },
}));

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
  ] as Application[],
}));

/**
 * A mock, with a known and deliberate limit — stated here because the previous version of
 * this docstring claimed it "models the real hook", and in the one dimension that matters
 * it does not.
 *
 * It gets the important half right: react-query leaves `data` `undefined` in both the
 * pending and the error state, and a mock returning `[]` there would quietly assert the
 * component reads a flag it does not have to read.
 *
 * ⚠️ But `data` is derived here from the very flags the component branches on, so
 * `data === undefined ⟺ isPending || isError` holds **by construction**. That is the exact
 * proposition the fix rests on, which means no test in this file can ever falsify it. A
 * real query state where `data` is `undefined` and both flags are false would be invisible
 * to every assertion below — and there is one: `fetchStatus: "paused"`, where `isLoading`
 * (v5: `isPending && isFetching`) is false. That gap is covered against the real library,
 * with no mock at all, in `CommandPalette.pausedQuery.test.tsx`. The two files are a pair;
 * neither is sufficient alone.
 */
vi.mock('../hooks/useApplications', () => ({
  useApplications: () => ({
    data: STATE.isPending || STATE.isError ? undefined : APPLICATIONS,
    isPending: STATE.isPending,
    isError: STATE.isError,
  }),
}));

const RECENT_SEARCHES_KEY = 'wic-recent-searches';

/** A query that matches the fixture application by job title. */
const MATCHES_AN_APPLICATION = 'Senior Engineer';
/** Same length, matches nothing at all — so input `value` cannot explain a DOM difference. */
const MATCHES_NOTHING = 'Zzzznotathingxx';

function renderPalette() {
  render(
    <MemoryRouter>
      <CommandPalette open onOpenChange={vi.fn()} />
    </MemoryRouter>
  );
  return screen.getByRole('dialog');
}

async function type(query: string) {
  await userEvent.type(screen.getByRole('textbox'), query);
}

/**
 * The text the palette actually *communicates*, with every `aria-hidden` subtree removed.
 *
 * Comparing raw `innerHTML` here is not good enough, and the difference is not academic:
 * the empty state's glyph (`⏳` / `⚠️` / `🔍`) is chosen by a **separate** expression from
 * the sentence beneath it. Reverting only the sentence to the unconditional
 * "No results found" — i.e. restoring the exact defect this file exists to pin — still
 * leaves the two glyphs differing, so an `innerHTML` comparison goes GREEN on the bug.
 * That glyph is `aria-hidden` decoration: it is announced to nobody, and a sighted user
 * cannot read a state off an hourglass that the sentence contradicts.
 *
 * So the comparison is made over announced text only. Measured against that mutant, this
 * is the difference between the assertion passing and failing.
 */
function announcedText(dialog: HTMLElement) {
  const clone = dialog.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return clone.textContent ?? '';
}

beforeEach(() => {
  localStorage.clear();
  STATE.isPending = false;
  STATE.isError = false;
});

afterEach(() => {
  localStorage.clear();
});

describe('CommandPalette — an unsettled query is not "No results found" (WIC-2179)', () => {
  it('ANNOUNCES something different in flight than when genuinely empty', async () => {
    // The exact comparison that measured the defect. Before the fix these two announced
    // strings were equal: 234 characters, zero differing (base `66ae5778`). Both queries
    // below are the same length so that the input's own `value` cannot be the difference
    // this assertion detects.
    STATE.isPending = true;
    const dialog = renderPalette();
    await type(MATCHES_AN_APPLICATION);
    const inFlight = announcedText(dialog);
    cleanup();

    STATE.isPending = false;
    const settled = renderPalette();
    await type(MATCHES_NOTHING);
    const settledAbsent = announcedText(settled);

    expect(inFlight).not.toBe(settledAbsent);
  });

  it('does not claim "No results found" while the applications query is in flight', async () => {
    STATE.isPending = true;
    const dialog = renderPalette();

    await type(MATCHES_AN_APPLICATION);

    expect(dialog).not.toHaveTextContent('No results found');
    expect(dialog).toHaveTextContent('Searching your applications');
  });

  it('does not claim "No results found" when the applications query has FAILED', async () => {
    // The non-transient half: `data` stays `undefined`, so pre-fix this state told the
    // user they had no matching applications for as long as they left the palette open.
    STATE.isError = true;
    const dialog = renderPalette();

    await type(MATCHES_AN_APPLICATION);

    expect(dialog).not.toHaveTextContent('No results found');
    expect(dialog).toHaveTextContent('Could not load your applications');
  });

  it('NEGATIVE CONTROL: still says "No results found" when the query settled genuinely empty', async () => {
    // Without this, "delete the empty state" would pass every other test in this file.
    const dialog = renderPalette();

    await type(MATCHES_NOTHING);

    expect(dialog).toHaveTextContent('No results found');
    expect(dialog).not.toHaveTextContent('Searching your applications');
    expect(dialog).not.toHaveTextContent('Could not load your applications');
  });

  it('flags a PARTIAL result list, where the empty state never renders at all', async () => {
    // `Applied` is a SUGGESTED_FILTERS title, so this query matches a suggestion and the
    // list is non-empty — the palette looks confident and complete while every one of the
    // user's actual applications is missing. The empty-state branch is never reached here,
    // which is why fixing only that branch would leave this case still lying.
    STATE.isPending = true;
    const dialog = renderPalette();

    await type(FILTER_SHORTCUT_LABELS.applied);

    expect(dialog).not.toHaveTextContent('No results found');
    expect(dialog).toHaveTextContent('Still loading your applications');
  });

  it('flags a partial result list when the query FAILED, too', async () => {
    STATE.isError = true;
    const dialog = renderPalette();

    await type(FILTER_SHORTCUT_LABELS.applied);

    expect(dialog).toHaveTextContent('could not be loaded');
  });

  it('NEGATIVE CONTROL: no partial-list notice once the query has settled', async () => {
    const dialog = renderPalette();

    await type(FILTER_SHORTCUT_LABELS.applied);

    expect(dialog).not.toHaveTextContent('Still loading your applications');
    expect(dialog).not.toHaveTextContent('could not be loaded');
  });

  it('flags the no-query LANDING view too, where the rows just silently go missing', async () => {
    // The third surface, and the quietest. With no query typed, `searchResults` is the
    // landing menu (suggestions + recents), so it is non-empty and the empty state never
    // renders — but the "Recent Applications" section simply has nothing in it. Measured
    // in this state: the notice renders and the application row does not, so the absence
    // is now narrated instead of silent.
    //
    // This surface had no positive test until WIC-2179 follow-up. It was covered by the
    // implementation only incidentally, because the notice sits in the outer results
    // `<div>` after both the `!query` and query blocks rather than inside either one.
    STATE.isPending = true;
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['remote backend']));
    const dialog = renderPalette();

    expect(dialog).toHaveTextContent('Still loading your applications');
    expect(dialog).not.toHaveTextContent('Senior Engineer');
    expect(dialog).not.toHaveTextContent('No results found');
  });

  it('NEGATIVE CONTROL: the no-query landing view is unaffected once settled', async () => {
    // The `!query` branch shows suggestions and recents. It must keep showing the
    // application rows, so the notice must not fire on a healthy settled palette.
    //
    // ⚠️ BOTH notice strings are asserted absent, not just the loading one. Checking only
    // "Still loading…" left this control one-sided, and measurably so: the mutant that
    // forces `applicationsMissing = true` leaves `isLoading` false, so the notice renders
    // with its *error* wording — and a control that names only the loading string stayed
    // GREEN on it while its sibling control (which names both) went red.
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['remote backend']));
    const dialog = renderPalette();

    expect(dialog).toHaveTextContent('Senior Engineer');
    expect(dialog).not.toHaveTextContent('Still loading your applications');
    expect(dialog).not.toHaveTextContent('could not be loaded');
  });
});
