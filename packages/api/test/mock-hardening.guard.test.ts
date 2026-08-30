import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * WIC-1701 — a `vi.mock` factory that lists a module's exports by hand is an
 * **allowlist**. Anything it does not name comes back `undefined`, which is
 * harmless right up until a *different branch* adds an export to that module:
 * the merge then breaks with **zero textual conflict**, because the two sides
 * touched different files, and neither branch's own CI can see it.
 *
 * That is not hypothetical. Merging `main` @ `835ed33` into WIC-1499 / PR #143
 * took `onboarding.routes.test.ts` from 26 passed to 6 failed / 20 passed. The
 * factory named five exports of `onboarding.service.js`; the PR added a sixth,
 * `ONBOARDING_STEP_FLAG_PAIRS`, read inside a `.superRefine` that runs *while
 * the Zod schema is being built* — so `for...of undefined` threw at router
 * construction and every request 500'd, with no missing-mock error anywhere.
 *
 * This guard fails on a **newly added** hand-enumerated service mock, so the
 * class cannot regress the way the instance did.
 *
 * Scope is deliberately `src/services/*.js` only. `db/client.js` (mocked to a
 * bare `{ getDb }`) is total replacement *on purpose* — spreading the real
 * client would pull a live connection into unit tests — and is out of scope.
 */

const testDir = dirname(fileURLToPath(import.meta.url));

/**
 * This file is excluded because its positive-control fixture below contains a
 * literal hand-enumerated factory, which the scanner would otherwise flag.
 * Both directions are pinned: the exclusion must name exactly one file, and
 * that file must actually exist in the scanned tree (see the staleness test).
 */
const SELF = 'mock-hardening.guard.test.ts';

/** A `vi.mock` call site recovered from a test file. */
interface MockSite {
  file: string;
  line: number;
  specifier: string;
  factory: string;
}

function listTestFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(testDir);
  return out.sort();
}

/**
 * Recovers each `vi.mock(...)` call with its full factory text. Balanced-paren
 * matching rather than a single regex: the factories span many lines and
 * contain nested parens, so a lazy `.*?` would truncate them and silently
 * classify a hand-enumerated factory as safe.
 */
function findMockSites(file: string, source: string): MockSite[] {
  const sites: MockSite[] = [];
  const opener = /vi\.mock\(\s*(['"])(.*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(source)) !== null) {
    const open = source.indexOf('(', m.index);
    let depth = 0;
    let i = open;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')' && --depth === 0) break;
    }
    sites.push({
      file,
      line: source.slice(0, m.index).split('\n').length,
      specifier: m[2],
      factory: source.slice(open, i + 1),
    });
  }
  return sites;
}

const isServiceModule = (specifier: string) => specifier.includes('/services/');

/**
 * A factory is safe when it spreads the real module before overriding. Both
 * idioms in this codebase count: `importOriginal` (the vitest-native form) and
 * `vi.importActual` (used by `dialogue.routes.test.ts` to keep the real Zod
 * schemas). Recognising only the first would flag an already-correct site.
 */
const spreadsRealModule = (factory: string) =>
  /importOriginal|importActual/.test(factory) && factory.includes('...');

/** Marker for a site where total replacement is a deliberate choice. */
const DELIBERATE_MARKER = 'deliberate-total-mock:';

function precededByJustification(source: string, site: MockSite): boolean {
  const lines = source.split('\n');
  const previous = lines[site.line - 2] ?? '';
  return previous.includes(DELIBERATE_MARKER);
}

const files = listTestFiles();
const scanned = files.filter((f) => !f.endsWith(SELF));
const sources = new Map(scanned.map((f) => [f, readFileSync(f, 'utf8')]));
const allSites = scanned.flatMap((f) => findMockSites(f, sources.get(f)!));
const serviceSites = allSites.filter((s) => isServiceModule(s.specifier));

