/**
 * Helpers for the ARIA 1.2 *name from author prohibited* defect class (WIC-1185, WIC-1191).
 *
 * An element with no `role` maps to the ARIA `generic` role, and `generic` prohibits an
 * author-supplied accessible name. `aria-label` on such an element is therefore not
 * required to be honoured: assistive tech may use it, or may ignore it and fall back to
 * the element's text content. Both readings are conformant, so a component that relies
 * on the attribute has two different accessible names depending on the AT.
 *
 * axe-core reports this as `aria-prohibited-attr` (impact `serious`, `wcag2a` / `wcag412`),
 * and reports it as *needs-review* rather than a hard violation precisely when the element
 * has text content — the ambiguity below is the thing it cannot decide.
 *
 * `eslint-plugin-jsx-a11y` does **not** catch this class: `role-supports-aria-props` only
 * fires once an element *has* a role, so a role-less element slips past it (verified in the
 * WIC-1185 review against the strict ruleset, 40 rules, zero findings). Hence these tests.
 *
 * Consumers should assert accessible names with jest-dom's `toHaveAccessibleName` rather
 * than calling `dom-accessibility-api` directly: that package is only a transitive
 * dependency here, and its `package.json` `exports` block hides its own `.d.ts` from
 * `tsc`, so a direct import type-checks as `any` under `noImplicitAny` and fails the build.
 */

/** Elements whose implicit ARIA role is `generic`, i.e. name-from-author is prohibited. */
const GENERIC_TAGS = [
  'span',
  'div',
  'p',
  'b',
  'i',
  'em',
  'strong',
  'small',
  'pre',
  'blockquote',
  'q',
  'sub',
  'sup',
  'hgroup',
];

/**
 * Every element in `container` that maps to `generic` and still carries an author name.
 * A non-empty result is the defect: those names may or may not be announced.
 */
export function elementsWithProhibitedName(container: HTMLElement): HTMLElement[] {
  const selector = GENERIC_TAGS.map((tag) => `${tag}[aria-label]:not([role])`).join(', ');
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

/**
 * Simulate the conformant assistive technology that *ignores* a prohibited author name,
 * by stripping `aria-label` from every `generic` element in the tree.
 *
 * Mutates in place, so compute the "honoured" name before calling this. Cloning is
 * deliberately avoided: the accessible-name computation resolves `<label for>` through
 * `ownerDocument.getElementById`, and a detached clone would duplicate ids and resolve
 * back to the original nodes.
 */
export function dropProhibitedNames(container: HTMLElement): void {
  for (const el of elementsWithProhibitedName(container)) {
    el.removeAttribute('aria-label');
  }
}
