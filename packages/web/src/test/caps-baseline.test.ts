import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

/**
 * Staleness test for the `local/no-literal-caps-jsx-text` allowlist (WIC-1440).
 *
 * `eslint.config.js` declares that list a SHRINKING BASELINE: one entry per string
 * still shouted on `main`, deleted as its PR lands. Nothing enforced the "deleted as
 * its PR lands" half. Between #90 and #98 merging and this test existing, six of the
 * eight entries were dead — and a dead entry is not clutter. Matching is per-string
 * and tree-wide, so each one is a standing permission to reintroduce that exact caps
 * string anywhere in `src/**`, including the very site its own PR just fixed:
 *
 *     <h3>GAP TALKING POINTS</h3>   ->  exit 0   (silently permitted)
 *     <h3>GAP TALKING NOTES</h3>    ->  exit 1   (rule live)
 *
 * This test pins the invariant the comment always claimed: the allowlist holds
 * exactly the strings that are genuinely still violating, no more and no fewer.
 * A merged PR now fails CI here until its entry is removed.
 *
 * Sibling precedent, and the reason this is worth a test rather than a convention:
 * `route-integrity.test.ts` carried its own hand-maintained allowlist and went stale
 * the same way (WIC-1439), staying green over a route that no longer existed.
 */

const RULE_ID = 'local/no-literal-caps-jsx-text';
// Any linted component file; used only to ask ESLint what config applies to `src/**`.
const SAMPLE_FILE = 'src/components/EmptyState.tsx';

// No `cwd` and no `overrideConfigFile`: ESLint discovers eslint.config.js from the
// process cwd, which vitest pins to this package (vitest.config.ts lives here). That
// avoids importing `node:path`/`node:url`, which tsconfig.app.json has no types for —
// the same reason route-integrity.test.ts reads source via Vite's `?raw` rather than
// `fs`. If the cwd were ever wrong, both helpers below fail loudly rather than
// silently returning empty.

/**
 * The baseline as ESLint actually resolves it for `src/**` — the effective value CI
 * enforces, not a re-read of the source text.
 */
async function declaredAllowList(): Promise<string[]> {
  const config = await new ESLint().calculateConfigForFile(SAMPLE_FILE);
  const setting = config.rules?.[RULE_ID];

  expect(
    Array.isArray(setting) && setting.length > 1,
    `${RULE_ID} should be configured with options for ${SAMPLE_FILE}; got ${JSON.stringify(setting)}`
  ).toBe(true);

  const options = (setting as [unknown, { allow?: string[] } | undefined])[1];
  return options?.allow ?? [];
}

/**
 * Every string the rule would flag with the baseline switched off. Runs the real
 * config, so the file scope, acronym list and `uppercase`-class exemption are the
 * ones CI uses; only the `allow` option is overridden.
 */
async function violatingStrings(): Promise<Set<string>> {
  const eslint = new ESLint({
    overrideConfig: [
      {
        files: ['src/**/*.tsx'],
        rules: { [RULE_ID]: ['error', { allow: [] }] },
      },
    ],
  });

  const results = await eslint.lintFiles(['src/**/*.tsx']);
  expect(results.length, 'lint run matched no files at all').toBeGreaterThan(0);

  const found = new Set<string>();

  for (const result of results) {
    for (const message of result.messages) {
      if (message.ruleId !== RULE_ID) continue;
      // Parse rather than read `data`: ESLint does not surface message data on
      // LintMessage. Assert the match instead of skipping on a miss — a silent miss
      // would empty this set and pass the whole suite vacuously.
      const match = /^Literal ALL-CAPS text "(.+?)" reaches/.exec(message.message);
      expect(match, `could not parse the flagged string out of: ${message.message}`).not.toBeNull();
      found.add(match![1]);
    }
  }

  return found;
}

describe('no-literal-caps-jsx-text allowlist', () => {
  // One lint pass over src/**/*.tsx takes several seconds; run it once and share it.
  let declared: string[];
  let violations: Set<string>;

  beforeAll(async () => {
    [declared, violations] = await Promise.all([declaredAllowList(), violatingStrings()]);
  }, 120_000);

  it('flags at least one violation once the baseline is switched off', () => {
    // Negative control. Without it, an allowlist that had correctly reached [] and a
    // lint run that silently matched nothing would look identical from here.
    // Delete this case when `allow` is dropped entirely — at that point an empty
    // result is the expected state, and the two below still hold.
    expect(violations.size).toBeGreaterThan(0);
  });

  it('has no entry whose PR has already landed', () => {
    const dead = declared.filter((entry) => !violations.has(entry));

    expect(
      dead,
      `These allowlist entries in eslint.config.js no longer match any violation, so ` +
        `their fix has merged. Each one is a standing tree-wide permission for that exact ` +
        `string — delete them (WIC-1440). If that leaves the list empty, drop the \`allow\` ` +
        `option entirely and delete the negative-control case above.`
    ).toEqual([]);
  });

  it('suppresses every violation it declares', () => {
    // The other direction: the baseline must fully cover what is actually shouted, so
    // `npm run lint` is green and any NEW caps string is a real CI failure.
    const allowed = new Set(declared);
    const uncovered = [...violations].filter((text) => !allowed.has(text));

    expect(uncovered, 'literal ALL-CAPS strings not covered by the baseline').toEqual([]);
  });
});
