// UC-3 tenancy: `POST /catalog/job-fit/analyze` computed every user's fit
// analysis over the union of every user's catalog (WIC-1435).
//
// `analyzeJobFit(input, clientId)` took no caller id — `clientId` is the
// rate-limit bucket key (the client IP) — and all three catalog reads were bare
// `db.select().from(...)` full-table scans. Three things escaped:
//
//   - `recommendedStarEntries[].rawText`, the user-authored accomplishment
//     sentence, verbatim in the response body;
//   - `strongMatches[].catalogEntry` / `partialMatches[].catalogEntry`, slugs
//     drawn from strangers' `tech_stack_tags` and `job_fit_tags`;
//   - `catalogEmpty`, computed over the *global* tag set, so EC-1's "Your
//     catalog is empty" was unreachable for a user with no catalog of their own
//     as soon as any other user had a single tag.
//
// No crafted request is needed for any of it: the endpoint's documented use is
// the exploit.
//
// The harness below honours the predicate each read is handed, on all three
// tables, rather than spying on `.where()`. A `where` spy that resolves the same
// fixture whatever it is asked reports green for both the fixed and the broken
// service — the WIC-1373 failure mode, and the reason WIC-1449's stub was
// rewritten. Filtering all three tables (not just `quantified_bullets`) is what
// makes the `catalogEmpty` case above assertable at all.
//
// Deliberately self-contained rather than importing
// `test/helpers/star-catalog-stub.ts`: that helper is only on the unmerged #153,
// and reaching for a file that exists on another branch is how WIC-1433 broke CI
// at import while the local suite was green. When #153 and #158 land, #158's D4
// `it.fails` trip-wires flip to plain `it` against this fix.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));
vi.mock('../src/config.js', () => ({
  getConfig: vi.fn(() => ({ anthropicApiKey: undefined })),
}));

import { and, eq, getTableName, isNotNull, or } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getDb } from '../src/db/client.js';
import { getConfig } from '../src/config.js';
import { techStackTags, jobFitTags, quantifiedBullets } from '../src/db/schema.js';
import { analyzeJobFit } from '../src/services/job-fit.service.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';
const OTHER = 'c2a91e77-5f30-4d18-8a41-6b0e9d3c8f12';

// Both bullets contain the literal `postgresql`, because the relevance filter
// matches on `rawText.includes(term)` where `term` is the slug
// `extractTechTerms` emits, not the JD's own wording.
const MINE = 'Cut postgresql p99 latency 41% on the billing path at Acme Corp.';
const THEIRS = 'Recovered $2.1M in churned ARR rebuilding the postgresql core at Initech.';

const JD = [
  'Senior Backend Engineer',
  '',
  'Requirements:',
  '- Deep PostgreSQL experience',
  '- TypeScript across the stack',
].join('\n');

// ── Predicate-honouring stub ─────────────────────────────────────────────────

const dialect = new PgDialect();

/**
 * The owner a clause actually restricts `table` to, read off its rendered SQL: a
 * user id for `user_id = $n`, `null` for `user_id is null`, and `undefined` when
 * the clause carries no owner term at all — which is what a missing `.where()`
 * and a bare `.where(undefined)` both render to. That last case is the point: a
 * `toHaveBeenCalled()` check on `where` passes against a `WHERE` that filters
 * nothing.
 *
 * Both patterns are anchored to the *whole* rendered clause, and anything else
 * raises. Presence of an owner term is not restriction by it: matched anywhere
 * in the string, `or(eq(userId, caller), isNotNull(userId))` reads as
 * "scoped to the caller" while returning the entire table, and because the stub
 * below filters each fixture by whatever this returns, the harness would then
 * manufacture the safe answer the service never produced — every behavioural
 * assertion in this file included. Degrading to `undefined` on an unrecognised
 * shape is no better, since the stub reads that as "matches everything", so an
 * oracle that cannot evaluate a clause must refuse to certify it instead.
 *
 * The cost is that a legitimate future `and(ownerScope(...), someOtherFilter)`
 * also raises. That is the correct direction to fail — loudly, with the SQL in
 * the message — for a service whose three reads each carry exactly one
 * predicate. #162 (WIC-1491) parses the rendered SQL into a boolean tree and is
 * the general fix; when it lands this collapses to its `expectScopedTo`.
 */
function ownerOf(table: unknown, clause: unknown): string | null | undefined {
  if (clause === undefined || clause === null) return undefined;
  const name = getTableName(table as Parameters<typeof getTableName>[0]);
  const { sql, params } = dialect.sqlToQuery(clause as Parameters<PgDialect['sqlToQuery']>[0]);
  const text = sql.trim();
  const bound = new RegExp(`^"${name}"\\."user_id" = \\$(\\d+)$`).exec(text);
  if (bound) return params[Number(bound[1]) - 1] as string;
  if (new RegExp(`^"${name}"\\."user_id" is null$`, 'i').test(text)) return null;
  throw new Error(
    `ownerOf: unmodelled predicate on "${name}" — presence of an owner term is not ` +
      `restriction by it, so this oracle refuses to certify a shape it cannot evaluate. ` +
      `Rendered SQL: ${text}`
  );
}

