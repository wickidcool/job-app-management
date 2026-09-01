import { afterEach, describe, expect, it } from 'vitest';

import { auditTree, collectAxeFindings, EXCLUDED_RULES, knownAxeRuleIds } from './axe';

/**
 * Tests for the shared axe helper itself (WIC-1926).
 *
 * The helper is what every other a11y assertion in this package now rests on, and its two
 * failure modes are both silent:
 *
 *   1. **Reading `violations` only.** The defect that motivated adopting axe at all —
 *      `aria-label` on a role-less element that *has* text (WIC-1185, WIC-1191) — is an
 *      axe `incomplete`, never a violation. A helper that dropped `incomplete` would go on
 *      passing every existing test while covering none of the class it was adopted for.
 *      That is a one-word edit away at all times, so the three-way semantics are pinned
 *      here against literal fixtures rather than left as a comment.
 *
 *   2. **Running nothing.** Every finding-based assertion reports a defect by returning a
 *      non-empty list, so all of them pass over a helper that never ran. The guard against
 *      that has its own control below — a guard with no control is just a comment.
 *
 * These fixtures are hand-built DOM rather than rendered components on purpose: they must
 * keep asserting the same thing when the components they were derived from change.
 */

const mounted: HTMLElement[] = [];

/** A detached-then-attached fixture; axe needs the tree in the document to evaluate it. */
function fixture(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  mounted.push(host);
  return host;
}

afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
});

describe('aria-prohibited-attr — the three-way result the helper must preserve', () => {
  it('reports a role-less element with NO text as a violation', async () => {
    const findings = await collectAxeFindings(fixture('<span aria-label="prohibited"></span>'));

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('aria-prohibited-attr');
    expect(findings[0].kind).toBe('violation');
  });

  it('reports a role-less element WITH text as incomplete, not a violation', async () => {
    // The load-bearing case. This is `ChangeActionBadge`'s original markup, and the exact
    // shape a `violations`-only helper reports as clean. If this test ever fails with
    // "expected 1, received 0", the helper stopped reading `incomplete` — the coverage is
    // gone even though every other a11y test in the package is still green.
    const findings = await collectAxeFindings(
      fixture('<span aria-label="prohibited">Visible text</span>')
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('aria-prohibited-attr');
    expect(findings[0].kind).toBe('incomplete');
  });

  it('accepts an author name on an element whose role permits one', async () => {
    // The negative control for the two above: without it, a helper that flagged every
    // `aria-label` anywhere would pass both of them and be uselessly noisy in practice.
    const findings = await collectAxeFindings(
      fixture('<span role="img" aria-label="legitimate">icon</span>')
    );

    expect(findings).toEqual([]);
  });
});

describe('the helper cannot report a vacuous pass', () => {
  it('reports how many rules it actually evaluated', async () => {
    const audit = await auditTree(fixture('<p>content</p>'));

    // axe-core 4.13 ships ~100 rules. A run that considered a handful would make every
    // "no findings" assertion in this package meaningless.
    expect(audit.rulesConsidered).toBeGreaterThanOrEqual(50);
    expect(audit.elementCount).toBeGreaterThan(0);
  });

  it('throws rather than returning [] when an excluded rule no longer exists', async () => {
    // The staleness control. A renamed or removed rule id excludes nothing, and would sit
    // in EXCLUDED_RULES looking like a decision that had been made and still applied.
    await expect(
      auditTree(fixture('<p>content</p>'), {
        excludedRules: { 'no-such-axe-rule': 'deliberately bogus' },
      })
    ).rejects.toThrow(/does not \s*define|no-such-axe-rule/);
  });

  it('keeps every real exclusion pointed at a rule axe still defines', () => {
    // The same check applied to the exclusions actually shipped, so an axe-core upgrade
    // that renames `region` or `color-contrast` fails here with a clear reason rather
    // than silently widening or narrowing what the route sweep measures.
    const known = knownAxeRuleIds();
    for (const id of Object.keys(EXCLUDED_RULES)) {
      expect(known.has(id), `EXCLUDED_RULES names "${id}", which axe no longer defines`).toBe(true);
    }
  });

  it('documents a reason for every exclusion', () => {
    for (const [id, reason] of Object.entries(EXCLUDED_RULES)) {
      expect(reason.length, `${id} is excluded with no stated reason`).toBeGreaterThan(20);
    }
  });
});
