// UC-3 job fit analyses are persisted — WIC-1652 AC-1 / AC-2, ADR-012.
//
// The defect this pins: `analyzeJobFit` computed a result, returned it, and
// wrote nothing down. `AnalyzeJobFitResponse` carried no id, so the caller could
// not name the analysis it had just spent an LLM call and a rate-limit slot on;
// `WorkflowChecklist`'s `hasFitAnalysis` and `fitScore` props were therefore
// unreachable by construction, not merely unwired.
//
// ⚠ Every assertion below runs the *real* `analyzeJobFit` against a db double,
// with no `ANTHROPIC_API_KEY` set so the regex parser runs instead of the LLM.
// The point is that the call completes: an "it persists" test that passed
// because the promise rejected somewhere earlier would prove nothing (the
// WIC-1818 lesson). The insert assertions are made on a call that also returned
// a full, well-formed response.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTableName } from 'drizzle-orm';
import {
  analyzeJobFit,
  computeFitScore,
  getJobFitAnalysis,
  jobFitAnalysesScope,
  listJobFitAnalyses,
} from '../src/services/job-fit.service.js';
import { applications, jobFitAnalyses } from '../src/db/schema.js';
import { expectScopedTo, renderClause } from './helpers/tenancy.js';
import { _resetConfig } from '../src/config.js';
import * as dbClient from '../src/db/client.js';
import type { FitMatchDTO } from '../src/types/index.js';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

// Long enough to clear the 50-character floor, and worded so the regex parser
// finds required terms — otherwise `requiredStack` is empty, `recommendation`
// is `null`, and the scored path is never exercised.
const JD =
  'Senior Software Engineer at Acme. Requirements: TypeScript, React, PostgreSQL, AWS. ' +
  'Nice to have: GraphQL. Remote, $150k-$180k.';

interface RecordedOp {
  op: 'select' | 'insert';
  table: string;
  clause?: unknown;
  values?: Record<string, unknown>;
}

/**
 * A db double that records what it was asked and answers from a per-table
 * fixture, honouring `.where()` via the shared predicate evaluator so a scoping
 * bug changes the rows the service sees rather than only the SQL it emitted.
 *
 * Purpose-built rather than reusing `scopedReadStub`: that helper drops
 * `.values()` on the floor, and the inserted row is the whole subject here.
 */
function dbDouble(fixtures: Record<string, Record<string, unknown>[]>) {
  const ops: RecordedOp[] = [];

  function chain(op: 'select' | 'insert') {
    let rows: Record<string, unknown>[] = [];
    let recorded: RecordedOp;
    const self: Record<string, unknown> = {
      from(t: unknown) {
        const table = getTableName(t as Parameters<typeof getTableName>[0]);
        rows = [...(fixtures[table] ?? [])];
        recorded = { op, table };
        ops.push(recorded);
        return self;
      },
      values(v: Record<string, unknown>) {
        recorded.values = v;
        return self;
      },
      where(clause: unknown) {
        recorded.clause = clause;
        // Evaluate the real clause: a stub that ignored it would report green
        // for a service that scoped nothing.
        const { sql, params } = renderClause(clause);
        rows = rows.filter((r) => matches(r, sql, params));
        return self;
      },
      orderBy: () => self,
      limit(n: number) {
        rows = rows.slice(0, n);
        return self;
      },
      returning: () => self,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(res, rej),
    };
    return self;
  }

  const withTable = (op: 'select' | 'insert') => (t: unknown) => {
    const c = chain(op) as Record<string, (t: unknown) => unknown>;
    c.from(t);
    return c;
  };

  return {
    db: { select: () => chain('select'), insert: withTable('insert') },
    ops,
    opsOn: (t: string) => ops.filter((o) => o.table === t),
  };
}

/**
 * Minimal evaluator for the two clause shapes these reads actually emit —
 * `id = $n AND user_id = $m` and `user_id IS NULL`. Deliberately not a general
 * SQL engine: the structural assertions use `expectScopedTo`, which does run the
 * real boolean tree. This only has to make the *rows* move.
 */
