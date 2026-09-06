import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from './CommandPalette';
import { FILTER_SHORTCUT_LABELS } from '../constants/filterShortcuts';

/**
 * WIC-2181 — the palette must not conclude "No results found" over a list it knows is a
 * prefix of the account.
 *
 * `useApplications`' docstring directed callers to `useApplicationCollection` on "any
 * surface that renders a count, a total, or a 'nothing to see here' conclusion", because
 * `truncated` is the only signal that the rows are a prefix. This component rendered
 * exactly such a conclusion and called `useApplications` anyway, so the flag was
 * unreachable here: `getAllPaged` stops after `MAX_APPLICATION_PAGES` and reports what it
 * could not fetch, and every filter in this component runs client-side over whatever it
 * got. "No results found" then means "no matches among the rows we happened to have",
 * which is not what it says — the same class of false negative WIC-2179 closed for the
 * in-flight and failed states, in a third state those two do not cover.
 *
 * SCOPE, STATED HONESTLY. `truncated` needs `MAX_APPLICATION_PAGES` (50) x
 * `APPLICATION_PAGE_SIZE` (100) = **5,000** applications for one user, so unlike WIC-2179
 * — which fired on every cold load and every failed request — this fires for nobody today.
 * It is fixed because the alternative was to weaken a contract `ApplicationsList` already
 * honours, and because the honest branch costs less than the paragraph explaining why the
 * dishonest one is tolerable.
 *
 * NO 5,000-ROW FIXTURE, AND NO HOOK MOCK EITHER. Generating 5,000 rows would measure the
 * fixture generator, not the component. But mocking the hook to hand back
 * `{ truncated: true }` would leave the *migration* — the thing this card actually changed
 * — untested, since a mocked hook is satisfied by any hook name. So this drives the real
 * `useApplicationCollection` through a real `QueryClient`, and mocks one layer lower at
 * `applicationService.getAllPaged`, which is where `truncated` genuinely comes from. The
 * fixture is one row claiming a `totalCount` of 137: the rows and the total disagree on
 * purpose, so an assertion cannot pass by reading the wrong one.
 *
 * THE NEGATIVE CONTROL IS THE LOAD-BEARING TEST. `still says "No results found" when the
 * collection is complete` is what stops the fix from being "delete the empty state". Only
 * the dishonest conclusion changes; the honest one must survive verbatim.
 */

const COLLECTION = {
  applications: [] as unknown[],
  totalCount: 0,
  truncated: false,
};

const GET_ALL_PAGED = vi.fn();

vi.mock('../services/api', () => ({
  applicationService: {
    getAllPaged: (...args: unknown[]) => GET_ALL_PAGED(...args),
  },
}));

/** The one row the stub serves. Deliberately fewer rows than `TOTAL_COUNT` reports. */
const FIXTURE_APPLICATION = {
  id: 'app-1',
  jobTitle: 'Senior Engineer',
  company: 'Acme Corp',
  status: 'offer',
  hasDocuments: false,
  version: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** What the server says exists, as against the single row actually handed over. */
const TOTAL_COUNT = 137;

/** Matches a `SUGGESTED_FILTERS` title, so the result list is NON-empty. */
const MATCHES_A_SUGGESTION = FILTER_SHORTCUT_LABELS.applied;
/** Matches no suggestion, no recent search and no fixture row, so the empty state renders. */
const MATCHES_NOTHING = 'Zzzznotathing';

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette open onOpenChange={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return screen.getByRole('dialog');
}

async function type(query: string) {
  await userEvent.type(screen.getByRole('textbox'), query);
}

/**
 * Waits for the query to settle before anything is asserted about what the palette
 * concludes. Without this a test could read the *pending* state's sentence and pass or
 * fail for a WIC-2179 reason rather than a WIC-2181 one.
 */
async function settle() {
  await waitFor(() => expect(GET_ALL_PAGED).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('Searching your applications…')).toBeNull());
}

beforeEach(() => {
  localStorage.clear();
  COLLECTION.applications = [FIXTURE_APPLICATION];
  COLLECTION.totalCount = TOTAL_COUNT;
  COLLECTION.truncated = true;
  GET_ALL_PAGED.mockReset();
  GET_ALL_PAGED.mockImplementation(async () => ({
    applications: COLLECTION.applications,
    totalCount: COLLECTION.totalCount,
    truncated: COLLECTION.truncated,
  }));
});

afterEach(() => {
  localStorage.clear();
});

describe('CommandPalette — a truncated collection is not "No results found" (WIC-2181)', () => {
  it('does not claim "No results found" when the rows searched were only a prefix', async () => {
    const dialog = renderPalette();
    await settle();
    await type(MATCHES_NOTHING);

    // The exact string of the defect. It is a claim about the whole account and we are not
    // entitled to make it over 1 of 137 rows.
    expect(dialog).not.toHaveTextContent('No results found');
    // And it says what it actually knows: how much it looked at, and that there is more.
    expect(dialog).toHaveTextContent(/No matches among the first 1 of your 137 applications/);
    expect(dialog).toHaveTextContent(/the rest were not searched/);
  });

  it('says so on a NON-empty result list too, where the shortfall is easier to miss', async () => {
    // Typing a suggestion title makes `searchResults` non-empty, so the empty branch never
    // renders and a populated, confident-looking list is all the user sees. Same false
    // negative as above with nothing on screen to hint at it — this is the branch WIC-2179
    // added for the in-flight case, now carrying the truncated one.
    const dialog = renderPalette();
    await settle();
    await type(MATCHES_A_SUGGESTION);

    expect(screen.getByRole('button', { name: new RegExp(MATCHES_A_SUGGESTION) })).toBeTruthy();
    expect(dialog).toHaveTextContent(
      /Only the first 1 of your 137 applications were searched, so some may be missing/
    );
  });

  it('NEGATIVE CONTROL: still says "No results found" when the collection is complete', async () => {
    // Everything held constant except `truncated`, which is the only thing that may move
    // this branch. `totalCount` still disagrees with the row count, so a fix that keyed off
    // `applications.length < totalCount` instead of the flag would fail here — that is a
    // different (and, over a filtered collection, wrong) predicate.
    COLLECTION.truncated = false;
    const dialog = renderPalette();
    await settle();
    await type(MATCHES_NOTHING);

    expect(dialog).toHaveTextContent('No results found');
    expect(dialog).not.toHaveTextContent(/were not searched/);
    expect(dialog).not.toHaveTextContent(/Only the first/);
  });

  it('NEGATIVE CONTROL: a complete collection shows no notice on a non-empty list either', async () => {
    COLLECTION.truncated = false;
    const dialog = renderPalette();
    await settle();
    await type(MATCHES_A_SUGGESTION);

    expect(screen.getByRole('button', { name: new RegExp(MATCHES_A_SUGGESTION) })).toBeTruthy();
    expect(dialog).not.toHaveTextContent(/Only the first/);
  });

  it('PRECONDITION: the fixture rows really do reach the component', async () => {
    // Without this every assertion above could be passing over an empty palette — the
    // service stub silently returning nothing looks identical to a truncated result from
    // the empty branch. It also pins the migration itself: a component still calling a
    // hook that projects the rows out of the collection cannot render `truncated`, and a
    // component reading neither renders no rows here.
    renderPalette();
    await settle();

    expect(await screen.findByText(FIXTURE_APPLICATION.jobTitle)).toBeTruthy();
    expect(GET_ALL_PAGED).toHaveBeenCalled();
  });
});
