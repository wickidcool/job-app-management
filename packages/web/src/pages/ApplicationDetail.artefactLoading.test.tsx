import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationDetail } from './ApplicationDetail';
import { useApplication } from '../hooks/useApplications';
import { useCoverLetters } from '../hooks/useCoverLetters';
import { useResumeVariants } from '../hooks/useResumeVariants';
import { useInterviewPrepByApplication } from '../hooks/useInterviewPrep';
import type { Application } from '../types/application';

vi.mock('../hooks/useApplications');
vi.mock('../hooks/useCoverLetters');
vi.mock('../hooks/useResumeVariants');
vi.mock('../hooks/useInterviewPrep');

/**
 * WIC-1630 — the three artefact steps state a false negative as fact while
 * their queries are still in flight.
 *
 * ## What is broken
 *
 * `ApplicationDetail` reads all three artefact queries by `data` alone and
 * never by `isLoading`:
 *
 * ```
 * const { data: companyCoverLetters = [] } = useCoverLetters(…)
 * const { data: companyResumeVariants }    = useResumeVariants(…)
 * const { data: interviewPrep }            = useInterviewPrepByApplication(id)
 * ```
 *
 * Each one collapses "not known yet" onto the same value as "known absent" —
 * `[]`, `[]` and `undefined` respectively. So on the first render pass after
 * the application resolves, the page asserts that none of the three artefacts
 * exist, and offers to create all three. A user who already has them sees an
 * invitation to make duplicates.
 *
 * ## Why the window is real and not a frame
 *
 * All three queries carry `enabled: !!application` (cover letters and resume
 * variants explicitly; interview prep via `id`). They therefore *cannot start*
 * until the application query resolves, which guarantees a second round-trip
 * with the page already rendered. This is not a sub-frame flicker — it is one
 * full network RTT of the page confidently stating the wrong thing, and longer
 * on a slow connection.
 *
 * ## Why these tests compare two renders instead of asserting a shape
 *
 * The fix is the developer's to choose (WIC-1630 suggests a
 * `'unknown' | 'absent' | 'present'` prop, but that is explicitly "rationale,
 * not a mandate"). Pinning a specific skeleton, `aria-busy` attribute or prop
 * name here would be testing the fix rather than the defect, and would fail a
 * correct implementation that picked a different affordance.
 *
 * So the contract asserted below is the weakest one that still has teeth:
 *
 *   **the in-flight render must be distinguishable from the settled-and-empty
 *   render.**
 *
 * If the DOM for "we do not know yet" is byte-identical to the DOM for "we
 * looked and there is none", then the page is stating a false negative as
 * fact, whatever the internals look like. Any honest fix — skeleton, spinner,
 * omitted row, `aria-busy`, dropped link — makes them differ and turns these
 * green. A fix that only renames props without changing what the user sees
 * leaves them red, which is correct.
 *
 * The two create-links are additionally pinned directly (AC-1), because
 * "invites the user to duplicate an artefact they already have" is the
 * user-visible harm the card is actually about, and it is worth an assertion
 * that names it rather than inferring it from a diff.
 *
 * ## Expected state on this tree
 *
 * Every test in this file is **RED on `fix/wic1536-workflow-checklist-wiring`**
 * and is meant to be. They are the acceptance signal for WIC-1630: the fix is
 * done when they are green and `ApplicationDetail.workflowChecklist.test.tsx`
 * (13 tests, all green here) has not regressed.
 */
const application: Application = {
  id: 'app_1',
  jobTitle: 'Staff Engineer',
  company: 'Acme',
  status: 'applied',
  hasDocuments: false,
  version: 1,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  jobDescription: 'Build things.',
};

/**
 * Which of the two lifecycle states to mock the three artefact queries in.
 *
 * `in-flight` is the state under test. `settled-absent` is the comparison
 * baseline — the application genuinely has no artefacts — and is the state the
 * page is currently, wrongly, indistinguishable from.
 *
 * The application query itself is resolved in *both* cases on purpose. While it
 * is loading the page renders a spinner and no checklist at all, so that render
 * is not the defect; the defect is the window after it resolves and before the
 * artefact queries do.
 */
type Phase = 'in-flight' | 'settled-absent';

