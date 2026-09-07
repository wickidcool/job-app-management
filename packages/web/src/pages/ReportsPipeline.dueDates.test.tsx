import { describe, expect, it, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { reportsService, type PipelineReportResponse } from '../services/api';
import { renderReportPage } from '../test/reportsKeyboardNav';
import { ReportsPipeline } from './ReportsPipeline';

/**
 * WIC-2267 — the "Overdue" / "Due soon" badges, asserted through the rendered page.
 *
 * ⚠️ THIS IS COMPONENT COVERAGE, NOT ROUTE COVERAGE. `App.tsx` sends `/reports/pipeline` to
 * `<Navigate to="/applications" replace />`, so nothing here ships to a user — the same
 * caveat `ReportsPipeline.keyboardNav.test.tsx` carries at length, and the reason the
 * user-facing guard for this card is `ApplicationDetail.nextActionDue.test.tsx` instead.
 * This file exists so the three fixed sites in this file cannot silently regress while the
 * page is unrouted, which is exactly when nobody would notice.
 *
 * ⚠️ TZ IS PINNED AND IS LOAD-BEARING. Under UTC every assertion below passes against the
 * broken code, because that is the one zone where `new Date('YYYY-MM-DD')` and local
 * midnight agree. `utcControl` pins that fact rather than leaving it as a claim.
 *
 * The fixtures use bare `YYYY-MM-DD`, which is what the wire actually carries —
 * `next_action_due` is a Postgres `date` column (`schema.ts:52`, `mode: 'string'`) passed
 * through unformatted by the service (`reports.service.ts:146`). Note that the sibling
 * keyboard-nav fixture uses a full `...T00:00:00Z` datetime for the same field; that
 * misrepresents the endpoint, and it is corrected in this branch.
 */
/**
 * The badge text, matched with its emoji.
 *
 * A bare /Overdue/ is NOT usable here: the stats tile below the columns carries a
 * permanent `<div>Overdue</div>` label, so a loose matcher finds that element whether or
 * not any row is badged, and the negative assertions can never fail. Caught exactly that
 * way while writing this file.
 */
const OVERDUE_BADGE = '🔴 Overdue';
const DUE_SOON_BADGE = '🟡 Due soon';

/**
 * The numeral in a summary-stat tile, read by its label.
 *
 * The tile is `<div>{stats.overdue}</div><div>Overdue</div>`, so the count is the label's
 * previous sibling. An exact-string match is what keeps this off the row badges — the badge
 * elements read "🔴 Overdue" and "🟡 Due soon", which are not equal to "Overdue" / "Due Soon".
 */
function tileCount(label: string): string {
  return screen.getByText(label).previousElementSibling?.textContent ?? '';
}

const originalTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTZ;
  vi.restoreAllMocks();
});

/**
 * Today's *local* calendar day, in the same `YYYY-MM-DD` form the API serves.
 *
 * Derived from the clock rather than hard-coded because the badges are relative to "now",
 * and a frozen fixture date would stop meaning "due today" the day after it was written.
 */
function localDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function report(nextActionDue: string | null): PipelineReportResponse {
  return {
    groups: [
      {
        status: 'applied',
        count: 1,
        applications: [
          {
            id: 'app-applied',
            jobTitle: 'Data Engineer',
            company: 'Acme',
            location: 'Remote',
            nextAction: 'Await response',
            nextActionDue,
            updatedAt: new Date().toISOString(),
            createdAt: '2026-08-01T00:00:00Z',
          },
        ],
      },
    ],
    totals: { active: 1, byStatus: { applied: 1 } },
    generatedAt: new Date().toISOString(),
  };
}

async function renderWith(nextActionDue: string | null) {
  vi.spyOn(reportsService, 'getPipeline').mockResolvedValue(report(nextActionDue));
  renderReportPage(<ReportsPipeline />, '/reports/pipeline');
  await waitFor(() => expect(screen.getByText('Data Engineer')).toBeInTheDocument());
}

describe('ReportsPipeline due-date badges (TZ-pinned)', () => {
  it('does not badge a row due TODAY as overdue in America/New_York', async () => {
    process.env.TZ = 'America/New_York';
    await renderWith(localDay(0));

    // Before the fix this row was badged "🔴 Overdue" all day, every day, in the Americas.
    expect(screen.queryByText(OVERDUE_BADGE)).not.toBeInTheDocument();
    expect(screen.getByText(DUE_SOON_BADGE)).toBeInTheDocument();
  });

  it('still badges a genuinely overdue row', async () => {
    process.env.TZ = 'America/New_York';
    await renderWith(localDay(-1));

    expect(screen.getByText(OVERDUE_BADGE)).toBeInTheDocument();
  });

  it('buckets a row due TODAY into the Due Today tile, not Overdue, in America/New_York', async () => {
    // The stats tile is a THIRD copy of this arithmetic, independent of the two badge
    // helpers above. Reverting only its parse leaves every other test in this branch green
    // — measured 24/24 — so without this assertion the aggregate ships uncovered.
    process.env.TZ = 'America/New_York';
    await renderWith(localDay(0));

    // Reverted, this row reads Overdue=1 / Due Today=0.
    expect(tileCount('Overdue')).toBe('0');
    expect(tileCount('Due Today')).toBe('1');
  });

  it('badges a row due in exactly 3 days as due soon in Europe/Berlin', async () => {
    // The `<= 3` boundary behaved as `<= 2` in positive-offset zones before the fix.
    process.env.TZ = 'Europe/Berlin';
    await renderWith(localDay(3));

    expect(screen.getByText(DUE_SOON_BADGE)).toBeInTheDocument();
  });

  it('renders no due badge at all when the row has no due date', async () => {
    process.env.TZ = 'America/New_York';
    await renderWith(null);

    expect(screen.queryByText(OVERDUE_BADGE)).not.toBeInTheDocument();
    expect(screen.queryByText(DUE_SOON_BADGE)).not.toBeInTheDocument();
  });

  it('utcControl: the due-today assertion is clean under UTC', async () => {
    // Stays green against BOTH the fixed and the broken code — the proof that the first
    // test owes its failure to the zone rather than to the fixture.
    process.env.TZ = 'UTC';
    await renderWith(localDay(0));

    expect(screen.queryByText(OVERDUE_BADGE)).not.toBeInTheDocument();
    expect(tileCount('Overdue')).toBe('0');
    expect(tileCount('Due Today')).toBe('1');
  });
});
