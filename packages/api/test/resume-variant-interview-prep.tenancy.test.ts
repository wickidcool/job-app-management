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
// Re-run one line at a time against the **whole** `packages/api` suite. Line
// numbers are as of the commit that adds this file; re-derive them with
// `grep -n` before trusting them, because five of the `resume_variants` lines
// are byte-identical and the card's own numbers had already drifted.
//
// Two different operators, because one of them is not executable everywhere —
// see "four gates" below:
//   [or]   flip `and(` → `or(`      (only where `or` is imported)
//   [drop] delete the owner term, collapsing the `userId` branch onto the
//          anonymous branch — needs no import, and is the shape of the real
//          defect rather than a boolean-logic typo
//
//   resume-variant.service.ts:511  getResumeVariant              [or]   RED ×1
//   resume-variant.service.ts:599  listResumeVariants and(...)   [or]   RED ×1
//   resume-variant.service.ts:633  updateResumeVariant UPDATE    [or]   RED ×2
//   resume-variant.service.ts:644  updateResumeVariant re-check  [or]   RED ×1
//   resume-variant.service.ts:659  deleteResumeVariant           [or]   RED ×1
//   resume-variant.service.ts:680  reviseResumeVariant           [or]   RED ×1
//   resume-variant.service.ts:895  exportResumeVariant           [or]   RED ×1
//   interviewPrep.service.ts:579   getInterviewPrep              [drop] RED ×1
//   interviewPrep.service.ts:626   getInterviewPrepByApplication [drop] RED ×1
//   interviewPrep.service.ts:648   updateInterviewPrep           [drop] RED ×1
//   interviewPrep.service.ts:796   logPracticeSession            [drop] RED ×1
//   interviewPrep.service.ts:960   exportInterviewPrep           [drop] RED ×1
//   interviewPrep.service.ts:1146  deleteInterviewPrep           [drop] RED ×1
//
// Second-hop predicates on `interview_prep_stories`, keyed on the prep rather
// than on an owner (see the describe block at the bottom of this file):
//
//   interviewPrep.service.ts:683   story update  interviewPrepId  [drop] RED ×1
//   interviewPrep.service.ts:901   story result  interviewPrepId  [drop] RED ×1
//
// The `×n` is the point. A site count only proves a mutation was *applied*; the
// kill count proves it changed *behaviour* this file can see. `:633` kills two
// because `or(id, version, userId)` breaks the 404 path and the 409 path at once
// — predicted before the run, and that is what the run returned.
//
// ## A mutation matrix needs four gates, not two (WIC-1610)
//
// The first revision of this matrix passed two gates and was still wrong twice.
//
//   1. the edit landed     — `git diff --numstat` == `1 1`
//   2. the suite noticed   — kill count matches the prediction
//   3. the mutant COMPILED — a mutant that does not parse produces no `Tests`
//      summary line at all, and a harness that greps for failures reads that
//      as a clean green. Anchoring one line off a multi-line `and(` is enough
//      to trigger it.
//   4. the failure MODE is the semantics you named — read the assertion text.
//      `interviewPrep.service.ts` imports `{ eq, and, sql }` and **no `or`**, so
//      all six `[or]` rows here originally went red on
//      `ReferenceError: or is not defined`. Diff gate green, kill counts green,
//      measuring a typo. Two further rows (`:680`, `:895`) went red on a
//      downstream `TypeError` after the guard let the row through — a real leak,
//      but reported as a crash, so those two cases now capture the outcome and
//      assert the tenancy violation *before* the error type.
//
// Under `[drop]`, five of the six `interview_preps` rows now fail with
// `promise resolved … instead of rejecting` — the entry point handing back a
// record the caller does not own, which is the actual finding.
//
// ## Negative control — exactly one, and it is reachable
//
//   resume-variant.service.ts:774  revise optimistic-lock write and(id, version)
//                                  REACHED and GREEN
//
// A control only means something if the suite executes the line. Probe it by
// replacing `and(` with an undefined identifier: a ReferenceError means the line
// runs, green means it never did. The first revision listed four controls and
// **all four were dead** — they would have stayed green with their predicate
// deleted outright, so their green was evidence of nothing.
//
//   - `:774` is now reached, by the happy-path case at the bottom of this file,
//     and stays green when its `version` term is dropped. That is a real control.
//   - `:681`/`:901` are now reached too, and are *not* controls: they are
//     load-bearing, so they moved into the matrix above as covered sites.
//   - `resume-variant.service.ts:638`, the anonymous-caller fallback, is
//     **withdrawn** rather than made reachable. Executing it means asserting
//     what the absent-caller branch does, and that branch reads the whole table
//     (WIC-1482, below). A green control bought by pinning a known fail-open as
//     intended behaviour is worse than no control.
//
// ## Adjacent, deliberately not fixed here
//
// Every site is `userId ? and(idTerm, ownerTerm) : <idTerm alone>`, and
// `listResumeVariants` is `if (userId) conditions.push(...)`. The absent-caller
// branch therefore reads the whole table rather than failing closed — the
// fail-open idiom WIC-1482 records. This card is test-only and the predicates it
// covers are correct as written, so that is left to its own change rather than
// smuggled in behind a coverage PR.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