describe('WIC-1701: api test mocks must not hand-enumerate service exports', () => {
  /**
   * The WIC-1483 trap: an equality-pinned baseline pins *what* was found and
   * never *how much was read*. A walk that reads zero files, or a regex that
   * matches nothing, produces an empty violation list — indistinguishable from
   * a clean tree. These three assertions make "found nothing" fail loudly.
   */
  it('actually reads the test tree (walk is non-empty and complete)', () => {
    // Independent of the recursive walk: the scanner must not silently drop files.
    const topLevel = readdirSync(testDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.ts'))
      .map((e) => join(testDir, e.name));
    for (const f of topLevel) {
      expect(files, `walk missed ${relative(testDir, f)}`).toContain(f);
    }

    expect(files.length).toBeGreaterThanOrEqual(31);
    expect(scanned.length).toBe(files.length - 1);
    expect(sources.size).toBe(scanned.length);
    // Every scanned file was read as real, non-empty text.
    expect([...sources.values()].every((s) => s.length > 0)).toBe(true);
  });

  it('actually finds mock call sites (detector is not dead)', () => {
    expect(allSites.length).toBeGreaterThanOrEqual(90);
    expect(serviceSites.length).toBeGreaterThanOrEqual(80);
    // Factories are recovered whole, not truncated at the first nested paren.
    expect(serviceSites.every((s) => s.factory.endsWith(')'))).toBe(true);
  });

  /**
   * Positive control. Proves the classifier can still *detect* the defect,
   * independently of whether the real corpus happens to be clean — otherwise a
   * broken matcher and a hardened tree are the same green.
   */
  it('classifies a hand-enumerated factory as a violation (positive control)', () => {
    const fixture = [
      "vi.mock('../src/services/example.service.js', () => ({",
      '  doThing: vi.fn(),',
      '}));',
    ].join('\n');
    const [site] = findMockSites('fixture.ts', fixture);
    expect(site).toBeDefined();
    expect(isServiceModule(site.specifier)).toBe(true);
    expect(spreadsRealModule(site.factory)).toBe(false);
    expect(precededByJustification(fixture, site)).toBe(false);
  });

  /** Negative control: the prescribed fix must read as compliant. */
  it('classifies a spread factory as compliant (negative control)', () => {
    const fixture = [
      "vi.mock('../src/services/example.service.js', async (importOriginal) => ({",
      "  ...(await importOriginal<typeof import('../src/services/example.service.js')>()),",
      '  doThing: vi.fn(),',
      '}));',
    ].join('\n');
    const [site] = findMockSites('fixture.ts', fixture);
    expect(spreadsRealModule(site.factory)).toBe(true);
  });

  it('every service-module mock spreads the real module or justifies total replacement', () => {
    const violations = serviceSites
      .filter((s) => !spreadsRealModule(s.factory))
      .filter((s) => !precededByJustification(sources.get(s.file)!, s))
      .map((s) => `${relative(testDir, s.file)}:${s.line} → ${s.specifier}`);

    expect(
      violations,
      [
        'Hand-enumerated vi.mock factory for a service module.',
        'A factory that lists exports by hand breaks when another branch adds an export,',
        'with no textual conflict and no failing check on either branch (WIC-1499 / PR #143).',
        '',
        'Fix — spread the real module, then override:',
        "  vi.mock('../src/services/x.js', async (importOriginal) => ({",
        "    ...(await importOriginal<typeof import('../src/services/x.js')>()),",
        '    someFn: vi.fn(),',
        '  }));',
        '',
        `If total replacement is genuinely intended, put a "// ${DELIBERATE_MARKER} <reason>"`,
        'comment on the line directly above the vi.mock call.',
      ].join('\n')
    ).toEqual([]);
  });

  /**
   * Allowlist staleness, pinned in both directions. Without this, a
   * justification comment left behind after its `vi.mock` is deleted becomes a
   * permanent, invisible hole.
   */
  it('every justification comment still sits above a total-replacement mock', () => {
    const orphaned: string[] = [];
    for (const [file, source] of sources) {
      const lines = source.split('\n');
      lines.forEach((line, idx) => {
        if (!line.includes(DELIBERATE_MARKER)) return;
        const next = lines[idx + 1] ?? '';
        if (!next.includes('vi.mock(')) {
          orphaned.push(`${relative(testDir, file)}:${idx + 1} (no vi.mock on the next line)`);
        }
      });
    }
    expect(orphaned, 'Stale justification comment — delete it or restore its mock.').toEqual([]);
  });

  it('the self-exclusion names exactly one file, and that file exists', () => {
    const excluded = files.filter((f) => f.endsWith(SELF));
    expect(excluded).toHaveLength(1);
    expect(excluded[0]).toBe(fileURLToPath(import.meta.url));
  });
});
