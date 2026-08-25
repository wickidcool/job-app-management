import { useNavigate } from 'react-router-dom';
import { useReportsByFitTier } from '../hooks/useReports';
import { FIT_TIER_LABELS } from '../constants/fitLevel';
import type { FitTier } from '../services/api/reportsService';

/**
 * The tiers that carry an actual verdict, best first. `unscored` and
 * `not_analyzed` are deliberately absent — they are states of the analysis, not
 * judgements about the job, and get their own row above rather than a tile that
 * invites comparison against a real fit level. That decision is now stated in
 * `VerdictTier` below, where the compiler holds both ends of it: these two may
 * not take a tile, and every other tier must.
 *
 * Each blurb states a **necessary** condition of its tier — never a sufficient
 * one. `computeRecommendation` is a four-way cascade over three variables (match
 * percentage, critical-gap count, seniority flag), and a tile has no room to
 * restate a cascade. What it must never do is contradict the tier it labels.
 *
 * (The number beside each blurb is `byTier[tier]` — how many applications fall
 * in that tier. It is not a skill-match count, and no skill-match count is
 * rendered on this page.)
 *
 * These originally restated the match-percentage arm alone, which made them
 * false for 14.1% of reachable scoring inputs: 100% of required skills matched
 * with 3 critical gaps returns `moderate_fit`, so the tier was captioned
 * "50–79% of required skills" — contradicting both its own definition and the
 * "You match 20 of 20 required skills" the user reads on drill-in
 * (`computeSummary`, `job-fit.service.ts`) (WIC-1309). Every blurb below
 * therefore carries the gap and seniority conditions that can pull a tier down.
 *
 * `packages/api/test/fit-tier-blurbs.test.ts` reads these exact strings and
 * checks each one against the real `computeRecommendation` over every reachable
 * input, so a blurb that stops being true fails the API suite. Reword freely —
 * update the paired predicate in that file when you do.
 */
const VERDICT_TIERS = [
  {
    tier: 'strong_fit',
    blurb: '80%+ of required skills, at most one critical gap',
    container: 'border-green-200 bg-green-50',
    heading: 'text-green-900',
    body: 'text-green-700',
  },
  {
    tier: 'moderate_fit',
    blurb: '50%+ of required skills, up to three critical gaps, no seniority mismatch',
    container: 'border-yellow-200 bg-yellow-50',
    heading: 'text-yellow-900',
    body: 'text-yellow-700',
  },
  {
    tier: 'stretch',
    blurb: 'A partial skill match, too many critical gaps, or a seniority mismatch',
    container: 'border-orange-100 bg-orange-50',
    heading: 'text-orange-700',
    body: 'text-orange-700',
  },
  {
    tier: 'low_fit',
    blurb: 'Under 30% of required skills, and no seniority mismatch',
    container: 'border-neutral-200 bg-neutral-50',
    heading: 'text-neutral-900',
    body: 'text-neutral-700',
  },
] as const satisfies ReadonlyArray<{
  tier: VerdictTier;
  blurb: string;
  container: string;
  heading: string;
  body: string;
}>;

/**
 * Every verdict tier must have a tile. An unrendered tier is not a cosmetic
 * gap: the API returns it in `groups` and counts it in `summary.byTier`, so a
 * tier with no tile is a set of applications silently missing from a report
 * that claims to cover the pipeline.
 *
 * This is the web-side twin of `_FIT_TIER_ORDER_IS_EXHAUSTIVE` in
 * `packages/api/src/services/reports.service.ts`, and it exists because
 * `VERDICT_TIERS` alone could not carry the claim. Its old annotation was
 * `Extract<FitTier, 'strong_fit' | ...>` — a *filter*, so deleting a tier
 * narrowed it and errored, but **adding** one was simply not selected and
 * compiled clean (WIC-1310). A subset assertion where an exhaustiveness
 * assertion was wanted.
 *
 * Both halves matter. `VerdictTier` is derived by exclusion rather than by
 * listing four names, so a new `Recommendation` member joins it automatically
 * and lands here as an error; `as const` keeps the entry literals, without
 * which `(typeof VERDICT_TIERS)[number]['tier']` would widen to the whole union
 * and the check below would be vacuous.
 */
type VerdictTier = Exclude<FitTier, 'unscored' | 'not_analyzed'>;

type UntiledVerdictTier = Exclude<VerdictTier, (typeof VERDICT_TIERS)[number]['tier']>;

const _VERDICT_TIERS_IS_EXHAUSTIVE: [UntiledVerdictTier] extends [never]
  ? true
  : ['VERDICT_TIERS has no tile for:', UntiledVerdictTier] = true;
void _VERDICT_TIERS_IS_EXHAUSTIVE;

export function ReportsByFitTier() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useReportsByFitTier();

  const summary = data?.summary ?? { total: 0, analyzed: 0, notAnalyzed: 0, byTier: {} };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-center">Loading by fit tier report...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-800 font-medium">Failed to load fit tier report</p>
          <p className="mt-2 text-sm text-red-600">
            {error instanceof Error ? error.message : 'Please try refreshing the page.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-neutral-900">By Fit Tier</h1>
        <p className="mt-2 text-neutral-600">Priority grouping by job fit analysis score</p>
      </div>

      {/* UC-3 Dependency Notice */}
      <div className="rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-8">
        <div className="text-center">
          <div className="text-4xl mb-4">🎯</div>
          <h2 className="text-xl font-semibold text-neutral-900 mb-2">Job Fit Analysis Required</h2>
          {/*
            The tier labels are deliberately NOT enumerated here: the tier cards below render
            in the same block (not an early return), so naming them twice on one page both
            stutters ("fit" four times) and duplicates every label string. WIC-1297 §4.
          */}
          <p className="text-neutral-600 mb-6 max-w-2xl mx-auto">
            Run job fit analysis on your applications to populate this report.
          </p>
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            View Applications
            <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Counts from the API for the two tiers that carry no verdict. Kept apart
          from the tier tiles below: these say something about the analysis, not
          about the job. */}
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">
                {FIT_TIER_LABELS.not_analyzed}
              </h3>
              <p className="mt-1 text-sm text-neutral-600">Applications without fit analysis</p>
            </div>
            <div className="text-3xl font-bold text-neutral-900">{summary.notAnalyzed}</div>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">{FIT_TIER_LABELS.unscored}</h3>
              <p className="mt-1 text-sm text-neutral-600">
                Analysed, but the job description had no required skills to score against
              </p>
            </div>
            <div className="text-3xl font-bold text-neutral-900">
              {summary.byTier['unscored'] ?? '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Placeholder tier groups */}
      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4 opacity-50">
        {VERDICT_TIERS.map(({ tier, blurb, container, heading, body }) => (
          <div key={tier} className={`rounded-lg border p-6 ${container}`}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className={`text-lg font-semibold ${heading}`}>{FIT_TIER_LABELS[tier]}</h3>
                <p className={`mt-1 text-sm ${body}`}>{blurb}</p>
              </div>
              <div className={`text-3xl font-bold ${heading}`}>{summary.byTier[tier] ?? '—'}</div>
            </div>
          </div>
        ))}
      </div>

      {data && (
        <p className="mt-4 text-xs text-neutral-400">
          Report generated at {new Date(data.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
