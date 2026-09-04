import { beforeAll, describe, expect, it, vi } from 'vitest';

import { auditTree, describeFinding, EXCLUDED_RULES, type AxeFinding } from './axe';
import { forEachBranch, stubGlobalFetch, type Branch } from './routeOutlineHarness';

/**
 * WIC-1926 — Ruling 2 of `docs/design/A11Y_ENFORCEMENT_RULING.md`: `axe-core` over the
 * rendered DOM of every route, on every render branch.
 *
 * Reuses the WIC-1675 harness rather than building a second one, which is the whole point
 * of §4.2's complaint: that ruling argued the rendered-outline work should have *been* the
 * axe adoption instead of a second bespoke utility. The harness it produced is a good one,
 * so this takes the reuse the ruling wanted, one card late.
 *
 * ## What this adds over the two checks already in the tree
 *
 * - `eslint-plugin-jsx-a11y` (Ruling 1) is a **per-file source** lint. It cannot see a
 *   composed tree, and it has no rule at all for the ARIA prohibited-name class.
 * - `routeOutline.render.test.tsx` renders the same 120 pairs but reads **only headings**.
 *
 * This reads everything else axe can decide about the same trees.
 *
 * ## The baseline is a frozen inventory, not a set of exemptions
 *
 * Every entry in `AXE_BASELINE` is a real finding on a real route, and none of them is
 * "fine". It exists so adoption could land as a build gate rather than waiting on the page
 * fixes, exactly as Ruling 1 landed jsx-a11y behind its 8-rule baseline. Both directions are
 * pinned below — a new finding fails, and a *fixed* one fails too, so the list cannot rot
 * into a permanent hole the way an add-only allowlist does.
 *
 * That ratchet has since done its job: WIC-1942 drove the list from 26 findings over 22 keys
 * to **8 over 8**, and every one of the 8 that remain is third-party markup rather than a
 * page of ours. See the header on `AXE_BASELINE` for why those are baselined and not excluded.
 */

vi.mock('../services/api', async (importOriginal) =>
  (await import('./routeOutlineApiMock')).apiMockModule(
    (await importOriginal()) as Record<string, unknown>
  )
);

const { ROUTES } = await import('./routeOutlineRoutes');

stubGlobalFetch();

/** `${rule}|${path}|${branch}` — one key per (rule, route, branch), counting nodes. */
function key(rule: string, path: string, branch: Branch): string {
  return `${rule}|${path}|${branch}`;
}

/**
 * Every axe finding on this tree today, as `key -> number of offending elements`.
 *
 * Measured across all 120 (route, branch) pairs. Originally 26 findings over 22 keys at
 * `586712c`; WIC-1942 fixed four of the five underlying defects, retiring 18 findings over
 * 14 keys and leaving only the entries below:
 *
 *   - `/applications/new` and `/projects/new/dialogue` — `aria-hidden-focus`, needs-review,
 *     on Radix's own `data-radix-focus-guard` sentinels.
 *
 * ## Why the remaining 8 stay baselined rather than fixed
 *
 * These are not our markup and there is no app-side edit that removes them. Measured on the
 * `/applications/new` tree, the single offending node per pair is Radix's own sentinel:
 *
 *   <span data-radix-focus-guard="" tabindex="0"
 *         style="outline: none; opacity: 0; position: fixed; pointer-events: none;">
 *
 * `FocusScope` brackets its dialog content with these, and they are load-bearing — they are
 * how focus is trapped inside the dialog and returned when it closes. So the fix would be a
 * patch to `@radix-ui/react-focus-scope`, not an edit here, and removing them would break
 * the very behaviour the rule exists to protect. Note the finding is `incomplete`
 * (needs-review), not a confirmed violation.
 *
 * It stays a *baseline entry* and not a `EXCLUDED_RULES` entry deliberately: excluding the
 * rule would blind the sweep to a real `aria-hidden-focus` defect written anywhere else in
 * the app, whereas these eight keys are pinned to two specific routes and cannot grow
 * without failing `raises no axe finding that is not in the frozen baseline`.
 *
 * `aria-prohibited-attr` — the WIC-1185 / WIC-1191 class this adoption was argued for —
 * finds **nothing** here, because both instances of it were fixed. That is a clean result
 * rather than an idle rule: the mutation controls in the two component tests below are
 * what prove the rule is live and would fail if either regressed.
 */
const AXE_BASELINE: Record<string, number> = {
  // Radix focus-guard sentinels on the two routes whose body is a dialog. Needs-review.
  // Third-party markup — see the header above for why these are baselined, not excluded.
  'aria-hidden-focus|/applications/new|loading': 1,
  'aria-hidden-focus|/applications/new|error': 1,
  'aria-hidden-focus|/applications/new|empty': 1,
  'aria-hidden-focus|/applications/new|loaded': 1,
  'aria-hidden-focus|/projects/new/dialogue|loading': 1,
  'aria-hidden-focus|/projects/new/dialogue|error': 1,
  'aria-hidden-focus|/projects/new/dialogue|empty': 1,
  'aria-hidden-focus|/projects/new/dialogue|loaded': 1,
};

