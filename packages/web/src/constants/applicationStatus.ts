import type { ApplicationStatus } from '../types/application';

/**
 * Every status an application can hold, in pipeline order.
 */
export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'saved',
  'applied',
  'phone_screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
];

/**
 * Parse a `?status=` query-string value into a validated status list.
 *
 * The command palette links to `/applications?status=interview,phone_screen`, so the
 * applications list has to turn that string back into filter state. Unknown tokens are
 * dropped rather than passed through — an unrecognised status would otherwise reach the
 * API as a filter value the server has no enum member for.
 *
 * Returns an empty array for a missing, blank, or wholly unrecognised value, which
 * callers should read as "no status filter requested".
 */
export function parseStatusParam(raw: string | null | undefined): ApplicationStatus[] {
  if (!raw) return [];

  const known = new Set<string>(APPLICATION_STATUSES);
  const parsed = new Set<ApplicationStatus>();

  for (const part of raw.split(',')) {
    const token = part.trim();
    if (known.has(token)) {
      parsed.add(token as ApplicationStatus);
    }
  }

  return [...parsed];
}
