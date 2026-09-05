import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import noLiteralCapsJsxText from './eslint-rules/no-literal-caps-jsx-text.js';
import noUseStateFromProp from './eslint-rules/no-usestate-from-prop.js';

const localRules = {
  rules: {
    'no-literal-caps-jsx-text': noLiteralCapsJsxText,
    'no-usestate-from-prop': noUseStateFromProp,
  },
};

/**
 * The `jsx-a11y` rules that this tree still violates (WIC-1483 recorded them, WIC-1589
 * is retiring them). 8 rules / 47 findings at adoption; **2 rules / 4 findings today.**
 *
 * ⚠️ That figure is prose and nothing asserts it — it read `5 rules / 26 findings` until
 * WIC-2077, having gone stale through WIC-2062 (26 -> 18) and WIC-2073 (18 -> 10, 5 rules
 * -> 4) without anything able to contradict it. The trailing counts on the entries below
 * ARE cross-checked, via `A11Y_BASELINE`; this sentence is not. Prefer the entries.
 *
 * These are `warn` ONLY so that adopting the plugin did not require fixing 47
 * pre-existing defects in the same change. They are not exempt: the total is pinned
 * from both sides (see below), so the count can go down but never up.
 *
 * This is a ratchet with a deadline, not an allowlist. The findings are owned by
 * WIC-1589; as they are fixed, `A11Y_BASELINE` in `src/test/jsxA11yBaseline.test.ts`
 * and the `--max-warnings` ceiling in `package.json` both have to come down with them,
 * because the test asserts exact equality in both directions and cross-checks the two
 * numbers against each other. When a rule reaches zero, delete its line here.
 *
 * Six rules have reached zero and are gone from this list, back at `error`:
 * `label-has-associated-control` (19 -> 0), `no-redundant-roles` (1 -> 0),
 * `no-noninteractive-element-to-interactive-role` (1 -> 0, WIC-1942 — the
 * `<article role="button">` in `ResumeVariantCard.tsx`, which also tripped axe's
 * `aria-allowed-role` and `nested-interactive`), `no-static-element-interactions`
 * (2 -> 0, WIC-2073 — the last two bare `<div onClick>` wrappers, in
 * `CatalogBrowseView.tsx` and `StarEntryPicker.tsx`), and `no-autofocus`
 * (5 -> 0, WIC-2077) and `click-events-have-key-events` (1 -> 0, WIC-2077 slice 2).
 *
 * ⛔ `no-autofocus` reached zero WITHOUT any focus behaviour changing, and that is the
 * one entry here whose history you must not misread. All five sites were inspected
 * individually and all five are correct as written: four are inside a Radix dialog,
 * where WCAG 2.4.3 requires focus to enter the dialog, and the fifth is an inline panel
 * revealed by a button press. They are now recorded as `eslint-disable-next-line`
 * directives with a per-site rationale, not fixed. `ProjectsList.tsx:234` is the one to
 * be careful with: its `autoFocus` is what suppresses Radix's `onOpenAutoFocus`, which is
 * what makes `useDialogFocusRestore`'s `focusin` fallback capture the trigger — deleting
 * it silently changes the focus-restore path pinned by WIC-1931. See the comment at
 * `ProjectsList.tsx:52-54`.
 *
 * Moving them from a baselined `warn` to a justified per-site disable is a STRENGTHENING:
 * before, any new `autoFocus` anywhere in the tree was a warning absorbed by the
 * `--max-warnings` ceiling; now it fails `npm run lint` outright, and the five exempt
 * sites each carry the reason they are exempt at the line that needs it.
 *
 * That last promotion is a genuine ratchet tightening and it is not optional: the
 * `warn` set is asserted to equal exactly the rules `A11Y_BASELINE` records findings
 * for, so a rule that reaches zero CANNOT be left here — the suite reds until the line
 * is deleted. Being free, it is also the `anchor-ambiguous-text` bargain below, taken
 * for the same reason.
 *
 * The resulting enforcement surface is 28 rules at `error` — but do not trust that
 * number here. It is asserted against the RESOLVED config in `jsxA11yBaseline.test.ts`
 * ('states its enforcement surface exactly'), which is the only copy that cannot rot.
 * An earlier revision of this comment claimed 26 when the true figure was 24, by
 * arithmetic rather than measurement (see PROMOTED_RULES); it is 28 now because four
 * rules were fixed, and the test is what says so.
 *
 * NOTE (WIC-1483): `jsx-a11y` is per-file and therefore structurally blind to
 * heading-order defects that exist only in the composition of a page and the component
 * it mounts. Adopting it does NOT cover WCAG SC 1.3.1. That is layer 2's job.
 */
