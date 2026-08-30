import { describe, it, expect } from 'vitest';
import { FILTER_SHORTCUT_LABELS } from './filterShortcuts';

/**
 * WIC-1775: two surfaces named a shortcut `Interviews This Week` over a status-only filter
 * carrying no time window at all, so the list was identical in every week of the year.
 * `Recently Applied` had the same defect. These labels must not reacquire a time word.
 */
describe('FILTER_SHORTCUT_LABELS', () => {
  const TIME_WORDS =
    /\b(this|last|next|past|recent|recently|today|week|weekly|month|monthly|day|days|year|upcoming|soon)\b/i;

  it('names no time window in any shortcut label', () => {
    for (const [key, label] of Object.entries(FILTER_SHORTCUT_LABELS)) {
      expect(TIME_WORDS.test(label), `${key} ("${label}") names a time window`).toBe(false);
    }
  });

  it('names the pipeline status the filters actually match on', () => {
    expect(FILTER_SHORTCUT_LABELS.interviewing).toBe('Interviewing');
    expect(FILTER_SHORTCUT_LABELS.applied).toBe('Applied');
  });
});
