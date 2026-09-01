// The STAR-catalog reads WIC-1449 did *not* reach — D4 (job-fit) and D5 (cover
// letters).
//
// WIC-1449 traced UC-6 and UC-7 and scoped seven reads of `quantified_bullets`.
// Re-running the same mechanical sweep (`grep -rn 'from(quantifiedBullets)'`)
// against that fix branch still returns two unqualified reads in other use
// cases. They are the same defect class, the same table, and the same escaping
// field — `rawText`, the user-authored accomplishment sentence — so they are
// pinned here with the same harness rather than re-derived from scratch.
//
// D4 `job-fit.service.ts:680` is the worst of the whole family. It is
// `db.select().from(quantifiedBullets)` with no predicate at all, and the module
// imports only `desc` from drizzle-orm — there is no `eq`/`and` in the file to
// have filtered with. `analyzeJobFit(input, clientId)` never receives a caller
// id: `POST /catalog/job-fit/analyze` (`catalog.routes.ts:341`) passes the
// client *IP*, for rate limiting, and never reads `c.get('userId')`. The service
// then ranks every user's bullets against the job description and returns the
// top five `rawText` values verbatim in `recommendedStarEntries`. No id
// guessing and no auth manipulation: the leak is the happy path.
//
// D5 `cover-letter.service.ts:119 fetchStarEntries(ids)` takes ids and nothing
// else, across four call sites, while `generateCoverLetter(input, userId)`
// already *has* the caller id and simply does not pass it down — the same
// `_userId`-shaped defect as UC-6's `suggestBullets`. The ids are client-
// supplied (`selectedStarEntryIds: z.array(z.string())`, `cover-letters.ts:24`),
// so this one is a plain IDOR.
//
// Both are `it.fails` trip-wires: they pass today *because the assertion fails*,
// and vitest turns them red the moment either read is scoped — which is when
// they must be converted to plain `it`. The `it` cases around them are the
// controls that prove the harness is wired up and would notice.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));
vi.mock('../src/config.js', () => ({
  getConfig: vi.fn(() => ({ anthropicApiKey: 'sk-test' })),
}));

const anthropicCtor = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages: unknown;
    constructor(opts: unknown) {
      this.messages = anthropicCtor(opts);
    }
  },
}));

import { getDb } from '../src/db/client.js';
import { getConfig } from '../src/config.js';
import { coverLetters, techStackTags, jobFitTags } from '../src/db/schema.js';
import { analyzeJobFit } from '../src/services/job-fit.service.js';
import { generateCoverLetter } from '../src/services/cover-letter.service.js';
// `CoverLetterError` lives in `types/index.ts`; the service imports it but does
// not re-export it. Importing it from the service yields `undefined`, and
// `toBeInstanceOf(undefined)` throws — which an `it.fails` swallows, so the
// trip-wire would have passed both before *and* after the fix.
import { CoverLetterError } from '../src/types/index.js';
import {
  stubDb,
  stubAnthropic,
  expectScopedTo,
  render,
  type CatalogRow,
} from './helpers/star-catalog-stub.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';
const OTHER = 'c2a91e77-5f30-4d18-8a41-6b0e9d3c8f12';

// Both contain the literal slug `PostgreSQL`, because the job-fit relevance
// filter matches a bullet by `rawText.includes(term)` where `term` is the
// *slug* `extractTechTerms` emits (`postgresql`), not the JD's own wording.
const MINE = 'Cut PostgreSQL p99 latency 41% on the billing path at Acme Corp.';
const THEIRS = 'Recovered $2.1M in churned ARR rebuilding the PostgreSQL core at Initech.';

const JD = [
  'Senior Backend Engineer',
  '',
  'Requirements:',
  '- Deep PostgreSQL experience',
  '- TypeScript across the stack',
].join('\n');

function bullet(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    id: '01HZ_BUL_MINE',
    rawText: MINE,
    impactCategory: 'revenue',
    sourceId: '01HZ_RES_001',
    userId: CALLER,
    ...overrides,
  };
}

const MIXED_CATALOG: CatalogRow[] = [
  bullet(),
  bullet({ id: '01HZ_BUL_THEIRS', rawText: THEIRS, userId: OTHER }),
];

/**
 * `tech_stack_tags` and `job_fit_tags` are *per-user* tables — `user_id uuid NOT
 * NULL` on both (`schema.ts:243`, `:221`) — and `analyzeJobFit` reads them with
 * the same bare `db.select().from(...)` it uses for the catalog. So D4 spans
 * three tables, not one, and these fixtures are deliberately owned by OTHER: an
 * unscoped read is what makes them visible at all.
 */
function tag(id: string, tagSlug: string, displayName: string, userId: string) {
  return { id, userId, tagSlug, displayName, aliases: [], mentionCount: 1 };
}

const OTHERS_TAGS = [tag('01HZ_TAG_PG', 'postgresql', 'PostgreSQL', OTHER)];

/**
 * `ownerParamOf` in the shared helper is hard-wired to `quantified_bullets`.
 * The tag tables need the same reading, so this is the table-parameterised
 * form — kept local rather than widening the helper #153 introduced.
 */
