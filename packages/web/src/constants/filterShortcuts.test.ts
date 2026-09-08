import { describe, it, expect } from 'vitest';
import {
  FILTER_SHORTCUT_LABELS,
  INTERVIEWS_THIS_WEEK_PATH,
  INTERVIEW_WINDOW_PARAM,
  INTERVIEW_WINDOW_THIS_WEEK,
  PREDEFINED_FILTER_SHORTCUTS,
} from './filterShortcuts';
import type { FilterOptions } from '../components/FilterPanel';

/**
 * WIC-1775 / WIC-2194 — a shortcut label may name a time window **if and only if** its
 * filter applies that window.
 *
 * ## Why this file changed shape
 *
 * The original test banned time words outright. That was a *proxy* for the rule above,
 * and an exact one at the time: with no interview-date field to filter on, no shortcut
 * could apply a window, so "names a window" and "lies about a window" were the same
 * predicate. WIC-2189 shipped the field, and the ruling was revisited (WIC-2194), so the
 * two predicates have come apart and the proxy now bans the *fix* along with the defect.
 *
 * **This is a strengthening, not a relaxation.** The old test asserted one direction and
 * could not see the other: a shortcut applying a real window while claiming nothing about
 * it (`Interviewing` over a week-bounded filter) passed it cleanly, and that is a hidden
 * filter — a user gets a silently narrowed list with no way to tell why rows are missing.
 * The biconditional catches both directions, and `Closing This Month` over a status-only
 * filter still fails, which is the case the original was written for.
 */
describe('FILTER_SHORTCUT_LABELS', () => {
  const TIME_WORDS =
    /\b(this|last|next|past|recent|recently|today|week|weekly|month|monthly|day|days|year|upcoming|soon)\b/i;

  /** Every window-bearing key `FilterOptions` has. A new one must be added here. */
  const namesAWindow = (label: string) => TIME_WORDS.test(label);
  const appliesAWindow = (filters: FilterOptions) =>
    Boolean(filters.interviewDateRange || filters.dateRange);

  it('names a time window if and only if the filter applies one', () => {
    for (const shortcut of PREDEFINED_FILTER_SHORTCUTS) {
      const filters = shortcut.buildFilters();
      expect(
        appliesAWindow(filters),
        `"${shortcut.name}" ${
          namesAWindow(shortcut.name)
            ? 'names a time window its filter does not apply'
            : 'applies a time window its label does not name'
        }`
      ).toBe(namesAWindow(shortcut.name));
    }
  });

  /**
   * A control for the test above. Without it the biconditional is satisfiable by a
   * registry in which *nothing* names a window and *nothing* applies one — which is
   * exactly the pre-WIC-2194 state, so a green would carry no information about whether
   * the wiring shipped. These two assertions pin that both sides are exercised.
   */
  it('exercises both sides of the biconditional', () => {
    const windowed = PREDEFINED_FILTER_SHORTCUTS.filter((s) => namesAWindow(s.name));
    const unwindowed = PREDEFINED_FILTER_SHORTCUTS.filter((s) => !namesAWindow(s.name));

    expect(windowed.map((s) => s.name)).toEqual(['Interviews This Week']);
    expect(unwindowed.length).toBeGreaterThan(0);
  });

  /**
   * The mutant this file exists to reject. `Closing This Month` over a status-only filter
   * is the example named in `SAVED_FILTER_SHORTCUT_NAMING.md`; asserting the rule catches
   * it proves the rule can still fail, rather than merely that today's registry passes.
   */
  it('rejects a windowed label over a status-only filter', () => {
    const mutant = {
      name: 'Closing This Month',
      buildFilters: (): FilterOptions => ({ status: ['offer'] }),
    };
    expect(namesAWindow(mutant.name)).toBe(true);
    expect(appliesAWindow(mutant.buildFilters())).toBe(false);
  });

  /** …and the opposite mutant: a real window under a label that admits nothing. */
  it('rejects a windowed filter under a label that names no window', () => {
    const mutant = {
      name: 'Interviewing',
      buildFilters: (): FilterOptions => ({
        interviewDateRange: { from: 'x', to: 'y' },
      }),
    };
    expect(namesAWindow(mutant.name)).toBe(false);
    expect(appliesAWindow(mutant.buildFilters())).toBe(true);
  });

  it('names the pipeline status the filters actually match on', () => {
    expect(FILTER_SHORTCUT_LABELS.interviewing).toBe('Interviews This Week');
    expect(FILTER_SHORTCUT_LABELS.applied).toBe('Applied');
  });

  /**
   * The palette navigates rather than emitting `FilterOptions`, so it can only carry the
   * window through the URL. If this link stops naming the marker, the palette silently
   * reverts to the status-only filter under a label promising a week — the exact WIC-1775
   * defect, on one surface only, which is the drift the shared constant exists to stop.
   */
  it('routes the palette through the marker the list page resolves', () => {
    expect(INTERVIEWS_THIS_WEEK_PATH).toContain(
      `${INTERVIEW_WINDOW_PARAM}=${INTERVIEW_WINDOW_THIS_WEEK}`
    );
    expect(INTERVIEWS_THIS_WEEK_PATH).toContain('status=interview,phone_screen');
  });

  /**
   * The link must NOT carry resolved instants. A palette entry is a module-level string,
   * so a baked date would be correct until the following Monday and then quietly wrong —
   * and would freeze one week into every bookmark.
   */
  it('carries a semantic marker, not a baked date', () => {
    expect(INTERVIEWS_THIS_WEEK_PATH).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
