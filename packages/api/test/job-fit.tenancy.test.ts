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

import { getTableName } from 'drizzle-orm';
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
 */
function ownerOf(table: unknown, clause: unknown): string | null | undefined {
  if (clause === undefined || clause === null) return undefined;
  const name = getTableName(table as Parameters<typeof getTableName>[0]);
  const { sql, params } = dialect.sqlToQuery(clause as Parameters<PgDialect['sqlToQuery']>[0]);
  const bound = new RegExp(`"${name}"\\."user_id" = \\$(\\d+)`).exec(sql);
  if (bound) return params[Number(bound[1]) - 1] as string;
  if (new RegExp(`"${name}"\\."user_id" is null`, 'i').test(sql)) return null;
  return undefined;
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

  return {
    db: { select } as unknown as ReturnType<typeof getDb>,
    reads,
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

  // Control. Without it the assertions below could pass because the fixture
  // never reached the ranking code rather than because it was scoped out.
  it("still surfaces the caller's own bullet and tag", async () => {
    install();

    const { response } = await analyzeJobFit({ jobDescriptionText: JD }, 'ip-control', CALLER);

    expect(response.recommendedStarEntries.map((e) => e.rawText)).toContain(MINE);
    expect(response.strongMatches.map((m) => m.catalogEntry)).toContain('postgresql');
    expect(response.catalogEmpty).toBe(false);
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
