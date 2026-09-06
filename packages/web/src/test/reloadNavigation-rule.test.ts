import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

/**
 * Behaviour tests for the `local/no-reload-navigation` rule (WIC-1097).
 *
 * WHY THIS FILE IS THE WHOLE DELIVERABLE, not a companion to it.
 *
 * The rule lands at ZERO findings on `main` by design — the change that adds it also fixes
 * the single surviving site (`pages/ResumeManager.tsx:164`). That is exactly the failure
 * mode WIC-1903 measured in this repo's first local rule: no-op the single
 * `context.report(...)` in `no-literal-caps-jsx-text` and `caps-baseline.test.ts` was still
 * `2 passed`, `npm run lint` still green. A rule that reported NOTHING AT ALL and a working
 * one were indistinguishable.
 *
 * So every assertion here is TREE-STATE-INDEPENDENT: it lints synthetic snippets through
 * the real resolved config, which also exercises the wiring — the file scope
 * (`src/**\/*.{ts,tsx}`), the plugin registration and the `error` severity are all
 * measured, not re-declared. A test asserting "the tree has no `location` writes" would
 * pass just as well with the rule file deleted.
 *
 * READ THIS BEFORE ADDING A "must not flag" CASE. Every negative case below carries a
 * differential control — the SAME shape with the exempting feature removed, which MUST
 * flag. Without the pairing, an assertion of "0 findings" is satisfied by a dead rule
 * rather than by the exemption under test.
 *
 * ⚠️ WHAT THE SCOPE ANALYSIS ACTUALLY BUYS — this docstring got it wrong first time round.
 * It claimed the tree's 22 `location.pathname` reads were the reason for scope analysis,
 * because "a name-matching implementation would report all of them". Measured under
 * WIC-2173: force `isUnresolvedGlobal` to `return true` and `npm run lint` is rc=0 with ZERO
 * findings. The rule visits only `AssignmentExpression` and `CallExpression`, so a read
 * never reaches the resolution step at all — those 22 sites are excluded by reads-not-writes,
 * under any resolution strategy.
 *
 * ⚠️ 22, NOT 35. `git grep -o 'location\.pathname' -- packages/web/src` returns 35 and an
 * earlier pass of this correction shipped that raw total as a read count. It is not one: it
 * includes THIS FILE's own write fixtures, which are precisely the sites the rule flags, and
 * prose lines including the false sentence being corrected. 22 genuine reads across 11 files,
 * same on `main` and on this branch.
 *
 * So the `useLocation()` cases below are pinning the SUITE's contract, not a live tree
 * hazard, and that is worth saying plainly. The case that genuinely discriminates the two
 * implementations on realistic source is `a local string named location, with .replace()
 * called on it` — String.replace, an everyday idiom, which a name-matching rule flags as
 * navigation. It is asserted below with the mutant direction spelled out.
 */

const RULE_ID = 'local/no-reload-navigation';

// A path the `src/**\/*.{ts,tsx}` config block matches. The file does not exist on disk;
// `lintText` only uses the path to resolve which config applies.
const PROBE_PATH = 'src/pages/__reload_probe__.tsx';

let eslint: ESLint;

/** Lint a whole module source through the real config and return this rule's messages. */
async function lintSource(source: string, filePath: string = PROBE_PATH) {
  const results = await eslint.lintText(source, { filePath });

  // Fail loudly rather than silently returning zero messages. A snippet that does not
  // parse, or a path ESLint declines to lint, would otherwise make every "must not flag"
  // case below pass for the wrong reason.
  expect(results.length, `ESLint linted no file at all for ${filePath}`).toBeGreaterThan(0);
  const fatal = results.flatMap((r) => r.messages).filter((m) => m.fatal);
  expect(
    fatal.map((m) => m.message),
    `snippet failed to parse: ${source}`
  ).toEqual([]);

  return results.flatMap((r) => r.messages).filter((m) => m.ruleId === RULE_ID);
}

/** Wrap statements in a component body — the shape every page in `src/pages` uses. */
function component(body: string): string {
  return `export function Probe() {\n  ${body}\n  return null;\n}\n`;
}

/** Lint one component body through the real config. */
async function lintBody(body: string) {
  return lintSource(component(body));
}

type Case = {
  readonly name: string;
  readonly body: string;
  readonly why: string;
};

