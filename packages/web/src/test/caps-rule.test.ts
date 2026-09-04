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

/**
 * Headings prettier has wrapped onto more than one line (WIC-1922).
 *
 * CAPS_PATTERN's character class admits a space but not a newline, so before WIC-1922 a
 * multi-line JSX text node could not match at all and the rule silently reported nothing.
 * The repo's own mandatory formatter is what puts the newline there: `printWidth: 100`
 * plus a `format:check` glob of `packages/**\/*.{ts,tsx,css,md}` means the wrapped form is
 * the one that survives CI, so the rule was blind to exactly the longest shouted headings.
 *
 * Each `jsx` below is prettier's real output, verified by running prettier over the
 * one-line form at the configured width. Note the one-line source has to exceed 100
 * columns for prettier to wrap it at all: WIC-1922's own worked example
 * (`...THE ATTACHED RESUME FIRST!`) is 92 columns and prettier leaves it alone, which is
 * why the strings here are longer than the ones in that ticket. Real components indent
 * deeper than this probe, so in `src/**` the wrap — and therefore the blind spot — starts
 * at a shorter heading than these cases need.
 */
const WRAPPED_CASES: readonly Case[] = [
  {
    name: 'two lines',
    jsx: '<h3>\n    NOTE: DO NOT SUBMIT THIS APPLICATION WITHOUT REVIEWING THE ATTACHED RESUME AND COVER LETTER\n    FIRST!\n  </h3>',
    why: 'WIC-1922',
  },
  {
    name: 'three lines',
    jsx: '<h2>\n    WARNING: THIS ACTION PERMANENTLY DELETES EVERY SAVED RESUME VARIANT, EVERY COVER LETTER\n    DRAFT AND EVERY INTERVIEW NOTE ATTACHED TO THIS APPLICATION, AND IT CANNOT BE UNDONE\n    LATER.\n  </h2>',
    why: 'WIC-1922',
  },
  {
    name: 'a newline as the only separator between two caps words',
    // The minimal case: identical to `<h3>GAP TALKING POINTS</h3>` except that one of the
    // spaces is a newline. If this flags, nothing but the whitespace class was ever
    // stopping it.
    jsx: '<h3>\n    GAP TALKING\n    POINTS\n  </h3>',
    why: 'WIC-1922 minimal case',
  },
];

/**
 * The KNOWN GAPS named in the rule's own doc comment.
 *
 * The rule claims these are out of scope; the docstring claims every such claim is pinned
 * here. Before WIC-1922 only the `$` gap actually was, so three of the four were prose
 * that nothing checked — a rule that quietly started flagging attribute values, or that
 * never could, read identically.
 *
 * Each case carries its own differential control: the SAME shouted string, moved into a
 * plain JSX text node, must flag. Without that pairing an assertion of "0 findings" is
 * satisfied just as well by a rule that reports nothing at all, which is precisely the
 * failure mode this file exists to catch.
 */
const KNOWN_GAP_CASES: readonly (Case & { readonly control: string })[] = [
  {
    name: 'runtime .toUpperCase()',
    jsx: '<h3>{"Gap talking points".toUpperCase()}</h3>',
    control: '<h3>GAP TALKING POINTS</h3>',
    why: 'JobFitAnalysis.tsx, owned by WIC-1122 / WIC-1146',
  },
  {
    name: 'caps inside an attribute value',
    // ChangeActionBadge's worst instance (WIC-1185): `text-transform` cannot reach an
    // attribute, so this one is unfixable from CSS — and this rule still cannot see it.
    jsx: '<button aria-label="CREATE ACTION">Create</button>',
    control: '<button>CREATE ACTION</button>',
    why: 'WIC-1185',
  },
];
// The fourth gap — caps reaching JSX through a variable — needs a module-level binding, so
// it cannot go through `component()` and gets its own test below.

/** Module source for the variable gap: the caps live in a binding, not a text node. */
const VARIABLE_GAP_SOURCE = `const LABEL = 'GAP TALKING POINTS';\nexport const Probe = () => <h3>{LABEL}</h3>;\n`;

let eslint: ESLint;

