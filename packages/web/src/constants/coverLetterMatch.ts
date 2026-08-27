import type { CoverLetterSummary } from '../services/api/types';

/**
 * The page size a caller must request before filtering cover letters on the
 * client, and the endpoint's own maximum.
 *
 * `GET /api/cover-letters` pages at `Math.min(params.limit ?? 20, 100)` and its
 * Zod schema is `.max(100)`, so 100 is the ceiling, not a preference — asking
 * for more is a 400.
 *
 * Why this cannot be left at the default 20: the only server-side narrowing
 * available is `?company=`, which is `ilike '%company%'`. Every letter for
 * every *other* role at that company — and at every company whose name merely
 * contains it — competes for the same page, and the page is chosen by
 * `created_at desc` before {@link coverLettersForApplication} ever sees it. So
 * the exact predicate can only ever remove rows; it cannot recover one the
 * server did not send. At 20, an application with 20 newer sibling letters
 * renders "No cover letters yet for this role" and leaves the workflow
 * checklist unticked — which is precisely the unreachability WIC-1533 was
 * filed to fix, reappearing at the tail of the list.
 *
 * **Residual, unfixed and deliberate:** above 100 letters matching the
 * substring filter, the same silent under-inclusion returns. Raising the cap
 * cannot close it — only WIC-1544's real `applicationId` association can, and
 * pagination UI on a section that should show a handful of letters would be
 * treating the symptom. Recorded here rather than hidden.
 */
export const COVER_LETTER_PAGE_MAX = 100;

/**
 * Decides whether a cover letter belongs to a given application.
 *
 * ## Why this function has to exist at all
 *
 * **There is no application↔cover-letter association in the system.** Measured
 * on `main` @ `881cb0f` (WIC-1533):
 *
 * - `cover_letters` (`packages/api/src/db/schema.ts`) has **no
 *   `application_id` column**.
 * - `POST /api/cover-letters/generate` validates with a `.strict()` Zod object
 *   that has **no `applicationId` key** — passing one is a 400, not a no-op.
 * - `GET /api/cover-letters` filters on `status`, `company`, `search`,
 *   `limit`, `cursor`. There is **no `applicationId` filter**.
 * - `CoverLetterGenerator` receives an `applicationId` prop and puts it only
 *   into the in-memory `CoverLetterResult` it hands to `onComplete`. It is
 *   never sent to the server; it dies with the component.
 *
 * So the association cannot be *looked up*. It has to be *reconstructed*, and
 * this is the one place that does it — so the "Cover Letters" section on
 * `ApplicationDetail` and the workflow checklist's "Cover Letter" row cannot
 * disagree about which letters count.
 *
 * ## What it reconstructs it from
 *
 * `cover_letters.target_company` and `.target_role` are both `NOT NULL`, and
 * `CoverLetterNew` prefills the generator with `application.company` and
 * `application.jobTitle`. A letter generated from an application therefore
 * carries that application's company and role verbatim. The same
 * `(targetCompany, targetRole)` pair is how `resume_variants` relates to a
 * target too, so this is the codebase's existing convention rather than a
 * new one invented here.
 *
 * The comparison is trimmed and case-folded because both sides are free text a
 * user can retype, but it is otherwise **exact**. Notably it is *not* the
 * `?company=` filter the endpoint offers, which is `ilike '%company%'` — a
 * substring match, under which an application at "Meta" claims every letter
 * written for "Metabase". The endpoint filter is still worth sending as a
 * server-side pre-narrowing; this predicate is what makes the result correct.
 *
 * ## Known limits, stated rather than hidden
 *
 * There are **two**, and they fail in opposite directions. Both are ceilings of
 * a reconstructed key, and both are lifted by the same fix — persisting
 * `applicationId` on the letter, an API and schema change WIC-1533 explicitly
 * puts out of scope, filed as **WIC-1544**.
 *
 * **1. Over-inclusion, visible.** Two applications for the same role at the
 * same company are indistinguishable here, and each shows both letters. The
 * user sees too much and can tell.
 *
 * **2. Under-inclusion, silent — see `COVER_LETTER_PAGE_MAX` below.** The
 * server filter is a substring match and the page is capped, so a letter this
 * predicate would have matched can be absent from the array before the
 * predicate ever runs. The user sees *nothing* and cannot tell. This is the
 * worse of the two, and it is the reason the cap is a named constant rather
 * than left at the endpoint's default.
 *
 * When WIC-1544 lands, this module should be **deleted** in favour of an
 * `?applicationId=` filter rather than kept beside it — two sources of truth
 * for one relation is how the type drift this file exists to work around got
 * started. The `coverLetterMatch.test.ts` case named "cannot separate two
 * applications for the same role at the same company" is the tripwire: it
 * starts failing when the real association arrives.
 */
export function coverLetterMatchesApplication(
  letter: Pick<CoverLetterSummary, 'targetCompany' | 'targetRole'>,
  application: { company: string; jobTitle: string }
): boolean {
  return (
    normalize(letter.targetCompany) === normalize(application.company) &&
    normalize(letter.targetRole) === normalize(application.jobTitle)
  );
}

/**
 * Every letter belonging to `application`, newest first.
 *
 * `GET /api/cover-letters` already returns `desc(created_at)`, so this
 * preserves the server's order rather than imposing one — but it sorts
 * explicitly anyway, because the caller may be filtering a cache that was
 * populated by a different query and the "most recent letter" is what the
 * checklist row links to.
 */
export function coverLettersForApplication(
  letters: CoverLetterSummary[],
  application: { company: string; jobTitle: string }
): CoverLetterSummary[] {
  return letters
    .filter((letter) => coverLetterMatchesApplication(letter, application))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
