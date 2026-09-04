import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import packageJsonRaw from '../../package.json?raw';

/**
 * The `eslint-plugin-jsx-a11y` ratchet (WIC-1483, layer 1).
 *
 * WCAG 2.1 AA has been an accepted Board requirement since 2026-04-15 (WIC-15 §8) with
 * nothing in the repo enforcing it. Layer 1 is the plugin; this file is the part that
 * makes adopting it *enforcement* rather than a gesture.
 *
 * 27 of the 34 resolved rules are `error` on this tree, so `npm run lint` already fails
 * CI on a new violation of any of them. 5 are `warn` (see `BASELINED_RULES` in
 * `eslint.config.js`) purely so that adopting the plugin did not require fixing 47
 * pre-existing defects in the same change (WIC-1483) — 21 of those 47 have since been
 * retired (WIC-1589, WIC-1942) — and 2 are deliberately `off` (see `PROMOTED_RULES` for the
 * measured cost of each).
 *
 * That 27 is asserted below against the RESOLVED config rather than restated in prose.
 * The first revision of this suite hand-computed it as `34 - 8 = 26`, which was wrong for
 * a different reason at the time: `recommended` ships 3 of its 34 entries `off`, so the
 * surface was 23, and the wrong figure sat in four files at once with nothing able to
 * contradict it. A count that only exists in a comment is precisely the unenforced claim
 * this card was filed about.
 *
 * The config extends `flatConfigs.strict`, and NONE of those counts can tell you so —
 * `strict` and `recommended` resolve to the same 34 entries and the same 27/5/2 histogram
 * once `PROMOTED_RULES` restores `anchor-ambiguous-text`, which `strict` drops entirely.
 * They also produce identical findings on this tree (26, over the same files, rules, lines
 * and columns). The whole difference is in rule OPTIONS, so that is what the last test
 * asserts; without it, a silent revert to `recommended` passes every assertion here.
 *
 * A downgrade-to-warn with no counter-pressure is how an allowlist becomes a permanent
 * tree-wide hole, so the baseline is pinned in BOTH directions and per file:
 *
 *   - a NEW violation in any file fails, even in a `warn` rule;
 *   - a FIXED violation also fails, forcing the baseline down instead of letting it
 *     rot upward. `toEqual` on the whole map, not `toBeLessThanOrEqual` on a total;
 *   - it is keyed by file+rule, so fixing one file and breaking another — which leaves
 *     the total at 26 — is still a failure.
 *
 * The `--max-warnings` ceiling in `package.json` is cross-checked against the same
 * measurement, so the two numbers cannot silently disagree.
 *
 * Scope limit, stated so a green run is not over-read: `jsx-a11y` is a per-FILE lint.
 * It is structurally blind to a heading-order defect that exists only in the
 * composition of a page and the component it mounts (`/cover-letters/new` was exactly
 * that shape — neither file was defective alone). This suite does NOT cover WCAG
 * SC 1.3.1; the rendered-outline assertion is layer 2.
 */

/**
 * `packages/web`, as an absolute path, derived without any `node:` builtin.
 *
 * This package typechecks with `"types": ["vite/client"]` and no `@types/node`, so
 * `node:path`/`node:url`/`node:fs` are a TS2307 in CI's `typecheck` step while running
 * perfectly well under vitest — green locally, red in CI. String methods need no types,
 * and `?raw` is declared by vite/client, so both spellings used here are typed.
 *
 * Derived from this file's own location rather than `process.cwd()` so the suite lints
 * the same tree no matter which directory vitest was started from.
 *
 * Sliced off `import.meta.url` as a plain string on purpose. `new URL('../..',
 * import.meta.url)` is the obvious spelling and it does NOT work here: vite rewrites that
 * exact pattern at transform time and hands back `/@fs/…/packages/web`, a served-asset
 * path with no counterpart on disk. That value still ends in `/packages/web`, so it slips
 * past the shape check below; what makes it loud is ESLint erroring on a glob that matches
 * no files. Keep the string form.
 */
const webRoot = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '')).replace(
  /\/src\/test\/[^/]*$/,
  ''
);