function matches(row: Record<string, unknown>, sql: string, params: unknown[]): boolean {
  const terms = sql.split(/\s+and\s+/i);
  return terms.every((term) => {
    const eqMatch = /"(\w+)"\."(\w+)" = \$(\d+)/.exec(term);
    if (eqMatch) {
      const col = camel(eqMatch[2]);
      return row[col] === params[Number(eqMatch[3]) - 1];
    }
    const nullMatch = /"(\w+)"\."(\w+)" is null/i.exec(term);
    if (nullMatch) return row[camel(nullMatch[2])] == null;
    return true;
  });
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const application = (id: string, userId: string | null) => ({
  id,
  userId,
  jobTitle: 'Engineer',
  company: 'Acme',
  status: 'saved',
});

const techTag = (slug: string) => ({
  id: `tt-${slug}`,
  userId: OWNER,
  tagSlug: slug,
  displayName: slug,
  aliases: [],
  mentionCount: 1,
});

/** A catalog that is non-empty, so the scored path runs rather than the short circuit. */
const CATALOG = {
  tech_stack_tags: ['typescript', 'react', 'postgresql'].map(techTag),
  job_fit_tags: [] as Record<string, unknown>[],
  quantified_bullets: [] as Record<string, unknown>[],
};

let savedApiKey: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedApiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  _resetConfig();
});

afterEach(() => {
  if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
  else delete process.env.ANTHROPIC_API_KEY;
  _resetConfig();
});

const ANALYSES = getTableName(jobFitAnalyses);
const APPLICATIONS = getTableName(applications);

// ── AC-1: the analysis is written down, with an id and an owning application ──

describe('analyzeJobFit persistence (AC-1)', () => {
  it('inserts a job_fit_analyses row and returns its id', async () => {
    const stub = dbDouble({ ...CATALOG, applications: [application('app-1', OWNER)] });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    const { response } = await analyzeJobFit(
      { jobDescriptionText: JD, applicationId: 'app-1' },
      'client',
      OWNER
    );

    const inserts = stub.opsOn(ANALYSES).filter((o) => o.op === 'insert');
    expect(inserts).toHaveLength(1);

    const row = inserts[0].values!;
    // The id on the wire is the id in the row. A response that invented an id
    // it did not store would satisfy "returns an id" and still leave every
    // `jobFitAnalysisId` unresolvable.
    expect(response.id).toBeTruthy();
    expect(row.id).toBe(response.id);
    expect(row.userId).toBe(OWNER);
    expect(row.applicationId).toBe('app-1');
    expect(response.applicationId).toBe('app-1');
  });

  it('stores the analysis payload, not just its identity', async () => {
    const stub = dbDouble({ ...CATALOG, applications: [application('app-1', OWNER)] });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    const { response } = await analyzeJobFit({ jobDescriptionText: JD }, 'client', OWNER);
    const row = stub.opsOn(ANALYSES).find((o) => o.op === 'insert')!.values!;

    expect(row.summary).toBe(response.summary);
    expect(row.confidence).toBe(response.confidence);
    expect(row.recommendation).toBe(response.recommendation);
    expect(row.fitScore).toBe(response.fitScore);
    expect(row.parsedJd).toEqual(response.parsedJd);
    expect(row.strongMatches).toEqual(response.strongMatches);
    expect(row.partialMatches).toEqual(response.partialMatches);
    expect(row.gaps).toEqual(response.gaps);
    expect(row.recommendedStarEntries).toEqual(response.recommendedStarEntries);
    expect(row.catalogEmpty).toBe(false);
    // The stored input is what makes an analysis explainable after the fact.
    expect(row.jobDescriptionText).toBe(JD);
    expect(row.jobDescriptionUrl).toBeNull();
    // Stored time and wire time are the same instant, not two clock reads.
    expect((row.analyzedAt as Date).toISOString()).toBe(response.analysisTimestamp);
  });

  it('persists the catalog-empty result too', async () => {
    // The short-circuit exit used to be a second `return` that skipped every
    // later step. If persistence had been bolted onto the scored path alone,
    // `catalogEmpty: true` would be the one result a caller could never name.
    const stub = dbDouble({
      tech_stack_tags: [],
      job_fit_tags: [],
      quantified_bullets: [],
      applications: [],
    });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    const { response } = await analyzeJobFit({ jobDescriptionText: JD }, 'client', OWNER);

    expect(response.catalogEmpty).toBe(true);
    const row = stub.opsOn(ANALYSES).find((o) => o.op === 'insert')?.values;
    expect(row).toBeDefined();
    expect(row!.id).toBe(response.id);
    expect(row!.catalogEmpty).toBe(true);
    expect(response.recommendation).toBeNull();
    expect(response.fitScore).toBeNull();
  });

  it('leaves applicationId null when the caller supplies none', async () => {
    // Analysing a bare job description with no application in hand stays
    // supported: `application_id` is nullable precisely so this request is not
    // a 4xx. Such an analysis simply cannot tick any checklist.
    const stub = dbDouble({ ...CATALOG, applications: [application('app-1', OWNER)] });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    const { response } = await analyzeJobFit({ jobDescriptionText: JD }, 'client', OWNER);

    expect(response.applicationId).toBeNull();
    expect(stub.opsOn(ANALYSES).find((o) => o.op === 'insert')!.values!.applicationId).toBeNull();
    // and it never went looking for one
    expect(stub.opsOn(APPLICATIONS)).toHaveLength(0);
  });
});

