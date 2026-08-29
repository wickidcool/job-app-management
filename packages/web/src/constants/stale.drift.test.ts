import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STALE_THRESHOLD_DAYS,
  STALE_STATUSES,
  STALE_THRESHOLD_OPTIONS,
  isStale,
} from './stale';
import API_STALE_SOURCE from '../../../api/src/services/stale.ts?raw';
import REPORTS_STALE_SOURCE from '../pages/ReportsStale.tsx?raw';
import APPLICATION_CARD_SOURCE from '../components/ApplicationCard.tsx?raw';
import APPLICATIONS_LIST_SOURCE from '../pages/ApplicationsList.tsx?raw';
import REPORTS_PIPELINE_SOURCE from '../pages/ReportsPipeline.tsx?raw';

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

    // And the client's own copy tracks it. Until the review of PR #222 the
    // client held no status list at all and this test could only restate the
    // server's; meanwhile `ApplicationsList` and `ApplicationCard` were each
    // applying "every active status" at 14 days, which is why a status set the
    // client never named was still a status set the client got wrong.
    expect([...STALE_STATUSES]).toEqual(members);
  });

  it('agrees with the API on which statuses can go stale', () => {
    // Behavioural, not textual: drive the client predicate over every status.
    const idle = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date('2026-03-01T00:00:00.000Z');
    const answers = (
      ['saved', 'applied', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn'] as const
    ).filter((status) => isStale({ status, updatedAt: idle }, { now }));
    expect(answers).toEqual(['applied', 'phone_screen']);
  });

  it('places the boundary at the same instant the API does', () => {
    // The two call sites used to compute `differenceInDays(startOfDay(now), …)
    // >= 14`, which rounds to whole calendar days and disagrees with the
    // server's instant comparison part-way through the boundary day. Pin the
    // instant, since that disagreement is a row appearing in one place and not
    // the other — the defect this card is about, one day wide.
    const now = new Date('2026-03-15T09:30:00.000Z');
    const justInside = new Date('2026-03-01T09:29:59.000Z');
    const justOutside = new Date('2026-03-01T09:30:01.000Z');
    expect(isStale({ status: 'applied', updatedAt: justInside }, { days: 14, now })).toBe(true);
    expect(isStale({ status: 'applied', updatedAt: justOutside }, { days: 14, now })).toBe(false);
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

/**
 * The web half of the tree-wide AC-N2a scan (its API counterpart lives in
 * `packages/api/test/stale.definition.test.ts`).
 *
 * This exists because the first pass of WIC-1479 fixed three definitions and
 * shipped with five. The two it missed — `ApplicationsList`'s "Stale (14+ days)"
 * pipeline tile and `ApplicationCard`'s "Stale" badge — agreed with the report
 * on the *threshold* and differed on the *status set*, so every guard aimed at
 * the number 7 or at the API's source walked straight past them. At 20 days an
 * `interview` row was badged stale on the list and absent from the report.
 *
 * What the scan detects, precisely: a value derived from a row's `updatedAt`
 * and then compared against a numeric literal. That is the shape of a
 * client-side staleness predicate, and it is the shape both missed surfaces had.
 * It deliberately does *not* fire on deriving elapsed days for display —
 * `QuickWins` renders "No update for N days" over a population the server
 * already selected, which is the sanctioned pattern, not a second definition.
 *
 * It tracks the *binding*, not the identifier name, so renaming
 * `daysSinceUpdate` does not slip past it. It does not claim to catch every
 * conceivable re-derivation; it catches this one, tree-wide, which is more than
 * the file-scoped guards it joins.
 */
describe('no file in packages/web holds a second definition (AC-N2a, tree-wide)', () => {
  // Project-root-relative so the keys are stable paths rather than a mix of
  // `./` and `../` that depends on where this test file happens to live.
  const MODULES = import.meta.glob('/src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  const DEFINITION = '/src/constants/stale.ts';

  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  const FILES = Object.keys(MODULES)
    .filter((path) => !/\.test\.tsx?$/.test(path))
    .sort();

  /**
   * Bindings derived — transitively — from a row's `updatedAt`, that are then
   * compared against a numeric literal somewhere in the same file.
   *
   * The taint is followed to a fixpoint rather than one hop, because one hop is
   * not enough: `ReportsPipeline`'s local helper wrote
   * `const updated = new Date(updatedAt)` and only then
   * `const daysSince = …updated.getTime()…`, so the binding that gets compared
   * never mentions `updatedAt` itself. A single-hop version of this guard ran
   * green on that file while the definition was live in it.
   */
  function elapsedComparisons(source: string): string[] {
    const code = stripComments(source);
    const assignments = [
      ...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*)/g),
    ].map((m) => [m[1], m[2]] as const);

    const tainted = new Set(['updatedAt']);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [name, rhs] of assignments) {
        if (tainted.has(name)) continue;
        if ([...tainted].some((t) => new RegExp(`\\b${t}\\b`).test(rhs))) {
          tainted.add(name);
          changed = true;
        }
      }
    }

    tainted.delete('updatedAt');
    return [...tainted].filter((name) =>
      new RegExp(`\\b${name}\\b\\s*(?:>=|<=|>|<)\\s*\\d`).test(code)
    );
  }

  it('scans a file set that actually contains the surfaces under guard', () => {
    // An empty or truncated glob is a vacuous pass that looks exactly like a
    // clean one. Pin the scope before trusting the verdict.
    expect(FILES).toContain(DEFINITION);
    expect(FILES).toContain('/src/components/ApplicationCard.tsx');
    expect(FILES).toContain('/src/pages/ApplicationsList.tsx');
    expect(FILES).toContain('/src/pages/ReportsPipeline.tsx');
    expect(FILES).toContain('/src/components/QuickWins.tsx');
    expect(FILES).toContain('/src/components/AttentionCard.tsx');
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('finds no client-side staleness predicate outside constants/stale.ts', () => {
    const offenders = FILES.filter(
      (path) => path !== DEFINITION && elapsedComparisons(MODULES[path]).length > 0
    ).map((path) => `${path}: ${elapsedComparisons(MODULES[path]).join(', ')}`);
    expect(offenders, 'client-side staleness predicate outside the shared definition').toEqual([]);
  });

  it('fires on both surfaces as they were written before this fix', () => {
    // Negative control, and the specific reason the scan is worth having: these
    // are the two bodies the review found, verbatim. `offenders` is asserted
    // empty above, and an empty result is what a broken scan returns too.
    const listTileBefore = `
      const daysSinceUpdate = differenceInDays(today, new Date(app.updatedAt));
      if (daysSinceUpdate >= 14) stale++;
    `;
    const cardBadgeBefore = `
      const daysSinceUpdate = differenceInDays(today, new Date(application.updatedAt));
      isStale = daysSinceUpdate >= 14;
    `;
    expect(elapsedComparisons(listTileBefore)).toEqual(['daysSinceUpdate']);
    expect(elapsedComparisons(cardBadgeBefore)).toEqual(['daysSinceUpdate']);

    // Renaming the binding does not evade it — the guard follows the binding.
    expect(
      elapsedComparisons(`
        const idleFor = differenceInDays(today, new Date(app.updatedAt));
        if (idleFor > 13) stale++;
      `)
    ).toEqual(['idleFor']);
  });

  it('fires through an intermediate binding, as ReportsPipeline was written', () => {
    // The verbatim helper this fix deleted. Nothing on the line that gets
    // compared mentions `updatedAt`; a one-hop guard passes it, which is why
    // the taint is followed to a fixpoint. This is the case that was live in
    // the tree when the first version of this scan was written.
    const pipelineHelperBefore = `
      function isStale(updatedAt: string, now: number): boolean {
        const updated = new Date(updatedAt);
        const daysSince = Math.floor((now - updated.getTime()) / (1000 * 60 * 60 * 24));
        return daysSince >= 14;
      }
    `;
    expect(elapsedComparisons(pipelineHelperBefore)).toContain('daysSince');
  });

  it('does not fire on deriving elapsed days for display', () => {
    // `QuickWins` does exactly this over a server-selected population. A guard
    // that flagged it would be weakened by whoever hit it next, and a weakened
    // guard is how this class of defect comes back.
    expect(
      elapsedComparisons(`
        const daysSinceUpdate = differenceInDays(new Date(), new Date(app.updatedAt));
        description: \`No update for \${daysSinceUpdate} days\`
      `)
    ).toEqual([]);

    // Nor on the due-date urgency thresholds that legitimately sit beside it.
    expect(
      elapsedComparisons(`
        const daysUntilDue = differenceInDays(dueDate, today);
        isOverdue = daysUntilDue < 0;
        isDueSoon = !isOverdue && daysUntilDue <= 3;
      `)
    ).toEqual([]);
  });
});

/**
 * Provenance for the two surfaces the scan above cleared.
 *
 * The scan proves they no longer hold a predicate. It cannot prove they hold
 * the *right* one — a surface that simply stopped rendering a stale indicator
 * would pass it just as cleanly. So require the import and the call.
 */
describe('the reconciled surfaces read the shared definition', () => {
  const SURFACES = [
    ['ApplicationCard.tsx', APPLICATION_CARD_SOURCE],
    ['ApplicationsList.tsx', APPLICATIONS_LIST_SOURCE],
    ['ReportsPipeline.tsx', REPORTS_PIPELINE_SOURCE],
  ] as const;

  const IMPORTS_SHARED_STALE = /import\s*\{[^}]*\}\s*from\s*'[./]*constants\/stale'/;

  it.each(SURFACES)('%s imports from constants/stale', (_name, source) => {
    expect(IMPORTS_SHARED_STALE.test(source)).toBe(true);
  });

  it.each(SURFACES)('%s decides staleness by calling the shared predicate', (_name, source) => {
    // The import alone is not enough: `ApplicationsList` imports the threshold
    // for its tile label as well, so an import would still be present on a file
    // that had quietly kept its own predicate for the count.
    expect(/\bisStale\s*\(/.test(source) || /\bisApplicationStale\s*\(/.test(source)).toBe(true);
  });

  it.each([
    ['ApplicationsList.tsx', APPLICATIONS_LIST_SOURCE],
    ['ReportsPipeline.tsx', REPORTS_PIPELINE_SOURCE],
  ] as const)('%s labels the window it actually applies', (_name, source) => {
    // "Stale (14+ days)" was a literal on both tiles, and a literal agreeing
    // with the shared default today is the exact shape of the defect this card
    // is about — the dashboard card's "(>7 days)" was one of these.
    expect(source).toContain('{DEFAULT_STALE_THRESHOLD_DAYS}+ days');
    expect(source).not.toContain('Stale (14+ days)');
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
