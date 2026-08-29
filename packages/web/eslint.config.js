import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * The 8 `jsx-a11y` recommended rules that `main` already violates (WIC-1483).
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
 * Rules `jsx-a11y`'s own `recommended` ships as `off`, and what each one costs (WIC-1483).
 *
 * `flatConfigs.recommended` has 34 entries but a severity histogram of `{error: 31, off: 3}`
 * — 3 of them enforce nothing. Counting all 34 as active is how this config came to claim
 * an enforcement surface of `34 - 8 = 26` when the true figure was 23. On a card whose
 * premise is "an accepted requirement with nothing behind it", shipping an enforcement
 * count 13% high is a smaller instance of the same defect, so the boundary is now stated
 * rather than assumed. Measured at `error` over `src/**` on this tree:
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
      jsxA11y.flatConfigs.recommended,
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
]);
