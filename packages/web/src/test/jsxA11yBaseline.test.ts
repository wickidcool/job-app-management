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
 * 26 of the 34 `recommended` rules are clean on `main` and are left at `error`, so
 * `npm run lint` already fails CI on a new violation of any of them. The other 8 are
 * `warn` (see `BASELINED_RULES` in `eslint.config.js`) purely so that adopting the
 * plugin did not require fixing 47 pre-existing defects in the same change.
 *
 * A downgrade-to-warn with no counter-pressure is how an allowlist becomes a permanent
 * tree-wide hole, so the baseline is pinned in BOTH directions and per file:
 *
 *   - a NEW violation in any file fails, even in a `warn` rule;
 *   - a FIXED violation also fails, forcing the baseline down instead of letting it
 *     rot upward. `toEqual` on the whole map, not `toBeLessThanOrEqual` on a total;
 *   - it is keyed by file+rule, so fixing one file and breaking another — which leaves
 *     the total at 47 — is still a failure.
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
 * Measured on `main` @ `775c288`. 47 findings, 22 files, 8 distinct rules.
 * Owned by WIC-1589 — every entry here is a real defect, not an accepted exception.
 */
const A11Y_BASELINE: Record<string, RuleCounts> = {
  'src/components/ApplicationCard.tsx': {
    'no-noninteractive-element-interactions': 1,
    'no-noninteractive-tabindex': 1,
    'no-redundant-roles': 1,
  },
  'src/components/CatalogBrowse/CatalogBrowseView.tsx': {
    'click-events-have-key-events': 1,
    'no-static-element-interactions': 1,
  },
  'src/components/CatalogDiff/AmbiguityResolver.tsx': { 'label-has-associated-control': 1 },
  'src/components/CommandPalette.tsx': { 'no-autofocus': 1 },
  'src/components/CoverLetterGenerator.tsx': { 'label-has-associated-control': 7 },
  'src/components/FilterPanel.tsx': {
    'click-events-have-key-events': 1,
    'no-noninteractive-element-interactions': 1,
  },
  'src/components/OutreachComposer.tsx': { 'label-has-associated-control': 5 },
  'src/components/ResumeUpload.tsx': {
    'click-events-have-key-events': 1,
    'no-noninteractive-element-interactions': 1,
  },
  'src/components/ResumeVariantCard.tsx': { 'no-noninteractive-element-to-interactive-role': 1 },
  'src/components/STARStoryBank.tsx': {
    'click-events-have-key-events': 1,
    'no-noninteractive-element-interactions': 1,
  },
  'src/components/SavedFilterShortcuts.tsx': { 'no-autofocus': 1 },
  'src/components/StarEntryPicker.tsx': {
    'click-events-have-key-events': 1,
    'no-static-element-interactions': 1,
  },
  'src/components/wizard/WizardContainer.tsx': {
    'label-has-associated-control': 1,
    'no-autofocus': 1,
  },
  'src/components/wizard/WizardStep.tsx': { 'no-noninteractive-element-interactions': 1 },
  'src/pages/OutreachNew.tsx': { 'label-has-associated-control': 1 },
  'src/pages/ProjectFileEditor.tsx': { 'label-has-associated-control': 2 },
  'src/pages/ProjectsList.tsx': { 'label-has-associated-control': 2, 'no-autofocus': 1 },
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
    // `src/pages/**` with the baseline and `--max-warnings` lowered to match is fully green
    // on 8 of 148 files without this line, and fails here with it.
    //
    // 148 `.ts`/`.tsx` files under `src` today; a floor of 100 absorbs ordinary churn.
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

    // The baselined 8 are `warn`, so `--max-warnings` is what pins them. Any jsx-a11y
    // finding at `error` severity would fail `npm run lint` outright — which is correct
    // for the other 26 rules, but means the tree is currently red, so say so here.
    expect(errors).toBe(0);
  }, 60_000);
});
