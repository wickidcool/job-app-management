import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationDetail } from './ApplicationDetail';
import { useApplication } from '../hooks/useApplications';
import { useCoverLetters } from '../hooks/useCoverLetters';
import { useResumeVariants } from '../hooks/useResumeVariants';
import { useInterviewPrepByApplication } from '../hooks/useInterviewPrep';
import { useJobFitAnalyses } from '../hooks/useJobFitAnalysis';
import { TARGETED_LIST_PAGE_MAX } from '../constants/applicationMatch';
import type { Application } from '../types/application';
import type { CoverLetterSummary, ResumeVariantSummary } from '../services/api/types';
import type { JobFitAnalysisSummary } from '../types/jobFit';

vi.mock('../hooks/useApplications');
vi.mock('../hooks/useCoverLetters');
vi.mock('../hooks/useResumeVariants');
vi.mock('../hooks/useInterviewPrep');
vi.mock('../hooks/useJobFitAnalysis');

/**
 * WIC-1536 — the checklist's props, asserted at the only call site that has to
 * supply them.
 *
 * ## Why this file renders the page and not the component
 *
 * `WorkflowChecklist` was never broken. It has always mapped
 * `hasCoverLetter`/`hasResumeVariant`/`hasInterviewPrep` onto ticks, a count
 * and a percentage correctly. The defect was that `ApplicationDetail` — its
 * **only** render site in the package — did not supply the props it needs to
 * count anything. On this branch's base, WIC-1533 had already wired the Cover
 * Letter step; `hasResumeVariant` and `hasFitAnalysis` kept their `= false`
 * defaults, and Interview Prep was hardcoded `completed: false` inside the
 * component with no prop to override it. A user who had written a tailored
 * resume and generated an interview prep therefore read "1 of 4 steps
 * completed" and **25%** with neither step ticked — the figure
 * `ApplicationDetail.pageCap.test.tsx` pins as a literal on that tree. On
 * `main`, where the Cover Letter step is unwired too, the same user reads
 * "0 of 4" and **0%**.
 *
 * A test over `WorkflowChecklist` in isolation cannot see that. Give it the
 * props and it passes — it passed on the defective tree. So every assertion
 * below renders the real page over the real component and mocks only the data
 * hooks, one layer further out than the thing under test. That is the same
 * distinction recorded on WIC-1563: a component obeying a prop is not the host
 * passing it.
 *
 * ## Why the fixtures carry non-matching siblings
 *
 * Each list fixture includes an artefact for a *different role at the same
 * company*, because that is what the server actually returns — the only
 * server-side narrowing available is `?company=`, an `ilike '%…%'`. If the page
 * ever stops applying `itemsForApplication` and just asks whether the array is
 * non-empty, every step ticks and the count assertions would still pass on a
 * fixture where everything matched. The sibling is what makes them able to
 * fail.
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

function letter(overrides: Partial<CoverLetterSummary> = {}): CoverLetterSummary {
  return {
    id: 'cl_1',
    status: 'finalized',
    title: 'Cover Letter - Staff Engineer at Acme',
    targetCompany: 'Acme',
    targetRole: 'Staff Engineer',
    tone: 'professional',
    lengthVariant: 'standard',
    preview: 'Dear hiring manager…',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    ...overrides,
  };
}

function variant(overrides: Partial<ResumeVariantSummary> = {}): ResumeVariantSummary {
  return {
    id: 'rv_1',
    status: 'finalized',
    title: 'Resume - Staff Engineer at Acme',
    targetCompany: 'Acme',
    targetRole: 'Staff Engineer',
    format: 'chronological',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

/** An artefact for another role at the same company — see the file header. */
const otherRoleLetter = letter({ id: 'cl_other', targetRole: 'Engineering Manager' });
const otherRoleVariant = variant({ id: 'rv_other', targetRole: 'Engineering Manager' });

/**
 * A stored job fit analysis (WIC-1835).
 *
 * `fitScore` is spelled out at every call site below rather than defaulted,
 * because the three states it can be in — a number, `null`, and absent — are
 * the whole point of the assertions that read it, and a default would let one
 * of them be inherited by accident.
 */
