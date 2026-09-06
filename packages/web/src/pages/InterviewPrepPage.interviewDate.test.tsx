import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { InterviewPrepPage } from './InterviewPrepPage';
import { useInterviewPrepByApplication } from '../hooks/useInterviewPrep';
import type { GetInterviewPrepResponse } from '../types/interviewPrep';

/**
 * WIC-2192 — the two interview-date render sites, asserted for the first time.
 *
 * `docs/design/SAVED_FILTER_SHORTCUT_NAMING.md` recorded these as dead code: *"the
 * interview-date render sites in `InterviewPrepCard.tsx` and `QuickReferenceExport.tsx`
 * are permanently dark"*, because `InterviewPrepPage` read `application.interviewDate`
 * off a type that had no such property, so the value was always `undefined`. WIC-2023
 * added the column and put `interviewDate` on the prep endpoint's `ApplicationSummary`,
 * which lit both sites — and nothing has looked at them since. `git ls-tree | grep -i
 * interviewprep` returns no test file at all, so until this one "they are live now" was
 * a source reading, not a measurement.
 *
 * ## What is load-bearing here, and why the test sits at the page
 *
 * `applicationSummary` (`InterviewPrepPage.tsx`, the `const applicationSummary:
 * ApplicationSummary = {...}` literal) copies four fields and **deliberately omits
 * `interviewDate`**. Both consumers are handed `{ ...applicationSummary, interviewDate:
 * application.interviewDate }`, so that one explicit override per site is the entire
 * wiring. Delete either and that site goes dark again exactly as the ruling described,
 * with no type error — the target property is optional on both prop types, which is why
 * `tsc` never caught the original defect and would not catch its return.
 *
 * A test that rendered `InterviewPrepCard` or `QuickReferenceExport` directly with an
 * `interviewDate` prop would pass against that deletion: it would be asserting the
 * component's own formatting, one layer below the wiring that was actually broken. So
 * these render the page and reach the components through it.
 *
 * ## Why the timezone is pinned
 *
 * Both sites format an *instant* with `toLocaleDateString`, which resolves against the
 * host timezone. The repo pins `TZ` nowhere, so a bare assertion measures whatever the
 * runner happens to be set to — and under `TZ=UTC` an offset defect is invisible.
 * `INTERVIEW_INSTANT` is chosen to fall on **different calendar days** either side of
 * the date line: 02:30Z on the 10th is the evening of the **9th** in New York and the
 * morning of the **10th** in Tokyo. That is what makes the Tokyo case a real control
 * rather than a second copy of the same measurement, and it is what would red a future
 * "simplification" that slices the ISO string instead of formatting it — a slice shows
 * the 10th in every zone on earth.
 */

vi.mock('../hooks/useInterviewPrep', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useInterviewPrep')>()),
  useInterviewPrepByApplication: vi.fn(),
}));

/** 2026-09-10T02:30Z — the 9th in New York, the 10th in Tokyo and in UTC. */
const INTERVIEW_INSTANT = '2026-09-10T02:30:00.000Z';

const APPLICATION_ID = 'app_1';

/**
 * Rendered dates come out of ICU, which has changed the separator before `AM`/`PM`
 * between Node releases (ASCII space vs U+202F). The separator is not what this file
 * measures, so it is normalised away rather than pinned; every other character,
 * including the calendar day, stays literal.
 */
const normalise = (text: string) => text.replace(/\s+/g, ' ');

/**
 * The export preview's interview-date line is the only text on that surface formatted
 * with `weekday: 'long'`, which makes this a tighter negative control than matching the
 * year — see the unscheduled case below for what matching the year hits instead.
 */
const WEEKDAY_DATE = /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), /;

function prepResponse(interviewDate: string | undefined): GetInterviewPrepResponse {
  return {
    interviewPrep: {
      id: 'prep_1',
      applicationId: APPLICATION_ID,
      interviewType: 'behavioral',
      timeAvailable: '1_hour',
      focusAreas: [],
      completeness: 80,
      stories: [],
      questions: [],
      gapMitigations: [],
      practiceLog: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      version: 1,
    },
    application: {
      id: APPLICATION_ID,
      jobTitle: 'Staff Engineer',
      company: 'Northwind',
      status: 'interview',
      ...(interviewDate === undefined ? {} : { interviewDate }),
    },
  };
}