// ── AC-1: the owning application is the caller's own ─────────────────────────

describe('analyzeJobFit applicationId ownership', () => {
  it('rejects an application belonging to another user, and writes nothing', async () => {
    const stub = dbDouble({ ...CATALOG, applications: [application('app-1', OTHER)] });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    await expect(
      analyzeJobFit({ jobDescriptionText: JD, applicationId: 'app-1' }, 'client', OWNER)
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });

    expect(stub.opsOn(ANALYSES)).toHaveLength(0);
  });

  it('rejects an application that does not exist', async () => {
    const stub = dbDouble({ ...CATALOG, applications: [] });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    await expect(
      analyzeJobFit({ jobDescriptionText: JD, applicationId: 'nope' }, 'client', OWNER)
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
  });

  it('scopes the application lookup by owner and by id', async () => {
    const stub = dbDouble({ ...CATALOG, applications: [application('app-1', OWNER)] });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    await analyzeJobFit({ jobDescriptionText: JD, applicationId: 'app-1' }, 'client', OWNER);

    const clause = stub.opsOn(APPLICATIONS)[0].clause;
    // Structural: `and`→`or` here would make any existing application id
    // resolve for any caller, which the behavioural cases above cannot see once
    // the fixture holds only one row.
    expectScopedTo(clause, { table: APPLICATIONS, userId: OWNER, ids: ['app-1'] });
  });

  it('rejects before spending a rate-limit slot or an LLM call', async () => {
    // A 404 that arrived after the analysis had already run would still cost
    // the caller the budget the analysis consumed.
    const stub = dbDouble({ ...CATALOG, applications: [] });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    await expect(
      analyzeJobFit({ jobDescriptionText: JD, applicationId: 'nope' }, 'client', OWNER)
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });

    // The catalog reads are the first thing the analysis proper does.
    expect(stub.opsOn('tech_stack_tags')).toHaveLength(0);
  });
});

// ── AC-2: fitScore is the score the recommendation was made from ─────────────

describe('fitScore (AC-2)', () => {
  const required = (matchType: FitMatchDTO['matchType']): FitMatchDTO => ({
    type: 'tech_stack',
    catalogEntry: 'x',
    jdRequirement: 'x',
    matchType,
    isRequired: true,
  });

  it('weights exact at 1 and partial at 0.5, per the documented algorithm', () => {
    expect(computeFitScore([required('exact'), required('exact')], 4)).toBe(50);
    expect(computeFitScore([required('exact'), required('alias')], 4)).toBe(38);
    expect(computeFitScore([required('related')], 2)).toBe(25);
    expect(computeFitScore([], 4)).toBe(0);
  });

  it('is null exactly when there is no denominator', () => {
    // `null` is the "unscored" result, not "not analysed" — and it must agree
    // with `recommendation`, which returns null under the same condition.
    expect(computeFitScore([], 0)).toBeNull();
  });

  it('is carried on the response and matches the recommendation it produced', async () => {
    const stub = dbDouble({ ...CATALOG, applications: [] });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    const { response } = await analyzeJobFit({ jobDescriptionText: JD }, 'client', OWNER);

    expect(response.fitScore).not.toBeNull();
    expect(response.fitScore).toBeGreaterThanOrEqual(0);
    expect(response.fitScore).toBeLessThanOrEqual(100);
    // The tier and the percentage are read off one number, so they cannot
    // contradict each other the way WIC-1309's blurbs and counts did.
    expect(response.recommendation).not.toBeNull();
    const pct = response.fitScore!;
    if (response.recommendation === 'strong_fit') expect(pct).toBeGreaterThanOrEqual(80);
    if (response.recommendation === 'low_fit') expect(pct).toBeLessThan(30);
  });
});

