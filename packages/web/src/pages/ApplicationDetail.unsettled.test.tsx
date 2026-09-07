import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationDetail } from './ApplicationDetail';
import type { Application } from '../types/application';

/**
 * WIC-2227 — a three-state type that could not reach its third state.
 *
 * `ArtefactStatus` is `'unknown' | 'absent' | 'present'` (`WorkflowChecklist.tsx`) and
 * exists precisely so a checklist row can decline to answer. `ApplicationDetail` derived
 * it with:
 *
 * ```
 * const artefactStatus = (loading, present) => loading ? 'unknown' : present ? 'present' : 'absent'
 * ```
 *
 * passing `isLoading`. In React Query v5 `isLoading` is `isPending && isFetching`, so it
 * is **false** for a query that is pending but *paused*, and false for one that has
 * *failed*. In both, `present` is false too — so the row rendered the definitive
 * `'absent'`: a checklist asserting as fact that the user has not written a cover letter,
 * when the truth is that we could not find out. `isError` never settles, so the failed
 * case is permanent rather than a flash.
 *
 * ## What these tests read
 *
 * `'unknown'` is not asserted as a prop — it is read through the two things the user
 * actually sees, which is what `WorkflowChecklist` already uses it for:
 *
 *   - the `Checking N …step(s)…` line, which counts unknown rows; and
 *   - the denominator of `X of Y steps completed`, which is deliberately *the steps we
 *     have an answer for*, not the row count.
 *
 * A fix that renamed props without changing either would leave these red, which is right.
 *
 * ## Why the service is mocked and not the hooks
 *
 * Same reason as the sibling `*.unsettled.test.tsx` files, and the reason WIC-2179's
 * review round 1 rejected the alternative: a hook mock whose `data` is derived from the
 * same flags the component branches on makes the fix's premise true by construction. A
 * real `QueryClient` drives the real hooks here; only the API barrel is stubbed.
 *
 * The application query itself always RESOLVES in this file. That is deliberate — it puts
 * the page past its own `if (!application)` guard, so the four artefact queries are
 * necessarily `enabled` and the state under test is genuinely paused/failed rather than
 * merely disabled.
 */

const GET_APPLICATION = vi.fn();
const LIST_COVER_LETTERS = vi.fn();
const LIST_RESUME_VARIANTS = vi.fn();
const GET_INTERVIEW_PREP = vi.fn();
const LIST_FIT_ANALYSES = vi.fn();

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    applicationService: { getById: (...a: unknown[]) => GET_APPLICATION(...a) },
    coverLetterService: { list: (...a: unknown[]) => LIST_COVER_LETTERS(...a) },
    resumeVariantService: { list: (...a: unknown[]) => LIST_RESUME_VARIANTS(...a) },
    interviewPrepService: { getByApplicationId: (...a: unknown[]) => GET_INTERVIEW_PREP(...a) },
    jobFitService: { listAnalyses: (...a: unknown[]) => LIST_FIT_ANALYSES(...a) },
  };
});

const APPLICATION: Application = {
  id: 'app-1',
  jobTitle: 'Staff Engineer',
  company: 'Acme',
  status: 'applied',
  hasDocuments: false,
  version: 3,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-10T00:00:00Z'),
};

/** The line `WorkflowChecklist` renders for rows whose query has not answered. */
const CHECKING_LINE = /Checking \d+ (more )?steps?…/i;
/** The settled-progress line; its denominator excludes unknown rows. */
const STEPS_COMPLETED = /(\d+) of (\d+) steps completed/i;

/** Every artefact query settles successfully and empty, except as overridden per test. */
function settleAllEmpty() {
  GET_APPLICATION.mockResolvedValue(APPLICATION);
  LIST_COVER_LETTERS.mockResolvedValue([]);
  LIST_RESUME_VARIANTS.mockResolvedValue({ variants: [] });
  GET_INTERVIEW_PREP.mockResolvedValue(null);
  LIST_FIT_ANALYSES.mockResolvedValue({ analyses: [] });
}

function renderApplicationDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/applications/app-1']}>
        <Routes>
          <Route path="/applications/:id" element={<ApplicationDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  for (const fn of [
    GET_APPLICATION,
    LIST_COVER_LETTERS,
    LIST_RESUME_VARIANTS,
    GET_INTERVIEW_PREP,
    LIST_FIT_ANALYSES,
  ]) {
    fn.mockReset();
  }
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('ApplicationDetail — an unread artefact query is "unknown", not "absent" (WIC-2227)', () => {
  it('CONTROL: when every artefact query settles empty, all four rows are known', async () => {
    // This is the state the checklist is ENTITLED to call absent, and it must still do
    // so — otherwise the assertions below would pass for a page that had simply stopped
    // reporting anything.
    settleAllEmpty();

    renderApplicationDetail();

    // Wait on the SETTLED denominator, not on the absence of the checking line. The four
    // artefact queries carry `enabled: !!application` and cannot start until the
    // application resolves, so for the first render there is no checklist in the document
    // at all — which makes "no checking line" trivially true, and a `waitFor` keyed on it
    // returns immediately against the page's own *loading* state. Keying on the value
    // being asserted is what makes this wait for the state under test.
    await waitFor(() => {
      expect(screen.getByText(STEPS_COMPLETED).textContent).toMatch(/0 of 4 steps completed/i);
    });
    // Only now is the absence of the checking line evidence of anything.
    expect(screen.queryByText(CHECKING_LINE)).toBeNull();
  });

  it('a FAILED artefact query leaves its row unknown rather than claiming the artefact is absent', async () => {
    settleAllEmpty();
    LIST_COVER_LETTERS.mockRejectedValue(new Error('500'));

    renderApplicationDetail();

    // The three healthy rows settle; the failed one must NOT join them. Waiting on the
    // denominator reaching 3 is what distinguishes "still loading" (denominator 0-2) from
    // the state under test.
    await waitFor(() => {
      expect(screen.getByText(STEPS_COMPLETED).textContent).toMatch(/0 of 3 steps completed/i);
    });
    // The failed row is reported as unanswered rather than as absent.
    expect(screen.getByText(CHECKING_LINE)).toBeTruthy();
    // The request really was attempted and really did fail.
    expect(LIST_COVER_LETTERS).toHaveBeenCalledTimes(1);
  });

  it('EVERY artefact row, not just the cover-letter one, stays unknown when its own query fails', async () => {
    // The three tests above pin the cover-letter row. Mutation showed that was the ONLY
    // row pinned: dropping `|| fitAnalysesError` or `|| interviewPrepError` from the other
    // call sites left the whole file green (45/45). Four near-identical `it`s would close
    // that, but this loops instead — and deliberately as a plain `it`, not `it.each`.
    // `it.each([])` registers nothing, so if this array were ever emptied the check would
    // disappear along with the thing it guards and the suite would report one FEWER test
    // rather than one failure. A shrinking count is the signature of a disarmed control.
    const rows: Array<[string, ReturnType<typeof vi.fn>]> = [
      ['cover letters', LIST_COVER_LETTERS],
      ['resume variants', LIST_RESUME_VARIANTS],
      ['interview prep', GET_INTERVIEW_PREP],
      ['fit analyses', LIST_FIT_ANALYSES],
    ];

    for (const [label, failing] of rows) {
      settleAllEmpty();
      failing.mockRejectedValue(new Error(`500 from ${label}`));

      renderApplicationDetail();

      // Exactly one row is unanswered, so the denominator is 3 rather than 4 — which is
      // the assertion that would have caught each of the surviving mutants.
      await waitFor(() => {
        expect(screen.getByText(STEPS_COMPLETED).textContent, label).toMatch(
          /0 of 3 steps completed/i
        );
      });
      expect(screen.getByText(CHECKING_LINE), label).toBeTruthy();

      cleanup();
    }
  });

  it('a FAILED application request does not claim the application does not exist', async () => {
    // The page-level twin of the same defect, and the worst claim on it: `getById` maps a
    // 404 to `null` and rethrows everything else, so a thrown error is precisely the case
    // where "not found" is NOT what happened.
    settleAllEmpty();
    GET_APPLICATION.mockRejectedValue(new Error('500'));

    renderApplicationDetail();

    expect(await screen.findByText(/Couldn’t load this application/i)).toBeTruthy();
    expect(screen.queryByText(/Application not found/i)).toBeNull();
  });

  it('CONTROL: a genuine 404 still reports the application as not found', async () => {
    // `getById` resolves `null` for a real 404. That case must keep its honest message —
    // otherwise the assertion above could be satisfied by a page that had simply lost the
    // not-found branch altogether.
    settleAllEmpty();
    GET_APPLICATION.mockResolvedValue(null);

    renderApplicationDetail();

    expect(await screen.findByText(/Application not found/i)).toBeTruthy();
    expect(screen.queryByText(/Couldn’t load this application/i)).toBeNull();
  });

  it('the Cover Letters section agrees with the checklist instead of saying "none yet"', async () => {
    // The two surfaces are wired to one `coverLettersUnsettled` precisely so they cannot
    // drift; this is the assertion that would catch them drifting apart again.
    settleAllEmpty();
    LIST_COVER_LETTERS.mockRejectedValue(new Error('500'));

    renderApplicationDetail();

    expect(await screen.findByText(/Couldn’t load cover letters for this role/i)).toBeTruthy();
    expect(screen.queryByText(/No cover letters yet for this role/i)).toBeNull();
    // A permanently-failed query is not "checking", so the spinner copy must not be the
    // thing left on screen forever either.
    expect(screen.queryByText(/Checking for cover letters…/i)).toBeNull();
  });

  it('an offline-PAUSED page does not claim the application does not exist', async () => {
    // Going offline pauses the application query too — which is exactly how the page-level
    // defect presented before the fix: `isLoading` false, `application` undefined, straight
    // through to "Application not found" for a record that exists and is merely unreachable.
    settleAllEmpty();
    onlineManager.setOnline(false);

    renderApplicationDetail();

    await waitFor(() => {
      expect(screen.getByText(/Loading\.\.\./i)).toBeTruthy();
    });
    expect(screen.queryByText(/Application not found/i)).toBeNull();
    // 0 calls is what makes this a PAUSED query rather than a merely slow one. It also
    // pins that the artefact queries never ran, so no row could have settled to "absent".
    expect(GET_APPLICATION).toHaveBeenCalledTimes(0);
    expect(LIST_COVER_LETTERS).toHaveBeenCalledTimes(0);
  });
});
