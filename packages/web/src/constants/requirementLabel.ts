/**
 * The canonical, and only, rendering of a skill's `isRequired` flag on a
 * **row** of `JobFitAnalysis`.
 *
 * Decided in WIC-1534 and specified in `docs/design/DESIGN_SYSTEM.md`
 * ("Match and Gap Section Counts" -> "Per-row required-ness"). It is the row
 * counterpart to `skillCount.ts`, which renders the same flag in aggregate for
 * the section headings.
 *
 * **Required-ness is stated on every row, in both branches.** Before this, the
 * three per-skill sections disclosed the flag three different ways: gap rows
 * named both branches, strong-match rows carried a `Required` badge *or
 * nothing*, and partial-match rows said nothing at all. Two faults followed:
 *
 * - **A negative was doing positive work.** On a strong-match row, no badge
 *   meant "nice-to-have" — indistinguishable from a row where the flag was
 *   simply not rendered. An absence cannot be read as a statement.
 * - **Partial-match rows carried no signal.** WIC-1528 put the split in the
 *   heading (`⚠️ Partial Matches (2 required, 1 nice-to-have)`), so the counts
 *   are known; but with more than one row of each kind, *which* row is which
 *   was unrecoverable.
 *
 * ### Why a text qualifier and not a badge on every row
 *
 * The rejected alternative was to extend the strong-match `Required` badge to
 * all three sections. It fails twice:
 *
 * - **Colour.** The badge is `bg-red-100 text-red-800` — red, on a
 *   green-bordered card that means good news, to mean "important" rather than
 *   "bad". Gap severity owns red on this screen and its ramp is
 *   `critical` -> `moderate` -> `minor` (WIC-1146). Spending red on a match row
 *   is a cross-axis colour reuse; copying it to two more sections would spend
 *   it three times over.
 * - **Density.** Three sections x N rows is a lot of chrome for one boolean.
 *
 * The qualifier instead reuses the one pattern already proven on this screen —
 * gap rows have always read `Critical — Required skill` — so no new chrome is
 * introduced and all three sections converge on a single shape.
 *
 * ### The noun is carried here, and elided in the heading
 *
 * `skillCount.ts` emits `2 required, 1 nice-to-have` with no noun, because the
 * heading ("Strong Matches", "Gaps") supplies it. A row has no such supplier,
 * so it carries "skill" itself. The two are the same vocabulary at two
 * altitudes, not two vocabularies — and neither reaches for "fit", which the
 * verdict axis owns (WIC-1301), nor for a reserved scale word (WIC-1146).
 */
export function formatRequirement(isRequired: boolean): string {
  return isRequired ? 'Required skill' : 'Nice-to-have skill';
}

/**
 * The separator between a row's classification and its required-ness
 * qualifier: `Matches: postgresql (alias) — Required skill`.
 *
 * Exported so the three sections cannot drift apart on punctuation the way
 * they drifted apart on disclosure. Gap rows previously used a hyphen and are
 * now on this em dash with them.
 */
export const REQUIREMENT_SEPARATOR = ' — ';
