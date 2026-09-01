import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import noLiteralCapsJsxText from './eslint-rules/no-literal-caps-jsx-text.js';

const localRules = {
  rules: { 'no-literal-caps-jsx-text': noLiteralCapsJsxText },
};

/**
 * The 8 `jsx-a11y` rules that `main` already violates (WIC-1483).
 *
 * These 8 are `warn` ONLY so that adopting the plugin does not require fixing 47
 * pre-existing defects in the same change. They are not exempt: the total is pinned
 * from both sides (see below), so the count can go down but never up.
 *
 * This is a ratchet with a deadline, not an allowlist. The 47 findings are owned by
 * WIC-1589; as they are fixed, `A11Y_BASELINE` in `src/test/jsxA11yBaseline.test.ts`
 * and the `--max-warnings` ceiling in `package.json` both have to come down with them,
 * because the test asserts exact equality in both directions and cross-checks the two
 * numbers against each other. When a rule reaches zero, delete its line here.
 *
 * The resulting enforcement surface is 24 rules at `error` — but do not trust that
 * number here. It is asserted against the RESOLVED config in `jsxA11yBaseline.test.ts`
 * ('states its enforcement surface exactly'), which is the only copy that cannot rot.
 * An earlier revision of this comment claimed 26 and was wrong (see PROMOTED_RULES).
 *
 * NOTE (WIC-1483): `jsx-a11y` is per-file and therefore structurally blind to
 * heading-order defects that exist only in the composition of a page and the component
 * it mounts. Adopting it does NOT cover WCAG SC 1.3.1. That is layer 2's job.
 */
const BASELINED_RULES = {
  'jsx-a11y/label-has-associated-control': 'warn', // 19
  'jsx-a11y/click-events-have-key-events': 'warn', // 9
  'jsx-a11y/no-static-element-interactions': 'warn', // 6
  'jsx-a11y/no-noninteractive-element-interactions': 'warn', // 5
  'jsx-a11y/no-autofocus': 'warn', // 5
  'jsx-a11y/no-redundant-roles': 'warn', // 1
  'jsx-a11y/no-noninteractive-tabindex': 'warn', // 1
  'jsx-a11y/no-noninteractive-element-to-interactive-role': 'warn', // 1
};

/**
 * Rules the extended `jsx-a11y` config ships as `off`, and what each one costs (WIC-1483).
 *
 * Counting a plugin config's entries as if they were all active is how this config came to
 * claim an enforcement surface of `34 - 8 = 26` when the true figure was 23:
 * `flatConfigs.recommended` has 34 entries but a severity histogram of `{error: 31, off: 3}`.
 * On a card whose premise is "an accepted requirement with nothing behind it", shipping an
 * enforcement count 13% high is a smaller instance of the same defect, so the boundary is
 * stated rather than assumed. Measured at `error` over `src/**` on this tree:
 *
 *   - `anchor-ambiguous-text`         0 findings  -> PROMOTED below. Free, so taken.
 *   - `control-has-associated-label`  3 findings  (FilterPanel, ResumeUpload,
 *                                                  InterviewPrepPage) -> left off. Opt-in
 *                                                  upstream; belongs with WIC-1589's work,
 *                                                  not smuggled into this change.
 *   - `label-has-for`                82 findings  in 20 files -> CORRECTLY off. Deprecated
 *                                                  upstream and superseded by
 *                                                  `label-has-associated-control`, which is
 *                                                  already baselined here at 19. Turning it
 *                                                  on would re-litigate the same defect in a
 *                                                  spelling its own authors withdrew.
 *
 * So: 24 at `error`, 8 at `warn`, 2 deliberately `off`. The test pins all three figures
 * AND the identity of the 2, so promoting or dropping one cannot pass silently.
 *
 * WHY `flatConfigs.strict` AND NOT `flatConfigs.recommended` (ADR-011 §4.2).
 *
 * `strict` is NOT a superset of `recommended`, and the one rule it loses is the one
 * promoted here. Measured against `eslint-plugin-jsx-a11y@6.10.2`:
 *
 *   - `recommended`  34 entries, `{error: 31, off: 3}`
 *   - `strict`       33 entries, `{error: 31, off: 2}`
 *   - `anchor-ambiguous-text` is present-but-`off` in `recommended` and **absent from
 *     `strict` entirely**. A bare swap of the `extends` entry would therefore drop the
 *     free promotion below without changing any count. PROMOTED_RULES puts it back, which
 *     is why the resolved surface is 34 entries / 24 `error` under either config.
 *
 * The swap costs nothing today and is not cosmetic tomorrow. Findings on this tree are
 * IDENTICAL under both — 47, in 22 files, over 8 rules, matching on file + rule + line +
 * column + severity, not merely on totals — so `A11Y_BASELINE`, the `--max-warnings`
 * ceiling and the fixture disables in `headingOutline.test.tsx` are untouched by it. What
 * it buys is 6 option tightenings on FUTURE code, chiefly the removal of
 * `allowExpressionValues: true` from `no-static-element-interactions` and
 * `no-noninteractive-tabindex`. That option suppresses the rule whenever `role` is a JSX
 * expression instead of a literal, which is a hole you can walk through. Probed, not
 * inferred, on this exact config:
 *
 *   `<div role={r} onClick={fn} />`  recommended: click-events-have-key-events only
 *                                    strict:      + no-static-element-interactions
 *   `<div role={r} tabIndex={0} />`  recommended: NOTHING fires
 *                                    strict:      no-noninteractive-tabindex
 *
 * Both of those rules are baselined at `warn`, so a new instance lands as a 48th warning
 * and `--max-warnings 47` fails the build. `recommended` would have shipped it silently.
 *
 * Those two are in BASELINED_RULES, and that is not a contradiction: a severity-only
 * override (`'warn'`) replaces the severity and RETAINS the extended config's options, so
 * the tightening reaches the baselined 8 as well. `jsxA11yBaseline.test.ts` asserts the
 * resolved options directly, because the entry count, the 24/8/2 histogram and the two
 * `off` names are all identical under both configs — nothing in the numbers can tell you
 * which ruleset is loaded, so a silent revert to `recommended` needs its own assertion.
 */
const PROMOTED_RULES = {
  'jsx-a11y/anchor-ambiguous-text': 'error', // 0 findings — clean today, kept clean.
};

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.strict,
      prettierConfig,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      ...BASELINED_RULES,
      ...PROMOTED_RULES,
    },
  },
  {
    // WIC-1209: literal ALL-CAPS in a JSX text node reaches the accessibility tree,
    // where some screen readers spell it out letter by letter. Component source only —
    // e2e specs assert against rendered output and are expected to contain caps.
    files: ['src/**/*.tsx'],
    plugins: { local: localRules },
    rules: {
      // Terminal state reached (WIC-1440): the baseline's last two entries, #103's
      // 'KEY PHRASES:' / 'REDIRECT TO:', landed and were deleted along with the
      // `allow` option itself — see src/test/caps-baseline.test.ts for why a
      // reintroduced `allow` list needs its own staleness test again.
      'local/no-literal-caps-jsx-text': 'error',
    },
  },
]);
