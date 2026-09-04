import * as axe from 'axe-core';

/**
 * The shared `axe-core` assertion for the vitest + RTL harness (WIC-1926).
 *
 * Ruling 2 of `docs/design/A11Y_ENFORCEMENT_RULING.md` §4: adopt `axe-core`, hosted here
 * rather than in Playwright, and expose **one** shared assertion so a11y cover is the
 * default for a rendered tree instead of a per-component opt-in someone has to remember.
 *
 * ## Why this is not redundant with `eslint-plugin-jsx-a11y` (Ruling 1, PR #226)
 *
 * The two tools cover disjoint classes. jsx-a11y at `strict` — all 40 rules, with a
 * 4-error positive control in the same invocation — returns **zero** findings for
 * `aria-label` on a role-less element, because `role-supports-aria-props` only fires once
 * an element *has* a role. That is the exact shape of WIC-1185 and WIC-1191. axe's
 * `aria-prohibited-attr` does catch it. Adopting one is not a reason to skip the other.
 *
 * ## `incomplete` is not optional reading
 *
 * Measured here on axe-core 4.13.0, which is why {@link collectAxeFindings} reports both
 * lists rather than `violations` alone:
 *
 * | markup                                         | axe verdict            |
 * |------------------------------------------------|------------------------|
 * | `<span aria-label="x" />` (no text)            | **violation**          |
 * | `<span aria-label="x">text</span>`             | **incomplete**         |
 * | `<span role="img" aria-label="x">icon</span>`  | pass                   |
 *
 * The middle row is `ChangeActionBadge`'s original defect, and it is *needs-review* rather
 * than a hard violation precisely because axe cannot decide whether the author name or the
 * text content wins — which is the ambiguity that made it a bug. Reporting
 * `violations.length` alone reads that real defect as clean.
 *
 * ## Anti-vacuity
 *
 * Every assertion built on this helper reports a defect by returning a **non-empty** list,
 * so all of them pass over a helper that silently ran nothing — a broken import, a renamed
 * rule, an empty tree. {@link collectAxeFindings} therefore throws rather than returning
 * `[]` when axe did not actually evaluate the tree, so "no findings" means "no defect" and
 * never "not wired".
 */

/** A violation, or an `incomplete` result that axe wants a human to adjudicate. */
export type AxeFindingKind = 'violation' | 'incomplete';

export interface AxeFinding {
  /** The axe rule id, e.g. `aria-prohibited-attr`. */
  rule: string;
  kind: AxeFindingKind;
  /** The offending element's selector, as axe reports it. */
  target: string;
  /** The offending element's markup, collapsed and clipped for a readable failure. */
  html: string;
  impact: string;
}

/**
 * Rules this harness does not run, and why.
 *
 * Both are excluded because **jsdom cannot answer them**, not because the app is exempt
 * from them. Stated as data so that narrowing what gets measured is a visible edit; the
 * ids are checked against axe's own rule list below, so a rule renamed upstream fails
 * loudly instead of leaving a dead entry that silently excludes nothing.
 */
export const EXCLUDED_RULES: Record<string, string> = {
  // Measured across the 120 (route, branch) pairs: 354 violations on 108 pairs, entirely
  // an artifact of the harness. `region` wants every node inside a landmark, and the app's
  // `<main>` lives in the chrome (`App.tsx:103`), which `routeOutlineHarness` deliberately
  // does not mount — it mounts the page component so the measured tree is the *route's*.
  // Running it here would measure the harness, not the app.
  region: 'the app <main> lives in App.tsx chrome, which the route harness does not mount',

  // Measured: 108 `incomplete`, 0 violations — i.e. one for every pair that rendered
  // anything at all. jsdom implements no layout and no canvas (it warns
  // "HTMLCanvasElement's getContext() ... without installing the canvas npm package"), so
  // axe can never resolve a contrast ratio here and returns needs-review unconditionally.
  'color-contrast': 'jsdom has no layout or canvas, so every node is unresolvable',
};

/** Collapse markup to one clipped line so a failure message stays readable. */
function summarise(html: string): string {
  const flat = String(html).replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
}

/**
 * Every axe rule id this build of axe-core knows about.
 *
 * Used to keep {@link EXCLUDED_RULES} honest: an id that is no longer a rule excludes
 * nothing, and would sit in the list looking like coverage that had been considered.
 */
export function knownAxeRuleIds(): Set<string> {
  return new Set(axe.getRules().map((rule) => rule.ruleId));
}

