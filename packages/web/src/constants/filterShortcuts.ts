import type { ApplicationStatus } from '../types/application';
import type { FilterOptions } from '../components/FilterPanel';
import { interviewWeekWindow } from '../utils/interviewWeek';

/**
 * The predefined filter shortcuts, and the labels they render.
 *
 * Both the command palette (`CommandPalette.tsx`) and the applications-list shortcut row
 * (`SavedFilterShortcuts.tsx`) offer the same four shortcuts. They were previously two
 * independent sets of string literals, which is how `Interviews This Week` came to sit in
 * both places naming a window neither filter carried (WIC-1775). Importing from here keeps
 * a rename in one surface from silently leaving the other behind.
 *
 * ## The naming rule (WIC-1775, revisited by WIC-2194)
 *
 * **A label may name a time window if and only if its filter applies that window.**
 *
 * The original ruling stated the same rule but could only enforce half of it: with no
 * interview-date field to filter on, *no* shortcut could apply a window, so banning time
 * words outright was equivalent and cheaper. That is no longer true — WIC-2189 shipped
 * `interviewDateFrom`/`interviewDateTo` — so the enforcement test in
 * `filterShortcuts.test.ts` now encodes the biconditional directly. It still fails on a
 * `Closing This Month` over a status-only filter; it no longer fails on a windowed label
 * whose window is real. That is a strengthening, not a relaxation: the ban was a proxy,
 * and this is the rule the proxy stood in for.
 *
 * `Interviewing` is accordingly `Interviews This Week` again — this time with the window.
 *
 * See `docs/design/SAVED_FILTER_SHORTCUT_NAMING.md`.
 */
export const FILTER_SHORTCUT_LABELS = {
  needsFollowUp: 'Needs Follow-up',
  interviewing: 'Interviews This Week',
  applied: 'Applied',
  activeOffers: 'Active Offers',
} as const;

/**
 * Marker the command palette puts in the URL, resolved to a concrete window by
 * `ApplicationsList` at render time.
 *
 * ⚠️ **The marker is semantic on purpose — do not put the resolved instants in the link.**
 * A palette entry is a fixed string, and `/applications?interviewDateFrom=2026-09-07T…`
 * would be baked at module load: correct until the following Monday, then quietly wrong,
 * and wrong in exactly the way this card exists to fix. It would also freeze one week into
 * any bookmark. Resolving the marker on arrival means the link means "this week" whenever
 * it is followed.
 */
export const INTERVIEW_WINDOW_PARAM = 'interviewWindow';
export const INTERVIEW_WINDOW_THIS_WEEK = 'this-week';

/** Destination for the palette's interviews entry — status **and** window, in one place. */
export const INTERVIEWS_THIS_WEEK_PATH =
  `/applications?status=interview,phone_screen&${INTERVIEW_WINDOW_PARAM}=${INTERVIEW_WINDOW_THIS_WEEK}` as const;

export interface PredefinedFilterShortcut {
  id: string;
  name: string;
  /**
   * Resolved **at click time**, not at module load.
   *
   * `Interviews This Week` computes a calendar week from the current clock; a value
   * captured when this module was imported would be stale for any tab left open across
   * Sunday midnight, which is the same lying-label defect one layer down.
   */
  buildFilters: () => FilterOptions;
}

/**
 * Shortcut `id`s are unchanged from WIC-1775 and deliberately do not all match their
 * labels: they are compared against user entries in `localStorage` under
 * `wic-saved-filters`, and only `name` is ever rendered.
 */
export const PREDEFINED_FILTER_SHORTCUTS: PredefinedFilterShortcut[] = [
  {
    id: 'needs-followup',
    name: FILTER_SHORTCUT_LABELS.needsFollowUp,
    buildFilters: () => ({
      status: ['saved', 'applied', 'phone_screen'] as ApplicationStatus[],
    }),
  },
  {
    id: 'interviews-this-week',
    name: FILTER_SHORTCUT_LABELS.interviewing,
    buildFilters: () => ({
      status: ['interview', 'phone_screen'] as ApplicationStatus[],
      interviewDateRange: interviewWeekWindow(),
    }),
  },
  {
    id: 'recently-applied',
    name: FILTER_SHORTCUT_LABELS.applied,
    buildFilters: () => ({
      status: ['applied'] as ApplicationStatus[],
    }),
  },
  {
    id: 'active-offers',
    name: FILTER_SHORTCUT_LABELS.activeOffers,
    buildFilters: () => ({
      status: ['offer'] as ApplicationStatus[],
    }),
  },
];