// `reviseResumeVariant` is the only entry point here that reaches Anthropic, and
// it does so *after* the guard at :680. Reaching the optimistic-lock write below
// it — the one genuine negative control in this file — means completing the
// happy path, so the client has to be stubbed. Same factory shape as
// `llm.service.test.ts`.
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({ messages: { create: mockCreate } })),
    __mockCreate: mockCreate,
  };
});

async function getMockCreate(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('@anthropic-ai/sdk');
  return (mod as unknown as { __mockCreate: ReturnType<typeof vi.fn> }).__mockCreate;
}

import { getDb } from '../src/db/client.js';
import { _resetConfig } from '../src/config.js';
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
const MY_STORY = '01HZSTORYMINE000000000001';
const THEIR_STORY = '01HZSTORYTHEIRS0000000001';

const VARIANTS = 'resume_variants';
const PREPS = 'interview_preps';
const STORIES = 'interview_prep_stories';

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

/** An `interview_prep_stories` row. Note the table has its own nullable
 * `user_id`, which neither second-hop predicate uses — they key on
 * `interview_prep_id` and inherit tenancy from the prep read above them. That
 * inheritance is the thing the two cases at the bottom of this file execute. */
function storyRow(over: ProbeRow = {}): ProbeRow {
  return {
    id: MY_STORY,
    userId: CALLER,
    interviewPrepId: MINE,
    starEntryId: '01HZSTAR00000000000000001',
    themes: ['ownership'],
    relevanceScore: 80,
    oneMinVersion: 'one minute',
    twoMinVersion: 'two minutes',
    fiveMinVersion: 'five minutes',
    isFavorite: false,
    personalNotes: null,
    practiceCount: 0,
    lastPracticedAt: null,
    confidenceLevel: 'not_practiced',
    displayOrder: 0,
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
function stubTables(fixtures: Record<string, ProbeRow[]>): ScopedReadStub {
  const s = scopedReadStub(fixtures);
  vi.mocked(getDb).mockReturnValue(s.db as ReturnType<typeof getDb>);
  return s;
}

function stub(table: string, rows: ProbeRow[]): ScopedReadStub {
  return stubTables({ [table]: rows });
}

const storyFixture = () => [
  storyRow(),
  storyRow({ id: THEIR_STORY, interviewPrepId: THEIRS, userId: OTHER }),
];

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
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
  _resetConfig();
});

