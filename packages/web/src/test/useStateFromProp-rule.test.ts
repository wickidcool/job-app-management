import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

/**
 * Behaviour tests for the `local/no-usestate-from-prop` rule (WIC-1618).
 *
 * WHY THIS FILE IS THE WHOLE DELIVERABLE, not a companion to it.
 *
 * The rule lands at ZERO findings on `main` by design — the three `initialContext` seeds
 * take the WIC-1583 naming exemption and the two boolean-predicate seeds are out of scope.
 * That is exactly the failure mode WIC-1903 measured in this repo's other local rule:
 * no-op the single `context.report(...)` in `no-literal-caps-jsx-text` and
 * `caps-baseline.test.ts` was still `2 passed`, `npm run lint` still green. A rule that
 * reported NOTHING AT ALL and a working one were indistinguishable.
 *
 * So every assertion here is TREE-STATE-INDEPENDENT: it lints synthetic snippets through
 * the real resolved config, which also exercises the wiring — the file scope
 * (`src/**\/*.{ts,tsx}`), the plugin registration and the `error` severity are all
 * measured, not re-declared. A test asserting "the tree is clean" would pass just as well
 * with the rule deleted.
 *
 * READ THIS BEFORE ADDING A "must not flag" CASE. Every negative case below is meaningful
 * only because it carries a differential control — the SAME shape with the exempting
 * feature removed, which MUST flag. Without the pairing, an assertion of "0 findings" is
 * satisfied by a dead rule rather than by the exemption under test.
 */

const RULE_ID = 'local/no-usestate-from-prop';

// A path the `src/**\/*.{ts,tsx}` config block matches. The file does not exist on disk;
// `lintText` only uses the path to resolve which config applies.
const PROBE_PATH = 'src/components/__usestate_probe__.tsx';

/** Wrap a component body in a module. Props are destructured in the parameter list —
 *  the shape every component in `src/**` actually uses (83 of 84; see the rule header). */
function component(props: string, body: string): string {
  return `import { useState } from 'react';\nexport function Probe({ ${props} }: never) {\n  ${body}\n  return null;\n}\n`;
}

let eslint: ESLint;

/** Lint a whole module source through the real config and return this rule's messages. */
async function lintSource(source: string) {
  const results = await eslint.lintText(source, { filePath: PROBE_PATH });

  // Fail loudly rather than silently returning zero messages. A snippet that does not
  // parse, or a path ESLint declines to lint, would otherwise make every "must not flag"
  // case below pass for the wrong reason.
  expect(results.length, `ESLint linted no file at all for ${PROBE_PATH}`).toBeGreaterThan(0);
  const fatal = results.flatMap((r) => r.messages).filter((m) => m.fatal);
  expect(
    fatal.map((m) => m.message),
    `snippet failed to parse: ${source}`
  ).toEqual([]);

  return results.flatMap((r) => r.messages).filter((m) => m.ruleId === RULE_ID);
}

/** Lint one component body through the real config. */
async function lintComponent(props: string, body: string) {
  return lintSource(component(props, body));
}

type Case = {
  readonly name: string;
  readonly props: string;
  readonly body: string;
  readonly why: string;
};

/**
 * Shapes that MUST flag. Each copies a prop's value into state, so the initialiser's
 * mount-only run makes the state a snapshot the parent cannot update.
 */
const VIOLATING_CASES: readonly Case[] = [
  {
    name: 'a bare prop',
    props: 'company',
    body: 'const [value, setValue] = useState(company);',
    why: 'the minimal case',
  },
  {
    name: 'a prop behind a `||` fallback',
    props: 'company',
    body: "const [value, setValue] = useState(company || '');",
    why: 'the exact shape WIC-1612 deleted from FilterPanel.tsx',
  },
  {
    name: 'a prop behind a `??` fallback',
    props: 'company',
    body: "const [value, setValue] = useState(company ?? '');",
    why: 'the nullish spelling of the same thing',
  },
  {
    name: 'an optional-chained property of a prop',
    props: 'context',
    body: "const [value, setValue] = useState(context?.company || '');",
    why: 'OutreachComposer.tsx:56 before WIC-1583 renamed the prop',
  },
  {
    name: 'a prop with a default in the destructure',
    props: "company = ''",
    body: 'const [value, setValue] = useState(company);',
    why: 'a parameter default does not make the copy safe',
  },
  {
    name: 'a nested-destructured prop',
    props: 'context: { company }',
    body: 'const [value, setValue] = useState(company);',
    why: 'the binding is nested; the root prop is still ordinary',
  },
  {
    name: 'a renamed prop',
    props: 'company: co',
    body: 'const [value, setValue] = useState(co);',
    why: 'renaming at the destructure must not launder the prop',
  },
  {
    name: 'a lazy initialiser',
    props: 'company',
    body: 'const [value, setValue] = useState(() => company);',
    why: '`useState(() => x)` has identical mount-only semantics to `useState(x)`',
  },
  {
    name: 'a template literal built from a prop',
    props: 'company',
    body: 'const [value, setValue] = useState(`${company} (draft)`);',
    why: 'a derived string is still a mount-time snapshot of the prop',
  },
  {
    name: 'a rest prop',
    props: '...rest',
    body: 'const [value, setValue] = useState(rest.company);',
    why: 'rest bindings are props too',
  },
  {
    name: 'a ternary over a prop',
    props: 'company, fallback',
    body: 'const [value, setValue] = useState(company ? company : fallback);',
    why: 'not a boolean predicate — the VALUE is a prop, only the test is',
  },
];

