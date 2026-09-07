import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FILTER_SHORTCUT_LABELS } from '../constants/filterShortcuts';
import { SavedFilterShortcuts } from './SavedFilterShortcuts';

/**
 * Regression cover for WIC-1775, updated by WIC-2194.
 *
 * Two surfaces offered a shortcut named `Interviews This Week` whose filter was
 * status-only — `{ status: ['interview', 'phone_screen'] }`, no date predicate anywhere.
 * The result set was therefore identical in every week of the year: an application that
 * reached `interview` four months ago, with nothing scheduled, showed up under a label
 * promising this week's interviews.
 *
 * `Recently Applied` carried the same defect (`{ status: ['applied'] }`, no window), which
 * is why the ruling covers the whole shortcut row rather than the one label that was
 * reported. See docs/design/SAVED_FILTER_SHORTCUT_NAMING.md.
 *
 * **The interview shortcut now carries the window instead of dropping the label.** The
 * ruling rejected that fix on one stated condition — that no interview-date field existed
 * — and the condition has flipped (WIC-2023/2188/2189). `Recently Applied` is untouched:
 * there is still no "applied this week" server filter, so `Applied` remains the honest
 * label, and the two shortcuts diverging here is the rule working rather than an
 * inconsistency.
 *
 * These assert the rendered label *and* the filter behind it together. Asserting either
 * alone is what let the original defect through: the label was defensible in isolation and
 * so was the filter, and only the pair is wrong.
 */
describe('SavedFilterShortcuts — predefined shortcut labels match the filters behind them', () => {
  it('offers no shortcut promising a window it does not apply', () => {
    render(<SavedFilterShortcuts onApplyFilter={vi.fn()} currentFilters={{}} />);

    // `Recently Applied` stays banned — its filter is still status-only.
    expect(screen.queryByRole('button', { name: /Recently Applied/i })).toBeNull();
  });

  it('applies a real interview-date window under the windowed label', async () => {
    const onApplyFilter = vi.fn();
    render(<SavedFilterShortcuts onApplyFilter={onApplyFilter} currentFilters={{}} />);

    const shortcut = screen.getByRole('button', { name: FILTER_SHORTCUT_LABELS.interviewing });
    await userEvent.click(shortcut);

    const emitted = onApplyFilter.mock.calls[0][0];
    expect(emitted.status).toEqual(['interview', 'phone_screen']);
    // Offset-bearing instants, not `YYYY-MM-DD` — a date-only bound is a 400 at the API.
    expect(emitted.interviewDateRange.from).toMatch(
      /^\d{4}-\d{2}-\d{2}T00:00:00\.000(Z|[+-]\d{2}:\d{2})$/
    );
    expect(emitted.interviewDateRange.to).toMatch(
      /^\d{4}-\d{2}-\d{2}T23:59:59\.999(Z|[+-]\d{2}:\d{2})$/
    );
  });

  it('resolves the window at click time, not at module load', async () => {
    // The shortcut list is a module-level constant. If the window were captured when the
    // module was imported, a tab left open across Sunday midnight would keep filtering to
    // last week under a label saying "this" — the same defect the wiring exists to fix.
    const onApplyFilter = vi.fn();
    render(<SavedFilterShortcuts onApplyFilter={onApplyFilter} currentFilters={{}} />);

    const now = Date.now();
    await userEvent.click(
      screen.getByRole('button', { name: FILTER_SHORTCUT_LABELS.interviewing })
    );

    const { from, to } = onApplyFilter.mock.calls[0][0].interviewDateRange;
    expect(new Date(from).getTime()).toBeLessThanOrEqual(now);
    expect(new Date(to).getTime()).toBeGreaterThanOrEqual(now);
  });

  it('names the applied shortcut for the status it selects', async () => {
    const onApplyFilter = vi.fn();
    render(<SavedFilterShortcuts onApplyFilter={onApplyFilter} currentFilters={{}} />);

    // An exact string, which is both simpler and stricter than the function matcher this
    // replaces (WIC-1846 made exact matching possible by hiding the decorative emoji from
    // the accessible name). Exactness is load-bearing here: it is what rules out a
    // reintroduced `Recently Applied`, which any substring or end-anchored matcher accepts.
    await userEvent.click(screen.getByRole('button', { name: FILTER_SHORTCUT_LABELS.applied }));

    expect(onApplyFilter).toHaveBeenCalledWith({ status: ['applied'] });
  });
});

/**
 * Regression cover for WIC-1846.
 *
 * The predefined shortcuts carry a decorative ✨ inside the button. Without
 * `aria-hidden`, it joins the button's *accessible name*, so a screen reader announces the
 * emoji's Unicode name in front of every label — "sparkles Interviewing, button" — and the
 * exact-name queries below cannot find the button at all.
 *
 * The decoration carries nothing a non-sighted user can act on: `isPredefined` is already
 * conveyed by the absence of the delete control next to it.
 *
 * These use an exact string name, not a regex. That is the whole point — a substring
 * matcher passes with the emoji still in the name, which is what let this through.
 */
describe('SavedFilterShortcuts — the decorative marker is not part of the name (WIC-1846)', () => {
  const predefined = Object.entries(FILTER_SHORTCUT_LABELS);

  it.each(predefined)('names the %s button exactly "%s", with no emoji prefix', (_key, label) => {
    render(<SavedFilterShortcuts onApplyFilter={vi.fn()} currentFilters={{}} />);

    expect(screen.getByRole('button', { name: label })).toHaveAccessibleName(label);
  });

  it('still renders the marker visually', () => {
    // The fix is to hide the emoji from assistive tech, not to delete it. A version that
    // dropped the span would pass every assertion above.
    const { container } = render(
      <SavedFilterShortcuts onApplyFilter={vi.fn()} currentFilters={{}} />
    );

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(predefined.length);
    expect(container.textContent).toContain('✨');
  });
});