describe('every route is axe-clean on every branch, against a frozen baseline', () => {
  const measured: Array<{
    path: string;
    branch: Branch;
    findings: AxeFinding[];
    rulesConsidered: number;
    elementCount: number;
  }> = [];

  beforeAll(async () => {
    for (const route of ROUTES) {
      await forEachBranch(route.render, route, async ({ branch, root }) => {
        const audit = await auditTree(root);
        measured.push({ path: route.path, branch, ...audit });
      });
    }
  }, 900_000);

  /**
   * Guards every assertion below against an empty `measured`.
   *
   * All of them report a defect by returning a non-empty list, so all of them pass over a
   * sweep that collected nothing — and a single throw in `beforeAll` would turn this whole
   * file green. Pinning the volume first makes that failure loud in each test instead.
   * Same reasoning, and same numbers, as `routeOutline.render.test.tsx`.
   */
  function pairs() {
    expect(ROUTES).toHaveLength(30);
    expect(measured, 'the sweep did not render every (route, branch) pair').toHaveLength(120);
    return measured;
  }

  /** `key -> node count` for what is on the tree right now. */
  function actualCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const pair of pairs()) {
      for (const finding of pair.findings) {
        const id = key(finding.rule, pair.path, pair.branch);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }

  it('renders all four branches of all 30 routes', () => {
    expect(pairs()).toHaveLength(120);
  });

  it('ran a full ruleset against a populated tree on every pair', () => {
    // The blunt harness guard. Every assertion in this file reports a defect by returning
    // a non-empty list, so every one of them is satisfied by a page that renders
    // *nothing*, and by an axe that ran a single trivial rule. `auditTree` already throws
    // when axe evaluates no rules at all, but it cannot tell an empty tree from a clean
    // one — so both volumes are pinned here, the same way `routeOutline.render.test.tsx`
    // pins its non-empty-outline floor.
    const all = pairs();

    // axe-core 4.13 ships ~100 rules. A config that silently narrowed the run to a
    // handful would leave every finding assertion below green and prove nothing.
    const thinnest = Math.min(...all.map((pair) => pair.rulesConsidered));
    expect(thinnest).toBeGreaterThanOrEqual(50);

    // And the trees themselves were real. The `loading` branches are legitimately sparse
    // skeletons, so this is a floor across the sweep rather than a per-pair minimum.
    const populated = all.filter((pair) => pair.elementCount >= 10);
    expect(populated.length).toBeGreaterThanOrEqual(90);

    // Narrowing what is measured must stay a visible edit, not a quiet one.
    expect(Object.keys(EXCLUDED_RULES).sort()).toEqual(['color-contrast', 'region']);
  });

  it('raises no axe finding that is not in the frozen baseline', () => {
    // The regression gate. A new violation, or a new needs-review, on any route.
    const counts = actualCounts();
    const offenders: string[] = [];

    for (const pair of pairs()) {
      for (const finding of pair.findings) {
        const id = key(finding.rule, pair.path, pair.branch);
        const allowed = AXE_BASELINE[id] ?? 0;
        if (allowed === 0) {
          offenders.push(`${pair.path} (${pair.branch}): ${describeFinding(finding)}`);
        }
      }
    }

    expect(offenders, 'new axe findings — fix them, do not add them to AXE_BASELINE').toEqual([]);

    // Counted separately: a baselined key that grew from 1 offending element to 3 is a
    // regression the per-key membership check above cannot see.
    const widened = Object.entries(AXE_BASELINE)
      .filter(([id, allowed]) => (counts.get(id) ?? 0) > allowed)
      .map(([id, allowed]) => `${id}: ${counts.get(id)} now, ${allowed} baselined`);

    expect(widened, 'these baselined findings affect more elements than before').toEqual([]);
  });

  it('has no stale baseline entry — a fixed finding must be deleted from the list', () => {
    // The direction that matters, and the one an add-only allowlist never gets. Without
    // this, a fix lands, the entry stays, and that (rule, route, branch) is never enforced
    // again. This makes fixing a page *fail* until its line is removed.
    const counts = actualCounts();
    const stale = Object.entries(AXE_BASELINE)
      .filter(([id, allowed]) => (counts.get(id) ?? 0) < allowed)
      .map(([id, allowed]) => `${id}: ${counts.get(id) ?? 0} now, ${allowed} baselined`);

    expect(stale, 'these are fixed or improved — update AXE_BASELINE down to match').toEqual([]);
  });

  it('has no baseline entry naming a route or branch the sweep does not measure', () => {
    const seen = new Set(pairs().map((pair) => `${pair.path}|${pair.branch}`));
    const unmatched = Object.keys(AXE_BASELINE).filter((id) => {
      const [, path, branch] = id.split('|');
      return !seen.has(`${path}|${branch}`);
    });

    expect(unmatched, 'these entries match no rendered (route, branch) pair').toEqual([]);
  });

  it('pins the size of the baseline so entries cannot be added quietly', () => {
    // Paired with the staleness test above, this makes the list a one-way ratchet: it can
    // only shrink, and only by someone editing these numbers down deliberately.
    const total = Object.values(AXE_BASELINE).reduce((sum, n) => sum + n, 0);
    expect(Object.keys(AXE_BASELINE)).toHaveLength(8);
    expect(total).toBe(8);
  });

  it('confirms the prohibited-name class is clean across every route', () => {
    // Named explicitly rather than left implicit in the baseline's absence of it. This is
    // the class Ruling 2 was argued for (WIC-1185, WIC-1191), and jsx-a11y is structurally
    // blind to it, so "zero here" is a result worth asserting rather than assuming.
    const offenders = pairs()
      .flatMap((pair) =>
        pair.findings
          .filter((finding) => finding.rule === 'aria-prohibited-attr')
          .map((finding) => `${pair.path} (${pair.branch}): ${describeFinding(finding)}`)
      )
      .sort();

    expect(offenders).toEqual([]);
  });
});
