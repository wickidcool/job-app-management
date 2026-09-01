/**
 * Reconstructing "which artefacts belong to this application", for every
 * artefact type that has no `application_id` to look one up by.
 *
 * Started life as `coverLetterMatch.ts` under WIC-1533, which needed it for
 * cover letters alone. WIC-1536 needs the identical predicate for **resume
 * variants**, and generalising it here was the alternative to copying it —
 * which the file's own closing note calls out as how the type drift it exists
 * to work around got started in the first place.
 */

/**
 * The two fields an artefact must expose for {@link targetsApplication} to
 * place it.
 *
 * Both `cover_letters` and `resume_variants` declare `target_company` and
 * `target_role` as `NOT NULL` text (`packages/api/src/db/schema.ts`), and both
 * summary DTOs surface them. The predicate is written against this shape
 * rather than either concrete type so that a third artefact — outreach
 * messages carry the same pair — costs no new module.
 */
export interface TargetedItem {
  targetCompany: string;
  targetRole: string;
}

/**
 * The page size a caller must request before filtering on the client, and both
 * endpoints' own maximum.
 *
 * `GET /api/cover-letters` and `GET /api/resume-variants` page identically —
 * `Math.min(params.limit ?? 20, 100)` in `cover-letter.service.ts` and
 * `resume-variant.service.ts`, with a matching `.max(100)` in each route's Zod
 * schema — so 100 is the ceiling, not a preference; asking for more is a 400.
 *
 * Why this cannot be left at the default 20: the only server-side narrowing
 * available on either endpoint is `?company=`, and in both it is
 * `ilike '%company%'`. Every artefact for every *other* role at that company —
 * and at every company whose name merely contains it — competes for the same
 * page, and the page is chosen by `created_at desc` before
 * {@link itemsForApplication} ever sees it. So the exact predicate can only
 * ever remove rows; it cannot recover one the server did not send. At 20, an
 * application with 20 newer sibling artefacts renders an empty section and
 * leaves the workflow checklist unticked — which is precisely the
 * unreachability WIC-1533 and WIC-1536 were filed to fix, reappearing at the
 * tail of the list.
 *
 * **Residual, unfixed and deliberate:** above 100 rows matching the substring
 * filter, the same silent under-inclusion returns. Raising the cap cannot
 * close it — only WIC-1544's real `applicationId` association can, and
 * pagination UI on a section that should show a handful of rows would be
 * treating the symptom. Recorded here rather than hidden.
 */
export const TARGETED_LIST_PAGE_MAX = 100;

/**
 * Decides whether a targeted artefact belongs to a given application.
 *
 * ## Why this function has to exist at all
 *
 * **There is no application↔artefact association in the system** for either
 * type it currently serves. Measured on `main` @ `5e2956b`:
 *
 * - `cover_letters` and `resume_variants` both have **no `application_id`
 *   column** (`packages/api/src/db/schema.ts`). Contrast `interview_preps`,
 *   which does — a real `application_id` FK, `notNull`, `unique` — which is
 *   why the checklist's Interview Prep row needs none of this machinery.
 * - `POST /api/cover-letters/generate` validates with a `.strict()` Zod object
 *   that has **no `applicationId` key** — passing one is a 400, not a no-op.
 * - Neither `GET /api/cover-letters` nor `GET /api/resume-variants` offers an
 *   `applicationId` filter; both take `status`, `company`, `search`, `limit`,
 *   `cursor`.
 * - `CoverLetterGenerator` receives an `applicationId` prop and puts it only
 *   into the in-memory result it hands to `onComplete`. It is never sent to
 *   the server; it dies with the component.
 *
 * So the association cannot be *looked up*. It has to be *reconstructed*, and
 * this is the one place that does it — so the "Cover Letters" section on
 * `ApplicationDetail`, the checklist's "Cover Letter" row and its "Tailored
 * Resume" row cannot disagree about which artefacts count.
 *
 * ## What it reconstructs it from
 *
 * `target_company` and `target_role` are `NOT NULL` on both tables, and the
 * create flows prefill from `application.company` / `application.jobTitle`
 * (`CoverLetterNew`, `ResumeVariantNew`). An artefact generated from an
 * application therefore carries that application's company and role verbatim.
 *
 * The comparison is trimmed and case-folded because both sides are free text a
 * user can retype, but it is otherwise **exact**. Notably it is *not* the
 * `?company=` filter the endpoints offer, which is `ilike '%company%'` — a
 * substring match, under which an application at "Meta" claims every artefact
 * written for "Metabase". The endpoint filter is still worth sending as a
 * server-side pre-narrowing; this predicate is what makes the result correct.
 *
 * ## Known limits, stated rather than hidden
 *
 * There are **two**, and they fail in opposite directions. Both are ceilings of
 * a reconstructed key, and both are lifted by the same fix — persisting
 * `applicationId` on the artefact, an API and schema change WIC-1533 and
 * WIC-1536 both put out of scope, filed as **WIC-1544** (which names cover
 * letters *and* resume variants).
 *
 * **1. Over-inclusion, visible.** Two applications for the same role at the
 * same company are indistinguishable here, and each shows both artefacts. The
 * user sees too much and can tell.
 *
 * **2. Under-inclusion, silent — see {@link TARGETED_LIST_PAGE_MAX}.** The
 * server filter is a substring match and the page is capped, so an artefact
 * this predicate would have matched can be absent from the array before the
 * predicate ever runs. The user sees *nothing* and cannot tell. This is the
 * worse of the two, and it is the reason the cap is a named constant rather
 * than left at the endpoint's default.
 *
 * When WIC-1544 lands, this module should be **deleted** in favour of an
 * `?applicationId=` filter rather than kept beside it — two sources of truth
 * for one relation is how the type drift this file exists to work around got
 * started. The `applicationMatch.test.ts` case named "cannot separate two
 * applications for the same role at the same company" is the tripwire: it
 * starts failing when the real association arrives.
 */
export function targetsApplication(
  item: TargetedItem,
  application: { company: string; jobTitle: string }
): boolean {
  return (
    normalize(item.targetCompany) === normalize(application.company) &&
    normalize(item.targetRole) === normalize(application.jobTitle)
  );
}

/**
 * Every artefact belonging to `application`, newest first.
 *
 * Both list endpoints already return `desc(created_at)`, so this preserves the
 * server's order rather than imposing one — but it sorts explicitly anyway,
 * because the caller may be filtering a cache that was populated by a
 * different query, and "the most recent one" is what the checklist row links
 * to.
 *
 * Generic in `T` so the caller keeps its own summary type: passing
 * `CoverLetterSummary[]` gets `CoverLetterSummary[]` back, not `TargetedItem[]`
 * with the `id` and `title` erased.
 */
export function itemsForApplication<T extends TargetedItem & { createdAt: string }>(
  items: T[],
  application: { company: string; jobTitle: string }
): T[] {
  return items
    .filter((item) => targetsApplication(item, application))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
