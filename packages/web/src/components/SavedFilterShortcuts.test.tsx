import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SavedFilterShortcuts } from './SavedFilterShortcuts';

/**
 * Regression cover for WIC-1775.
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
 * These assert the rendered label *and* the filter behind it together. Asserting either
 * alone is what let the original defect through: the label was defensible in isolation and
 * so was the filter, and only the pair is wrong.
 */
describe('SavedFilterShortcuts — predefined shortcut labels name status, not time', () => {
  it('offers no shortcut promising a time window', () => {
    render(<SavedFilterShortcuts onApplyFilter={vi.fn()} currentFilters={{}} />);

    expect(screen.queryByRole('button', { name: /Interviews This Week/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Recently Applied/i })).toBeNull();
  });

  it('names the interview-stage shortcut for the statuses it selects', async () => {
    const onApplyFilter = vi.fn();
    render(<SavedFilterShortcuts onApplyFilter={onApplyFilter} currentFilters={{}} />);

    const shortcut = screen.getByRole('button', { name: /Interviewing/i });
    await userEvent.click(shortcut);

    expect(onApplyFilter).toHaveBeenCalledWith({ status: ['interview', 'phone_screen'] });
  });

  it('names the applied shortcut for the status it selects', async () => {
    const onApplyFilter = vi.fn();
    render(<SavedFilterShortcuts onApplyFilter={onApplyFilter} currentFilters={{}} />);

    // A function matcher, not /Applied$/ — the accessible name carries the shortcut's emoji
    // prefix, and an end-anchored regex still matches `Recently Applied`, so it would pass
    // against the very defect this covers.
    await userEvent.click(
      screen.getByRole('button', {
        name: (name) => /\bApplied$/i.test(name.trim()) && !/recently/i.test(name),
      })
    );

    expect(onApplyFilter).toHaveBeenCalledWith({ status: ['applied'] });
  });
});
