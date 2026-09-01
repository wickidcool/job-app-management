import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

/**
 * Behaviour tests for the `local/no-literal-caps-jsx-text` rule (WIC-1262, WIC-1903).
 *
 * Why this file exists, and why it is not a duplicate of `caps-baseline.test.ts`:
 *
 * `caps-baseline.test.ts` asserts a property of the REPO — that the allowlist holds
 * exactly the strings still shouted in `src/**`. Once WIC-1440 reached its terminal
 * state (allowlist emptied, `allow` option dropped, tree clean) that file's assertions
 * degenerated: one became vacuous over an empty list, the other became "the tree has no
 * violations". A rule that reports NOTHING AT ALL produces exactly the same green.
 *
 * Measured, not argued (WIC-1903, reproduced here at `ca97445` before this file existed):
 * no-op the single `context.report(...)` call in the rule, and
 * `caps-baseline.test.ts` is still `2 passed`. The rule's entire reporting path was
 * unpinned — a silently dead rule and a working one were indistinguishable, and
 * `npm run lint` stayed green either way.
 *
 * So the assertions here are deliberately TREE-STATE-INDEPENDENT. They lint synthetic
 * snippets through the real resolved config, which keeps them valid now that `src/**` is
 * legitimately clean, and keeps them honest about the config wiring: the file scope
 * (`src/**\/*.tsx`), the plugin registration and the `error` severity are all exercised,
 * not re-declared.
 *
 * READ THIS BEFORE ADDING A "must not flag" CASE. Every negative case below is only
 * meaningful because `reports a heading it is meant to catch` passes in the same run,
 * through the same helper and the same probe path. If the probe path ever stopped being
 * linted, every negative case would pass vacuously and only that one positive control
 * would go red. Do not delete it, and do not move the negative cases into a file that
 * does not carry it.
 */

const RULE_ID = 'local/no-literal-caps-jsx-text';

// A path that the `src/**\/*.tsx` config block matches. The file does not exist on disk;
// `lintText` only uses the path to resolve which config applies.
const PROBE_PATH = 'src/components/__caps_probe__.tsx';

/** Wrap a JSX fragment in a module so it parses as a component file. */
function component(jsx: string): string {
  return `export const Probe = () => (\n  ${jsx}\n);\n`;
}

type Case = {
  /** Test name. */
  readonly name: string;
  /** The JSX to lint, already wrapped by `component()` at call time. */
  readonly jsx: string;
  /** Ticket / reason this case exists. */
  readonly why: string;
};

/**
 * The 8 realistic shouted headings WIC-1262 measured escaping the original pattern,
 * plus the one that always flagged. The original character class admitted only space,
 * `&`, `:`, `'` and `-`, so a single trailing period was enough to drop a string out of
 * the rule entirely.
 *
 * Written as literals rather than derived from the rule's own regex: a table generated
 * from the thing under test cannot fail when the thing under test changes.
 */
const PUNCTUATION_CASES: readonly Case[] = [
  { name: 'trailing period', jsx: '<h3>NOTE: DO NOT SUBMIT.</h3>', why: 'WIC-1262' },
  { name: 'comma', jsx: '<h3>WARNING, READ THIS</h3>', why: 'WIC-1262' },
  { name: 'question mark', jsx: '<h3>ARE YOU SURE?</h3>', why: 'WIC-1262' },
  { name: 'exclamation mark', jsx: '<h3>SAVE AND EXIT!</h3>', why: 'WIC-1262' },
  { name: 'forward slash', jsx: '<h3>PROS/CONS SUMMARY</h3>', why: 'WIC-1262' },
  { name: 'parentheses', jsx: '<h3>KEY POINTS (DRAFT)</h3>', why: 'WIC-1262' },
  { name: 'em dash', jsx: '<h3>STEP 1 — GET READY</h3>', why: 'WIC-1262' },
  { name: 'en dash', jsx: '<h3>STEP 1 – GET READY</h3>', why: 'WIC-1262' },
  // The control from WIC-1262's table: punctuation-free except a colon, so it flagged
  // under the original pattern too. Its job is to show the widening did not have to
  // break anything to work.
  {
    name: 'colon only (flagged before the widening too)',
    jsx: '<h3>CONTROL: THIS ONE FLAGS</h3>',
    why: 'WIC-1262 control',
  },
];

/**
 * Shapes that are CORRECT and must stay green. Mixed-case source plus a CSS `uppercase`
 * class renders in caps without the caps ever reaching the accessibility tree; three
 * prior tickets nearly "fixed" `pages/ResumeVariantDetail.tsx` into a regression on
 * exactly this pattern, which is why each className shape gets its own case.
 */
