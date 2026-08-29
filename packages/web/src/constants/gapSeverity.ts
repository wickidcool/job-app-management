import type { GapSeverity } from '../types/jobFit';

/**
 * The canonical, and only, rendering of the `GapSeverity` field.
 *
 * Decided in WIC-1146 and specified in `docs/design/DESIGN_SYSTEM.md`
 * ("Gap Severity Scale"). It replaces three disagreeing ad-hoc ramps that were
 * previously inlined in `JobFitAnalysis` and `GapMitigationPanel`.
 *
 * Both render sites read this map so that the same severity cannot drift into
 * two different colours again.
 *
 * Roles, per the design system:
 * - `surface` tints the card.
 * - `mark` is the left border / any non-text graphical indicator; meets 3:1.
 * - `text` is the severity label; meets 4.5:1.
 *
 * Two rules the scale depends on:
 * - **The text label is mandatory at every render site.** Red -> orange ->
 *   amber is not distinguishable under colour-vision deficiency, so the word
 *   does the actual work (WCAG 1.4.1). Do not add a swatch, dot, chip or emoji
 *   as a colour-only mark in its place.
 * - **Never green.** `minor` is amber, not green and not yellow: every gap is
 *   a shortfall, and green reads as "resolved".
 */
export const GAP_SEVERITY: Record<
  GapSeverity,
  { label: string; surface: string; mark: string; text: string }
> = {
  critical: {
    label: 'Critical',
    surface: 'bg-red-50',
    mark: 'border-red-900',
    text: 'text-red-700',
  },
  moderate: {
    label: 'Moderate',
    surface: 'bg-orange-50',
    mark: 'border-orange-700',
    text: 'text-orange-700',
  },
  minor: {
    label: 'Minor',
    surface: 'bg-amber-50',
    mark: 'border-amber-600',
    text: 'text-amber-700',
  },
};
