import type { Confidence, GapSeverity, Recommendation } from '../types/jobFit';
import type { FitTier } from '../services/api/reportsService';

/**
 * The canonical, and only, display labels for the overall **fit level**.
 *
 * Decided in WIC-1288 and specified in `docs/design/DESIGN_SYSTEM.md`
 * ("Fit Level Labels"). Replaces `recommendation.replace('_', ' ')`, which
 * rendered the wire value straight to screen.
 *
 * **Fit level is a verdict, not a magnitude.** `JobFitAnalysis` already carries
 * two magnitude scales — gap severity (`critical` / `moderate` / `minor`) and
 * analysis confidence (`high` / `medium` / `low`) — so a fit level labelled
 * with a magnitude adjective is one word away from meaning two things on one
 * screen. That is exactly how `moderate_fit` came to render "moderate" above a
 * gap card also rendering "moderate": same word, opposite direction, no cue
 * that the axis had changed. The ladder below reads yes / maybe / reaching / no.
 *
 * **These are display strings only.** `strong_fit` / `moderate_fit` / `stretch`
 * / `low_fit` are API contract values (`docs/architecture/API_CONTRACTS.md`,
 * `POST /api/catalog/job-fit/analyze`) and are unchanged on the wire. Never
 * render a `Recommendation` or `FitTier` value directly; map it through here.
 *
 * Two rules the vocabulary depends on:
 * - **A word may not carry two meanings on one screen.** Recurrence is fine
 *   when the meaning and the direction are identical — "Strong fit" alongside
 *   the "Strong matches" section is the same claim about the same axis. It is
 *   not fine across axes, which is what "moderate" fit vs "moderate" gap was.
 * - **Fit level may not reuse gap severity's or confidence's words at all.**
 *   `_FIT_LEVEL_VOCABULARY_IS_DISJOINT` below makes a violation a compile
 *   error rather than something design review has to catch by eye.
 */
export const FIT_LEVEL_LABELS = {
  strong_fit: 'Strong fit',
  moderate_fit: 'Possible fit',
  stretch: 'Stretch',
  low_fit: 'Unlikely fit',
} as const satisfies Record<NonNullable<Recommendation>, string>;

/**
 * Fit level rendered when the analysis could not score the job description
 * (`recommendation: null` — an empty catalog, or a JD with no required skills).
 */
export const NO_FIT_LEVEL_LABEL = 'No recommendation';

/**
 * Display labels for the reports' `FitTier`, a **different** enum that happens
 * to share two members with `Recommendation`. The shared members must render
 * identically — one wire value must not read two ways across two screens.
 *
 * `weak_fit` has no `Recommendation` counterpart (`Recommendation` splits the
 * bottom of the range into `stretch` and `low_fit`); reconciling the two enums
 * is a contract question, tracked separately.
 */
export const FIT_TIER_LABELS: Record<FitTier, string> = {
  strong_fit: FIT_LEVEL_LABELS.strong_fit,
  moderate_fit: FIT_LEVEL_LABELS.moderate_fit,
  weak_fit: 'Weak fit',
  not_analyzed: 'Not analyzed',
};

// ── Vocabulary guard ─────────────────────────────────────────────────────────
//
// WIC-1288 surfaced as a Playwright strict-mode violation — i.e. after the copy
// had already shipped. The check below moves it to `npm run typecheck`: label a
// fit level with a word that gap severity or confidence already owns and
// `_FIT_LEVEL_VOCABULARY_IS_DISJOINT` stops being assignable from `true`, and
// the build fails naming the offending word.
//
// The reserved set is derived from the two contract unions rather than from the
// rendered strings, so adding a `GapSeverity` or `Confidence` member extends the
// guard automatically. Both scales render their wire value verbatim (modulo
// case), so union member and rendered word are the same string today.

/** Splits a label into its lowercased words: `'Possible fit'` -> `'possible' | 'fit'`. */
type Words<S extends string> = S extends `${infer Head} ${infer Tail}`
  ? Lowercase<Head> | Words<Tail>
  : Lowercase<S>;

type FitLevelWords = Words<(typeof FIT_LEVEL_LABELS)[NonNullable<Recommendation>]>;

type ReservedWords = GapSeverity | Confidence;

type CollidingWords = Extract<FitLevelWords, ReservedWords>;

export const _FIT_LEVEL_VOCABULARY_IS_DISJOINT: [CollidingWords] extends [never]
  ? true
  : ['fit level reuses a word owned by gap severity or confidence:', CollidingWords] = true;