/**
 * THE WIC-1583 EXEMPTION. A prop named `initial*` declares the mount-only contract in the
 * name, which is the decision `main` already made in `OutreachComposer.tsx:14-23` rather
 * than a judgement this rule re-litigates.
 *
 * Each case carries its differential control: the identical body with the prop RENAMED to
 * an ordinary name must flag.
 */
const NAMING_EXEMPTION_CASES: readonly (Case & { readonly controlProps: string })[] = [
  {
    name: 'a prop named exactly `initial`',
    props: 'initial',
    controlProps: 'ordinary',
    body: 'const [value, setValue] = useState(THE_PROP);',
    why: 'the boundary case of the pattern',
  },
  {
    name: 'a prop named `initialContext`',
    props: 'initialContext',
    controlProps: 'ordinaryContext',
    body: "const [value, setValue] = useState(THE_PROP?.company || '');",
    why: 'OutreachComposer.tsx:56-58 as it stands on main today',
  },
  {
    name: 'a prop named `initialValue`, lazily initialised',
    props: 'initialValue',
    controlProps: 'ordinaryValue',
    body: 'const [value, setValue] = useState(() => THE_PROP);',
    why: 'the exemption must survive the lazy spelling',
  },
];

let probeEslint: ESLint;

describe('no-usestate-from-prop', () => {
  beforeAll(() => {
    // One instance across every case: constructing it loads and resolves
    // eslint.config.js, which is the slow part.
    eslint = new ESLint();
    probeEslint = eslint;
  });

  describe('the rule is wired up and reporting (WIC-1903)', () => {
    it('is enabled as an error for the probe path', async () => {
      const config = await probeEslint.calculateConfigForFile(PROBE_PATH);
      const setting = config.rules?.[RULE_ID];

      // ESLint normalises severity, so an enabled rule always arrives as an array whose
      // first element is 2. This separates "the rule is off / out of scope" from "the rule
      // is on but reports nothing" when the positive control below goes red.
      expect(
        Array.isArray(setting) && setting[0] === 2,
        `${RULE_ID} should be enabled as an error for ${PROBE_PATH}; got ${JSON.stringify(setting)}`
      ).toBe(true);
    }, 60_000);

    it('is enabled as an error for a .ts path too', async () => {
      // The config block is `src/**\/*.{ts,tsx}`, deliberately wider than the caps rule's
      // `tsx`. Pin it, or a silent narrowing to `tsx` would be invisible.
      const config = await probeEslint.calculateConfigForFile('src/hooks/__probe__.ts');
      const setting = config.rules?.[RULE_ID];

      expect(Array.isArray(setting) && setting[0] === 2).toBe(true);
    }, 60_000);

    it('is enabled as an error for a .test.tsx path (test files are in scope on purpose)', async () => {
      // Stated in eslint.config.js rather than left implicit: a test-helper component is
      // exactly the shape this rule reads, so excluding tests would put the rule's own
      // blind spot in the one place nobody checks.
      const config = await probeEslint.calculateConfigForFile('src/hooks/__probe__.test.tsx');
      const setting = config.rules?.[RULE_ID];

      expect(Array.isArray(setting) && setting[0] === 2).toBe(true);
    }, 60_000);

    it('reports a useState seeded from a prop', async () => {
      // THE positive control. This is the case a no-op'd `context.report(...)` kills, and
      // the only assertion in the repo that does — see the file header. Verified by
      // actually no-op'ing the report under WIC-1618: this test goes red, `npm run lint`
      // stays green.
      const messages = await lintComponent('company', 'const [v, setV] = useState(company);');

      expect(
        messages.length,
        'the rule reported nothing on a known-violating snippet: its reporting path is dead'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('names the state variable and the offending prop in the report', async () => {
      // The message is what a developer acts on, and it is the only place the suggested
      // remedy appears. Pin both substitutions.
      const [message] = await lintComponent(
        'company',
        'const [draft, setDraft] = useState(company);'
      );

      expect(message.message).toContain('seeds `draft`');
      expect(message.message).toContain('the `company` prop');
      // The remedy must point at the repo's own convention, and must warn off the fix
      // `react-hooks/set-state-in-effect` rejects (WIC-1612).
      expect(message.message).toContain('initialCompany');
      expect(message.message).toContain('set-state-in-effect');
    }, 60_000);
  });

  describe('copying a prop into state flags', () => {
    it.each(VIOLATING_CASES)(
      'flags: $name',
      async ({ props, body }) => {
        const messages = await lintComponent(props, body);
        expect(messages.length, `expected a finding for: ${props} / ${body}`).toBeGreaterThan(0);
      },
      60_000
    );

    it('flags an arrow component too, not only a function declaration', async () => {
      // `CatalogBrowseTable.tsx:35` proves the arrow shape exists in this tree (the card
      // for this work claimed zero, measured with a line-anchored grep that misses a
      // nested one). Handling it is therefore measured, not speculative.
      const source =
        "import { useState } from 'react';\n" +
        'export const Probe = ({ company }: never) => {\n' +
        '  const [value, setValue] = useState(company);\n' +
        '  return null;\n' +
        '};\n';
      const messages = await lintSource(source);

      expect(messages.length, 'the arrow-component shape must be handled').toBeGreaterThan(0);
    }, 60_000);
  });

  describe('the WIC-1583 `initial*` naming convention exempts (and only it)', () => {
    it.each(NAMING_EXEMPTION_CASES)(
      'does not flag: $name',
      async ({ props, controlProps, body }) => {
        const messages = await lintComponent(props, body.replace(/THE_PROP/g, props));
        expect(
          messages.map((m) => m.message),
          `unexpected finding for the exempt shape: ${props}`
        ).toEqual([]);

        // The differential control, and the reason the assertion above is not vacuous:
        // the SAME body with an ordinary prop name MUST flag. If the rule were dead, this
        // would go red and the "0" above would be exposed as meaningless.
        const controlMessages = await lintComponent(
          controlProps,
          body.replace(/THE_PROP/g, controlProps)
        );
        expect(
          controlMessages.length,
          `control failed, so the 0 above proves nothing: ${controlProps}`
        ).toBeGreaterThan(0);
      },
      60_000
    );

    it('does not exempt `initialize`, which merely starts with the same letters', async () => {
      // The pattern requires a word boundary after `initial`, so a prop that happens to
      // begin with those letters does not silently buy the exemption.
      const messages = await lintComponent(
        'initialize',
        'const [value, setValue] = useState(initialize);'
      );

      expect(messages.length, '`initialize` must not take the exemption').toBeGreaterThan(0);
    }, 60_000);

    it('does not exempt a mixed initialiser that also reads an ordinary prop', async () => {
      // One exempt prop must not carry an ordinary one along: the ordinary prop's updates
      // are still dropped.
      const messages = await lintComponent(
        'initialContext, company',
        'const [value, setValue] = useState(initialContext?.company || company);'
      );

      expect(
        messages.length,
        'a mixed initialiser still drops the ordinary prop and must flag'
      ).toBeGreaterThan(0);
    }, 60_000);
  });

  describe('the documented KNOWN GAPS are still open, and pinned', () => {
    it('does not see a boolean-coercion seed (`!!prop`) — the deliberate narrowing', async () => {
      // NOT an oversight. This is `OutreachComposer.tsx:59` (`useState(!!fitAnalysisId)`)
      // and it is the substance of WIC-1618's design question. The state is not a copy of
      // the prop but a user-owned boolean whose DEFAULT was conditioned on it, so "the
      // prop and the state have diverged" has no reading. See the rule's KNOWN GAPS.
      const messages = await lintComponent(
        'fitAnalysisId',
        'const [use, setUse] = useState(!!fitAnalysisId);'
      );
      expect(
        messages.length,
        'this gap has been closed — good, but update the rule KNOWN GAPS and OutreachComposer.tsx:59'
      ).toBe(0);

      // Differential control: the SAME prop, copied rather than coerced, must flag.
      const controlMessages = await lintComponent(
        'fitAnalysisId',
        'const [use, setUse] = useState(fitAnalysisId);'
      );
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not see a comparison seed (`prop === 0`)', async () => {
      // `hooks/useRouteFocusHandoff.test.tsx:55` (`useState(readyAfterMs === 0)`).
      const messages = await lintComponent(
        'readyAfterMs',
        'const [ready, setReady] = useState(readyAfterMs === 0);'
      );
      expect(messages.length).toBe(0);

      const controlMessages = await lintComponent(
        'readyAfterMs',
        'const [ready, setReady] = useState(readyAfterMs);'
      );
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not see a `Boolean(prop)` seed', async () => {
      const messages = await lintComponent(
        'company',
        'const [has, setHas] = useState(Boolean(company));'
      );
      expect(messages.length).toBe(0);

      const controlMessages = await lintComponent(
        'company',
        'const [has, setHas] = useState(company);'
      );
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not follow a prop laundered through an intermediate local', async () => {
      // The rule reads references inside the initialiser expression only, so one
      // assignment defeats it. Pinned so that closing the gap is a deliberate act.
      const messages = await lintComponent(
        'company',
        'const seed = company;\n  const [value, setValue] = useState(seed);'
      );
      expect(messages.length).toBe(0);

      const controlMessages = await lintComponent(
        'company',
        'const [value, setValue] = useState(company);'
      );
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not see a component wrapped in memo()', async () => {
      // Zero instances in `src/**` today, so this is a boundary the rule declines to
      // handle rather than a shape it gets wrong. The day someone adds a memo component,
      // this test is what makes the gap visible instead of silent.
      const source =
        "import { useState, memo } from 'react';\n" +
        'export const Probe = memo(({ company }: never) => {\n' +
        '  const [value, setValue] = useState(company);\n' +
        '  return null;\n' +
        '});\n';
      const messages = await lintSource(source);
      expect(messages.length, 'memo() is now handled — good, but update the rule KNOWN GAPS').toBe(
        0
      );

      // Control: the same body unwrapped MUST flag, or the 0 above proves nothing.
      const controlSource =
        "import { useState } from 'react';\n" +
        'export const Probe = ({ company }: never) => {\n' +
        '  const [value, setValue] = useState(company);\n' +
        '  return null;\n' +
        '};\n';
      const controlMessages = await lintSource(controlSource);
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not read a hook with POSITIONAL params', async () => {
      // `useDebounce(value, delay)` seeds `useState(value)` at useDebounce.ts:12 and is
      // CORRECT — it resyncs in an effect, which is the point of a debounce. The correct
      // and incorrect uses of the positional shape are indistinguishable to this rule, so
      // it does not look at them.
      const source =
        "import { useState } from 'react';\n" +
        'export function useProbe(value: never) {\n' +
        '  const [v, setV] = useState(value);\n' +
        '  return v;\n' +
        '}\n';
      const messages = await lintSource(source);
      expect(messages.length).toBe(0);

      const controlMessages = await lintComponent('value', 'const [v, setV] = useState(value);');
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);
  });

  describe('correct code stays green', () => {
    it('does not flag state that never touches a prop', async () => {
      const messages = await lintComponent('company', "const [value, setValue] = useState('');");
      expect(messages.map((m) => m.message)).toEqual([]);
    }, 60_000);

    it('does not flag a local that merely SHADOWS a prop name', async () => {
      // Resolution goes through scope analysis, not name matching. A local binding that
      // shadows a prop resolves to its own variable, so this must stay green — a
      // name-matching implementation would report it.
      const source =
        "import { useState } from 'react';\n" +
        'export function Probe({ company }: never) {\n' +
        '  console.log(company);\n' +
        '  return function Inner() {\n' +
        "    const company = 'local';\n" +
        '    const [value, setValue] = useState(company);\n' +
        '    return value;\n' +
        '  };\n' +
        '}\n';
      const messages = await lintSource(source);
      expect(
        messages.map((m) => m.message),
        'a shadowing local is not a prop'
      ).toEqual([]);
    }, 60_000);

    it('does not flag a prop read during render rather than copied into state', async () => {
      // The prescribed remedy must itself be green, or the rule would have no exit.
      const messages = await lintComponent(
        'company',
        'const label = company.toUpperCase();\n  const [value, setValue] = useState(0);'
      );
      expect(messages.map((m) => m.message)).toEqual([]);
    }, 60_000);
  });
});