type RuleCounts = Record<string, number>;

/**
 * Measured on this tree after WIC-1942. 26 findings, 16 files, 5 distinct rules — down
 * from the 47/22/8 at WIC-1483 adoption, now that `label-has-associated-control`
 * (19 -> 0), `no-redundant-roles` (1 -> 0) and
 * `no-noninteractive-element-to-interactive-role` (1 -> 0) are fully retired. Owned by
 * WIC-1589 — every entry here is a real defect, not an accepted exception.
 */
const A11Y_BASELINE: Record<string, RuleCounts> = {
  'src/components/ApplicationCard.tsx': {
    'no-noninteractive-element-interactions': 1,
    'no-noninteractive-tabindex': 1,
  },
  'src/components/CatalogBrowse/CatalogBrowseView.tsx': {
    'click-events-have-key-events': 1,
    'no-static-element-interactions': 1,
  },
  'src/components/CommandPalette.tsx': { 'no-autofocus': 1 },
  'src/components/FilterPanel.tsx': {
    'click-events-have-key-events': 1,
    'no-noninteractive-element-interactions': 1,
  },
  'src/components/ResumeUpload.tsx': {
    'click-events-have-key-events': 1,
    'no-noninteractive-element-interactions': 1,
  },
  // `src/components/ResumeVariantCard.tsx` used to sit here with
  // `no-noninteractive-element-to-interactive-role: 1` — the `<article role="button">`.
  // WIC-1942 removed that role (it also tripped axe's `aria-allowed-role` and
  // `nested-interactive`), moving the card's navigation onto a real button inside the
  // heading, so the file now has no jsx-a11y finding at all and the entry is deleted
  // rather than zeroed. That drops BASELINE_TOTAL 27 -> 26; both `--max-warnings`
  // ceilings in package.json move with it.
  'src/components/STARStoryBank.tsx': {
    'click-events-have-key-events': 1,
    'no-noninteractive-element-interactions': 1,
  },
  'src/components/SavedFilterShortcuts.tsx': { 'no-autofocus': 1 },
  'src/components/StarEntryPicker.tsx': {
    'click-events-have-key-events': 1,
    'no-static-element-interactions': 1,
  },
  'src/components/wizard/WizardContainer.tsx': { 'no-autofocus': 1 },
  'src/components/wizard/WizardStep.tsx': { 'no-noninteractive-element-interactions': 1 },
  'src/pages/ProjectsList.tsx': { 'no-autofocus': 1 },
  'src/pages/ReportsClosedLoop.tsx': {
    'click-events-have-key-events': 1,
    'no-static-element-interactions': 1,
  },
  'src/pages/ReportsNeedsAction.tsx': {
    'click-events-have-key-events': 1,
    'no-static-element-interactions': 1,
  },
  'src/pages/ReportsPipeline.tsx': {
    'click-events-have-key-events': 1,
    'no-static-element-interactions': 1,
  },
  'src/pages/ReportsStale.tsx': {
    'click-events-have-key-events': 1,
    'no-static-element-interactions': 1,
  },
  'src/pages/ResumeVariantDetail.tsx': { 'no-autofocus': 1 },
};

const BASELINE_TOTAL = Object.values(A11Y_BASELINE)
  .flatMap((counts) => Object.values(counts))
  .reduce((a, b) => a + b, 0);

type Measurement = {
  byFile: Record<string, RuleCounts>;
  total: number;
  errors: number;
  /** How many files ESLint actually read. Zero findings over zero files is not a clean tree. */
  filesLinted: number;
};

/** Linting the whole tree takes ~10s, and two tests need it. Do it once. */
let measured: Promise<Measurement> | undefined;
function measure(): Promise<Measurement> {
  return (measured ??= runEslint());
}

