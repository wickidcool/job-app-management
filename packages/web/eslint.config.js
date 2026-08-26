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
      'local/no-literal-caps-jsx-text': [
        'error',
        {
          // SHRINKING BASELINE — do not add an entry without a linked ticket.
          //
          // Every entry is a string still shouted on `main` because the PR that fixes it
          // has not merged. Delete each entry as its PR lands; the list must reach [] and
          // the option should then be dropped entirely.
          //
          //   PR #103 (WIC-1205) 'KEY PHRASES:', 'REDIRECT TO:'
          //
          // Matching is per-string and tree-wide, NOT per-file. That keeps the rule live
          // inside GapMitigationPanel.tsx — a NEW caps string there still fails CI — but
          // it also means a landed entry is a standing permission for that exact string
          // ANYWHERE in src/**/*.tsx, including the site its own PR just fixed. Six such
          // entries were live from #90/#98 merging until WIC-1440.
          //
          // This list is no longer maintained by hand alone: src/test/caps-baseline.test.ts
          // fails as soon as an entry stops matching a real violation, so a merged PR
          // cannot leave its permission behind.
          allow: ['KEY PHRASES:', 'REDIRECT TO:'],
        },
      ],
    },
  },
])
