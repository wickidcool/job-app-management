import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { ReportsByFitTier } from './ReportsByFitTier';
import { useReportsByFitTier } from '../hooks/useReports';
import { FIT_TIER_LABELS } from '../constants/fitLevel';
import type { ByFitTierReportResponse } from '../services/api/reportsService';

/**
 * The WIC-1297 §4 ruling, as a test instead of a comment.
 *
 * The ruling: the "Job Fit Analysis Required" notice must not enumerate the fit
 * tiers. The notice and the tier cards render in one `return` block — the notice
 * is not an early return — so a tier named in the notice is a tier named twice
 * on one page, and the sentence stutters "fit" once per tier on top of that.
 *
 * That ruling was already on the record when PR #111 rewrote the very line it
 * governs, and grew the parenthetical from three labels to four. It was caught
 * in code review; nothing in `src/` or `e2e/` mentioned this page, so CI had no
 * opinion. This file is the opinion (WIC-1557).
 *
 * The tests are written over `FIT_TIER_LABELS` rather than over hardcoded copy,
 * so they keep their meaning as the tier set changes — which it is changing:
 * WIC-1298 replaces `weak_fit` with `stretch` / `low_fit` / `unscored`. The two
 * structural tests at the bottom exist because a table-driven test can go
 * vacuous without failing, and this one has two ways to do it.
 */

// The page's only data source. Mocked, so the test needs neither a QueryClient
// provider nor a server.
vi.mock('../hooks/useReports');

/** Every `[tier, label]` pair the page is expected to render exactly one of. */
const TIER_LABELS = Object.entries(FIT_TIER_LABELS);

/** Count of non-overlapping occurrences of `needle` in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Renders the page in its empty state — the state the notice exists for, and
 * the one the WIC-1297 §4 ruling is about. Counts are all zero, which is what
 * a user with no analyses run sees.
 */
function renderPage() {
  const report: ByFitTierReportResponse = {
    groups: [],
    summary: { total: 0, analyzed: 0, notAnalyzed: 0, byTier: {} },
    generatedAt: '2026-08-26T09:00:00.000Z',
  };

  vi.mocked(useReportsByFitTier).mockReturnValue({
    data: report,
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useReportsByFitTier>);

  return render(
    <MemoryRouter>
      <ReportsByFitTier />
    </MemoryRouter>
  );
}

/**
 * The dependency-notice block: the smallest ancestor of the "Job Fit Analysis
 * Required" heading that also contains the notice's call to action.
 *
 * Anchoring on both ends matters. `heading.parentElement` alone would silently
 * shrink to a new wrapper `<div>` if someone added one, and a scope that no
 * longer spans the body copy would pass the no-enumeration test without
 * checking anything. Requiring the CTA to be inside pins the far edge, so the
 * scope can only be the notice or something larger — and something larger
 * fails loudly below rather than quietly passing.
 */
function dependencyNotice(): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: /job fit analysis required/i });
  const cta = screen.getByRole('button', { name: /view applications/i });

  let scope: HTMLElement | null = heading.parentElement;
  while (scope && !scope.contains(cta)) {
    scope = scope.parentElement;
  }

  if (!scope) {
    throw new Error(
      'Could not find a block containing both the notice heading and its CTA — the notice markup changed shape.'
    );
  }
  return scope;
}

describe('ReportsByFitTier — empty-state copy (WIC-1297 §4)', () => {
  // The ruling's consequence: one page, one mention per tier. This is what
  // regressed on PR #111 — the notice named four tiers that the tier cards
  // below were already naming, so each of those four appeared twice.
  it.each(TIER_LABELS)('names the %s tier ("%s") exactly once on the page', (_tier, label) => {
    const { container } = renderPage();

    expect(occurrences(container.textContent ?? '', label)).toBe(1);
  });

  // The ruling itself, stated where it applies. This is the stricter of the
  // two: deleting a tier card and *keeping* the enumeration would leave the
  // count above at one apiece while still violating §4.
  it('does not enumerate any fit tier inside the dependency notice', () => {
    renderPage();
    const notice = dependencyNotice().textContent ?? '';

    // Scope sanity — see dependencyNotice(). If the notice ever stops carrying
    // its own heading and CTA, the assertion below is measuring the wrong box.
    expect(notice).toContain('Job Fit Analysis Required');
    expect(notice).toContain('View Applications');

    const enumerated = TIER_LABELS.filter(([, label]) => notice.includes(label)).map(
      ([tier]) => tier
    );
    expect(enumerated).toEqual([]);
  });

  // ── Guards on the guards ───────────────────────────────────────────────────
  //
  // Both tests above iterate `FIT_TIER_LABELS` and both count substrings. Each
  // of those has a way to stop testing anything without going red, so each gets
  // pinned here.

  // If the table were ever emptied, `it.each([])` would contribute zero tests
  // and the filter above would find zero labels — a green run asserting
  // nothing. Duplicate labels would be just as bad: two tiers sharing a string
  // can never each occur once.
  it('has a non-empty tier table with distinct labels', () => {
    const labels = TIER_LABELS.map(([, label]) => label);

    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(new Set(labels).size).toBe(labels.length);
  });

  // Substring counting is only sound while the labels are mutually
  // non-containing. Add a tier labelled "Fit" next to "Strong fit" and the
  // once-per-page count silently starts double-counting.
  it('has no tier label contained in another tier label', () => {
    const labels = TIER_LABELS.map(([, label]) => label);
    const contained = labels.filter((label) =>
      labels.some((other) => other !== label && other.includes(label))
    );

    expect(contained).toEqual([]);
  });
});
