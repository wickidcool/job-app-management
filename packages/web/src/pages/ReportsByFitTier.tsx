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
 * restate a cascade. What it must never do is contradict the count printed
 * beside it.
 *
 * These originally restated the match-percentage arm alone, which made them
 * false for 81 of the 574 reachable scoring inputs (14.1%): 100% of required
 * skills matched with 3 critical gaps returns `moderate_fit`, so "50–79% of
 * required skills" appeared above a match count of 20/20 (WIC-1309).
 *
 * Read them as a set, not as four independent lines (WIC-1318). No tile spends
 * more than two clauses, because the cascade is legible *across* them: the gap
 * ladder off `strong_fit` (≤1) and `stretch` (>3), which leaves 2–3 for
 * `moderate_fit`; the seniority flag off `moderate_fit` ("no seniority
 * mismatch") and `stretch` ("or a seniority mismatch"). That is why
 * `moderate_fit` need not restate the gap bound and `low_fit` need not restate
 * the seniority one — and why `low_fit` deliberately does not, since saying it
 * would make that blurb sufficient as well as necessary.
 *
 * Two rules any rewording has to keep (WIC-1322):
 *
 * **A bare comma never carries the connective.** These blurbs are clause lists
 * of two different kinds, and the reader gets no cue from a comma alone which
 * kind they are holding. So conjunction is written `, with` and disjunction is
 * written `, or` — never a naked comma for either. `strong_fit` and
 * `moderate_fit` are conjunctions ("…, with at most one critical gap");
 * `stretch` is a disjunction ("…, more than three critical gaps, or a seniority
 * mismatch"); `low_fit` is one clause and takes no comma at all.
 *
 * **Exclusivity belongs to the set, not to the tiles.** The blurbs are
 * necessary-only, so more than one is true of the same application — 267 of the
 * 574 reachable inputs (46.5%) satisfy two or more. That is a property of
 * dropping clauses and it cannot be worded away tile by tile. Prefixing the
 * lower tiers with "Otherwise:" was proposed and measured: it removes only the
 * *upward* bleed (a blurb true of an input that scored higher) and leaves 147
 * of 574 (25.6%), because a blurb that dropped a clause stays true of inputs
 * that fall *through* it — `moderate_fit` dropped `criticalGaps <= 3`, so 60%
 * matched with five critical gaps reads as `moderate_fit` but scores `stretch`,
 * and no ordering word touches that case. Full exclusivity needs every blurb to
 * restate its whole cascade arm, which is the three-clause spec line this set
 * exists to avoid, and it degrades `low_fit` to "everything else". The cascade
 * is a fact about the four tiles together, so `TIER_ORDER_CAPTION` states it
 * once above the row instead — where it also answers the question overlapping
 * descriptions actually raise on a counts report: whether the counts
 * double-count.
 *
 * `packages/api/test/fit-tier-blurbs.test.ts` reads these exact strings and
 * checks each one against the real `computeRecommendation` over every reachable
 * input, so a blurb that stops being true fails the API suite. Reword freely —
 * update the paired predicate in that file when you do.
 */
const VERDICT_TIERS = [
  {
    tier: 'strong_fit',
    blurb: '80%+ of required skills, with at most one critical gap',
    container: 'border-green-200 bg-green-50',
    heading: 'text-green-900',
    body: 'text-green-700',
  },
  {
    tier: 'moderate_fit',
    blurb: '50%+ of required skills, with no seniority mismatch',
    container: 'border-yellow-200 bg-yellow-50',
    heading: 'text-yellow-900',
    body: 'text-yellow-700',
  },
  {
    tier: 'stretch',
    blurb: 'Under 50% of required skills, more than three critical gaps, or a seniority mismatch',
    container: 'border-orange-100 bg-orange-50',
    heading: 'text-orange-700',
    body: 'text-orange-700',
  },
  {
    tier: 'low_fit',
    blurb: 'Under 30% of required skills',
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
 * and lands here as an error.
 *
 * **Do not give `VERDICT_TIERS` an explicit type annotation.** This check reads
 * `typeof VERDICT_TIERS`, so it only sees the entry literals while that type is
 * *inferred*. An annotation replaces the inferred type, widening every entry's
 * `tier` to the whole union — `UntiledVerdictTier` becomes `never`, the check
 * passes vacuously, and the build stays clean. `satisfies` constrains the shape
 * without replacing the inferred type; that is why it is used here instead.
 *
 * Measured, adding a fifth `Recommendation` member (WIC-1337): `satisfies`
 * alone catches it, `as const satisfies` catches it, and an annotation misses
 * it *even with `as const satisfies` still present*. So `as const` is not the
 * load-bearing part — it only makes the array readonly. The annotation is the
 * hazard, and it is a plausible one: a lint preference, a "be explicit" review
 * note, or an IDE quick-fix all produce it. Because that failure is silent,
 * `_VERDICT_TIERS_KEEPS_ENTRY_LITERALS` below makes it loud.
 */
type VerdictTier = Exclude<FitTier, 'unscored' | 'not_analyzed'>;

type UntiledVerdictTier = Exclude<VerdictTier, (typeof VERDICT_TIERS)[number]['tier']>;

const _VERDICT_TIERS_IS_EXHAUSTIVE: [UntiledVerdictTier] extends [never]
  ? true
  : ['VERDICT_TIERS has no tile for:', UntiledVerdictTier] = true;
void _VERDICT_TIERS_IS_EXHAUSTIVE;

/**
 * Guards the guard: the exhaustiveness check above is only meaningful while
 * `typeof VERDICT_TIERS` preserves each entry's literal `tier`.
 *
 * `WidenedEntryTier` distributes over the entry union and keeps only entries
 * whose `tier` is the *whole* `VerdictTier` union rather than one name. An
 * annotation widens every entry at once, so it leaves every member behind and
 * the guard fires; with the type inferred, each entry carries a single literal
 * and every member collapses to `never`. Written without naming `'strong_fit'`
 * so that reordering or renaming tiles does not touch it.
 *
 * It distributes over `[number]` rather than testing `[0]` deliberately.
 * `(typeof VERDICT_TIERS)[0]` means "entry zero" only while the type is a
 * *tuple*; drop `as const` and the array is no longer a tuple, so `[0]` yields
 * the union of all four entries and its `tier` is the whole union — identical
 * to annotation-widening, and the guard would fail a tree that is in fact
 * still sound. That false positive was real and is measured in WIC-1361.
 */
type WidenedEntryTier<T> = T extends { tier: infer U }
  ? [VerdictTier] extends [U]
    ? T
    : never
  : never;

const _VERDICT_TIERS_KEEPS_ENTRY_LITERALS: [
  WidenedEntryTier<(typeof VERDICT_TIERS)[number]>,
] extends [never]
  ? true
  : ['VERDICT_TIERS has an explicit type annotation; the exhaustiveness check above is vacuous'] =
  true;
void _VERDICT_TIERS_KEEPS_ENTRY_LITERALS;

/**
 * Carries the one thing the tiles cannot say about themselves: the tiers are
 * ordered and `computeRecommendation` stops at the first arm that matches, so
 * an application meeting two descriptions is filed under the higher one only.
 *
 * Deliberately not folded into the blurbs. It is a claim about the set, and a
 * per-tile version ("Otherwise: …") would have to be read as an anaphor to the
 * tile before it — which the layout does not support: the row is
 * `lg:grid-cols-4` across at desktop and 2×2 at `md`, so "the one before this"
 * is leftward, or up-and-right, or (only at the single-column mobile
 * breakpoint) actually above. A caption above the row reads the same at all
 * three widths.
 *
 * "Counted once" is doing the load-bearing work: these tiles print counts, and
 * four overlapping descriptions over four numbers invite the reader to wonder
 * whether an application is being tallied twice.
 */
const TIER_ORDER_CAPTION =
  'Ranked best first. Each application is counted once, in the first tier it qualifies for.';

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
      <p className="mt-6 text-sm text-neutral-600">{TIER_ORDER_CAPTION}</p>
      <div className="mt-2 grid gap-4 md:grid-cols-2 lg:grid-cols-4 opacity-50">
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