// ── AC-1: an analysis can be found again ─────────────────────────────────────

describe('listJobFitAnalyses', () => {
  const stored = (id: string, userId: string | null, applicationId: string | null) => ({
    id,
    userId,
    applicationId,
    recommendation: 'moderate_fit',
    fitScore: 62,
    summary: 'summary',
    confidence: 'high',
    catalogEmpty: false,
    analyzedAt: new Date('2026-08-30T00:00:00.000Z'),
  });

  it('returns only the calling user rows, filtered by application', async () => {
    const stub = dbDouble({
      job_fit_analyses: [
        stored('mine', OWNER, 'app-1'),
        stored('mine-other-app', OWNER, 'app-2'),
        stored('theirs', OTHER, 'app-1'),
      ],
    });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    const { analyses } = await listJobFitAnalyses(
      { applicationId: 'app-1' },
      jobFitAnalysesScope(OWNER)
    );

    expect(analyses.map((a) => a.id)).toEqual(['mine']);
    expect(analyses[0]).toMatchObject({
      applicationId: 'app-1',
      recommendation: 'moderate_fit',
      fitScore: 62,
      analyzedAt: '2026-08-30T00:00:00.000Z',
    });
  });

  it('scopes by owner even when no application filter is given', async () => {
    // The application filter is not a substitute for the owner term:
    // application ids are caller-supplied.
    const stub = dbDouble({
      job_fit_analyses: [stored('mine', OWNER, 'app-1'), stored('theirs', OTHER, 'app-1')],
    });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    const { analyses } = await listJobFitAnalyses({}, jobFitAnalysesScope(OWNER));

    expect(analyses.map((a) => a.id)).toEqual(['mine']);
    expectScopedTo(stub.opsOn(ANALYSES)[0].clause, { table: ANALYSES, userId: OWNER });
  });

  it('restricts an anonymous caller to orphan rows', async () => {
    // ADR-003's anonymous path: absent identity means `IS NULL`, never
    // "unscoped". `expectScopedTo` is deliberately the wrong assertion here.
    const stub = dbDouble({
      job_fit_analyses: [stored('orphan', null, 'app-1'), stored('owned', OWNER, 'app-1')],
    });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    const { analyses } = await listJobFitAnalyses({}, jobFitAnalysesScope(undefined));

    expect(analyses.map((a) => a.id)).toEqual(['orphan']);
    expect(renderClause(stub.opsOn(ANALYSES)[0].clause).sql).toMatch(
      /"job_fit_analyses"\."user_id" is null/i
    );
  });

  it('caps the page size', async () => {
    const stub = dbDouble({
      job_fit_analyses: Array.from({ length: 150 }, (_, i) => stored(`a${i}`, OWNER, 'app-1')),
    });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    expect(
      (await listJobFitAnalyses({ limit: 500 }, jobFitAnalysesScope(OWNER))).analyses
    ).toHaveLength(100);
    expect((await listJobFitAnalyses({}, jobFitAnalysesScope(OWNER))).analyses).toHaveLength(20);
  });
});

// ── WIC-2058: an analysis can be found again *by id* ─────────────────────────
//
// `listJobFitAnalyses` above answers "which analyses belong to this application", which is
// what ticks the checklist. It cannot answer "show me this analysis", because its only exact
// narrowing is `applicationId` and the viewer route carries no application — so resolving an
// id through it means scanning the newest 100 rows in the browser, which is the page-cap
// defect from WIC-1533 and WIC-1652 reintroduced. Hence a real read-one.