function renderDetail(phase: Phase) {
  const loading = phase === 'in-flight';

  vi.mocked(useApplication).mockReturnValue({
    data: application,
    isLoading: false,
  } as ReturnType<typeof useApplication>);

  // React Query leaves `data` undefined until a query settles. The page's
  // `= []` default is what silently turns that into "there are none".
  vi.mocked(useCoverLetters).mockReturnValue({
    data: loading ? undefined : [],
    isLoading: loading,
  } as unknown as ReturnType<typeof useCoverLetters>);

  vi.mocked(useResumeVariants).mockReturnValue({
    data: loading ? undefined : { variants: [] },
    isLoading: loading,
  } as unknown as ReturnType<typeof useResumeVariants>);

  // The service maps this endpoint's 404 to `null`, so settled-absent is
  // `null` here; `undefined` is genuinely "still loading". The page's
  // `!!interviewPrep?.interviewPrep` flattens both to `false`.
  vi.mocked(useInterviewPrepByApplication).mockReturnValue({
    data: loading ? undefined : null,
    isLoading: loading,
  } as unknown as ReturnType<typeof useInterviewPrepByApplication>);

  return render(
    <MemoryRouter initialEntries={['/applications/app_1']}>
      <Routes>
        <Route path="/applications/:id" element={<ApplicationDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The checklist card, scoped by its own heading. */
function checklist(): HTMLElement {
  return screen.getByRole('heading', { name: 'Application Workflow' }).closest('div')!
    .parentElement!.parentElement as HTMLElement;
}

/**
 * The four checklist rows, read positionally.
 *
 * Indexed rather than matched by label because a correct fix is allowed to
 * change a row's label rendering (dropping the link turns the label from an
 * `<a>` into a `<span>`), and a label-keyed lookup would then throw "no such
 * step" instead of reporting the real difference. The order is fixed by the
 * component's `items` array.
 */
const ROWS = ['Job Fit Analysis', 'Cover Letter', 'Tailored Resume', 'Interview Prep'] as const;

function rows(): HTMLElement[] {
  return within(checklist()).getAllByRole('listitem') as HTMLElement[];
}

function row(label: (typeof ROWS)[number]): HTMLElement {
  return rows()[ROWS.indexOf(label)];
}

/** Every href inside a checklist row (`[]` when the row renders no link). */
function hrefsIn(el: HTMLElement): string[] {
  return within(el)
    .queryAllByRole('link')
    .map((a) => a.getAttribute('href') ?? '');
}

/**
 * A row's rendered markup, whitespace-normalised.
 *
 * Compared across the two phases to answer the only question that matters:
 * can a user tell "we don't know yet" from "there isn't one"? Using the whole
 * subtree rather than a hand-picked tuple means *any* honest affordance counts
 * — a skeleton, a spinner, `aria-busy`, a dropped link, different copy.
 */
function rowMarkup(label: (typeof ROWS)[number]): string {
  return row(label).outerHTML.replace(/\s+/g, ' ').trim();
}

/** The "N of 4 steps completed" line. */
function progressText(): string {
  return within(checklist())
    .getByText(/steps completed/)
    .textContent!.trim();
}

function captureMarkup(label: (typeof ROWS)[number], phase: Phase): string {
  const { unmount } = renderDetail(phase);
  const html = rowMarkup(label);
  unmount();
  return html;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ApplicationDetail — artefact steps while their queries are in flight (WIC-1630)', () => {
  /**
   * Control. Every assertion below reads rows positionally, so if the checklist
   * ever stops rendering exactly these four in this order, those assertions
   * would be reading the wrong node — silently, and mostly still passing.
   *
   * This is the one test in the file that is GREEN on the defective tree.
   */
  it('renders the four steps in a known order while the artefact queries load', () => {
    renderDetail('in-flight');

    expect(rows()).toHaveLength(4);
    expect(within(row('Cover Letter')).getByText('Cover Letter')).toBeTruthy();
    expect(within(row('Tailored Resume')).getByText('Tailored Resume')).toBeTruthy();
    expect(within(row('Interview Prep')).getByText('Interview Prep')).toBeTruthy();
  });

  describe('AC-1 — an in-flight step does not invite duplicate creation', () => {
    it('does not offer "write a new cover letter" from the checklist while the query is in flight', () => {
      renderDetail('in-flight');

      expect(hrefsIn(row('Cover Letter'))).not.toContain('/cover-letters/new?appId=app_1');
    });

    it('does not offer "tailor a new resume" from the checklist while the query is in flight', () => {
      renderDetail('in-flight');

      expect(hrefsIn(row('Tailored Resume'))).not.toContain('/resume-variants/new?appId=app_1');
    });

    /**
     * Interview Prep keeps `/applications/:id/prep` in both states by design —
     * it is where you *read* an existing prep, not only where you create one —
     * so unlike the two rows above there is no create-link to withhold. Its
     * false claim is the untick itself, which is why this row is covered only
     * by the distinguishability test below and by the count.
     */
    it('does not render the interview prep step as settled-incomplete while the query is in flight', () => {
      const inFlight = captureMarkup('Interview Prep', 'in-flight');
      const absent = captureMarkup('Interview Prep', 'settled-absent');

      expect(inFlight).not.toEqual(absent);
    });
  });

  describe('AC-1/AC-2 — unknown is distinguishable from absent, per row', () => {
    it.each([['Cover Letter'], ['Tailored Resume'], ['Interview Prep']] as const)(
      'renders the %s step differently while loading than when it is known to be absent',
      (label) => {
        const inFlight = captureMarkup(label, 'in-flight');
        const absent = captureMarkup(label, 'settled-absent');

        expect(inFlight).not.toEqual(absent);
      }
    );

    /**
     * The negative control for the three cases above.
     *
     * Job Fit Analysis is driven by no query at all — `hasFitAnalysis` is never
     * passed and nothing persists a fit analysis (WIC-1652) — so it is
     * genuinely the same in both phases, and *must* stay identical. If a fix
     * makes this row differ too, it is keying off a page-wide "something is
     * loading" flag rather than per-query state, and would blank a row whose
     * answer was never in doubt.
     */
    it('leaves the query-less Job Fit Analysis step identical across both phases', () => {
      const inFlight = captureMarkup('Job Fit Analysis', 'in-flight');
      const absent = captureMarkup('Job Fit Analysis', 'settled-absent');

      expect(inFlight).toEqual(absent);
    });
  });

  describe('AC-2 — the cover letters section agrees with the checklist', () => {
    it('does not claim "No cover letters yet for this role" while the query is in flight', () => {
      renderDetail('in-flight');

      expect(screen.queryByText(/No cover letters yet for this role/)).toBeNull();
    });

    /**
     * AC-2 is about *agreement*, which neither surface can violate alone. The
     * two are checked in one render so a half-fix — guarding the section but
     * not the checklist, the exact failure WIC-1630 was split out of WIC-1533
     * to avoid — is caught here even though both single-surface tests above
     * would pass.
     */
    it('shows the section and the checklist step in the same state while loading', () => {
      renderDetail('in-flight');

      const sectionSaysAbsent = screen.queryByText(/No cover letters yet for this role/) !== null;
      const checklistSaysAbsent = hrefsIn(row('Cover Letter')).includes(
        '/cover-letters/new?appId=app_1'
      );

      expect({ sectionSaysAbsent, checklistSaysAbsent }).toEqual({
        sectionSaysAbsent: false,
        checklistSaysAbsent: false,
      });
    });
  });

  describe('AC-3 — the completion count does not count an unknown step as incomplete', () => {
    /**
     * The header is the surface WIC-1811 asks for an explicit PASS/FAIL on.
     *
     * `completedCount` counts `item.completed === true` and `totalCount` is the
     * literal row count, so three unknown steps are counted as three known
     * failures and the denominator claims all four answers are in hand. The
     * page reads "0 of 4 steps completed" and 0% — the same figures it shows an
     * application that genuinely has nothing.
     *
     * Asserted as "differs from settled-absent" rather than as a specific
     * string because AC-3 does not dictate what the count becomes; excluding
     * unknown steps could yield "0 of 1", a range, or a suppressed count.
     */
    it('does not report the same progress while loading as when everything is known absent', () => {
      const inFlightRender = renderDetail('in-flight');
      const inFlight = progressText();
      inFlightRender.unmount();

      renderDetail('settled-absent');
      const absent = progressText();

      // Pin the baseline too, so this cannot pass by the *absent* figure
      // drifting rather than the loading one being fixed.
      expect(absent).toEqual('0 of 4 steps completed');
      expect(inFlight).not.toEqual(absent);
    });

    it('does not assert a denominator of 4 when three of the four answers are unknown', () => {
      renderDetail('in-flight');

      expect(progressText()).not.toMatch(/of 4 steps completed/);
    });
  });
});
