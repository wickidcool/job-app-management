import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

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

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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
    const rel = relative(webRoot, result.filePath).split('\\').join('/');
    for (const message of result.messages) {
      if (!message.ruleId?.startsWith('jsx-a11y/')) continue;
      const rule = message.ruleId.slice('jsx-a11y/'.length);
      byFile[rel] ??= {};
      byFile[rel][rule] = (byFile[rel][rule] ?? 0) + 1;
      total += 1;
      if (message.severity === 2) errors += 1;
    }
  }

  return { byFile, total, errors };
}

describe('jsx-a11y baseline (WIC-1483)', () => {
  it('has the plugin actually wired into the shared config', async () => {
    // A positive control. Without it, every assertion below passes just as happily when
    // the plugin fails to load or the `extends` entry is dropped — a null result would
    // read as "the tree is clean" when it means "nothing was checked".
    const eslint = new ESLint({ cwd: webRoot });
    const [result] = await eslint.lintText('export const Bad = () => <img src="x.png" />;\n', {
      filePath: resolve(webRoot, 'src/__a11y_positive_control__.tsx'),
    });

    const fired = result.messages.filter((m) => m.ruleId?.startsWith('jsx-a11y/'));
    expect(fired.map((m) => m.ruleId)).toContain('jsx-a11y/alt-text');

    // ...and that a clean rule is a hard error, not a warning. This is what makes
    // `npm run lint` a build-failing gate rather than advisory output (AC-1).
    expect(fired.find((m) => m.ruleId === 'jsx-a11y/alt-text')?.severity).toBe(2);
  }, 60_000);

  it('matches the recorded baseline exactly — no new violations, and no stale entries', async () => {
    const { byFile } = await measure();

    // Equality, deliberately. `toBeLessThanOrEqual` on a total would let a regression
    // hide behind an unrelated fix, and would let the baseline outlive the defects it
    // describes. If this fails because a violation was FIXED: delete the entry, drop
    // `--max-warnings` in package.json to match, and if a rule hit zero, remove it from
    // BASELINED_RULES in eslint.config.js so it goes back to `error`.
    expect(byFile).toEqual(A11Y_BASELINE);
  }, 60_000);

  it('keeps the --max-warnings ceiling in step with the baseline', async () => {
    const { total, errors } = await measure();
    const pkg = JSON.parse(readFileSync(resolve(webRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

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
