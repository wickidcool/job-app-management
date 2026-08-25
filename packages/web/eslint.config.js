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
          // These eight strings are still shouted on `main` only because the PRs that
          // fix them have not merged. Delete each entry as its PR lands; the list must
          // reach [] and the option should then be dropped entirely.
          //
          // Matching is per-string, not per-file, so the rule stays fully live inside
          // GapMitigationPanel.tsx and QuickReferenceExport.tsx — a NEW caps string in
          // either file still fails CI today.
          //
          //   PR #90  (WIC-1069) 'KEY STRENGTHS TO HIGHLIGHT', 'INTERVIEW QUICK REFERENCE'
          //   PR #98  (WIC-1127) 'YOUR TOP', 'STORIES',
          //                      'KEY QUESTIONS & SUGGESTED ANSWERS', 'GAP TALKING POINTS'
          //   PR #103 (WIC-1205) 'KEY PHRASES:', 'REDIRECT TO:'
          //
          // Verified 2026-08-25 by merging #90 + #98 + #103 into `main` in a scratch
          // worktree and re-running this rule: ZERO violations. The baseline empties
          // completely rather than partially.
          allow: [
            'KEY STRENGTHS TO HIGHLIGHT',
            'INTERVIEW QUICK REFERENCE',
            'YOUR TOP',
            'STORIES',
            'KEY QUESTIONS & SUGGESTED ANSWERS',
            'GAP TALKING POINTS',
            'KEY PHRASES:',
            'REDIRECT TO:',
          ],
        },
      ],
    },
  },
])