/** Lint a whole module source through the real config and return this rule's messages. */
async function lintSource(source: string) {
  const results = await eslint.lintText(source, { filePath: PROBE_PATH });

  // Fail loudly rather than silently returning zero messages. A snippet that does not
  // parse, or a path ESLint declines to lint, would otherwise make every "must not
  // flag" case below pass for the wrong reason.
  expect(results.length, `ESLint linted no file at all for ${PROBE_PATH}`).toBeGreaterThan(0);
  const fatal = results.flatMap((r) => r.messages).filter((m) => m.fatal);
  expect(
    fatal.map((m) => m.message),
    `snippet failed to parse: ${source}`
  ).toEqual([]);

  return results.flatMap((r) => r.messages).filter((m) => m.ruleId === RULE_ID);
}

/** Lint one JSX fragment through the real config and return this rule's messages. */
async function lintSnippet(jsx: string) {
  return lintSource(component(jsx));
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

  describe("prettier's line wrapping no longer defeats the pattern (WIC-1922)", () => {
    it.each(WRAPPED_CASES)(
      'flags a shouted heading prettier has wrapped onto $name',
      async ({ jsx }) => {
        const messages = await lintSnippet(jsx);
        expect(messages.length, `expected a finding for: ${jsx}`).toBeGreaterThan(0);
      },
      60_000
    );

    it('reports the wrapped text collapsed onto one line', async () => {
      // `caps-baseline.test.ts` recovers the flagged string by regex over this message and
      // compares it against the `allow` list, so the reported string is an interface, not
      // an incidental. Collapsing means a multi-line node reports its RENDERED name — the
      // same string the one-line source would report — rather than a fragment ending at
      // the first newline. Pin it: an `allow` entry could otherwise never match a wrapped
      // site, and the two files cannot see this coupling from either side alone.
      const [message] = await lintSnippet('<h3>\n    GAP TALKING\n    POINTS\n  </h3>');

      expect(message.message).toMatch(/^Literal ALL-CAPS text "GAP TALKING POINTS" reaches/);
    }, 60_000);

    it('still exempts a wrapped heading that carries an uppercase class', async () => {
      // The widening must not cost the R1 exemption. This shape was unreachable before
      // WIC-1922 — the pattern rejected it long before `hasUppercaseClass` was consulted —
      // so it is the exemption's first real test on a multi-line node.
      const WRAPPED = '\n    GAP TALKING\n    POINTS\n  ';
      const messages = await lintSnippet(
        `<h3 className="text-xs uppercase tracking-wider">${WRAPPED}</h3>`
      );

      expect(
        messages.map((m) => m.message),
        'a wrapped R1-pattern heading must stay green'
      ).toEqual([]);

      // Differential control, and the reason this case is not vacuous: the SAME wrapped
      // text without the class must flag. Revert the whitespace collapse and the
      // assertion above still passes — but this one goes red, because it is the class,
      // not the newline, that has to be doing the exempting.
      const controlMessages = await lintSnippet(`<h3>${WRAPPED}</h3>`);
      expect(
        controlMessages.length,
        'control failed, so the exemption above is not what kept the case green'
      ).toBeGreaterThan(0);
    }, 60_000);
  });

  describe('the documented KNOWN GAPS are still open, and pinned (WIC-1922)', () => {
    it.each(KNOWN_GAP_CASES)(
      'does not see: $name',
      async ({ jsx, control }) => {
        const messages = await lintSnippet(jsx);
        expect(
          messages.length,
          `this gap has been closed — good, but update the rule's KNOWN GAPS comment: ${jsx}`
        ).toBe(0);

        // The differential control. Same string, plain text node: this MUST flag, or the
        // assertion above is satisfied by a dead rule rather than by the gap.
        const controlMessages = await lintSnippet(control);
        expect(
          controlMessages.length,
          `control failed, so the 0 above proves nothing: ${control}`
        ).toBeGreaterThan(0);
      },
      60_000
    );

    it('does not follow a caps string through a variable binding', async () => {
      // Needs a module-level binding, so it cannot go through `component()`.
      const messages = await lintSource(VARIABLE_GAP_SOURCE);
      expect(messages.length, VARIABLE_GAP_SOURCE).toBe(0);

      const controlMessages = await lintSnippet('<h3>GAP TALKING POINTS</h3>');
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
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
