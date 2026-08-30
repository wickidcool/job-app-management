import { describe, expect, it } from 'vitest';

import apiDashboardSource from '../../../api/src/services/dashboard.service.ts?raw';
import {
  APPLIED_WINDOW_DAYS,
  APPLIED_WINDOW_LABEL,
  APPLIED_WINDOW_METRIC_LABEL,
} from './appliedWindow';

/**
 * WIC-1743 — AC-N12, the half a rendering test cannot reach.
 *
 * `DashboardStats.windowLabel.test.tsx` proves the two surfaces render the label
 * this module exports. That is necessary and not sufficient: it would stay green
 * if the API moved its window to fourteen days, or made it calendar-week-to-date,
 * and left the copy saying seven. The label would then be wrong again, in exactly
 * the way AC-N12 forbids, with a full green suite.
 *
 * So this file reads the arithmetic itself. It is a source audit rather than a
 * behavioural test because the window is computed in a different package, against
 * a database, from `new Date()` — `packages/web` has no way to observe it at run
 * time. `route-integrity.test.ts` establishes the `?raw` audit shape here.
 */

describe('APPLIED_WINDOW_DAYS matches the window the API actually measures', () => {
  // `oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)` in getDashboardStats(). Anchored on
  // both identifiers so a rename cannot leave this matching some other subtraction.
  const ROLLING_SUBTRACTION = /oneWeekAgo\.setDate\(oneWeekAgo\.getDate\(\) - (\d+)\)/g;

  it('finds exactly one week-window computation to check', () => {
    // The positive control on the regex. A dead pattern and a satisfied one both
    // produce an empty match list, so the count is asserted before the value is
    // read off it — otherwise every assertion below would pass vacuously the day
    // the API renames its variable.
    const matches = [...apiDashboardSource.matchAll(ROLLING_SUBTRACTION)];

    expect(matches).toHaveLength(1);
  });

  it('subtracts exactly APPLIED_WINDOW_DAYS days', () => {
    const [match] = [...apiDashboardSource.matchAll(ROLLING_SUBTRACTION)];

    expect(Number(match[1])).toBe(APPLIED_WINDOW_DAYS);
  });

  it('measures a rolling window, not a calendar week', () => {
    // A week-to-date window has to find the start of the current week, and the only
    // way to do that with a JS Date is `getDay()`. Its absence is what makes "Last 7
    // Days" a true statement rather than a coincidence.
    //
    // This is the guard WIC-1743 asks for by name: the card forbids "fixing" the
    // label mismatch by re-windowing the metric, because AC-N10 defines it as the
    // last seven days. If someone re-windows it anyway, this reds and they have to
    // amend AC-N10 first rather than silently contradicting it.
    expect(apiDashboardSource).not.toMatch(/getDay\(\)/);
  });
});

describe('the exported labels name the window rather than a calendar period', () => {
  it('states the day count in both forms', () => {
    expect(APPLIED_WINDOW_LABEL).toContain(String(APPLIED_WINDOW_DAYS));
    expect(APPLIED_WINDOW_METRIC_LABEL).toContain(String(APPLIED_WINDOW_DAYS));
  });

  it('carries no calendar-period wording', () => {
    // The original defect, as a matcher. "This Week" and "This Month" are the two
    // phrasings a user reads as a calendar period; neither may reappear on a metric
    // whose window slides.
    for (const label of [APPLIED_WINDOW_LABEL, APPLIED_WINDOW_METRIC_LABEL]) {
      expect(label).not.toMatch(/\bthis (week|month)\b/i);
    }
  });

  it('names its subject in the standalone form and elides it in the tile form', () => {
    // The tile sits in a row with `Total` / `Response` / `In Review` and takes its
    // subject from the card around it; the Recent Activity row has no such supplier.
    // Pinned so the two forms cannot be collapsed into one by a future tidy-up that
    // would leave one of the surfaces under-labelled.
    expect(APPLIED_WINDOW_LABEL).not.toMatch(/applied/i);
    expect(APPLIED_WINDOW_METRIC_LABEL).toMatch(/applied/i);
    expect(APPLIED_WINDOW_METRIC_LABEL).toContain(APPLIED_WINDOW_LABEL);
  });
});