function renderPage(interviewDate: string | undefined) {
  vi.mocked(useInterviewPrepByApplication).mockReturnValue({
    data: prepResponse(interviewDate),
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useInterviewPrepByApplication>);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/applications/${APPLICATION_ID}/interview-prep`]}>
        <Routes>
          <Route
            path="/applications/:id/interview-prep"
            element={<InterviewPrepPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Opens the export modal, which is the only way to reach the second render site. */
async function openExportModal() {
  await userEvent.click(screen.getByRole('button', { name: /export quick reference/i }));
  return screen.getByRole('dialog');
}

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = originalTZ;
});

const originalTZ = process.env.TZ;

describe('InterviewPrepPage wires interviewDate into InterviewPrepCard', () => {
  it('renders the interview instant in the host timezone (America/New_York)', () => {
    process.env.TZ = 'America/New_York';
    renderPage(INTERVIEW_INSTANT);

    // The 9th, not the 10th: 02:30Z is the previous evening on the US east coast.
    expect(normalise(screen.getByText(/Sep 9, 2026/).textContent ?? '')).toContain(
      'Sep 9, 2026, 10:30 PM'
    );
  });

  it('renders the same instant as a different calendar day in Asia/Tokyo', () => {
    process.env.TZ = 'Asia/Tokyo';
    renderPage(INTERVIEW_INSTANT);

    // Same stored value, +9 rather than -4, so the label lands on the 10th. A render
    // that sliced the ISO string would print the 10th in both this test and the one
    // above; only the pair can tell formatting from slicing.
    expect(normalise(screen.getByText(/Sep 10, 2026/).textContent ?? '')).toContain(
      'Sep 10, 2026, 11:30 AM'
    );
  });

  it('renders the countdown from the same value', () => {
    process.env.TZ = 'America/New_York';
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-07T02:30:00.000Z'));

    renderPage(INTERVIEW_INSTANT);

    // Exactly three days out. The countdown block is the gate the date label sits
    // inside, so this pins the branch the label depends on rather than assuming it.
    expect(screen.getByText(/In 3 days/)).toBeInTheDocument();
  });

  it('renders neither countdown nor date when the interview is unscheduled', () => {
    process.env.TZ = 'America/New_York';
    renderPage(undefined);

    // The control for all three assertions above: a NULL interview date is the common
    // case (every row predating WIC-2023), and it must stay silent rather than render
    // an epoch or an "Invalid Date". `new Date(undefined)` formats as "Invalid Date",
    // so this reds on a guard that tests the wrong thing.
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Interview completed/)).not.toBeInTheDocument();
  });
});

describe('InterviewPrepPage wires interviewDate into QuickReferenceExport', () => {
  it('renders the interview instant in the export preview header', async () => {
    process.env.TZ = 'America/New_York';
    renderPage(INTERVIEW_INSTANT);

    const dialog = await openExportModal();

    // A separate render site with its own format options and its own spread, one
    // `interviewDate:` override away from going dark independently of the card.
    expect(
      normalise(within(dialog).getByText(/Wednesday, September 9, 2026/).textContent ?? '')
    ).toContain('Wednesday, September 9, 2026 at 10:30 PM');
  });

  it('omits the date line from the export preview when unscheduled', async () => {
    process.env.TZ = 'America/New_York';
    renderPage(undefined);

    const dialog = await openExportModal();

    // Matched on the weekday, not on the year. The dialog footer already carries an
    // unrelated date — "Generated with Careerpin • 9/6/2026", which is *today* and so
    // drifts — and a `/2026/` sweep here reds on that rather than on the site under
    // test. `weekday: 'long'` is unique to the interview-date line.
    expect(within(dialog).queryByText(WEEKDAY_DATE)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });
});
