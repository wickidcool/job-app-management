/**
 * Display names for the predefined filter shortcuts.
 *
 * Both the command palette (`CommandPalette.tsx`) and the applications-list shortcut row
 * (`SavedFilterShortcuts.tsx`) offer the same four shortcuts. They were previously two
 * independent sets of string literals, which is how `Interviews This Week` came to sit in
 * both places naming a window neither filter carried (WIC-1775). Importing from here keeps
 * a rename in one surface from silently leaving the other behind.
 *
 * Naming rule, per that ruling: a shortcut label names *what the filter selects*, never a
 * time window the filter does not apply. `Interviewing` and `Applied` describe pipeline
 * status, which is all these filters actually match on.
 *
 * See `docs/design/SAVED_FILTER_SHORTCUT_NAMING.md`.
 */
export const FILTER_SHORTCUT_LABELS = {
  needsFollowUp: 'Needs Follow-up',
  interviewing: 'Interviewing',
  applied: 'Applied',
  activeOffers: 'Active Offers',
} as const;
