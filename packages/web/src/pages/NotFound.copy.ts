/**
 * Copy strings for the 404 page.
 *
 * Held in one block on purpose: the wording is owned by Copywriter/Editor
 * (WIC-1051) and the layout by UI/UX. Keeping them separate means a copy
 * revision is a one-hunk diff that cannot disturb spacing or structure.
 *
 * Lifted out of `NotFound.tsx` into its own module by WIC-1089 so that
 * `constants/title.ts` can read `heading` for the catch-all route's
 * `document.title` without importing a React page — and, more to the point,
 * without the title being a *retyped* copy of the heading. The apostrophe in
 * "couldn't" is a straight U+0027, not the typographic U+2019 the surrounding
 * design docs use in prose; retyping it is the documented way to get that wrong
 * (`docs/design/ROUTE_TITLE_CONVENTION.md` §7).
 */
export const NOT_FOUND_COPY = {
  eyebrow: '404',
  heading: "That page couldn't be found",
  body: "The link may be out of date, or the address may have a typo. Everything you've saved is safe.",
  // Deliberately not the onboarding CTA's "Go to Dashboard": a 404-recovery click
  // and a completed-onboarding click are opposite signals and must stay tellable
  // apart in analytics and in role+name test selectors. "Back" frames recovery.
  primaryAction: 'Back to dashboard',
  searchAction: 'Search applications',
  pathLabel: 'Address you tried:',
} as const;