function analysis(overrides: Partial<JobFitAnalysisSummary> = {}): JobFitAnalysisSummary {
  return {
    id: 'jfa_1',
    applicationId: 'app_1',
    recommendation: 'strong_fit',
    fitScore: 72,
    summary: 'Strong match on the required stack.',
    confidence: 'high',
    catalogEmpty: false,
    analyzedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

interface Fixture {
  coverLetters?: CoverLetterSummary[];
  resumeVariants?: ResumeVariantSummary[];
  hasInterviewPrep?: boolean;
  fitAnalyses?: JobFitAnalysisSummary[];
}

function renderDetail({
  coverLetters = [],
  resumeVariants = [],
  hasInterviewPrep = false,
  fitAnalyses = [],
}: Fixture = {}) {
  vi.mocked(useApplication).mockReturnValue({
    data: application,
    isLoading: false,
  } as ReturnType<typeof useApplication>);

  vi.mocked(useCoverLetters).mockReturnValue({
    data: coverLetters,
    isLoading: false,
  } as ReturnType<typeof useCoverLetters>);

  vi.mocked(useResumeVariants).mockReturnValue({
    data: { variants: resumeVariants },
    isLoading: false,
  } as ReturnType<typeof useResumeVariants>);

  // The service maps the endpoint's 404 to `null`, so "no prep" is `null` here
  // and not `undefined` — `undefined` is the still-loading state.
  vi.mocked(useInterviewPrepByApplication).mockReturnValue({
    data: hasInterviewPrep ? { interviewPrep: { id: 'ip_1' } } : null,
    isLoading: false,
  } as unknown as ReturnType<typeof useInterviewPrepByApplication>);

  // The endpoint is filtered and ordered server-side, so the fixture is the
  // page the server would have returned — already narrowed to this application
  // and newest first. That is why there is no sibling row here of the kind the
  // two artefact lists above carry: there is no client predicate for one to
  // defeat. What replaces it is the request assertion in AC-2 below.
  vi.mocked(useJobFitAnalyses).mockReturnValue({
    data: { analyses: fitAnalyses },
    isLoading: false,
  } as unknown as ReturnType<typeof useJobFitAnalyses>);

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

interface Step {
  label: string;
  completed: boolean;
  href: string | null;
  recommended: boolean;
  badge: string | null;
}

/**
 * Reads the four steps out of the rendered DOM.
 *
 * Deliberately reads *rendered state*, not props: the tick is the `✓` the
 * component prints for a completed step, and `href` is whatever the row
 * actually links to (`null` when the row is a plain `<span>`). A prop-shaped
 * assertion would re-state the wiring instead of checking it.
 *
 * `recommended` and `badge` read the two pills the row can carry. Both are
 * rendered text, for the same reason — the "Recommended" pill is suppressed for
 * a completed step (`item.recommended && !item.completed`), so reading the flag
 * rather than the pill would claim a badge the user never sees (WIC-1835).
 */
function steps(): Step[] {
  return within(checklist())
    .getAllByRole('listitem')
    .map((li) => {
      const link = within(li).queryByRole('link');
      const match = li.textContent?.match(/(\d+)% match/);
      return {
        label: (link?.textContent ?? within(li).getAllByText(/\S/)[1]?.textContent ?? '').trim(),
        completed: li.textContent?.includes('✓') ?? false,
        href: link?.getAttribute('href') ?? null,
        recommended: !!within(li).queryByText('Recommended'),
        badge: match ? match[0] : null,
      };
    });
}

/** The labels of the rows currently carrying a "Recommended" pill. */
function recommendedSteps(): string[] {
  return steps()
    .filter((s) => s.recommended)
    .map((s) => s.label);
}

function step(label: string): Step {
  const found = steps().find((s) => s.label === label);
  if (!found)
    throw new Error(
      `no checklist step labelled "${label}" (got ${JSON.stringify(steps().map((s) => s.label))})`
    );
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ApplicationDetail — workflow checklist wiring', () => {
  /**
   * The control on the fixtures. If `steps()` ever stops finding four rows —
   * a markup change, a bad scope — every "is not completed" assertion below
   * would pass vacuously and every count would be read off the wrong node.
   */
  it('renders exactly the four workflow steps', () => {
    renderDetail();

    expect(steps().map((s) => s.label)).toEqual([
      'Job Fit Analysis',
      'Cover Letter',
      'Tailored Resume',
      'Interview Prep',
    ]);
  });

  describe('AC-1 — completed work is reflected', () => {
    it('ticks the three reachable steps and reports a non-zero percentage', () => {
      renderDetail({
        coverLetters: [letter(), otherRoleLetter],
        resumeVariants: [variant(), otherRoleVariant],
        hasInterviewPrep: true,
      });

      expect(step('Cover Letter').completed).toBe(true);
      expect(step('Tailored Resume').completed).toBe(true);
      expect(step('Interview Prep').completed).toBe(true);

      const card = within(checklist());
      expect(card.getByText('3 of 4 steps completed')).toBeInTheDocument();
      expect(card.getByText('75%')).toBeInTheDocument();
    });

    it('counts each artefact type independently rather than all-or-nothing', () => {
      renderDetail({ coverLetters: [letter()] });

      expect(step('Cover Letter').completed).toBe(true);
      expect(step('Tailored Resume').completed).toBe(false);
      expect(step('Interview Prep').completed).toBe(false);
      expect(within(checklist()).getByText('1 of 4 steps completed')).toBeInTheDocument();
      expect(within(checklist()).getByText('25%')).toBeInTheDocument();
    });

    /**
     * The pre-fix behaviour, pinned as the thing that must not come back. Every
     * figure here was what a user with three finished artefacts saw.
     */
    it('still reports 0% when there genuinely is nothing', () => {
      renderDetail();

      expect(steps().every((s) => !s.completed)).toBe(true);
      expect(within(checklist()).getByText('0 of 4 steps completed')).toBeInTheDocument();
      expect(within(checklist()).getByText('0%')).toBeInTheDocument();
    });

    /**
     * The exact predicate has to run *at this call site*, not only inside
     * `applicationMatch.ts` where its own unit tests cover it. Here the server
     * has returned only siblings — same company, different role — which is
     * exactly what `?company=`'s `ilike '%…%'` yields.
     */
    it('does not tick a step for another role at the same company', () => {
      renderDetail({
        coverLetters: [otherRoleLetter],
        resumeVariants: [otherRoleVariant],
      });

      expect(step('Cover Letter').completed).toBe(false);
      expect(step('Tailored Resume').completed).toBe(false);
      expect(within(checklist()).getByText('0 of 4 steps completed')).toBeInTheDocument();
    });
  });

  describe('AC-2 — a completed step stops inviting a duplicate', () => {
    it('repoints the Cover Letter and Tailored Resume rows at the artefact', () => {
      renderDetail({
        coverLetters: [letter(), otherRoleLetter],
        resumeVariants: [variant(), otherRoleVariant],
      });

      expect(step('Cover Letter').href).toBe('/cover-letters/cl_1');
      expect(step('Tailored Resume').href).toBe('/resume-variants/rv_1');
    });

    it('links to the newest artefact when there is more than one', () => {
      renderDetail({
        coverLetters: [letter(), letter({ id: 'cl_2', createdAt: '2026-08-09T00:00:00.000Z' })],
        resumeVariants: [variant(), variant({ id: 'rv_2', createdAt: '2026-08-09T00:00:00.000Z' })],
      });

      expect(step('Cover Letter').href).toBe('/cover-letters/cl_2');
      expect(step('Tailored Resume').href).toBe('/resume-variants/rv_2');
    });

    it('still offers to create one when the step is not completed', () => {
      renderDetail();

      expect(step('Cover Letter').href).toBe('/cover-letters/new?appId=app_1');
      expect(step('Tailored Resume').href).toBe('/resume-variants/new?appId=app_1');
    });

    /**
     * Interview Prep is the deliberate exception. `/applications/:id/prep` is
     * where an existing prep is *read*, not only where one is created, so
     * dropping the link on completion — right for the two "go generate one"
     * rows above — would take the finished artefact away.
     */
    it('keeps the Interview Prep link in both states', () => {
      // Unmounted between the two renders on purpose: without it both
      // checklists are in the document at once and the scope helper throws on
      // finding two headings, which is a harness failure and not this
      // assertion failing.
      const { unmount } = renderDetail();
      expect(step('Interview Prep').completed).toBe(false);
      expect(step('Interview Prep').href).toBe('/applications/app_1/prep');
      unmount();

      renderDetail({ hasInterviewPrep: true });
      expect(step('Interview Prep').completed).toBe(true);
      expect(step('Interview Prep').href).toBe('/applications/app_1/prep');
    });
  });

  describe('AC-3 — the page asks for a page big enough to filter', () => {
    /**
     * Asserted on the **request**, not the render. Both lists are filtered on
     * the client after the server has already truncated the page, so a row this
     * page needed can be missing before its predicate ever runs. At the default
     * 20, an application with 20 newer siblings at the same company renders an
     * unticked checklist — this card's own defect, reappearing at the tail of
     * the list. No render-output assertion can see that; the fixture is
     * whatever the test hands over.
     */
    it('requests the endpoint maximum for both artefact lists', () => {
      renderDetail();

      expect(vi.mocked(useCoverLetters)).toHaveBeenCalledWith(
        expect.objectContaining({ company: 'Acme', limit: TARGETED_LIST_PAGE_MAX }),
        expect.objectContaining({ enabled: true })
      );
      expect(vi.mocked(useResumeVariants)).toHaveBeenCalledWith(
        expect.objectContaining({ company: 'Acme', limit: TARGETED_LIST_PAGE_MAX }),
        expect.objectContaining({ enabled: true })
      );
      expect(TARGETED_LIST_PAGE_MAX).toBeGreaterThan(20);
    });

    it('looks the interview prep up by application id rather than filtering a list', () => {
      renderDetail();

      // `interview_preps.application_id` is a real notNull/unique FK, so this
      // one needs no reconstruction — and if it ever regresses to list-and-filter
      // it inherits the page-cap problem the other two have to live with.
      expect(vi.mocked(useInterviewPrepByApplication)).toHaveBeenCalledWith('app_1');
    });

    /**
     * The step is read off the *payload*, not the envelope.
     *
     * `getByApplicationId` resolves to `GetInterviewPrepResponse | null`, so a
     * truthy body carrying no `interviewPrep` — which is what a 200 with an
     * empty object is — would tick a step for a prep that does not exist if the
     * page tested the response itself. `ApplicationDetail.pageCap.test.tsx`
     * serves exactly that body from its `fetch` replay and is what caught it;
     * this pins it where the distinction is legible.
     */
    it('does not tick Interview Prep for a response carrying no prep', () => {
      vi.mocked(useApplication).mockReturnValue({
        data: application,
        isLoading: false,
      } as ReturnType<typeof useApplication>);
      vi.mocked(useCoverLetters).mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof useCoverLetters>);
      vi.mocked(useResumeVariants).mockReturnValue({
        data: { variants: [] },
        isLoading: false,
      } as unknown as ReturnType<typeof useResumeVariants>);
      vi.mocked(useInterviewPrepByApplication).mockReturnValue({
        data: {},
        isLoading: false,
      } as unknown as ReturnType<typeof useInterviewPrepByApplication>);

      render(
        <MemoryRouter initialEntries={['/applications/app_1']}>
          <Routes>
            <Route path="/applications/:id" element={<ApplicationDetail />} />
          </Routes>
        </MemoryRouter>
      );

      expect(step('Interview Prep').completed).toBe(false);
      expect(within(checklist()).getByText('0 of 4 steps completed')).toBeInTheDocument();
    });
  });

  /**
   * WIC-1835 AC-2 — the fit analysis step, resolved from the stored analysis.
   *
   * This suite replaces WIC-1536's tripwire, which asserted the opposite:
   * that the step could *not* tick, because nothing persisted an analysis and
   * so no caller could supply `hasFitAnalysis` truthfully. PR #283 added the
   * `job_fit_analyses` table and `GET /catalog/job-fit/analyses`, so the
   * ceiling that test pinned — 3 of 4 — is no longer the honest one, and the
   * assertion it made is now the regression.
   */
  describe('WIC-1835 AC-2 — the fit analysis step ticks from the stored analysis', () => {
    it('ticks Job Fit Analysis and badges the stored score', () => {
      renderDetail({
        fitAnalyses: [analysis({ fitScore: 72 })],
        coverLetters: [letter()],
        resumeVariants: [variant()],
        hasInterviewPrep: true,
      });

      expect(step('Job Fit Analysis').completed).toBe(true);
      expect(step('Job Fit Analysis').badge).toBe('72% match');
      // A completed step drops its "go create one" link, as the other two do.
      expect(step('Job Fit Analysis').href).toBeNull();
      expect(within(checklist()).getByText('4 of 4 steps completed')).toBeInTheDocument();
      expect(within(checklist()).getByText('100%')).toBeInTheDocument();
    });

    /**
     * The negative control, and the only case that survives unchanged from
     * WIC-1536's tripwire. Without it every assertion above could be satisfied
     * by a page that ticks the step unconditionally.
     */
    it('leaves the step unticked and still offering to create one when there is no analysis', () => {
      renderDetail({
        coverLetters: [letter()],
        resumeVariants: [variant()],
        hasInterviewPrep: true,
      });

      expect(step('Job Fit Analysis').completed).toBe(false);
      expect(step('Job Fit Analysis').href).toBe('/job-fit-analysis?appId=app_1');
      expect(step('Job Fit Analysis').badge).toBeNull();
      expect(within(checklist()).getByText('3 of 4 steps completed')).toBeInTheDocument();
    });

    /**
     * `hasFitAnalysis` means "an analysis exists", not "an analysis scored
     * something". `fitScore` is `null` exactly when `recommendation` is — the
     * catalog was empty, or the job description named no required skills — and
     * that analysis is still one the user has run. Ticking off the score would
     * keep offering to create an analysis they already have, which is WIC-1652's
     * user-visible complaint restated.
     */
    it('ticks an unscored analysis, with no badge to show for it', () => {
      renderDetail({ fitAnalyses: [analysis({ fitScore: null, recommendation: null })] });

      expect(step('Job Fit Analysis').completed).toBe(true);
      expect(step('Job Fit Analysis').badge).toBeNull();
      expect(within(checklist()).getByText('1 of 4 steps completed')).toBeInTheDocument();
    });

    /**
     * The discriminating case for the badge, and the reason the component tests
     * `fitScore != null` rather than `fitScore ?`.
     *
     * Under truthiness a genuine 0% match rendered no badge, so a user whose
     * catalog matched none of the required stack saw exactly what a user with
     * no analysis at all saw. Every other assertion in this suite passes on the
     * truthiness version — 72 is truthy and `null` is falsy either way — so
     * this one is the whole of the coverage for that change.
     */
    it('renders a genuine zero as a badge rather than swallowing it', () => {
      renderDetail({ fitAnalyses: [analysis({ fitScore: 0, recommendation: 'low_fit' })] });

      expect(step('Job Fit Analysis').completed).toBe(true);
      expect(step('Job Fit Analysis').badge).toBe('0% match');
    });

    /**
     * Asserted on the **request**, because no render assertion can see this.
     *
     * `job_fit_analyses.application_id` is nullable: an analysis run from
     * `/job-fit-analysis` with no `appId` belongs to no application and can
     * never tick any checklist. So a page that dropped `applicationId` from the
     * query would tick this application's step for someone else's analysis, and
     * every assertion above would still pass — the fixture is whatever this
     * file hands over. The filter has to be the server's.
     */
    it('narrows the analyses query to this application server-side', () => {
      renderDetail();

      expect(vi.mocked(useJobFitAnalyses)).toHaveBeenCalledWith(
        expect.objectContaining({ applicationId: 'app_1' }),
        expect.objectContaining({ enabled: true })
      );
    });
  });

  /**
   * WIC-1835 AC-3 — the two `recommended` badges.
   *
   * Both are `hasFitAnalysis && !hasX`, so on a tree where nothing could supply
   * `hasFitAnalysis` they were dead branches: the pill existed in the markup
   * and no state reached it. AC-2's wiring is what makes them reachable, and
   * these assertions are what pin that they arrive on the right two rows.
   */
  describe('WIC-1835 AC-3 — the analysis makes the Cover Letter and Resume steps recommended', () => {
    /**
     * Read as a set, not one row at a time. The *whole* recommendation state of
     * the checklist moves here — off "Job Fit Analysis" and onto the two rows
     * the analysis unlocks — and a per-row assertion would miss a pill that
     * stayed behind. Interview Prep is never in this set for an `applied`
     * application; it is recommended at `interview`/`phone_screen`.
     */
    it('moves the recommendation off the analysis and onto the next two steps', () => {
      const { unmount } = renderDetail();
      expect(recommendedSteps()).toEqual(['Job Fit Analysis']);
      unmount();

      renderDetail({ fitAnalyses: [analysis()] });
      expect(recommendedSteps()).toEqual(['Cover Letter', 'Tailored Resume']);
    });

    /**
     * A step that is already done is not recommended, however unlocked it is —
     * the pill is suppressed by `!item.completed`. Without this the assertion
     * above passes for a component that recommends both rows unconditionally
     * once an analysis exists.
     */
    it('drops the recommendation from a step that has been completed', () => {
      renderDetail({ fitAnalyses: [analysis()], coverLetters: [letter()] });

      expect(step('Cover Letter').completed).toBe(true);
      expect(recommendedSteps()).toEqual(['Tailored Resume']);
    });

    /**
     * The control that makes the two above able to fail on the wiring rather
     * than on the component. An unscored analysis is still an analysis, so it
     * unlocks the two steps exactly as a scored one does — this is the same
     * "exists, not scored" rule AC-2 pins, observed through the badges.
     */
    it('recommends the next two steps for an unscored analysis too', () => {
      renderDetail({ fitAnalyses: [analysis({ fitScore: null, recommendation: null })] });

      expect(recommendedSteps()).toEqual(['Cover Letter', 'Tailored Resume']);
    });
  });
});