const ALLOWED_CASES: readonly Case[] = [
  {
    name: 'R1 pattern: uppercase class on the element itself',
    jsx: '<h3 className="text-xs uppercase tracking-wider">GAP TALKING POINTS</h3>',
    why: 'WIC-1209 model case',
  },
  {
    name: 'R1 pattern: uppercase class on a JSX ancestor (text-transform inherits)',
    jsx: '<div className="uppercase">\n    <span>GAP TALKING POINTS</span>\n  </div>',
    why: 'WIC-1209 ancestor walk',
  },
  {
    name: 'R1 pattern: uppercase reached through a template literal',
    jsx: '<h3 className={`text-xs ${"uppercase"}`}>GAP TALKING POINTS</h3>',
    why: 'WIC-1209 interpolated className',
  },
  {
    name: 'R1 pattern: uppercase reached through a conditional expression',
    jsx: '<h3 className={true ? "uppercase" : ""}>GAP TALKING POINTS</h3>',
    why: 'WIC-1209 interpolated className',
  },
  {
    name: 'allowlisted acronyms only',
    jsx: '<h3>PDF DOCX TXT</h3>',
    why: 'letter-by-letter is the correct reading for an acronym',
  },
  {
    name: 'allowlisted acronyms separated by the newly admitted punctuation',
    jsx: '<h3>PDF, DOCX (TXT)</h3>',
    why: 'WIC-1262 must not turn the acronym exemption into a false positive',
  },
  {
    name: 'ordinary sentence case',
    jsx: '<h3>Gap talking points.</h3>',
    why: 'the overwhelmingly common shape; a false positive here would be catastrophic',
  },
  {
    name: 'too short to be a shouted label',
    jsx: '<h3>ABC</h3>',
    why: 'the pattern requires a first capital plus 3 more characters',
  },
  {
    name: 'separator noise with no caps word',
    // Matches CAPS_PATTERN in full — first capital, then only class characters — so
    // HAS_CAPS_WORD is the only thing keeping it green. Written without `&amp;` on
    // purpose: the entity puts lowercase letters in the text node and would exempt this
    // case at the pattern instead, which is not the branch it is here to cover.
    jsx: '<h3>A & B - C</h3>',
    why: 'HAS_CAPS_WORD keeps separator noise out',
  },
];

let eslint: ESLint;

/** Lint one snippet through the real config and return this rule's messages. */
async function lintSnippet(jsx: string) {
  const results = await eslint.lintText(component(jsx), { filePath: PROBE_PATH });

  // Fail loudly rather than silently returning zero messages. A snippet that does not
  // parse, or a path ESLint declines to lint, would otherwise make every "must not
  // flag" case below pass for the wrong reason.
  expect(results.length, `ESLint linted no file at all for ${PROBE_PATH}`).toBeGreaterThan(0);
  const fatal = results.flatMap((r) => r.messages).filter((m) => m.fatal);
  expect(
    fatal.map((m) => m.message),
    `snippet failed to parse: ${jsx}`
  ).toEqual([]);

  return results.flatMap((r) => r.messages).filter((m) => m.ruleId === RULE_ID);
}

describe('no-literal-caps-jsx-text', () => {
  beforeAll(() => {
    // One instance across every case: constructing it loads and resolves
    // eslint.config.js, which is the slow part.
    eslint = new ESLint();
  });

  describe('the rule is wired up and reporting (WIC-1903)', () => {
    it('is enabled as an error for the probe path', async () => {
      const config = await eslint.calculateConfigForFile(PROBE_PATH);
      const setting = config.rules?.[RULE_ID];

      // ESLint normalises severity, so an enabled rule always arrives as an array whose
      // first element is 2. This separates "the rule is off / out of scope" from "the
      // rule is on but reports nothing" when the positive control below goes red.
      expect(
        Array.isArray(setting) && setting[0] === 2,
        `${RULE_ID} should be enabled as an error for ${PROBE_PATH}; got ${JSON.stringify(setting)}`
      ).toBe(true);
    }, 60_000);

    it('reports a heading it is meant to catch', async () => {
      // THE positive control. This is the case that a no-op'd `context.report(...)`
      // kills, and the only assertion in the repo that does — see the file header.
      const messages = await lintSnippet('<h3>GAP TALKING POINTS</h3>');

      expect(
        messages.length,
        'the rule reported nothing on a known-violating snippet: its reporting path is dead'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('names the offending string in the report, so the baseline test can parse it', async () => {
      // `caps-baseline.test.ts` recovers the flagged string by regex over this message,
      // because ESLint does not surface message `data` on a LintMessage. That coupling
      // is invisible from either file on its own, so pin it here.
      const [message] = await lintSnippet('<h3>GAP TALKING POINTS</h3>');

      expect(message.message).toMatch(/^Literal ALL-CAPS text "GAP TALKING POINTS" reaches/);
    }, 60_000);
  });

  describe('ordinary punctuation no longer defeats the pattern (WIC-1262)', () => {
    it.each(PUNCTUATION_CASES)(
      'flags a shouted heading with a $name',
      async ({ jsx }) => {
        const messages = await lintSnippet(jsx);
        expect(messages.length, `expected a finding for: ${jsx}`).toBeGreaterThan(0);
      },
      60_000
    );

    it('leaves the documented `$` gap open', async () => {
      // NOT an oversight: `$` is deliberately outside the character class because it
      // risks matching currency-and-caps fragments (WIC-1262). Pinned so that widening
      // the pattern to cover it is a deliberate act with a test to update, rather than
      // an accident nobody notices either way.
      const messages = await lintSnippet('<h3>SALARY: $120K RANGE</h3>');

      expect(
        messages.length,
        'the `$` gap has been closed — good, but update this case and the rule comment'
      ).toBe(0);
    }, 60_000);
  });

  describe('correct casing stays green', () => {
    it.each(ALLOWED_CASES)(
      'does not flag: $name',
      async ({ jsx }) => {
        const messages = await lintSnippet(jsx);
        expect(
          messages.map((m) => m.message),
          `unexpected finding for: ${jsx}`
        ).toEqual([]);
      },
      60_000
    );
  });
});
