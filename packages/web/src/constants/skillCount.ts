/**
 * The canonical rendering of a **count of skills** in a `JobFitAnalysis`
 * section heading.
 *
 * Decided in WIC-1528 and specified in `docs/design/DESIGN_SYSTEM.md`
 * ("Match and Gap Section Counts"). It replaces a bare `list.length`, which
 * named a number without naming the population it counted.
 *
 * **A count on this screen must say which skills it counts.** Every one of the
 * three counted sections — strong matches, partial matches, gaps — mixes
 * required and nice-to-have skills, while the fit summary a few rows above
 * counts required skills only. So `✅ Strong Matches (7)` could render beneath
 * "You match 5 of 6 required skills" with nothing on screen to explain how 7
 * exceeds 6. The number was never wrong; it was undisclosed.
 *
 * Two rules the format depends on:
 * - **Name the populations, never a second fraction.** `(7 of 9 skills)` would
 *   put a second `X of Y` beside the summary's `5 of 6 required skills` with a
 *   different numerator *and* a different denominator — the WIC-1288 "one word,
 *   two meanings" collision restated in numerals. Two labelled subtotals cannot
 *   be misread as a restatement of the summary.
 * - **Do not reach for "fit".** The verdict axis owns "fit" and the
 *   match-classification axis owns "match" (WIC-1301). These strings qualify a
 *   count of skills, so they stay on the words the screen already uses for the
 *   requirement axis: `Parsed Requirements` renders "Required Stack" and
 *   "Nice-to-have", and gap rows render "Required skill" / "Nice-to-have
 *   skill". No new noun is introduced.
 *
 * Reserved scale vocabulary is untouched: `critical` / `moderate` / `minor`
 * belong to gap severity and `high` / `medium` / `low` to confidence.
 *
 * ### These subtotals do not have to sum to the summary's numerator
 *
 * They are different populations, and now they say so. `computeSummary`
 * (`packages/api/src/services/job-fit.service.ts`) counts required strong
 * **and** required partial matches against `totalRequired`, so
 * `Strong Matches (5 required)` equals the summary's `5 of 6` only when there
 * happens to be no required partial match. That is not a defect to reconcile —
 * forcing the heading to agree would make it report something other than the
 * rows beneath it.
 */
export function formatSkillCount(skills: readonly { isRequired: boolean }[]): string {
  const required = skills.filter((s) => s.isRequired).length;
  const niceToHave = skills.length - required;

  // The noun is elided — it is supplied by the heading ("Strong Matches",
  // "Gaps"), so "5 required, 2 nice-to-have" needs no pluralisation.
  const parts: string[] = [];
  if (required > 0) parts.push(`${required} required`);
  if (niceToHave > 0) parts.push(`${niceToHave} nice-to-have`);

  // Every call site is gated on a non-empty list, so this is defensive: an
  // empty list has no population to disclose and falls back to the plain zero.
  return parts.length > 0 ? parts.join(', ') : '0';
}