describe('getJobFitAnalysis', () => {
  const stored = (id: string, userId: string | null, applicationId: string | null) => ({
    id,
    userId,
    applicationId,
    recommendation: 'moderate_fit',
    fitScore: 62,
    summary: 'summary',
    confidence: 'high',
    catalogEmpty: false,
    analyzedAt: new Date('2026-08-30T00:00:00.000Z'),
  });

  it('returns the caller own analysis as the same summary shape the list returns', async () => {
    const stub = dbDouble({ job_fit_analyses: [stored('mine', OWNER, 'app-1')] });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    expect(await getJobFitAnalysis('mine', jobFitAnalysesScope(OWNER))).toMatchObject({
      id: 'mine',
      applicationId: 'app-1',
      recommendation: 'moderate_fit',
      fitScore: 62,
      analyzedAt: '2026-08-30T00:00:00.000Z',
    });
  });

  it('returns null for another user analysis, and the predicate is a conjunction', async () => {
    // The leak this guards is not "the row comes back" — it is `or(idTerm, ownerTerm)`,
    // which renders the owner term, binds the caller id, and returns the whole table. Both
    // halves are asserted: the row, because that is what a user would see, and the clause
    // structure via `expectScopedTo`, because a presence check cannot tell `and` from `or`
    // (WIC-1491, and the three leaks that motivated it).
    const stub = dbDouble({
      job_fit_analyses: [stored('mine', OWNER, 'app-1'), stored('theirs', OTHER, 'app-1')],
    });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    expect(await getJobFitAnalysis('theirs', jobFitAnalysesScope(OWNER))).toBeNull();
    // `ids` is supplied so probe 4 runs as well: it asserts the id half is bound to the
    // `id` column rather than merely appearing in `params`, which is the other way a
    // read-one can be wrong without any test noticing.
    expectScopedTo(stub.opsOn(ANALYSES)[0].clause, {
      table: ANALYSES,
      userId: OWNER,
      ids: ['theirs'],
    });
  });

  it('returns null for an id that does not exist — indistinguishable from the above', async () => {
    // Same `null` for both, on purpose: the route turns each into the same 404, so an id
    // that belongs to somebody else cannot be told apart from one that belongs to nobody.
    const stub = dbDouble({ job_fit_analyses: [stored('mine', OWNER, 'app-1')] });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    expect(await getJobFitAnalysis('no-such-id', jobFitAnalysesScope(OWNER))).toBeNull();
  });

  it('restricts an anonymous caller to orphan rows', async () => {
    // ADR-003's anonymous path, as the list read has it: absent identity means `IS NULL`,
    // never "unscoped". Asserted in both directions so a scope that degraded to
    // "match everything" would fail on the second line rather than pass on the first.
    const stub = dbDouble({
      job_fit_analyses: [stored('orphan', null, 'app-1'), stored('owned', OWNER, 'app-1')],
    });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    expect(await getJobFitAnalysis('orphan', jobFitAnalysesScope(undefined))).toMatchObject({
      id: 'orphan',
    });
    expect(await getJobFitAnalysis('owned', jobFitAnalysesScope(undefined))).toBeNull();
    expect(renderClause(stub.opsOn(ANALYSES)[0].clause).sql).toMatch(
      /"job_fit_analyses"\."user_id" is null/i
    );
  });

  it('carries a null fitScore through as null, not as zero', async () => {
    // AC-4. An unscored analysis — empty catalog, or a JD naming no required skills — is
    // the state this card is really about, and it is the one a `fitScore ? …` reader
    // collapses onto "no analysis". The DTO must keep `null` distinct from `0`.
    const stub = dbDouble({
      job_fit_analyses: [
        { ...stored('unscored', OWNER, 'app-1'), fitScore: null, recommendation: null },
        { ...stored('zero', OWNER, 'app-2'), fitScore: 0 },
      ],
    });
    vi.mocked(dbClient.getDb).mockReturnValue(stub.db as never);

    const unscored = await getJobFitAnalysis('unscored', jobFitAnalysesScope(OWNER));
    expect(unscored?.fitScore).toBeNull();
    expect(unscored?.recommendation).toBeNull();

    expect((await getJobFitAnalysis('zero', jobFitAnalysesScope(OWNER)))?.fitScore).toBe(0);
  });
});
