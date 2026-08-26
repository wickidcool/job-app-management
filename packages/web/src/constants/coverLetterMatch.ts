import type { CoverLetterSummary } from '../services/api/types';

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
 * ## Known limit, stated rather than hidden
 *
 * Two applications for the **same role at the same company** are
 * indistinguishable here, and each will show both letters. That is not a bug
 * in this function — it is the precision ceiling of a reconstructed key, and
 * it can only be lifted by persisting `applicationId` on the letter, which is
 * an API and schema change that WIC-1533 explicitly puts out of scope.
 *
 * That change is filed as **WIC-1544**. When it lands, this module should be
 * **deleted** in favour of an `?applicationId=` filter rather than kept beside
 * it — two sources of truth for one relation is how the type drift this file
 * exists to work around got started. The `coverLetterMatch.test.ts` case named
 * "cannot separate two applications for the same role at the same company" is
 * the tripwire: it starts failing when the real association arrives.
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