/** Shapes that MUST flag. Each performs a document navigation the router could do in place. */
const VIOLATING_CASES: readonly Case[] = [
  {
    name: '`window.location.href = ...`',
    body: "window.location.href = '/resumes/upload';",
    why: 'the exact shape WIC-1097 deleted from ResumeManager.tsx:164',
  },
  {
    name: 'a bare `location.href = ...`',
    body: "location.href = '/resumes/upload';",
    why: 'the same write without the `window.` prefix; `location` is the DOM global here',
  },
  {
    name: '`window.location.assign(...)`',
    body: "window.location.assign('/resumes/upload');",
    why: 'the method spelling of the same navigation',
  },
  {
    name: '`window.location.replace(...)`',
    body: "window.location.replace('/resumes/upload');",
    why: 'replace() navigates too — it only differs in history handling',
  },
  {
    name: 'a bare `location.assign(...)`',
    body: "location.assign('/resumes/upload');",
    why: 'the unprefixed method form',
  },
  {
    name: '`window.location = ...` (assigning the object itself)',
    body: "window.location = '/resumes/upload';",
    why: 'the legacy spelling; the browser coerces it to a href write',
  },
  {
    name: '`window.location.pathname = ...`',
    body: "window.location.pathname = '/resumes/upload';",
    why: 'a pathname write navigates exactly as href does',
  },
  {
    name: '`window.location.search = ...`',
    body: "window.location.search = '?tab=all';",
    why: 'a query-string write reloads the document — the class useRouteFocusHandoff avoids',
  },
  {
    name: '`window.location.hash = ...`',
    body: "window.location.hash = '#section';",
    why: 'in scope for consistency; the router owns the hash in a SPA',
  },
  {
    name: '`globalThis.location.href = ...`',
    body: "globalThis.location.href = '/resumes/upload';",
    why: 'globalThis is the same object by another name',
  },
  {
    name: '`self.location.href = ...`',
    body: "self.location.href = '/resumes/upload';",
    why: 'self is the same object again',
  },
  {
    name: '`document.location.href = ...`',
    body: "document.location.href = '/resumes/upload';",
    why: 'document.location is a documented alias for window.location — the same object, and a commoner spelling than globalThis or self. Unlisted until WIC-2173.',
  },
  {
    name: '`document.location.assign(...)`',
    body: "document.location.assign('/resumes/upload');",
    why: 'the method spelling through the document alias',
  },
  {
    name: '`document.location = ...` (assigning the object itself)',
    body: "document.location = '/resumes/upload';",
    why: 'the legacy spelling through the document alias',
  },
  {
    name: 'an assignment inside a JSX handler',
    body: "return <button onClick={() => (window.location.href = '/x')}>Go</button>;",
    why: 'the authored shape — an arrow in an onAction/onClick prop, as ResumeManager had it',
  },
  {
    name: 'a non-literal destination',
    body: 'window.location.href = target;',
    why: 'a computed target is still a document navigation, and is the case most worth catching',
  },
  {
    name: 'a template-literal destination',
    body: 'window.location.href = `/resumes/${id}`;',
    why: 'interpolation does not change the navigation class',
  },
];

