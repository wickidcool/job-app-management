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
 * Everything else in `recommended` — 26 of the 34 rules — is clean today and is left at
 * `error`, so a new violation of any of them fails `npm run lint` and therefore CI.
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
    },
  },
]);