const BASELINED_RULES = {
  'jsx-a11y/no-noninteractive-element-interactions': 'warn', // 3
  'jsx-a11y/no-noninteractive-tabindex': 'warn', // 1
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
 *                                                  now at `error` with 0 findings (WIC-1589).
 *                                                  Turning it on would re-litigate the same
 *                                                  defect in a spelling its own authors
 *                                                  withdrew — and, now that the successor is
 *                                                  clean, would re-open 82 findings the tree
 *                                                  has already answered.
 *
 * So: 26 at `error`, 6 at `warn`, 2 deliberately `off`. The test pins all three figures
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
 *     is why the resolved surface is 34 entries / 26 `error` under either config.
 *
 * The swap costs nothing today and is not cosmetic tomorrow. Findings on this tree were
 * IDENTICAL under both when measured — 47, in 22 files, over 8 rules, matching on file +
 * rule + line + column + severity, not merely on totals — so `A11Y_BASELINE`, the `--max-warnings`
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
 * Since WIC-2073 those two rules are no longer both baselined, and the option tightening
 * now bites HARDER for it: `no-static-element-interactions` is back at `error`, so the
 * first probe above fails the build outright rather than as an 11th warning, while
 * `no-noninteractive-tabindex` stays `warn` and lands as an 11th warning against
 * `--max-warnings 10`. `recommended` would have shipped both silently.
 *
 * That `no-noninteractive-tabindex` is still in BASELINED_RULES is not a contradiction: a
 * severity-only override (`'warn'`) replaces the severity and RETAINS the extended
 * config's options, so the tightening reaches the baselined 4 as well.
 * `jsxA11yBaseline.test.ts` asserts the resolved options directly, because the entry
 * count, the 28/4/2 histogram and the two `off` names are all identical under both
 * configs — nothing in the numbers can tell you which ruleset is loaded, so a silent
 * revert to `recommended` needs its own assertion.
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
  {
    // WIC-1618: `useState` seeded from a prop snapshots it on mount, so the parent goes on
    // updating the prop while the component keeps its mount-time copy. A prop named
    // `initial*` declares that contract and is exempt (the WIC-1583 convention).
    //
    // Scope is `{ts,tsx}`, wider than the caps rule's `tsx`, so that a hook written in a
    // `.ts` file with a destructured options object is covered the day someone writes one.
    // No such hook exists today; the cost of including `.ts` is zero and the cost of
    // discovering the gap later is not.
    //
    // TEST FILES ARE DELIBERATELY IN SCOPE, stated here rather than left implicit. A
    // test-helper component is a throwaway with no second writer, so the argument for
    // excluding them is real — but `hooks/useRouteFocusHandoff.test.tsx` defines exactly
    // the shape this rule reads, and a carve-out would mean the rule's own test-shaped
    // blind spot were the one place nobody checked. The caps rule likewise lints
    // `src/**/*.tsx` including tests.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { local: localRules },
    rules: {
      // Lands at `error` with zero findings and no allowlist. `warn` was rejected
      // deliberately: it would push both `--max-warnings 26` ceilings in package.json,
      // which WIC-2053 showed are coupled to the a11y baselines. `error` + zero findings
      // touches neither.
      'local/no-usestate-from-prop': 'error',
    },
  },
]);