/** Every jsx-a11y finding in `src`, as `{ [relativePath]: { [ruleName]: count } }`. */
async function runEslint(): Promise<Measurement> {
  const eslint = new ESLint({ cwd: webRoot });
  const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);

  const byFile: Record<string, RuleCounts> = {};
  let total = 0;
  let errors = 0;

  for (const result of results) {
    // ESLint reports absolute paths. Strip the root by prefix rather than with
    // `path.relative`, and fail loudly if a result lands outside it instead of emitting a
    // `../..`-shaped key that could never match the baseline and would read as a regression.
    if (!result.filePath.startsWith(`${webRoot}/`)) {
      throw new Error(`lint result outside ${webRoot}: ${result.filePath}`);
    }
    const rel = result.filePath
      .slice(webRoot.length + 1)
      .split('\\')
      .join('/');
    for (const message of result.messages) {
      if (!message.ruleId?.startsWith('jsx-a11y/')) continue;
      const rule = message.ruleId.slice('jsx-a11y/'.length);
      byFile[rel] ??= {};
      byFile[rel][rule] = (byFile[rel][rule] ?? 0) + 1;
      total += 1;
      if (message.severity === 2) errors += 1;
    }
  }

  return { byFile, total, errors, filesLinted: results.length };
}

describe('jsx-a11y baseline (WIC-1483)', () => {
  it('has the plugin actually wired into the shared config', async () => {
    // A positive control. Without it, every assertion below passes just as happily when
    // the plugin fails to load or the `extends` entry is dropped — a null result would
    // read as "the tree is clean" when it means "nothing was checked".
    //
    // The shape check on the root is necessary and NOT sufficient, which is worth stating
    // because the insufficiency was demonstrated rather than imagined: the vite-rewritten
    // `/@fs/…/packages/web` path satisfies this assertion and resolves to nothing on disk.
    // The count in the next test is what closes that; this only catches a gross mismatch.
    expect(webRoot.endsWith('/packages/web'), `webRoot resolved to ${webRoot}`).toBe(true);

    const eslint = new ESLint({ cwd: webRoot });
    const [result] = await eslint.lintText('export const Bad = () => <img src="x.png" />;\n', {
      filePath: `${webRoot}/src/__a11y_positive_control__.tsx`,
    });

    const fired = result.messages.filter((m) => m.ruleId?.startsWith('jsx-a11y/'));
    expect(fired.map((m) => m.ruleId)).toContain('jsx-a11y/alt-text');

    // ...and that a clean rule is a hard error, not a warning. This is what makes
    // `npm run lint` a build-failing gate rather than advisory output (AC-1).
    expect(fired.find((m) => m.ruleId === 'jsx-a11y/alt-text')?.severity).toBe(2);
  }, 60_000);

  it('matches the recorded baseline exactly — no new violations, and no stale entries', async () => {
    const { byFile, filesLinted } = await measure();

    // The anti-no-op guard, and it is NOT redundant with the equality below.
    //
    // `toEqual` pins *what* was found; nothing in it pins *how much was looked at*. Narrow
    // the glob and regenerate A11Y_BASELINE from the narrowed run — which is exactly the
    // shape of "regenerate the baseline until it goes green" — and the two agree with each
    // other perfectly while most of the tree goes unchecked. Measured: glob narrowed to
    // `src/pages/**`, with A11Y_BASELINE and both `--max-warnings` ceilings regenerated to
    // agree, reads **32 of 151** files and fails here.
    //
    // Two corrections to an earlier version of this note, both from re-measuring it rather
    // than re-reading it. It said "8 of 148", which was the wrong quantity as well as a
    // stale total: 8 is how many files had findings, and the number this line exists to
    // pin is how many were READ. And it said the mutation was otherwise fully green, which
    // stopped being true when 'states its enforcement surface exactly' was added below —
    // that test ties the `warn` set to the rules the baseline records, so a narrowed
    // baseline reds it too (6 configured vs 3 surviving — `label-has-associated-control`
    // was one of the four survivors before WIC-1589 retired it). Deleting this line leaves
    // that one red; also trimming BASELINED_RULES to the 3 survivors moves the failure to
    // the `error` count (29, not 26). Getting this mutation green now means editing the
    // assertions themselves, not just the baseline — which is the point of both guards.
    //
    // 151 `.ts`/`.tsx` files under `src` today; a floor of 100 absorbs ordinary churn.
    expect(filesLinted).toBeGreaterThan(100);

    // Equality, deliberately. `toBeLessThanOrEqual` on a total would let a regression
    // hide behind an unrelated fix, and would let the baseline outlive the defects it
    // describes. If this fails because a violation was FIXED: delete the entry, drop
    // `--max-warnings` in package.json to match, and if a rule hit zero, remove it from
    // BASELINED_RULES in eslint.config.js so it goes back to `error`.
    expect(byFile).toEqual(A11Y_BASELINE);
  }, 60_000);

  it('keeps the --max-warnings ceiling in step with the baseline', async () => {
    const { total, errors } = await measure();
    const pkg = JSON.parse(packageJsonRaw) as { scripts: Record<string, string> };

    // Guard the guard: if the flag is ever dropped or renamed, this must fail rather
    // than quietly stop pinning anything.
    const ceiling = /--max-warnings\s+(\d+)/.exec(pkg.scripts.lint);
    expect(ceiling, `no --max-warnings in lint script: ${pkg.scripts.lint}`).not.toBeNull();
    expect(Number(ceiling![1])).toBe(BASELINE_TOTAL);
    expect(total).toBe(BASELINE_TOTAL);

    // `lint:fix` carries the same ceiling and, until now, nothing checked it. Lower `lint`
    // to 20 and leave `lint:fix` at 27 and the two silently disagree — a hole in a guard
    // whose stated job is that they cannot. Both are pinned to the same measurement.
    const fixCeiling = /--max-warnings\s+(\d+)/.exec(pkg.scripts['lint:fix']);
    expect(
      fixCeiling,
      `no --max-warnings in lint:fix script: ${pkg.scripts['lint:fix']}`
    ).not.toBeNull();
    expect(Number(fixCeiling![1])).toBe(BASELINE_TOTAL);

    // The baselined 5 are `warn`, so `--max-warnings` is what pins them. Any jsx-a11y
    // finding at `error` severity would fail `npm run lint` outright — which is correct
    // for the other 27 rules, but means the tree is currently red, so say so here.
    expect(errors).toBe(0);
  }, 60_000);

  it('states its enforcement surface exactly — 27 error, 5 warn, 2 deliberately off', async () => {
    // The reason this test exists.
    //
    // Every other number in this PR is measured; the enforcement surface was not. It was
    // hand-derived as `34 - 8 = 26`, copied into four files, and wrong in all four —
    // `jsx-a11y`'s `recommended` ships 3 of its 34 entries `off`, so nothing was enforcing
    // them and the real figure was 23. No assertion here could fail on that, which is the
    // same shape as the defect this whole card is about: a stated requirement with no
    // mechanism able to contradict it.
    //
    // Read from the RESOLVED config for a real source file, so it accounts for the
    // plugin's own severities AND this repo's overrides together — the arithmetic that
    // produced 26 is exactly what must not be trusted a second time.
    const eslint = new ESLint({ cwd: webRoot });
    const config = await eslint.calculateConfigForFile(`${webRoot}/src/App.tsx`);

    const a11yRules = Object.entries(config.rules ?? {}).filter(([rule]) =>
      rule.startsWith('jsx-a11y/')
    );
    const severityOf = (entry: unknown) => (Array.isArray(entry) ? entry[0] : entry);
    const named = (severity: number) =>
      a11yRules
        .filter(([, entry]) => severityOf(entry) === severity)
        .map(([rule]) => rule)
        .sort();

    // Fails closed: if the config failed to resolve, `rules` is empty and every count is 0.
    expect(a11yRules).toHaveLength(34);

    expect(named(2)).toHaveLength(27);
    expect(named(1)).toHaveLength(5);

    // Pinned BY NAME, not just counted. `label-has-for` is deprecated upstream and
    // superseded by `label-has-associated-control`, now at `error` with 0 findings
    // (WIC-1589); leaving `label-has-for` on would re-litigate the same 82 findings in a
    // withdrawn spelling, now that the successor is clean.
    // `control-has-associated-label` is opt-in upstream and costs 3 — real work, owned by
    // WIC-1589, deliberately not smuggled into this change. If a plugin upgrade turns a
    // THIRD rule off, that is a silent loss of enforcement and this must fail.
    expect(named(0)).toEqual(['jsx-a11y/control-has-associated-label', 'jsx-a11y/label-has-for']);

    // The 5 at `warn` must be exactly the rules the baseline records findings for. This
    // ties the config to the evidence: baselining a rule that has no recorded violations,
    // or recording violations for a rule that is not baselined, both fail here.
    const baselinedRules = [
      ...new Set(Object.values(A11Y_BASELINE).flatMap((counts) => Object.keys(counts))),
    ]
      .map((rule) => `jsx-a11y/${rule}`)
      .sort();
    expect(named(1)).toEqual(baselinedRules);
  }, 60_000);

  it('is extended from `strict`, and closes the expression-value hole `recommended` leaves open', async () => {
    // Nothing above this line can tell `strict` from `recommended` (ADR-011 §4.2).
    //
    // The two configs are 33 entries `{error: 31, off: 2}` and 34 `{error: 31, off: 3}`,
    // and they differ on 7 rules — but 6 of those differences are in rule OPTIONS, and the
    // 7th is that `anchor-ambiguous-text` is absent from `strict` altogether while
    // `recommended` ships it `off`. PROMOTED_RULES restores it, so BOTH configs resolve to
    // 34 entries at 27/5/2, over the same 2 `off` names. They also produce byte-identical
    // findings on this tree: 26, matching on file + rule + line + column + severity.
    //
    // So every count in the test above is satisfied by either ruleset, and a revert of the
    // `extends` entry would pass the whole suite while quietly restoring the hole below.
    // Options are the only observable difference; this is the assertion that sees them.
    const eslint = new ESLint({ cwd: webRoot });
    const config = await eslint.calculateConfigForFile(`${webRoot}/src/App.tsx`);
    const optionsOf = (rule: string) => {
      const entry = (config.rules ?? {})[`jsx-a11y/${rule}`];
      return Array.isArray(entry) ? entry.slice(1) : [];
    };

    // `allowExpressionValues: true` suppresses these two rules whenever `role` is a JSX
    // expression rather than a literal — i.e. exactly where a static check is least able to
    // reason and most needs to complain. `recommended` sets it on both; `strict` sets
    // neither. Asserted as "no option object at all" rather than as `!== true`, so a future
    // upstream default that re-introduces it under another spelling still fails.
    expect(optionsOf('no-static-element-interactions')).toEqual([]);
    expect(optionsOf('no-noninteractive-tabindex')).toEqual([]);

    // A severity-only override (`'warn'` in BASELINED_RULES) replaces the severity and
    // KEEPS the extended config's options, which is why the tightening reaches these two
    // even though both are baselined. If flat config ever stopped merging that way, the
    // assertions above would read as `strict` on a config that had lost its options
    // entirely — so pin a rule that is NOT baselined and whose options are non-empty under
    // both. `strict` adds `progressbar` and `slider` to the tabbable set.
    const tabbable = (optionsOf('interactive-supports-focus')[0] as { tabbable?: string[] })
      ?.tabbable;
    expect(tabbable).toContain('progressbar');
    expect(tabbable).toContain('slider');

    // And the behaviour, not just the config that is supposed to produce it. Under
    // `recommended` this snippet emits NOTHING; a new instance of it would land in the tree
    // with no warning and no diff to argue with. Under `strict` it is a finding, which —
    // because `no-noninteractive-tabindex` is baselined at `warn` — makes it a 28th warning
    // and fails `npm run lint` against the `--max-warnings` ceiling.
    const [result] = await eslint.lintText(
      "const role = 'button';\nexport const Bad = () => <div role={role} tabIndex={0} />;\n",
      { filePath: `${webRoot}/src/__strict_control__.tsx` }
    );
    expect(result.messages.map((m) => m.ruleId)).toContain('jsx-a11y/no-noninteractive-tabindex');
  }, 60_000);
});
