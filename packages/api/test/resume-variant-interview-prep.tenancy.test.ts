// WIC-1537 — the tenancy predicates on `resume_variants` and `interview_preps`
// that nothing would have noticed regressing.
//
// ## What was measured
//
// One site at a time, every `and(idTerm, ownerTerm)` tenancy predicate in these
// two services was flipped to `or(...)` — a live cross-tenant IDOR, since
// `or(eq(id, X), eq(user_id, caller))` returns row `X` whoever owns it — and the
// **full** `packages/api` suite was run against the mutant. Eleven of the
// fourteen sites surveyed left the suite entirely green. The three that went red
// were red only because PR #153 had just written cases that address them with a
// foreign id.
//
// The predicates are correct today. This file is not a fix; it is the missing
// detector. Same distinction as WIC-1502: adopting a stronger evaluator makes a
// defect *detectable*, not *detected* — something has to actually pass a foreign
// id to the entry point.
//
// ## Enumerated by property, not by call shape
//
// The original survey enumerated sites by grepping the shape `and(id, ownerId)`.
// That shape-scoped sweep is the exact mistake WIC-1437 recorded: it misses a
// site with the same *property* but a different arity. `updateResumeVariant`'s
// primary UPDATE is `and(id, version, userId)` — three terms — and it is a
// tenancy predicate on caller-supplied ids just as much as the two-term ones.
// `listResumeVariants` is the same blind spot again from the other direction: it
// pushes the owner term into an array and combines it as `and(...conditions)`,
// so no `and(id, ownerId)` grep can see it either.
//
// Re-derived from the tree, the two services carry **thirteen** owner-bearing
// predicates, not eleven, and all thirteen are covered below.
//
// ## Why the negative case is the one that means anything
//
// A positive case ("the caller gets their own row") passes under `or` too. Every
// case here has caller A ask for an id owned by B and requires the read to
// resolve nothing, and asserts the clause with `expectScopedTo`, which evaluates
// the real boolean tree rather than checking that an owner term is present
// somewhere in the rendered SQL.
//
// The `db` stub is `scopedReadStub`, which filters fixtures through that same
// evaluator. A stub that resolves a canned row set regardless of the clause
// reports green against the scoped and the leaking service alike — that is how
// these twelve sites stayed uncovered while looking covered.
//
// ## The matrix this file is accepted against
//
// Re-run by flipping `and(` → `or(` on exactly one line and running this file.
// Line numbers are as of the commit that adds this file; re-derive them with
// `grep -n 'and('` before trusting them, because five of the `resume_variants`
// lines are byte-identical and the card's own numbers had already drifted.
//
//   resume-variant.service.ts:511  getResumeVariant                    RED ×1
//   resume-variant.service.ts:599  listResumeVariants and(...conditions) RED ×1
//   resume-variant.service.ts:633  updateResumeVariant UPDATE           RED ×2
//   resume-variant.service.ts:644  updateResumeVariant re-check         RED ×1
//   resume-variant.service.ts:659  deleteResumeVariant                  RED ×1
//   resume-variant.service.ts:680  reviseResumeVariant                  RED ×1
//   resume-variant.service.ts:895  exportResumeVariant                  RED ×1
//   interviewPrep.service.ts:579   getInterviewPrep                     RED ×1
//   interviewPrep.service.ts:626   getInterviewPrepByApplication        RED ×1
//   interviewPrep.service.ts:648   updateInterviewPrep                  RED ×1
//   interviewPrep.service.ts:796   logPracticeSession                   RED ×1
//   interviewPrep.service.ts:960   exportInterviewPrep                  RED ×1
//   interviewPrep.service.ts:1146  deleteInterviewPrep                  RED ×1
//
// The `×n` is the point. A site count only proves a mutation was *applied*; the
// kill count proves it changed *behaviour* this file can see. `:633` kills two
// because `or(id, version, userId)` breaks the 404 path and the 409 path at once
// — predicted before the run, and that is what the run returned.
//
// ## Negative controls — these must stay GREEN
//
//   resume-variant.service.ts:774  revise optimistic-lock write and(id, version)
//   resume-variant.service.ts:638  update anonymous fallback    and(id, version)
//   interviewPrep.service.ts:681   story update  and(storyId, interviewPrepId)
//   interviewPrep.service.ts:901   story result  and(storyId, interviewPrepId)
//
// None carries an owner term; each is guarded upstream by one of the scoped
// reads above. All four stayed green, which is what distinguishes this file from
// one that is merely mutation-sensitive in general.
//
// ## Adjacent, deliberately not fixed here
//
// Every site is `userId ? and(idTerm, ownerTerm) : <idTerm alone>`, and
// `listResumeVariants` is `if (userId) conditions.push(...)`. The absent-caller
// branch therefore reads the whole table rather than failing closed — the
// fail-open idiom WIC-1482 records. This card is test-only and the predicates it
// covers are correct as written, so that is left to its own change rather than
// smuggled in behind a coverage PR.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client.js';
import {
  getResumeVariant,
  listResumeVariants,
  updateResumeVariant,
  deleteResumeVariant,
  reviseResumeVariant,
  exportResumeVariant,
} from '../src/services/resume-variant.service.js';
import {
  getInterviewPrep,
  getInterviewPrepByApplication,
  updateInterviewPrep,
  logPracticeSession,
  exportInterviewPrep,
  deleteInterviewPrep,
} from '../src/services/interviewPrep.service.js';
import { NotFoundError, VersionConflictError } from '../src/types/index.js';
import { scopedReadStub, type ScopedReadStub } from './helpers/scoped-read-stub.js';
import { expectScopedTo, type ProbeRow } from './helpers/tenancy.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';
const OTHER = 'c2a91e77-5f30-4d18-8a41-6b0e9d3c8f12';

