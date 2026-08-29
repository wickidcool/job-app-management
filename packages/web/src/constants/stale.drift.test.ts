import { describe, it, expect } from 'vitest';
import { DEFAULT_STALE_THRESHOLD_DAYS, STALE_THRESHOLD_OPTIONS } from './stale';
import API_STALE_SOURCE from '../../../api/src/services/stale.ts?raw';
import REPORTS_STALE_SOURCE from '../pages/ReportsStale.tsx?raw';

/**
 * WIC-1479. `packages/web` and `packages/api` share no compiled module, so the
 * client's copy of the stale threshold is a hand-mirror of the server's. A
 * hand-mirror with no test is precisely how this defect was born: the dashboard
 * card's 7 and the report's 14 were each individually reasonable and nothing
 * compared them.
 *
 * So compare them here, by reading the API source as text.
 *
 * The source arrives through Vite's `?raw` loader, the same mechanism
 * `route-integrity.test.ts` and `NotFound.test.tsx` use to read `App.tsx`.
 * `node:fs` is not an option: `packages/web`'s tsconfig carries
 * `types: ["vite/client"]` and no `@types/node`, so a `readFileSync` import is a
 * TS2307 in CI's typecheck step. `?raw` also fails loudly at collection time if
 * the path ever stops resolving, where a filesystem walk would have to invent
 * its own not-found error.
 */

/**
 * Reads a numeric constant out of the API source.
 *
 * Uses `matchAll` and asserts exactly one hit rather than `String.match`, which
 * returns only the first: a stale value left behind in a `// was: …` comment,
 * or a second declaration inside a block comment, would otherwise shadow the
 * real one and turn this guard into a vacuous pass.
 */
function readApiConstant(name: string): number {
  const declarations = [
    ...API_STALE_SOURCE.matchAll(new RegExp(`^export const ${name} = (\\d+);$`, 'gm')),
  ];
  expect(
    declarations.length,
    `expected exactly one \`export const ${name}\` in the API's stale.ts, found ${declarations.length}`
  ).toBe(1);
  return Number(declarations[0][1]);
}

describe('the client mirror of the stale definition tracks the API', () => {
  it('agrees on the default threshold', () => {
    expect(DEFAULT_STALE_THRESHOLD_DAYS).toBe(readApiConstant('DEFAULT_STALE_THRESHOLD_DAYS'));
  });

  it('offers only windows the API will accept', () => {
    const min = readApiConstant('MIN_STALE_THRESHOLD_DAYS');
    const max = readApiConstant('MAX_STALE_THRESHOLD_DAYS');
    for (const option of STALE_THRESHOLD_OPTIONS) {
      expect(option).toBeGreaterThanOrEqual(min);
      expect(option).toBeLessThanOrEqual(max);
    }
  });

  it('offers the default as a selectable option', () => {
    // Otherwise the report opens on a window its own selector cannot show,
    // and the control reads as though the user picked something they did not.
    expect([...STALE_THRESHOLD_OPTIONS]).toContain(DEFAULT_STALE_THRESHOLD_DAYS);
  });

  it('names the same statuses the API does', () => {
    // The client never filters by status itself — it relies on the server's
    // default. This asserts the server's default is still the specified pair,
    // so a widening there would surface here rather than silently changing
    // what the dashboard's link leads to.
    const declarations = [
      ...API_STALE_SOURCE.matchAll(/^export const STALE_STATUSES = (\[[^\]]*\])/gm),
    ];
    expect(declarations.length, 'expected exactly one STALE_STATUSES declaration').toBe(1);

    // Extract the quoted members rather than comparing the literal text.
    // Prettier reflows this array across lines once it grows, and a trailing
    // comma or line break is not a change in meaning — a guard that fails on
    // reformatting gets weakened by whoever hits it next.
    const members = [...declarations[0][1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(members).toEqual(['applied', 'phone_screen']);
  });
});

/**
 * The mirror above is only worth having if the surfaces actually read it.
 *
 * `ReportsStale`'s opening threshold is the one value on the client that has to
 * be right *before* any response arrives — the dashboard links here promising a
 * count computed at the server's default window, so the report must open on
 * that window. A `useState(14)` would agree with the constant today and drift
 * silently the day the API's default moves, which is precisely the shape of the
 * original defect. So assert provenance, not equality: read the page's source
 * and require the identifier.
 */
describe('the report reads the shared default rather than a literal', () => {
  const INITIAL_THRESHOLD = /useState<number>\(\s*([A-Za-z0-9_]+)\s*\)/g;

  it('initialises its threshold from DEFAULT_STALE_THRESHOLD_DAYS', () => {
    const initialisers = [...REPORTS_STALE_SOURCE.matchAll(INITIAL_THRESHOLD)];
    expect(initialisers, 'expected exactly one useState<number> in ReportsStale').toHaveLength(1);
    expect(initialisers[0][1]).toBe('DEFAULT_STALE_THRESHOLD_DAYS');
  });

  it('builds its selector from STALE_THRESHOLD_OPTIONS, not hand-written options', () => {
    expect(REPORTS_STALE_SOURCE).toContain('STALE_THRESHOLD_OPTIONS.map');
    // A leftover hardcoded `<option value={14}>` beside the mapped list would
    // render a duplicate and re-introduce a second source for the windows.
    expect([...REPORTS_STALE_SOURCE.matchAll(/<option value=\{\d+\}/g)]).toHaveLength(0);
  });

  it('the provenance guard fails on a literal initialiser', () => {
    // Negative control: a source-scraping assertion that stops matching is
    // indistinguishable from one that passes, so prove it can still fail.
    const literal = 'const [staleThreshold, setStaleThreshold] = useState<number>(14);';
    const hits = [...literal.matchAll(INITIAL_THRESHOLD)];
    expect(hits).toHaveLength(1);
    expect(hits[0][1]).not.toBe('DEFAULT_STALE_THRESHOLD_DAYS');
  });
});

describe('the drift guard can fail', () => {
  // Negative control. A text-scraping guard degrades to a vacuous pass the
  // moment its regex stops matching, and nothing about a green run says which
  // of the two it was.
  const parse = (source: string, name: string) => [
    ...source.matchAll(new RegExp(`^export const ${name} = (\\d+);$`, 'gm')),
  ];

  it('finds the declaration it claims to find', () => {
    expect(parse(API_STALE_SOURCE, 'DEFAULT_STALE_THRESHOLD_DAYS')).toHaveLength(1);
  });

  it('reports a mismatched value rather than passing', () => {
    const mutated = API_STALE_SOURCE.replace(
      /^export const DEFAULT_STALE_THRESHOLD_DAYS = \d+;$/m,
      'export const DEFAULT_STALE_THRESHOLD_DAYS = 7;'
    );
    expect(Number(parse(mutated, 'DEFAULT_STALE_THRESHOLD_DAYS')[0][1])).toBe(7);
    expect(DEFAULT_STALE_THRESHOLD_DAYS).not.toBe(7);
  });

  it('refuses to read a value that is shadowed by a second declaration', () => {
    // The `matchAll` + length check exists for exactly this shape.
    const shadowed = `${API_STALE_SOURCE}\nexport const DEFAULT_STALE_THRESHOLD_DAYS = 7;`;
    expect(parse(shadowed, 'DEFAULT_STALE_THRESHOLD_DAYS')).toHaveLength(2);
  });
});
