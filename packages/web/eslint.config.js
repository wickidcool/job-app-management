import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettierConfig from 'eslint-config-prettier'
import noLiteralCapsJsxText from './eslint-rules/no-literal-caps-jsx-text.js'

const localRules = {
  rules: { 'no-literal-caps-jsx-text': noLiteralCapsJsxText },
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      prettierConfig,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
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
])