afterEach(() => {
  delete process.env['ANTHROPIC_API_KEY'];
  _resetConfig();
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
    //
    // WIC-1610: the outcome is captured rather than awaited through
    // `rejects.toBeInstanceOf` so that the *tenancy* assertion is the one that
    // fires. Past the guard this entry point runs on into the AI client and
    // dies on a downstream `TypeError`, and a red spelled
    // `expected TypeError … to be an instance of NotFoundError` is the same
    // uninformative failure mode as the `or is not defined` rows this card
    // corrected — it would score identically for an unrelated crash. The
    // recorded ops are what prove the foreign row was reached, and they are
    // recorded either way. The error type is still asserted, below.
    const outcome = await reviseResumeVariant(
      THEIRS,
      { instructions: 'Tighten it', version: 1 } as never,
      CALLER
    ).then(
      () => 'resolved',
      (e: unknown) => e
    );

    expectNothingForeignReached(s, VARIANTS, {
      table: VARIANTS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { version: 1 },
    });

    expect(outcome, 'and the caller is told the variant does not exist').toBeInstanceOf(
      NotFoundError
    );
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

    // Outcome captured for the same reason as `reviseResumeVariant` above: past
    // the guard this one runs on into the document renderer and dies there, so
    // awaiting `rejects.toBeInstanceOf` would report a `TypeError` instead of
    // the tenancy violation that caused it (WIC-1610).
    const outcome = await exportResumeVariant(
      THEIRS,
      { format: 'docx', headerInfo: { name: 'A', email: 'a@example.com' } } as never,
      CALLER
    ).then(
      () => 'resolved',
      (e: unknown) => e
    );

    expectNothingForeignReached(s, VARIANTS, {
      table: VARIANTS,
      userId: CALLER,
      ids: [THEIRS],
      extra: { version: 1 },
    });

    expect(outcome, 'and the caller is told the variant does not exist').toBeInstanceOf(
      NotFoundError
    );
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

describe('interview_prep_stories — second-hop writes inherit tenancy from the prep read', () => {
  // WIC-1610. These two lines were listed as *negative controls* in the first
  // revision of this file. A reachability probe — replace `and(` with an
  // undefined identifier and look for a ReferenceError — showed that no test in
  // the suite executed either of them, so their green meant "never ran", not
  // "ran and was unmoved". They would have stayed green with the predicate
  // deleted outright.
  //
  // Reached, they are not controls at all: they are load-bearing. Neither
  // carries an owner term, and `interview_prep_stories` has its own nullable
  // `user_id` they do not use, so the *only* thing standing between a
  // caller-supplied `storyId` and another prep's story is the
  // `interview_prep_id` term plus the scoped prep read one statement earlier.
  // Drop that term and the caller edits a story hanging off a prep they were
  // just told does not exist.

  it('updateInterviewPrep will not edit a story hanging off another prep', async () => {
    const s = stubTables({ [PREPS]: prepFixture(), [STORIES]: storyFixture() });

    await updateInterviewPrep(
      MINE,
      { version: 1, storyUpdates: [{ storyId: THEIR_STORY, isFavorite: true }] } as never,
      CALLER
    );

    const writes = s.opsOn(STORIES).filter((o) => o.op === 'update');
    expect(writes, 'the story UPDATE must actually have been issued').toHaveLength(1);
    expect(
      writes[0].rows.map((r) => r.id),
      'a story belonging to another prep must not be reachable by story id alone'
    ).toEqual([]);
  });

  it('updateInterviewPrep does edit the caller’s own story — the guard is not "match nothing"', async () => {
    // Positive control (WIC-1434): without it, deleting the whole predicate and
    // resolving the empty set for every clause would satisfy the case above.
    const s = stubTables({ [PREPS]: prepFixture(), [STORIES]: storyFixture() });

    await updateInterviewPrep(
      MINE,
      { version: 1, storyUpdates: [{ storyId: MY_STORY, isFavorite: true }] } as never,
      CALLER
    );

    const writes = s.opsOn(STORIES).filter((o) => o.op === 'update');
    expect(
      writes[0].rows.map((r) => r.id),
      'the caller’s own story is still reachable'
    ).toEqual([MY_STORY]);
  });

  it('logPracticeSession will not record a result against another prep’s story', async () => {
    const s = stubTables({ [PREPS]: prepFixture(), [STORIES]: storyFixture() });

    await logPracticeSession(
      MINE,
      {
        version: 1,
        startedAt: '2026-02-01T10:00:00.000Z',
        endedAt: '2026-02-01T10:30:00.000Z',
        type: 'story_drill',
        focusAreas: [],
        questionResults: [],
        gapResults: [],
        storyResults: [{ storyId: THEIR_STORY, confidenceRating: 'confident' }],
      } as never,
      CALLER
    );

    const writes = s.opsOn(STORIES).filter((o) => o.op === 'update');
    expect(writes, 'the story result UPDATE must actually have been issued').toHaveLength(1);
    expect(
      writes[0].rows.map((r) => r.id),
      'practice results must not land on another prep’s story'
    ).toEqual([]);
  });
});

describe('negative control — a non-tenancy predicate the suite really does execute', () => {
  // The point of a negative control is to show this file goes red for *tenancy*
  // regressions specifically, rather than for any mutation anywhere. That only
  // means something if the mutated line runs. `reviseResumeVariant`'s
  // optimistic-lock write `and(id, version)` sits after the scoped read at :680,
  // so every foreign-id case above throws before reaching it — which is exactly
  // why it was dead. Completing the happy path is what makes it live.
  it('reviseResumeVariant completes for the owner, executing the optimistic-lock write', async () => {
    const s = stub(VARIANTS, variantFixture());
    const create = await getMockCreate();
    create.mockResolvedValue({
      content: [
        { type: 'text', text: JSON.stringify({ experience: [], skills: [], education: [] }) },
      ],
    });

    const result = await reviseResumeVariant(
      MINE,
      { instructions: 'Tighten the summary', version: 1 } as never,
      CALLER
    );

    expect(result.variant.id, 'the owner gets their own variant back').toBe(MINE);

    const writes = s.opsOn(VARIANTS).filter((o) => o.op === 'update');
    expect(writes, 'the optimistic-lock UPDATE is the line under control').toHaveLength(1);
    expect(writes[0].rows.map((r) => r.id)).toEqual([MINE]);
  });
});