const MINE = '01HZVARIANTMINE00000000001';
const THEIRS = '01HZVARIANTTHEIRS000000001';
const MY_APP = '01HZAPPMINE00000000000001';
const THEIR_APP = '01HZAPPTHEIRS000000000001';

const VARIANTS = 'resume_variants';
const PREPS = 'interview_preps';

/** A `resume_variants` row rich enough that the service can read past the guard. */
function variantRow(over: ProbeRow = {}): ProbeRow {
  return {
    id: MINE,
    userId: CALLER,
    applicationId: MY_APP,
    title: 'Senior Backend Engineer — Acme',
    status: 'draft',
    version: 1,
    baseResumeId: null,
    content: { experience: [], skills: [], education: [] },
    selectedBullets: [],
    selectedTechTags: [],
    sectionOrder: null,
    hiddenSections: null,
    format: null,
    sectionEmphasis: null,
    atsScore: null,
    revisionHistory: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

/** An `interview_preps` row rich enough that the service can read past the guard. */
function prepRow(over: ProbeRow = {}): ProbeRow {
  return {
    id: MINE,
    userId: CALLER,
    applicationId: MY_APP,
    interviewType: 'behavioral',
    timeAvailable: '1_week',
    focusAreas: [],
    generatedQuestions: [],
    gapMitigations: [],
    quickReference: null,
    practiceSessions: [],
    completeness: 40,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

/**
 * Both rows always exist. The foreign row is what the mutation would hand back,
 * so it has to be in the fixture — an empty table would make every entry point
 * "fail closed" for the wrong reason and the whole file would pass under `or`.
 */
function stub(table: string, rows: ProbeRow[]): ScopedReadStub {
  const s = scopedReadStub({ [table]: rows });
  vi.mocked(getDb).mockReturnValue(s.db as ReturnType<typeof getDb>);
  return s;
}

const variantFixture = () => [variantRow(), variantRow({ id: THEIRS, userId: OTHER })];
const prepFixture = () => [
  prepRow(),
  prepRow({ id: THEIRS, userId: OTHER, applicationId: THEIR_APP }),
];

/**
 * Every read/write this entry point issued against `table` must be restricted to
 * the caller, and none of them may have resolved the foreign row.
 */
function expectNothingForeignReached(
  s: ScopedReadStub,
  table: string,
  expectation: Parameters<typeof expectScopedTo>[1]
): void {
  const ops = s.opsOn(table);
  expect(
    ops.length,
    `no operation on "${table}" was recorded — the assertions below would pass vacuously`
  ).toBeGreaterThan(0);
  for (const op of ops) {
    expect(
      op.rows.map((r) => r.userId),
      `a ${op.op} on "${table}" resolved a row the caller does not own`
    ).not.toContain(OTHER);
    expectScopedTo(op.clause, expectation);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resume_variants — caller-supplied id reads are scoped to the caller', () => {
  it('getResumeVariant does not resolve another user’s variant', async () => {
    const s = stub(VARIANTS, variantFixture());

    await expect(getResumeVariant(THEIRS, CALLER)).rejects.toBeInstanceOf(NotFoundError);

    expectNothingForeignReached(s, VARIANTS, {
      table: VARIANTS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { version: 1 },
    });
  });

  it('updateResumeVariant scopes both the UPDATE and its existence re-check', async () => {
    const s = stub(VARIANTS, variantFixture());

    await expect(
      updateResumeVariant(THEIRS, { title: 'Renamed', version: 1 } as never, CALLER)
    ).rejects.toBeInstanceOf(NotFoundError);

    // Two distinct predicates: the optimistic-locking UPDATE `and(id, version,
    // userId)` and, when it matches nothing, the `and(id, userId)` re-check that
    // decides between 404 and 409. The three-term one is the site the shape-based
    // sweep missed; without the owner term it would rename another user's variant
    // outright, and without it on the re-check a foreign id would answer 409
    // instead of 404 and confirm the row exists.
    const ops = s.opsOn(VARIANTS);
    expect(
      ops.map((o) => o.op),
      'the UPDATE runs first, then the existence re-check'
    ).toEqual(['update', 'select']);

    expectNothingForeignReached(s, VARIANTS, {
      table: VARIANTS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { version: 1 },
    });
  });

  it('updateResumeVariant still answers 409 for the caller’s own stale version', async () => {
    // The re-check's owner term must not be so strong that it swallows the
    // conflict case: this is what stops "scope it" being satisfied by a
    // predicate that matches nothing at all.
    const s = stub(VARIANTS, variantFixture());

    await expect(
      updateResumeVariant(MINE, { title: 'Renamed', version: 99 } as never, CALLER)
    ).rejects.toBeInstanceOf(VersionConflictError);

    const [, recheck] = s.opsOn(VARIANTS);
    expect(
      recheck.rows.map((r) => r.id),
      'the re-check found the caller’s own row'
    ).toEqual([MINE]);
  });

  it('deleteResumeVariant does not delete another user’s variant', async () => {
    const s = stub(VARIANTS, variantFixture());

    await expect(deleteResumeVariant(THEIRS, CALLER)).rejects.toBeInstanceOf(NotFoundError);

    expectNothingForeignReached(s, VARIANTS, {
      table: VARIANTS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { version: 1 },
    });
  });

  it('reviseResumeVariant does not load another user’s variant into the LLM prompt', async () => {
    const s = stub(VARIANTS, variantFixture());

    // The guard fires before any Anthropic call, which is also why an unscoped
    // read here would put another user's resume content into a prompt.
    await expect(
      reviseResumeVariant(THEIRS, { instructions: 'Tighten it', version: 1 } as never, CALLER)
    ).rejects.toBeInstanceOf(NotFoundError);

    expectNothingForeignReached(s, VARIANTS, {
      table: VARIANTS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { version: 1 },
    });
  });

  it('listResumeVariants keeps the owner term when a filter is combined with it', async () => {
    // A thirteenth site, and one neither the original survey nor its `and(id,
    // ownerId)` grep could see: the owner term is *pushed into an array* and
    // combined as `and(...conditions)`. The `conditions.length === 1` shortcut
    // means the combinator is only reached once a filter is supplied, so the
    // leak is conditional on a query parameter — which is precisely why an
    // unfiltered smoke test would have missed it.
    const s = stub(VARIANTS, [
      variantRow({ status: 'draft' }),
      variantRow({ id: THEIRS, userId: OTHER, status: 'draft' }),
    ]);

    const result = await listResumeVariants({ status: 'draft' }, CALLER);

    expect(
      result.variants.map((v) => v.id),
      'the list must not spill another user’s variants'
    ).toEqual([MINE]);
    expectScopedTo(s.clausesOn(VARIANTS)[0], {
      table: VARIANTS,
      userId: CALLER,
      extra: { status: 'draft', version: 1 },
    });
  });

  it('exportResumeVariant does not render another user’s variant to a document', async () => {
    const s = stub(VARIANTS, variantFixture());

    await expect(
      exportResumeVariant(
        THEIRS,
        { format: 'docx', headerInfo: { name: 'A', email: 'a@example.com' } } as never,
        CALLER
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    expectNothingForeignReached(s, VARIANTS, {
      table: VARIANTS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { version: 1 },
    });
  });
});

describe('interview_preps — caller-supplied id reads are scoped to the caller', () => {
  it('getInterviewPrep does not resolve another user’s prep', async () => {
    const s = stub(PREPS, prepFixture());

    await expect(getInterviewPrep(THEIRS, CALLER)).rejects.toBeInstanceOf(NotFoundError);

    expectNothingForeignReached(s, PREPS, {
      table: PREPS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { applicationId: MY_APP },
    });
  });

  it('getInterviewPrepByApplication scopes on application_id, not just on the owner', async () => {
    const s = stub(PREPS, prepFixture());

    await expect(getInterviewPrepByApplication(THEIR_APP, CALLER)).rejects.toBeInstanceOf(
      NotFoundError
    );

    // The only site in either service keyed on `applicationId` rather than the
    // primary key, so `idKey` moves with it — asserting the id half against `id`
    // here would pass vacuously.
    expectNothingForeignReached(s, PREPS, {
      table: PREPS,
      userId: CALLER,
      idKey: 'applicationId',
      ids: [THEIR_APP],
      extra: { id: MINE },
    });
  });

  it('updateInterviewPrep does not mutate another user’s prep', async () => {
    const s = stub(PREPS, prepFixture());

    await expect(
      updateInterviewPrep(THEIRS, { interviewType: 'technical', version: 1 } as never, CALLER)
    ).rejects.toBeInstanceOf(NotFoundError);

    expectNothingForeignReached(s, PREPS, {
      table: PREPS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { applicationId: MY_APP },
    });
  });

  it('logPracticeSession does not append a session to another user’s prep', async () => {
    const s = stub(PREPS, prepFixture());

    await expect(
      logPracticeSession(THEIRS, { version: 1, questionResults: [] } as never, CALLER)
    ).rejects.toBeInstanceOf(NotFoundError);

    expectNothingForeignReached(s, PREPS, {
      table: PREPS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { applicationId: MY_APP },
    });
  });

  it('exportInterviewPrep does not render another user’s prep to a document', async () => {
    const s = stub(PREPS, prepFixture());

    await expect(exportInterviewPrep(THEIRS, 'markdown', undefined, CALLER)).rejects.toBeInstanceOf(
      NotFoundError
    );

    expectNothingForeignReached(s, PREPS, {
      table: PREPS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { applicationId: MY_APP },
    });
  });

  it('deleteInterviewPrep does not delete another user’s prep', async () => {
    const s = stub(PREPS, prepFixture());

    await expect(deleteInterviewPrep(THEIRS, CALLER)).rejects.toBeInstanceOf(NotFoundError);

    expectNothingForeignReached(s, PREPS, {
      table: PREPS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { applicationId: MY_APP },
    });
  });
});

describe('the stub itself would report the leak', () => {
  // If this ever goes green-by-construction — a stub that filters nothing, or
  // one that resolves the empty set for every clause — the twelve cases above
  // stop meaning anything. This pins the two failure modes directly.
  it('resolves the foreign row when the predicate admits it', async () => {
    const { db, opsOn } = scopedReadStub({ [VARIANTS]: variantFixture() });
    const { eq, or } = await import('drizzle-orm');
    const { resumeVariants } = await import('../src/db/schema.js');

    const rows = await (db as { select: () => Record<string, (a?: unknown) => unknown> })
      .select()
      // The exact mutant: `or` where the service has `and`.
      .from(resumeVariants)
      .where(or(eq(resumeVariants.id, THEIRS), eq(resumeVariants.userId, CALLER)));

    expect(
      (rows as ProbeRow[]).map((r) => r.id),
      'under `or` the caller reads their own row *and* the foreign one'
    ).toEqual([MINE, THEIRS]);
    expect(opsOn(VARIANTS)).toHaveLength(1);
  });

  it('resolves the caller’s row when the predicate is the real one', async () => {
    const { db } = scopedReadStub({ [VARIANTS]: variantFixture() });
    const { eq, and } = await import('drizzle-orm');
    const { resumeVariants } = await import('../src/db/schema.js');

    const rows = await (db as { select: () => Record<string, (a?: unknown) => unknown> })
      .select()
      .from(resumeVariants)
      .where(and(eq(resumeVariants.id, MINE), eq(resumeVariants.userId, CALLER)));

    expect((rows as ProbeRow[]).map((r) => r.id)).toEqual([MINE]);
  });
});
