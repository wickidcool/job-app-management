/**
 * The canonical labels for the Dashboard's "applied volume" metric.
 *
 * Decided in WIC-1743 under **AC-N12 (a window label names its window)** of the
 * UC-5 spec: *"Every surface that renders a window metric labels the window it
 * actually measures. A label a user reads as a calendar period may not be
 * attached to a rolling one."*
 *
 * ### The window is rolling, and it was labelled as a calendar period
 *
 * `appliedThisWeek` is computed in `packages/api/src/services/dashboard.service.ts`
 * as `new Date()` minus {@link APPLIED_WINDOW_DAYS} days — a window that ends
 * *now* and slides forward with every request. It was rendered under two labels
 * that both denote the **current calendar week**: `Applied This Week` on the
 * Dashboard's Recent Activity card and `This Week` on the `DashboardStats` tile.
 *
 * The failure needs no threshold and no volume of data. A user submits two
 * applications on Thursday and nothing afterwards; the following **Monday** the
 * Dashboard reads `Applied This Week: 2` while they have submitted nothing this
 * week. The count is correct for the window it measures and wrong for the window
 * it names.
 *
 * ### Why relabel rather than re-window
 *
 * Making the count calendar-week-to-date would contradict **AC-N10**, which
 * defines the metric as the last seven days regardless of status. That is the
 * whole reason, and it stands on its own: AC-N10 governs this metric directly,
 * so the relabel needs no appeal to consistency with a neighbouring window.
 *
 * It deliberately does not rest on the `appliedThisMonth` sibling, which cannot
 * carry that argument. That field is `oneMonthAgo.setMonth(getMonth() - 1)`, so
 * it measures 28 to 31 days rather than a flat 30 — 2026-03-31 looks back 28
 * days, 2026-02-28 looks back 31 — and it has no label to be consistent with,
 * because its only non-type occurrence in `packages/web/src` is the zeroed
 * pre-fetch fallback in `Dashboard.tsx`. It reaches no surface, so AC-N12 does
 * not currently reach it either.
 *
 * If week-to-date is ever judged the better product answer, AC-N10 has to be
 * amended first — `appliedWindow.test.ts` fails loudly if the API's window
 * silently becomes a calendar one, so that decision cannot be made by accident.
 *
 * ### Why the day count lives here and not in the copy
 *
 * The two labels are built from one number so they cannot drift apart from each
 * other, and `appliedWindow.test.ts` pins that number against the arithmetic in
 * the API service, so they cannot drift away from the thing they describe. A
 * label spelled out as a string literal on each surface is what allowed the
 * original defect to survive two surfaces and a spec review.
 */

/** The length of the rolling window `appliedThisWeek` measures, in days. */
export const APPLIED_WINDOW_DAYS = 7;

/**
 * Compact form, for a stat tile that sits beside `Total` / `Response` /
 * `In Review` and takes its subject from the surrounding card.
 */
export const APPLIED_WINDOW_LABEL = `Last ${APPLIED_WINDOW_DAYS} Days`;

/**
 * Long form, for a standalone metric row that has to name its own subject as
 * well as its window.
 */
export const APPLIED_WINDOW_METRIC_LABEL = `Applied (${APPLIED_WINDOW_LABEL})`;