function ownerOf(tableName: string, clause: unknown): string | null | undefined {
  if (clause === undefined || clause === null) return undefined;
  const { sql, params } = render(clause);
  const bound = new RegExp(`"${tableName}"\\."user_id" = \\$(\\d+)`).exec(sql);
  if (bound) return params[Number(bound[1]) - 1] as string;
  if (new RegExp(`"${tableName}"\\."user_id" is null`, 'i').test(sql)) return null;
  return undefined;
}

// ── D4: job-fit ───────────────────────────────────────────────────────────────

/**
 * `analyzeJobFit` has no caller-id parameter to pass, so the fix has to add one.
 * Calling through this alias states the proposed signature — `(input, clientId,
 * userId)`, keeping `clientId` where it is because it is the rate-limit key and
 * not an identity — without the test failing to compile against today's
 * two-parameter export. The extra argument is simply ignored until the fix
 * lands, which is exactly the "passes because the assertion fails" property the
 * trip-wire depends on.
 */
const analyzeJobFitWithCaller = analyzeJobFit as unknown as (
  input: unknown,
  clientId: string,
  userId?: string
) => ReturnType<typeof analyzeJobFit>;

describe('analyzeJobFit tenancy (D4 — the unqualified full-table read)', () => {
  function install(catalog: CatalogRow[], tags = OTHERS_TAGS) {
    const stub = stubDb({
      catalog,
      tables: [
        [techStackTags, tags],
        [jobFitTags, []],
      ],
    });
    vi.mocked(getDb).mockReturnValue(stub.db as ReturnType<typeof getDb>);
    return stub;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // No key ⇒ `parseJobDescription` skips the LLM and takes the regex path, so
    // these assertions do not depend on a model response at all.
    vi.mocked(getConfig).mockReturnValue({ anthropicApiKey: undefined } as never);
  });

  // Control. If this ever fails, the fixture stopped reaching the ranking code
  // and the trip-wires below would be vacuous rather than meaningful.
  it("surfaces the caller's own bullet as a recommendation", async () => {
    const stub = install([bullet()]);

    const { response } = await analyzeJobFitWithCaller(
      { jobDescriptionText: JD },
      'ip-control',
      CALLER
    );

    expect(response.recommendedStarEntries.map((e) => e.rawText)).toContain(MINE);
    expect(stub.catalogClauses(), 'the catalog is read exactly once').toHaveLength(1);
  });

  it('scopes the STAR-catalog read to the caller', async () => {
    const stub = install(MIXED_CATALOG);

    await analyzeJobFitWithCaller({ jobDescriptionText: JD }, 'ip-predicate', CALLER);

    // Ships as `db.select().from(quantifiedBullets)` — no `.where()` at all, so
    // there is no clause to inspect and `ownerParamOf` reports `undefined`.
    expectScopedTo(stub.catalogClauses()[0], CALLER);
  });

  it("does not rank or return another user's STAR rawText", async () => {
    install(MIXED_CATALOG);

    const { response } = await analyzeJobFitWithCaller(
      { jobDescriptionText: JD },
      'ip-leak',
      CALLER
    );

    expect(response.recommendedStarEntries.map((e) => e.rawText)).not.toContain(THEIRS);
    expect(response.recommendedStarEntries.map((e) => e.id)).toEqual(['01HZ_BUL_MINE']);
  });

  it('scopes the tech-stack and job-fit tag reads to the caller', async () => {
    const stub = install(MIXED_CATALOG);

    await analyzeJobFitWithCaller({ jobDescriptionText: JD }, 'ip-tags', CALLER);

    // Both tag tables carry `user_id NOT NULL` and both are read bare. The
    // matched `catalogEntry` slugs are echoed back in `strongMatches`, so this
    // is a second escape route out of the same endpoint.
    //
    // A downstream consequence is not asserted here because this harness
    // returns non-catalog fixtures unfiltered, so it cannot distinguish the
    // fixed code: `catalogEmpty` (`job-fit.service.ts:691`) is computed over
    // *everyone's* tags, so a user with no catalog of their own is told it is
    // populated and handed an analysis built from strangers' data instead of
    // the "upload a resume" empty state. That is the same unreachable-empty-
    // state defect WIC-1449 fixed for UC-6/UC-7's CATALOG_EMPTY. Scoping these
    // two reads fixes it; proving it needs a harness that filters every table.
    expect(stub.reads.some((r) => r.table === techStackTags)).toBe(true);
    for (const read of stub.reads) {
      if (read.table === techStackTags)
        expect(ownerOf('tech_stack_tags', read.clause)).toBe(CALLER);
      if (read.table === jobFitTags) expect(ownerOf('job_fit_tags', read.clause)).toBe(CALLER);
    }
  });
});

// ── D5: cover letters ─────────────────────────────────────────────────────────