export interface AxeAudit {
  findings: AxeFinding[];
  /**
   * How many rules axe actually evaluated against this tree, and how many elements were
   * in it. Both are volume signals for callers: every finding-based assertion passes over
   * a tree that was never populated, and neither `findings.length` nor axe itself can
   * tell an empty tree from a clean one.
   */
  rulesConsidered: number;
  elementCount: number;
}

/**
 * Run axe over `root` and return every finding, violations and `incomplete` alike.
 *
 * Throws if axe did not actually evaluate anything, so that an empty result is evidence of
 * a clean tree rather than of a helper that failed to run. See the anti-vacuity note above.
 */
export async function auditTree(
  root: HTMLElement,
  options: { excludedRules?: Record<string, string> } = {}
): Promise<AxeAudit> {
  const excluded = options.excludedRules ?? EXCLUDED_RULES;

  const stale = Object.keys(excluded).filter((id) => !knownAxeRuleIds().has(id));
  if (stale.length > 0) {
    throw new Error(
      `EXCLUDED_RULES names ${stale.join(', ')}, which axe-core ${axe.version} does not ` +
        'define. A renamed or removed rule excludes nothing — delete the entry or fix the id.'
    );
  }

  const results = await axe.run(root);

  // The four buckets partition the rules axe considered. If their union is empty the run
  // did nothing — an unattached root, a disabled ruleset, a broken import — and every
  // caller's "no findings" assertion would pass over it.
  const considered = new Set(
    [...results.passes, ...results.violations, ...results.incomplete, ...results.inapplicable].map(
      (result) => result.id
    )
  );
  if (considered.size === 0) {
    throw new Error(
      'axe evaluated no rules at all against this tree. A "no findings" result here would ' +
        'be vacuous, so this is a harness failure rather than a clean pass.'
    );
  }

  const findings: AxeFinding[] = [];
  for (const [kind, list] of [
    ['violation', results.violations],
    ['incomplete', results.incomplete],
  ] as const) {
    for (const result of list) {
      if (result.id in excluded) continue;
      for (const node of result.nodes) {
        findings.push({
          rule: result.id,
          kind,
          target: node.target.join(' '),
          html: summarise(node.html),
          impact: result.impact ?? 'unknown',
        });
      }
    }
  }

  return {
    findings,
    rulesConsidered: considered.size,
    elementCount: root.querySelectorAll('*').length,
  };
}

/** {@link auditTree}, for callers that only need the findings. */
export async function collectAxeFindings(
  root: HTMLElement,
  options: { excludedRules?: Record<string, string> } = {}
): Promise<AxeFinding[]> {
  return (await auditTree(root, options)).findings;
}

/** One finding as a single readable line. */
export function describeFinding(finding: AxeFinding): string {
  return `${finding.rule} (${finding.kind}, ${finding.impact}): ${finding.target} — ${finding.html}`;
}

/**
 * Assert that a rendered tree has no axe findings.
 *
 * The shared assertion the ruling asks for: component tests call this instead of hand-
 * rolling a query per defect class. Failures name every offending element, because a bare
 * count tells you a page regressed without telling you where.
 */
export async function expectNoAxeFindings(root: HTMLElement): Promise<void> {
  const findings = await collectAxeFindings(root);
  if (findings.length > 0) {
    throw new Error(
      `expected no axe findings, got ${findings.length}:\n` +
        findings.map((finding) => `  - ${describeFinding(finding)}`).join('\n')
    );
  }
}

/**
 * Simulate the conformant assistive technology that *ignores* a prohibited author name,
 * by stripping `aria-label` from every element whose implicit role is `generic`.
 *
 * This is the one part of the retired `prohibitedName.ts` that survives its deletion, and
 * deliberately so: axe replaced that module's *detector* (`elementsWithProhibitedName` was
 * a hand-rolled stand-in for `aria-prohibited-attr`), but it has no equivalent for this.
 * axe reports that a name *may* be ignored; only this can show what the user is then left
 * with. WIC-1191 is why that distinction matters — dropping the tick's prohibited name left
 * a bare "✓" glyph inside the `<label>`, so the textarea's accessible name differed between
 * two equally conformant readings. Asserting the two agree needs both readings.
 *
 * Mutates in place, so compute the "honoured" name before calling this. Cloning is
 * deliberately avoided: the accessible-name computation resolves `<label for>` through
 * `ownerDocument.getElementById`, and a detached clone would duplicate ids and resolve
 * back to the original nodes.
 */
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

export function dropProhibitedNames(container: HTMLElement): void {
  const selector = GENERIC_TAGS.map((tag) => `${tag}[aria-label]:not([role])`).join(', ');
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(selector))) {
    el.removeAttribute('aria-label');
  }
}
