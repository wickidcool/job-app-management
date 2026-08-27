/**
 * Document-outline helpers for heading-level tests (WIC-1417, WIC-1563).
 *
 * A heading-level *skip* — an `<h1>` followed by an `<h3>` with no `<h2>` between them —
 * is what actually breaks screen-reader navigation, and it is invisible to any assertion
 * that looks at one component in isolation. `EmptyState`'s hardcoded `<h3>` (WIC-1417) and
 * `KanbanColumn`'s (WIC-1563) both read as perfectly reasonable in their own file; the
 * defect only exists in the tree the host page assembles.
 *
 * So these read the *rendered* outline in document order and judge the sequence, rather
 * than asserting on a tag name. That distinction matters for the Kanban case in
 * particular: `ApplicationCard`'s `<h3>` was never wrong on its own, it was wrong relative
 * to the `<h3>` that `KanbanColumn` rendered above it, and a per-component tag assertion
 * would have called both of them correct.
 */

export interface OutlineEntry {
  level: number;
  text: string;
}

/** ARIA's default for `role="heading"` when no usable `aria-level` is given. */
const ARIA_DEFAULT_HEADING_LEVEL = 2;

/**
 * Every heading inside `container`, in document order.
 *
 * Includes `role="heading"` + `aria-level` as well as the native tags: to assistive tech
 * the two are the same thing, so an outline check that only saw `h1`–`h6` could be walked
 * around without ever going red.
 *
 * The level resolution below is **total** — it always yields a positive integer, never
 * `NaN` — and that is the load-bearing property, not a detail. `findOutlineSkips` reports
 * a problem by returning a *non-empty* array, so its failure mode is silence: `NaN`
 * compares false in both directions, so a single uncomparable entry would suppress the
 * check for the headings on *either* side of it and turn `h1 -> ? -> h4` into a clean
 * report. Two inputs reach that branch, and neither is exotic:
 *
 *   - `role="heading"` with **no** `aria-level`, which ARIA defines as level **2**;
 *   - `aria-level` present but not a valid level (`"abc"`, `""`, `"0"`, `"1.5"`), which
 *     user agents ignore, falling back to the native tag if there is one and to 2 if not.
 *
 * Resolving either to `NaN` would falsify the paragraph above about not being walkable
 * around, so both are pinned in `headingOutline.test.tsx`.
 */
export function getOutline(container: HTMLElement): OutlineEntry[] {
  const nodes = container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]');

  return Array.from(nodes).map((node) => {
    const ariaLevel = node.getAttribute('aria-level');
    const fromTag = /^H([1-6])$/.exec(node.tagName);

    const explicit = ariaLevel === null ? Number.NaN : Number(ariaLevel);
    const level =
      Number.isInteger(explicit) && explicit >= 1
        ? explicit
        : fromTag
          ? Number(fromTag[1])
          : ARIA_DEFAULT_HEADING_LEVEL;

    return { level, text: (node.textContent ?? '').trim() };
  });
}

/**
 * The skips in an outline: every place the level jumps by more than one going *down*.
 *
 * Jumping back up any distance is fine — that is just closing several sections at once
 * (`h3` back to `h2`, or straight to the next `h1`). Only descending by more than one
 * leaves a gap, because there is no parent heading for the deeper one to belong to.
 */
export function findOutlineSkips(
  outline: OutlineEntry[]
): Array<{ from: OutlineEntry; to: OutlineEntry }> {
  const skips: Array<{ from: OutlineEntry; to: OutlineEntry }> = [];

  for (let i = 1; i < outline.length; i++) {
    const from = outline[i - 1];
    const to = outline[i];
    if (to.level - from.level > 1) skips.push({ from, to });
  }

  return skips;
}

/** Renders an outline as `h1 "Applications" -> h3 "Saved"`, for failure messages. */
export function describeOutline(outline: OutlineEntry[]): string {
  return outline.map((h) => `h${h.level} "${h.text}"`).join(' -> ');
}
