import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardStats } from './DashboardStats';
import { asRatio, toPercent, type Ratio } from '../types/units';
import type { ApplicationStatus } from '../types/application';

/**
 * Regression cover for WIC-1514.
 *
 * `responseRate` crosses the API/web boundary as a **ratio in [0, 1]** — that is
 * what `docs/architecture/API_CONTRACTS.md` specifies and what
 * `packages/api/src/services/dashboard.service.ts` actually ships. This component
 * used to document the prop as `0-100` and render `Math.round(val)`, with no
 * adapter anywhere between the two. Both sides were `number`, so TypeScript could
 * not see it.
 *
 * The consequence was not "slightly wrong": `Math.round(v)` over `v` in [0, 1]
 * has a **two-element range**, so the "Response" card could only ever read "0%"
 * or "1%", and was correct in exactly one case (a true rate of 0%) by
 * coincidence.
 *
 * The first two tests below pin the AC scenarios. The third is the one that
 * cannot quietly stop discriminating: it asserts the card's output *varies*
 * across the input domain. A single-point assertion would still pass if some
 * future change re-collapsed the range in a different place; a cardinality
 * assertion cannot.
 */

/** Full status tally, as `GET /dashboard` reports it. */
type StatusCounts = Record<ApplicationStatus, number>;

function counts(overrides: Partial<StatusCounts>): StatusCounts {
  return {
    saved: 0,
    applied: 0,
    phone_screen: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
    ...overrides,
  };
}

/**
 * Mirrors `packages/api/src/services/dashboard.service.ts` (the `responded` /
 * `totalApplied` / `responseRate` block and the two-decimal rounding at the
 * response boundary).
 *
 * Deliberately a copy rather than an import: `@wic/api` is a separate package
 * that this one does not depend on, and the point of the test is to drive the
 * component with a value produced by the *server's* formula in the *server's*
 * unit. If that formula ever changes unit, the AC-1 case below goes red.
 */
function apiResponseRate(byStatus: StatusCounts): Ratio {
  const responded = byStatus.phone_screen + byStatus.interview + byStatus.offer + byStatus.rejected;
  const totalApplied = byStatus.applied + responded;
  const rate = totalApplied > 0 ? responded / totalApplied : 0;
  return asRatio(Math.round(rate * 100) / 100);
}

function renderResponseCard(responseRate: Ratio) {
  // Several cases below render more than once per test, and RTL only auto-cleans
  // between tests — without this the second render's "Response" label is a
  // duplicate match.
  cleanup();
  render(<DashboardStats stats={{ total: 4, appliedThisWeek: 4, responseRate, inReview: 2 }} />);
  // The card's value and label are siblings; find the label, read the value.
  const label = screen.getByText('Response');
  const card = label.parentElement;
  expect(card).not.toBeNull();
  return card!.firstElementChild!.textContent;
}

describe('DashboardStats — the "Response" card', () => {
  it('reads "75%" for one applied, one phone_screen, one interview, one rejected (AC-T1d)', () => {
    const byStatus = counts({ applied: 1, phone_screen: 1, interview: 1, rejected: 1 });

    // 3 of 4 applications drew a response. The API sends 0.75, not 75.
    expect(apiResponseRate(byStatus)).toBe(0.75);

    expect(renderResponseCard(apiResponseRate(byStatus))).toBe('75%');
  });

  it('renders the ends of the domain as 0% and 100%', () => {
    expect(renderResponseCard(asRatio(0))).toBe('0%');
    expect(renderResponseCard(asRatio(1))).toBe('100%');
  });

  it('spans the output range rather than collapsing it to two values', () => {
    // Pre-fix, `Math.round(val)` mapped every one of these onto just "0%" or
    // "1%". Six distinct inputs must produce six distinct readings.
    const ratios = [0, 0.14, 0.33, 0.5, 0.75, 1].map(asRatio);
    const rendered = ratios.map((r) => renderResponseCard(r));

    expect(rendered).toEqual(['0%', '14%', '33%', '50%', '75%', '100%']);
    expect(new Set(rendered).size).toBe(ratios.length);
  });

  it('rounds the percentage, not the ratio', () => {
    // 0.336 -> 33.6% -> "34%". Rounding the ratio first would give "0%", and
    // truncating instead of rounding would give "33%".
    expect(renderResponseCard(asRatio(0.336))).toBe('34%');
  });
});

describe('the Ratio/Percent unit brands', () => {
  it('converts a ratio to a percentage exactly once', () => {
    expect(toPercent(asRatio(0.75))).toBe(75);
    expect(toPercent(asRatio(0))).toBe(0);
    expect(toPercent(asRatio(1))).toBe(100);
  });

  it('rejects a bare number where a Ratio is required, at compile time', () => {
    // The brand is the enforcement AC-T1a asks for: a comment saying "0-1" is
    // not checkable, an intersection with a unique-symbol brand is. These are
    // type-level assertions — they cost nothing at runtime and fail `tsc`.
    // @ts-expect-error a plain number is not a Ratio
    const notARatio: Ratio = 0.75;
    // @ts-expect-error a Percent is not a Ratio, so it cannot be re-converted
    const notARatioEither: Ratio = toPercent(asRatio(0.75));

    // Reference both so the assignments are not flagged as unused.
    expect(typeof notARatio).toBe('number');
    expect(typeof notARatioEither).toBe('number');
  });
});