describe('no-reload-navigation', () => {
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
      // first element is 2. This separates "the rule is off / out of scope" from "the rule
      // is on but reports nothing" when the positive control below goes red.
      expect(
        Array.isArray(setting) && setting[0] === 2,
        `${RULE_ID} should be enabled as an error for ${PROBE_PATH}; got ${JSON.stringify(setting)}`
      ).toBe(true);
    }, 60_000);

    it('is enabled as an error for a .ts path too', async () => {
      // The config block is `src/**\/*.{ts,tsx}`, deliberately wider than the caps rule's
      // `tsx`. A `window.location` write is just as reachable from a service or a hook —
      // an auth redirect would most naturally be written in `services/`. Pin the width, or
      // a silent narrowing to `tsx` would be invisible.
      const config = await eslint.calculateConfigForFile('src/services/__probe__.ts');
      const setting = config.rules?.[RULE_ID];

      expect(Array.isArray(setting) && setting[0] === 2).toBe(true);
    }, 60_000);

    it('reports a `window.location.href` write', async () => {
      // THE positive control. This is the case a no-op'd `context.report(...)` kills, and
      // the assertion that makes every "0 findings" below mean something.
      const messages = await lintBody("window.location.href = '/x';");

      expect(
        messages.length,
        'the rule reported nothing on a known-violating snippet: its reporting path is dead'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('names the offending expression and a copy-pasteable remedy in the report', async () => {
      // The message is what a developer acts on, and it is the only place the remedy
      // appears. Pin both substitutions.
      const [message] = await lintBody("window.location.href = '/resumes/upload';");

      expect(message.message).toContain('window.location.href');
      expect(message.message).toContain("navigate('/resumes/upload')");
      // The off-site escape hatch must be discoverable from the message, or the first
      // developer who genuinely needs it will delete the rule instead.
      expect(message.message).toContain('eslint-disable-next-line');
    }, 60_000);

    it('does NOT tell a `location.hash` write that it reloads the document (WIC-2173)', async () => {
      // `hash` is in NAVIGATING_PROPERTIES and stays there — a hash write does set the URL
      // behind the router's back. But it does not reload: it fires `hashchange` and scrolls,
      // and the bundle, the document and the React Query cache all survive. The shared
      // message asserted the opposite, in permanent text, so `hash` now has its own.
      const [hashMessage] = await lintBody("window.location.hash = '#section';");
      expect(hashMessage, 'the hash write must still be reported').toBeDefined();
      expect(
        hashMessage.message,
        'a hash write does not reload the document; the message must not claim it does'
      ).not.toContain('reloads the whole document');
      expect(hashMessage.message).toContain('hashchange');
      expect(hashMessage.message).toContain("navigate('#section')");

      // Differential control, and the point of the pairing: every OTHER property in the set
      // does reload, and must keep saying so. Without this, deleting the claim everywhere
      // would satisfy the assertion above.
      const [hrefMessage] = await lintBody("window.location.href = '/x';");
      expect(
        hrefMessage.message,
        'the reload claim is correct for href and must survive the hash correction'
      ).toContain('reloads the whole document');
    }, 60_000);
  });

  describe('document navigation flags', () => {
    it.each(VIOLATING_CASES)(
      'flags: $name',
      async ({ body }) => {
        const messages = await lintBody(body);
        expect(messages.length, `expected a finding for: ${body}`).toBeGreaterThan(0);
      },
      60_000
    );
  });

  describe('a local binding named `location` is not the DOM global', () => {
    // This tree reads `location.pathname` in 22 places across 11 files — TopNavigation,
    // BottomTabBar, MobileNavigation, ResumeManagerTabs, RouteTitle, NotFound,
    // useRouteFocusHandoff and several test harnesses. Every one is correct, but NONE of them
    // is what the scope analysis protects: the rule never visits a read position, so a
    // name-matching build of it leaves all 22 alone too (measured, WIC-2173). What scope
    // analysis separates is a WRITE, or an `assign`/`replace` CALL, on a local named
    // `location` — the cases below.
    //
    // 22 is hand-classified, not `git grep -c`: the raw occurrence total is 35, and the
    // difference is this file's own write fixtures plus prose. See the file docstring.

    it('does not flag a read of a `useLocation()` result', async () => {
      const source =
        "import { useLocation } from 'react-router-dom';\n" +
        'export function Probe() {\n' +
        '  const location = useLocation();\n' +
        "  return location.pathname === '/' ? null : null;\n" +
        '}\n';
      const messages = await lintSource(source);

      expect(
        messages.map((m) => m.message),
        'the router location is a local binding, not the DOM global'
      ).toEqual([]);
    }, 60_000);

    it('does not flag a WRITE to a `useLocation()`-shaped local binding', async () => {
      // The sharpest version of the case: the write shape the rule looks for, on a
      // `location` that is demonstrably a local. Scope analysis is the only thing that
      // separates this from the violating case, so it is asserted directly.
      const source =
        "import { useLocation } from 'react-router-dom';\n" +
        'export function Probe() {\n' +
        '  const location = useLocation();\n' +
        "  location.pathname = '/x';\n" +
        '  return null;\n' +
        '}\n';
      const messages = await lintSource(source);
      expect(
        messages.map((m) => m.message),
        'a local binding named `location` is not `window.location`'
      ).toEqual([]);

      // The differential control, and the reason the 0 above is not vacuous: the SAME
      // write with the local declaration removed resolves to the global and MUST flag.
      const controlSource =
        'export function Probe() {\n' +
        "  location.pathname = '/x';\n" +
        '  return null;\n' +
        '}\n';
      const controlMessages = await lintSource(controlSource);
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not flag a `location` parameter', async () => {
      const source =
        'export function probe(location: { href: string }) {\n' +
        "  location.href = '/x';\n" +
        '  return location;\n' +
        '}\n';
      const messages = await lintSource(source);
      expect(messages.map((m) => m.message)).toEqual([]);

      const controlMessages = await lintSource(
        'export function probe() {\n' + "  location.href = '/x';\n" + '}\n'
      );
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not flag an imported binding named `location`', async () => {
      const source =
        "import { location } from './fixtures';\n" +
        'export function Probe() {\n' +
        "  location.href = '/x';\n" +
        '  return null;\n' +
        '}\n';
      const messages = await lintSource(source);
      expect(messages.map((m) => m.message)).toEqual([]);

      const controlMessages = await lintSource(
        'export function Probe() {\n' + "  location.href = '/x';\n" + '  return null;\n' + '}\n'
      );
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not flag `.replace()` on a local STRING named `location` (the discriminating case)', async () => {
      // ⭐ THE CASE THAT EARNS THE SCOPE ANALYSIS, and the only one here that a
      // name-matching rule gets wrong on realistic source.
      //
      // `String.prototype.replace` and `Location.prototype.replace` share a name, and
      // `replace` is in NAVIGATING_METHODS. So a local string that happens to be called
      // `location` — trimming a leading slash off a path, an everyday idiom this tree uses
      // the shape of in a dozen files — reaches the CallExpression visitor with
      // `callee.property.name === 'replace'`. ONLY the scope resolution stops it: the
      // binding has a definition, so `isWindowLocation` rejects it.
      //
      // Measured both directions under WIC-2173, in a `src/services/*.ts` path:
      //   shipped rule            -> not flagged (asserted here)
      //   `isUnresolvedGlobal` forced to `return true` -> FLAGGED
      // That is a genuine false positive the shipped rule avoids, unlike the 22
      // `location.pathname` reads, which a name-matching rule leaves alone as well.
      const source =
        'export function stripLeadingSlash(raw: string) {\n' +
        '  const location = raw;\n' +
        "  return location.replace(/^\\//, '');\n" +
        '}\n';
      const messages = await lintSource(source, 'src/services/__reload_probe__.ts');
      expect(
        messages.map((m) => m.message),
        'String.replace on a local is not Location.replace'
      ).toEqual([]);

      // The differential control, same convention as every other negative case here: the
      // SAME call with the local declaration removed resolves to the DOM global and MUST
      // flag. Without it the 0 above is satisfied by a dead rule.
      const controlSource =
        'export function stripLeadingSlash() {\n' + "  location.replace('/x');\n" + '}\n';
      const controlMessages = await lintSource(controlSource, 'src/services/__reload_probe__.ts');
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not flag a router location reached through `router.state.location`', async () => {
      // `WizardContainer.discardGuard.test.tsx` asserts on exactly this shape 5 times.
      const messages = await lintBody('const p = router.state.location.pathname; void p;');
      expect(messages.map((m) => m.message)).toEqual([]);
    }, 60_000);
  });

  describe('reads of the real `window.location` are not navigation', () => {
    it('does not flag reading `window.location.href`', async () => {
      const messages = await lintBody('const url = window.location.href; void url;');
      expect(
        messages.map((m) => m.message),
        'a read navigates nowhere'
      ).toEqual([]);

      // Control: the same property, written rather than read, MUST flag.
      const controlMessages = await lintBody("window.location.href = '/x';");
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not flag comparing `window.location.pathname`', async () => {
      const messages = await lintBody(
        "const atRoot = window.location.pathname === '/'; void atRoot;"
      );
      expect(messages.map((m) => m.message)).toEqual([]);

      const controlMessages = await lintBody("window.location.pathname = '/';");
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not flag reading `window.location.origin`', async () => {
      // `origin` is not in NAVIGATING_PROPERTIES and is read-only in the DOM anyway; it is
      // the natural way to build an absolute URL for an API call.
      const messages = await lintBody('const o = window.location.origin; void o;');
      expect(messages.map((m) => m.message)).toEqual([]);
    }, 60_000);
  });

  describe('the documented KNOWN GAPS are still open, and pinned', () => {
    it('does not flag `location.reload()`', async () => {
      // NOT an oversight. A reload re-fetches the URL you are already on; it changes no
      // path and there is no router call that does it, so "use navigate() instead" has no
      // reading. See the rule's KNOWN GAPS.
      const messages = await lintBody('window.location.reload();');
      expect(
        messages.length,
        'this gap has been closed — good, but update the rule KNOWN GAPS'
      ).toBe(0);

      // Differential control: the same object, navigated rather than reloaded, must flag.
      const controlMessages = await lintBody("window.location.replace('/x');");
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not follow `location` through an alias', async () => {
      // The rule reads the member expression at the assignment only, so one indirection
      // defeats it — exactly as it defeats `no-usestate-from-prop`. Pinned so that closing
      // the gap is a deliberate act.
      const messages = await lintBody("const l = window.location;\n  l.href = '/x';");
      expect(
        messages.length,
        'this gap has been closed — good, but update the rule KNOWN GAPS'
      ).toBe(0);

      const controlMessages = await lintBody("window.location.href = '/x';");
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not see a computed member access', async () => {
      const messages = await lintBody("window['location'].href = '/x';");
      expect(
        messages.length,
        'this gap has been closed — good, but update the rule KNOWN GAPS'
      ).toBe(0);

      const controlMessages = await lintBody("window.location.href = '/x';");
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not see a CHAINED object expression (`window.document` / `window.top`)', async () => {
      // WIC-2173 accepted bare `document.location` (see VIOLATING_CASES) but the object list
      // is matched ONE LEVEL DEEP — a bare identifier. `window.document.location` is
      // therefore the alias gap in another spelling, and `window.top.location` is a
      // different document entirely, which no router call can reach. Pinned so that closing
      // either is a deliberate act; zero sites on `main` for both.
      const chained = await lintBody("window.document.location.href = '/x';");
      expect(
        chained.length,
        'this gap has been closed — good, but update the rule KNOWN GAPS'
      ).toBe(0);

      const topFrame = await lintBody("window.top.location.href = '/x';");
      expect(
        topFrame.length,
        'this gap has been closed — good, but update the rule KNOWN GAPS'
      ).toBe(0);

      // Control: the unchained spelling of the very same navigation MUST flag, or the two
      // zeros above are satisfied by a rule that stopped reading `document` at all.
      const controlMessages = await lintBody("document.location.href = '/x';");
      expect(
        controlMessages.length,
        'control failed, so the 0s above prove nothing'
      ).toBeGreaterThan(0);
    }, 60_000);

    it('does not flag a LOCAL binding named `document` (scope analysis covers the new object)', async () => {
      // Adding `document` to the object list widens the rule's reach, so it also widens what
      // the scope analysis has to hold back. A local named `document` is realistic in this
      // tree — it is a resume/document app. Same differential convention as the `location`
      // locals above.
      const source =
        'export function probe(document: { location: string }) {\n' +
        "  document.location = '/x';\n" +
        '  return document;\n' +
        '}\n';
      const messages = await lintSource(source);
      expect(
        messages.map((m) => m.message),
        'a local binding named `document` is not the DOM document'
      ).toEqual([]);

      const controlMessages = await lintBody("document.location = '/x';");
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);
  });

  describe('the prescribed remedy is itself green', () => {
    it('does not flag `navigate(...)`', async () => {
      // The rule must have an exit, or it would have no shippable fix.
      const source =
        "import { useNavigate } from 'react-router-dom';\n" +
        'export function Probe() {\n' +
        '  const navigate = useNavigate();\n' +
        "  return <button onClick={() => navigate('/resumes/upload')}>Go</button>;\n" +
        '}\n';
      const messages = await lintSource(source);
      expect(messages.map((m) => m.message)).toEqual([]);
    }, 60_000);

    it('does not flag a `<Link to=...>`', async () => {
      const source =
        "import { Link } from 'react-router-dom';\n" +
        'export function Probe() {\n' +
        '  return <Link to="/resumes/upload">Go</Link>;\n' +
        '}\n';
      const messages = await lintSource(source);
      expect(messages.map((m) => m.message)).toEqual([]);
    }, 60_000);

    it('is silenced by a justified disable directive, the off-site escape hatch', async () => {
      // Off-site navigation has no router equivalent, so the rule WILL flag it and the
      // exemption belongs at the site — the convention this config settled on for
      // `jsx-a11y/no-autofocus`. Assert the hatch actually works, or the message that
      // recommends it is advice the developer cannot take.
      const messages = await lintBody(
        '// eslint-disable-next-line local/no-reload-navigation -- off-site, no router equivalent\n' +
          "  window.location.href = 'https://example.com/checkout';"
      );
      expect(messages.map((m) => m.message)).toEqual([]);

      // Control: the identical line WITHOUT the directive must flag, or this proves
      // nothing about the directive.
      const controlMessages = await lintBody(
        "window.location.href = 'https://example.com/checkout';"
      );
      expect(
        controlMessages.length,
        'control failed, so the 0 above proves nothing'
      ).toBeGreaterThan(0);
    }, 60_000);
  });
});