interface OwnedRow extends Record<string, unknown> {
  userId: string | null;
}

/** Every table's fixture is filtered by the owner term in that read's own SQL. */
function stubDb(tables: Array<[unknown, OwnedRow[]]>) {
  const rowsByTable = new Map(tables.map(([t, rows]) => [t, rows]));
  const reads: Array<{ table: unknown; clause?: unknown }> = [];

  const from = vi.fn();
  const select = vi.fn(() => {
    from.mockImplementationOnce((table: unknown) => {
      const read: { table: unknown; clause?: unknown } = { table };
      reads.push(read);

      const resolve = () => {
        const all = rowsByTable.get(table) ?? [];
        const owner = ownerOf(table, read.clause);
        return owner === undefined ? all : all.filter((r) => (r.userId ?? null) === owner);
      };

      const builder: Record<string, unknown> = {
        where: vi.fn((clause: unknown) => {
          read.clause = clause;
          return builder;
        }),
        orderBy: vi.fn(() => builder),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(resolve()).then(res, rej),
      };
      return builder;
    });
    return { from };
  });

  // `analyzeJobFit` persists the analysis since WIC-1652, so the double has to
  // model the write as well as the reads. Recorded rather than discarded: the
  // owner the analysis is stored under is a tenancy fact worth asserting.
  const writes: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      writes.push({ table, values });
      return Promise.resolve();
    },
  }));

  return {
    db: { select, insert } as unknown as ReturnType<typeof getDb>,
    reads,
    writes,
    clauseFor: (table: unknown) => reads.find((r) => r.table === table)?.clause,
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function bullet(id: string, rawText: string, userId: string): OwnedRow {
  return { id, userId, rawText, impactCategory: 'revenue', sourceId: '01HZ_RES_001' };
}

function tag(id: string, tagSlug: string, displayName: string, userId: string): OwnedRow {
  return { id, userId, tagSlug, displayName, aliases: [], mentionCount: 1 };
}

const MY_BULLET = bullet('01HZ_BUL_MINE', MINE, CALLER);
const THEIR_BULLET = bullet('01HZ_BUL_THEIRS', THEIRS, OTHER);

const MY_TECH = tag('01HZ_TAG_PG_MINE', 'postgresql', 'PostgreSQL', CALLER);
const THEIR_TECH = tag('01HZ_TAG_TS_THEIRS', 'typescript', 'TypeScript', OTHER);

// `job_fit_tags` is matched against the JD's seniority and industries, so this
// one is what an unscoped read of that third table leaks into `strongMatches`:
// the JD says "Senior Backend Engineer" and only OTHER has claimed `senior`.
const THEIR_JOB_FIT = tag('01HZ_TAG_SENIOR_THEIRS', 'senior', 'Senior', OTHER);

function install({
  bullets = [MY_BULLET, THEIR_BULLET],
  tech = [MY_TECH, THEIR_TECH],
  jobFit = [THEIR_JOB_FIT],
} = {}) {
  const stub = stubDb([
    [quantifiedBullets, bullets],
    [techStackTags, tech],
    [jobFitTags, jobFit],
  ]);
  vi.mocked(getDb).mockReturnValue(stub.db);
  return stub;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('analyzeJobFit tenancy (WIC-1435)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No API key ⇒ `parseJobDescription` skips the LLM and takes the regex path,
    // so none of these assertions depend on a model response.
    vi.mocked(getConfig).mockReturnValue({ anthropicApiKey: undefined } as never);
  });

  it('stores the analysis under the caller, not unowned', async () => {
    // The read half of this suite proves the caller cannot *see* another
    // tenant's catalog. This is the write half: WIC-1652 persists the result,
    // so an analysis written with a null owner would be a row the caller can
    // never read back (an owner-less read scopes to `user_id IS NULL`).
    const stub = install();

    await analyzeJobFit({ jobDescriptionText: JD }, 'default', CALLER);

    expect(stub.writes, 'the analysis must be persisted').toHaveLength(1);
    expect(stub.writes[0].values.userId).toBe(CALLER);
  });

  // Control. Without it the assertions below could pass because the fixture
  // never reached the ranking code rather than because it was scoped out.
  it("still surfaces the caller's own bullet and tag", async () => {
    install();

    const { response } = await analyzeJobFit({ jobDescriptionText: JD }, 'ip-control', CALLER);

    expect(response.recommendedStarEntries.map((e) => e.rawText)).toContain(MINE);
    expect(response.strongMatches.map((m) => m.catalogEntry)).toContain('postgresql');
    expect(response.catalogEmpty).toBe(false);
  });

  // Two cells that pin the oracle itself. Every assertion in this file routes
  // through `ownerOf`, so an oracle that cannot tell a restricting owner term
  // from a decorative one would report the whole file green against the live
  // WIC-1435 leak — `or(eq(userId, caller), isNotNull(userId))` in `ownerScope`
  // passed 17/17 here, and 453/453 across the suite, before this change.
  //
  // The first is the kill assertion for exactly that shape. The second is the
  // generalisation control: the refusal is a property of "shape I cannot
  // evaluate", not a special case for `or`. The opposite direction — that the
  // oracle does not over-raise on the two shapes it *does* model — is what the
  // `= $n` and `is null` assertions in the cells below already establish.
  it('refuses to certify an owner term that is present but not restricting', () => {
    const leaky = or(eq(quantifiedBullets.userId, CALLER), isNotNull(quantifiedBullets.userId));

    expect(() => ownerOf(quantifiedBullets, leaky)).toThrow(/unmodelled predicate/);
  });

  it('raises rather than silently degrading on a predicate shape it cannot model', () => {
    const conjunction = and(
      eq(quantifiedBullets.userId, CALLER),
      eq(quantifiedBullets.id, '01HZ_BUL_MINE')
    );

    expect(() => ownerOf(quantifiedBullets, conjunction)).toThrow(/unmodelled predicate/);
  });

  it('scopes the STAR-catalog read to the caller', async () => {
    const stub = install();

    await analyzeJobFit({ jobDescriptionText: JD }, 'ip-bullets', CALLER);

    expect(ownerOf(quantifiedBullets, stub.clauseFor(quantifiedBullets))).toBe(CALLER);
  });

  it("does not rank or return another user's STAR rawText", async () => {
    install();

    const { response } = await analyzeJobFit({ jobDescriptionText: JD }, 'ip-leak', CALLER);

    expect(response.recommendedStarEntries.map((e) => e.rawText)).not.toContain(THEIRS);
    expect(response.recommendedStarEntries.map((e) => e.id)).toEqual(['01HZ_BUL_MINE']);
  });

  it('scopes the tech-stack and job-fit tag reads to the caller', async () => {
    const stub = install();

    await analyzeJobFit({ jobDescriptionText: JD }, 'ip-tags', CALLER);

    expect(ownerOf(techStackTags, stub.clauseFor(techStackTags))).toBe(CALLER);
    expect(ownerOf(jobFitTags, stub.clauseFor(jobFitTags))).toBe(CALLER);
  });

  it("does not score the caller against another user's tags", async () => {
    install();

    const { response } = await analyzeJobFit({ jobDescriptionText: JD }, 'ip-tags-leak', CALLER);

    // `typescript` is in the JD's required stack and is in OTHER's
    // `tech_stack_tags` only, so unscoped it lands in `strongMatches`; scoped it
    // must be a gap. `senior` is the same story one table over, in
    // `job_fit_tags`, via the seniority match.
    const matched = [...response.strongMatches, ...response.partialMatches].map(
      (m) => m.catalogEntry
    );
    expect(matched).not.toContain('typescript');
    expect(matched).not.toContain('senior');
    expect(response.gaps.map((g) => g.jdRequirement)).toContain('typescript');
    expect(response.gaps.map((g) => g.jdRequirement)).toContain('senior');
  });

  // EC-1. Unreachable before the fix: `catalogEmpty` was
  // `techTags.length === 0 && jfTags.length === 0` over the *global* set, so one
  // other user's single tag was enough to tell a user with no catalog that
  // theirs was populated — and then hand them an analysis built from that
  // stranger's data.
  it('reports the empty-catalog state for a caller whose own catalog is empty', async () => {
    install({ bullets: [THEIR_BULLET], tech: [THEIR_TECH] });

    const { response } = await analyzeJobFit({ jobDescriptionText: JD }, 'ip-empty', CALLER);

    expect(response.catalogEmpty).toBe(true);
    expect(response.summary).toContain('Your catalog is empty');
    expect(response.recommendation).toBeNull();
    expect(response.recommendedStarEntries).toEqual([]);
    expect(response.strongMatches).toEqual([]);
  });

  // All three columns are `user_id uuid NOT NULL`, so `IS NULL` reaches no rows:
  // an anonymous caller (the local-dev path where `authMiddleware` sets `userId`
  // to null) gets the EC-1 empty state, not everyone's catalog. The predicate is
  // asserted as well as the outcome, because "no rows" would also be the result
  // of a fixture that simply never loaded.
  it('scopes an absent caller id to IS NULL rather than failing open', async () => {
    const stub = install();

    const { response } = await analyzeJobFit({ jobDescriptionText: JD }, 'ip-anon');

    for (const table of [quantifiedBullets, techStackTags, jobFitTags]) {
      expect(ownerOf(table, stub.clauseFor(table)), getTableName(table)).toBeNull();
    }
    expect(response.catalogEmpty).toBe(true);
    expect(response.recommendedStarEntries).toEqual([]);
  });
});
