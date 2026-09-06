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
 * THE MEASUREMENT THAT DEFINES THE DEFECT. Holding the user's own typed query constant
 * (two queries of equal length, Radix's generated ids normalised), the DOM the palette
 * rendered for *"an application that exists, still loading"* was **byte-identical across
 * all 1546 characters** to the DOM for *"a query that genuinely matches nothing"*. The
 * only differing bytes in the whole subtree were the `value` attribute of the search input
 * — the user's own keystrokes, not anything the palette was telling them.
 *
 * That byte-identity is what `renders a DIFFERENT empty state ...` below pins directly,
 * and it is the assertion to keep if any other test here is ever dropped: every other
 * assertion in this file is satisfiable by a component that merely *has* a loading string
 * somewhere, whereas this one fails unless the two states actually diverge.
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
  STATE: { isLoading: false, isError: false },
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
 * Models the real hook rather than a convenient shape: react-query leaves `data`
 * `undefined` in both the pending and the error state, and a mock that returned `[]` there
 * would quietly assert the component reads a flag it does not have to read.
 */
vi.mock('../hooks/useApplications', () => ({
  useApplications: () => ({
    data: STATE.isLoading || STATE.isError ? undefined : APPLICATIONS,
    isLoading: STATE.isLoading,
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

/** The dialog's markup with Radix's per-mount generated ids normalised away. */
function normalisedHtml(dialog: HTMLElement) {
  return dialog.innerHTML.replace(/radix-[_a-zA-Z0-9]+/g, 'RADIX_ID');
}

beforeEach(() => {
  localStorage.clear();
  STATE.isLoading = false;
  STATE.isError = false;
});

afterEach(() => {
  localStorage.clear();
});

describe('CommandPalette — an unsettled query is not "No results found" (WIC-2179)', () => {
  it('renders a DIFFERENT empty state in flight than when genuinely empty', async () => {
    // The exact comparison that measured the defect. Before the fix these two were equal.
    STATE.isLoading = true;
    const dialog = renderPalette();
    await type(MATCHES_AN_APPLICATION);
    const inFlight = normalisedHtml(dialog);
    cleanup();

    STATE.isLoading = false;
    const settled = renderPalette();
    await type(MATCHES_NOTHING);
    const settledAbsent = normalisedHtml(settled);

    expect(inFlight).not.toBe(settledAbsent);
  });

  it('does not claim "No results found" while the applications query is in flight', async () => {
    STATE.isLoading = true;
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
    STATE.isLoading = true;
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

  it('NEGATIVE CONTROL: the no-query landing view is unaffected once settled', async () => {
    // The `!query` branch shows suggestions and recents. It must keep showing the
    // application rows, so the notice must not fire on a healthy settled palette.
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['remote backend']));
    const dialog = renderPalette();

    expect(dialog).toHaveTextContent('Senior Engineer');
    expect(dialog).not.toHaveTextContent('Still loading your applications');
  });
});