describe('generateCoverLetter tenancy (D5 — fetchStarEntries ignores the caller)', () => {
  const ai = () => stubAnthropic(() => 'Dear Hiring Manager,\n\nRegards,\nA. Candidate');

  function install(catalog: CatalogRow[]) {
    const stub = stubDb({ catalog, tables: [[coverLetters, []]] });
    vi.mocked(getDb).mockReturnValue(stub.db as ReturnType<typeof getDb>);
    const anthropic = ai();
    anthropicCtor.mockReturnValue(anthropic.client.messages);
    return { stub, anthropic };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue({ anthropicApiKey: 'sk-test' } as never);
  });

  // Control: the caller's own id resolves and generation completes, so a
  // `STAR_ENTRY_NOT_FOUND` below is evidence about *scoping* and not about the
  // fixture being unreachable.
  //
  // Asserted with `toContain` rather than an exact list because the harness
  // deliberately models catalog *tenancy* only — it filters a read by the owner
  // term in its own rendered SQL and ignores the `inArray(id, …)` half. Pinning
  // the exact array here would be asserting on the stub, not on the service.
  it("accepts the caller's own STAR entry", async () => {
    const { stub, anthropic } = install([bullet()]);

    const result = await generateCoverLetter(
      {
        jobDescriptionText: JD,
        targetCompany: 'Acme Corp',
        targetRole: 'Senior Backend Engineer',
        selectedStarEntryIds: ['01HZ_BUL_MINE'],
      } as never,
      CALLER
    );

    expect(result.usedStarEntries.map((e) => e.rawText)).toContain(MINE);
    expect(anthropic.prompts[0]).toContain(MINE);
    expect(stub.catalogClauses()).toHaveLength(1);
  });

  it('scopes the STAR-entry read to the caller', async () => {
    const { stub } = install(MIXED_CATALOG);

    await generateCoverLetter(
      {
        jobDescriptionText: JD,
        targetCompany: 'Acme Corp',
        targetRole: 'Senior Backend Engineer',
        selectedStarEntryIds: ['01HZ_BUL_MINE'],
      } as never,
      CALLER
    );

    // Ships as `.where(inArray(quantifiedBullets.id, ids))` — a lone `inArray`
    // carries no owner term, which is precisely the case `toHaveBeenCalled()`
    // on `where` would wave through.
    //
    // WIC-1502: this asserted `ownerParamOf(...) === CALLER`. `ownerParamOf`
    // answers "which owner id appears in the rendered SQL", and that question
    // cannot separate `and(idTerm, ownerTerm)` from `or(idTerm, ownerTerm)` —
    // both render `"quantified_bullets"."user_id" = $n` and bind the caller.
    // Measured: threading the caller through `fetchStarEntries` with `or(...)`
    // made this assertion pass, firing the trip-wire and inviting the documented
    // `it.fails` -> `it` conversion — which yields a green suite over a live
    // IDOR. `expectScopedTo` evaluates the real boolean tree, so the `or` shape
    // throws and this wire stays green until the read is *actually* scoped.
    expectScopedTo(stub.catalogClauses()[0], CALLER, ['01HZ_BUL_MINE']);
  });

  it("rejects another user's STAR entry id as STAR_ENTRY_NOT_FOUND", async () => {
    install(MIXED_CATALOG);

    // The unscoped read makes the foreign row *found*, so the `invalidIds`
    // branch never fires. That branch is also an existence oracle: today it
    // reports whether an arbitrary bullet id exists anywhere in the table.
    await expect(
      generateCoverLetter(
        {
          jobDescriptionText: JD,
          targetCompany: 'Acme Corp',
          targetRole: 'Senior Backend Engineer',
          selectedStarEntryIds: ['01HZ_BUL_THEIRS'],
        } as never,
        CALLER
      )
    ).rejects.toBeInstanceOf(CoverLetterError);
  });

  it("keeps another user's rawText out of the prompt and the response", async () => {
    const { anthropic } = install(MIXED_CATALOG);

    // Deliberately not `await`ed into a value: once the read is scoped, the
    // foreign id becomes unknown and this call rejects at the `invalidIds`
    // branch *before* a prompt is ever built. Letting that rejection propagate
    // would make the assertions below unreachable, and an `it.fails` cannot
    // tell an unreachable assertion from a failing one — so the throw is
    // swallowed and the leak is asserted on what actually escaped.
    const result = await generateCoverLetter(
      {
        jobDescriptionText: JD,
        targetCompany: 'Acme Corp',
        targetRole: 'Senior Backend Engineer',
        selectedStarEntryIds: ['01HZ_BUL_MINE', '01HZ_BUL_THEIRS'],
      } as never,
      CALLER
    ).catch(() => null);

    // Two depths, because they fail independently: the prompt is where the
    // foreign sentence escapes first, and `usedStarEntries` is what the caller
    // reads back. The generated body is persisted to `cover_letters`, so unlike
    // UC-6's D1 this leak also outlives the request.
    expect(anthropic.prompts[0] ?? '', 'foreign rawText reached the model').not.toContain(THEIRS);
    expect(result?.usedStarEntries.map((e) => e.rawText) ?? []).not.toContain(THEIRS);
  });
});
