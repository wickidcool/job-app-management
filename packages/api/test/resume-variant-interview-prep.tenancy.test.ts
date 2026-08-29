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
// Those predicates were correct as written; WIC-1537 added no fix, only the
// missing detector. Same distinction as WIC-1502: adopting a stronger evaluator
// makes a defect *detectable*, not *detected* — something has to actually pass a
// foreign id to the entry point. WIC-1601 then supplied the defects (see below),
// so the file now carries both halves.
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
// Re-derived from the tree, the two services carried **thirteen** owner-bearing
// predicates, not eleven, and all thirteen are covered below. WIC-1601 added the
// owner term to seven more reads that had none, so the matrix is twenty sites
// plus the two shared anonymous-fallback cells.
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
// ## WIC-1601 — what this file became
//
// WIC-1537 left two residuals explicitly unfixed, and WIC-1601 closed both in
// the change that also grew this file. So the sections below the original twelve
// cases are a *fix*'s detector rather than a coverage backfill, and the header
// matrix is re-derived for the fixed tree:
//
//   a. **Reads with no owner term at all.** The same entry points read
//      `resumes`, `tech_stack_tags` and `applications` on a caller-supplied id
//      with no owner term — three of them with no `.where()` whatsoever. Same
//      detector, pointed one table across.
//   b. **The absent-caller fail-open.** Every predicate was
//      `userId ? and(idTerm, ownerTerm) : <idTerm alone>` and
//      `listResumeVariants` was `if (userId) conditions.push(...)`, so an
//      anonymous caller read the whole table. Both now go through a single
//      `ownerScope(table, userId)` that returns `isNull(table.userId)` rather
//      than `undefined`.
//
// The `quantified_bullets` half of the original WIC-1601 report is **not** here:
// all seven of those sites are fixed on the WIC-1449 branch (PR #153), which was
// not in this branch's base when the card was written. Re-derived against the
// tree rather than the card, this change's residual was seven sites, not eleven.
//
// ## The matrix this file is accepted against
//
// There are two matrices, measured on two different trees, and both are kept:
// A on the pre-fix tree (WIC-1537 + WIC-1610, PR #203), B on this tree with
// WIC-1601's fix applied (PR #206). Neither renumbers the other — a matrix is
// only meaningful against the tree it was run on.
//
// ### Matrix B — this tree, WIC-1601's fix applied
//
// Re-run by mutating exactly one line and running this file. Line numbers are as
// of the merge commit that composes #203 and #206; re-derive them with
// `grep -n 'ownerScope('` before trusting them, because five of the
// `resume_variants` lines are byte-identical and the original card's numbers had
// already drifted.
//
//   resume-variant.service.ts:228   generateResumeVariant baseResumeId    RED ×2
//   resume-variant.service.ts:267   generateResumeVariant techTags        RED ×2
//   resume-variant.service.ts:555   getResumeVariant                      RED ×2
//   resume-variant.service.ts:589   getResumeVariant baseResume           RED ×1
//   resume-variant.service.ts:619   listResumeVariants owner condition †  RED ×2
//   resume-variant.service.ts:679   updateResumeVariant UPDATE            RED ×3
//   resume-variant.service.ts:688   updateResumeVariant re-check          RED ×2
//   resume-variant.service.ts:701   deleteResumeVariant                   RED ×2
//   resume-variant.service.ts:720   reviseResumeVariant                   RED ×1
//   resume-variant.service.ts:933   exportResumeVariant                   RED ×1
//   resume-variant.service.ts:72    ownerScope anonymous fallback ‡       RED ×6
//   interviewPrep.service.ts:427    generateInterviewPrep application     RED ×2
//   interviewPrep.service.ts:443    generateInterviewPrep prep uniqueness RED ×1
//   interviewPrep.service.ts:608    getInterviewPrep                      RED ×2
//   interviewPrep.service.ts:629    getInterviewPrep application          RED ×1
//   interviewPrep.service.ts:653    getInterviewPrepByApplication         RED ×2
//   interviewPrep.service.ts:676    updateInterviewPrep                   RED ×1
//   interviewPrep.service.ts:822    logPracticeSession                    RED ×1
//   interviewPrep.service.ts:984    exportInterviewPrep                   RED ×1
//   interviewPrep.service.ts:1000   exportInterviewPrep application       RED ×1
//   interviewPrep.service.ts:1168   deleteInterviewPrep                   RED ×1
//   interviewPrep.service.ts:48     ownerScope anonymous fallback ‡       RED ×3
//
// ### Matrix A — the pre-fix tree (PR #203, WIC-1537 as corrected by WIC-1610)
//
// Kept verbatim because it is the acceptance record of the change this one is
// stacked on, and its line numbers belong to that tree, not this one.
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
//   † not an `and(`→`or(` flip — the owner term is an array element, so the
//     mutation is dropping it: `[ownerScope(…) as any]` → `[]`.
//   ‡ `isNull(table.userId)` → `undefined`, i.e. restoring the fail-open. This
//     is the only aggregate cell in the matrix, because the fallback genuinely
//     is one shared decision rather than a per-site one.
//
// All 22 went red at exactly the count predicted before the run. The `×n` is the
// point: a site count only proves a mutation was *applied*, the kill count
// proves it changed *behaviour* this file can see (WIC-1574). `:679` kills three
// because `or(id, version, userId)` breaks the 404 path, the 409 path and the
// anonymous path at once.
//
// Two traps this matrix hit and had to be re-run past, both worth keeping:
//
// - `interviewPrep.service.ts` does not import `or`. The first pass flipped
//   `and(`→`or(` there and every cell went red on `ReferenceError: or is not
//   defined` — a kill that fires against a perfectly scoped predicate too, so
//   those cells measured nothing. The operator has to be imported as part of the
//   mutant, and an **import-only** cell (kills 0) is what proves the import is
//   not itself what the tests are seeing.
// - Three ip cells over-shot their prediction before that fix, which is what
//   exposed it. A cell that kills *more* than predicted deserves the same
//   scrutiny as one that kills less.
//
// The reads that carried no owner term at all are not in the table above,
// because their revert-to-the-bug cell is the state of the tree before this
// change: all seven of the WIC-1601 cases below were run red against it first
// and each named the value it leaked — a foreign `resumes.fileName`, `['CFO',
// 'Umbrella']` out of `getInterviewPrep`, and the filename
// `interview-prep-umbrella-2026-08-27.md` out of `exportInterviewPrep`.
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
// WIC-1610's account of the controls is the one that survives this merge, and
// it **overrides** the three-control list WIC-1601 carried before it. That list
// asserted "all three stayed green, which is what distinguishes this file from
// one that is merely mutation-sensitive" — but two of the three were never
// controls at all, so that sentence was claiming reachability it had not
// probed. Superseded, not renumbered (WIC-1545).
//
//   resume-variant.service.ts:813  revise optimistic-lock write and(id, version)
//                                  REACHED and GREEN — the one real control
//
// A control only means something if the suite executes the line. Probe it by
// replacing `and(` with an undefined identifier: a ReferenceError means the line
// runs, green means it never did. WIC-1537's first revision listed four controls
// and **all four were dead** — they would have stayed green with their predicate
// deleted outright, so their green was evidence of nothing.
//
//   - `:813` (`:774` pre-fix) is reached by the happy-path case at the bottom of
//     this file, and stays green when its `version` term is dropped. Real.
//   - `interviewPrep.service.ts:708`/`:926` (`:683`/`:901` pre-fix) are reached
//     too, and are *not* controls: they are load-bearing, so they moved into the
//     matrix above as covered sites with their own cases.
//   - `resume-variant.service.ts:638`, the anonymous-caller fallback, was
//     **withdrawn** rather than made reachable, because executing it would pin
//     the WIC-1482 fail-open as intended behaviour. On this tree it is moot:
//     WIC-1601 deleted the branch it lived on. Recorded because a control
//     silently vanishing from a list is indistinguishable from one quietly
//     dropped for failing.
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
  generateResumeVariant,
  getResumeVariant,
  listResumeVariants,
  updateResumeVariant,
  deleteResumeVariant,
  reviseResumeVariant,
  exportResumeVariant,
} from '../src/services/resume-variant.service.js';
import {
  generateInterviewPrep,
  getInterviewPrep,
  getInterviewPrepByApplication,
  updateInterviewPrep,
  logPracticeSession,
  exportInterviewPrep,
  deleteInterviewPrep,
} from '../src/services/interviewPrep.service.js';
import { NotFoundError, VersionConflictError } from '../src/types/index.js';
import { scopedReadStub, type ScopedReadStub } from './helpers/scoped-read-stub.js';
import { expectScopedTo, predicateFor, type ProbeRow } from './helpers/tenancy.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';
const OTHER = 'c2a91e77-5f30-4d18-8a41-6b0e9d3c8f12';

const MINE = '01HZVARIANTMINE00000000001';
const THEIRS = '01HZVARIANTTHEIRS000000001';
const MY_APP = '01HZAPPMINE00000000000001';
const THEIR_APP = '01HZAPPTHEIRS000000000001';
const MY_RESUME = '01HZRESUMEMINE0000000001';
const THEIR_RESUME = '01HZRESUMETHEIRS00000001';
const MY_TAG = '01HZTAGMINE00000000000001';
const THEIR_TAG = '01HZTAGTHEIRS0000000001';
const MY_STORY = '01HZSTORYMINE000000000001';
const THEIR_STORY = '01HZSTORYTHEIRS0000000001';

const VARIANTS = 'resume_variants';
const PREPS = 'interview_preps';
const RESUMES = 'resumes';
const TAGS = 'tech_stack_tags';
const APPS = 'applications';
const BULLETS = 'quantified_bullets';
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

/** An `applications` row, as the two services read it. */
function appRow(over: ProbeRow = {}): ProbeRow {
  return {
    id: MY_APP,
    userId: CALLER,
    jobTitle: 'Senior Backend Engineer',
    company: 'Acme',
    status: 'applied',
    version: 1,
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

/** A `resumes` row, as `generateResumeVariant`/`getResumeVariant` read it. */
function resumeRow(over: ProbeRow = {}): ProbeRow {
  return { id: MY_RESUME, userId: CALLER, fileName: 'mine.pdf', version: 1, ...over };
}

/** A `tech_stack_tags` row. `user_id` is NOT NULL and `(user_id, tag_slug)` is unique. */
function tagRow(over: ProbeRow = {}): ProbeRow {
  return { id: MY_TAG, userId: CALLER, tagSlug: 'postgres', displayName: 'Postgres', ...over };
}

/**
 * Both rows always exist. The foreign row is what the mutation would hand back,
 * so it has to be in the fixture — an empty table would make every entry point
 * "fail closed" for the wrong reason and the whole file would pass under `or`.
 */
function stub(table: string, rows: ProbeRow[]): ScopedReadStub {
  return stubTables({ [table]: rows });
}

/** The same, for the entry points that read more than one table. */
function stubTables(fixtures: Record<string, ProbeRow[]>): ScopedReadStub {
  const s = scopedReadStub(fixtures);
  vi.mocked(getDb).mockReturnValue(s.db as ReturnType<typeof getDb>);
  return s;
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

// ── WIC-1601 — the reads on the *other* tables these services touch ───────────
//
// Everything above asks whether the read of the service's own table is scoped.
// These ask the question the moment the same entry point reads a *different*
// table on a caller-supplied id — `resumes`, `tech_stack_tags`, `applications`
// — where the predicate was `eq(id, <caller-supplied>)` with no owner term at
// all. Same detector, pointed one table across.

const JD = { targetCompany: 'Acme', targetRole: 'Staff Engineer', jobDescriptionText: 'Postgres' };

describe('resume_variants — the foreign tables the same entry points read', () => {
  it('generateResumeVariant does not accept another user’s resume as the base', async () => {
    // Unscoped this is an existence oracle on `resumes` — `BASE_RESUME_NOT_FOUND`
    // vs. anything-else tells the caller whether an id they guessed is real —
    // and it writes the foreign id into `resume_variants.baseResumeId`, which is
    // what `getResumeVariant` then re-reads (next case but one).
    const s = stubTables({
      [RESUMES]: [resumeRow(), resumeRow({ id: THEIR_RESUME, userId: OTHER })],
      [BULLETS]: [],
    });

    await expect(
      generateResumeVariant({ ...JD, baseResumeId: THEIR_RESUME } as never, CALLER)
    ).rejects.toMatchObject({ code: 'BASE_RESUME_NOT_FOUND' });

    expectNothingForeignReached(s, RESUMES, {
      table: RESUMES,
      userId: CALLER,
      ids: [THEIR_RESUME],
    });
  });

  it('generateResumeVariant does not accept another user’s tech tag', async () => {
    // `tech_stack_tags.user_id` is NOT NULL with a unique index on
    // `(user_id, tag_slug)`, so the table is per-user and not the global catalog
    // the card left open as a question.
    const s = stubTables({
      [TAGS]: [tagRow(), tagRow({ id: THEIR_TAG, userId: OTHER, tagSlug: 'kafka' })],
      [BULLETS]: [],
    });

    await expect(
      generateResumeVariant({ ...JD, selectedTechTags: [THEIR_TAG] } as never, CALLER)
    ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });

    expectNothingForeignReached(s, TAGS, { table: TAGS, userId: CALLER, ids: [THEIR_TAG] });
  });

  it('getResumeVariant does not hand back another user’s resume fileName', async () => {
    // The variant is the caller's own; only its `baseResumeId` is foreign, which
    // is exactly the row state the unscoped write above leaves behind. Fixing
    // the write does not clean what it already wrote (WIC-1437), so the read has
    // to carry the predicate too.
    const s = stubTables({
      [VARIANTS]: [variantRow({ baseResumeId: THEIR_RESUME })],
      [RESUMES]: [resumeRow({ id: THEIR_RESUME, userId: OTHER, fileName: 'their-resume.pdf' })],
      [BULLETS]: [],
    });

    const result = await getResumeVariant(MINE, CALLER);

    expect(
      result.baseResume,
      'a foreign baseResumeId must resolve to nothing, not to its fileName'
    ).toBeUndefined();
    expectNothingForeignReached(s, RESUMES, {
      table: RESUMES,
      userId: CALLER,
      ids: [THEIR_RESUME],
    });
  });
});

describe('interview_preps — the foreign tables the same entry points read', () => {
  it('generateInterviewPrep does not read another user’s application', async () => {
    // `jobTitle` and `company` go straight into the LLM prompt and into the prep
    // the caller then owns and can read back, so this one leaks content, not
    // just existence.
    const s = stubTables({
      [APPS]: [appRow(), appRow({ id: THEIR_APP, userId: OTHER, company: 'Umbrella' })],
      [PREPS]: [],
      [BULLETS]: [],
    });

    await expect(
      generateInterviewPrep({ applicationId: THEIR_APP } as never, CALLER)
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });

    expectNothingForeignReached(s, APPS, { table: APPS, userId: CALLER, ids: [THEIR_APP] });
  });

  it('generateInterviewPrep’s 409 does not disclose another user’s prep', async () => {
    // A foreign prep on the caller's own application is reachable precisely
    // because the read above was unscoped. Unfixed, this branch answers 409 and
    // puts the foreign prep's id in `details.existingPrepId`.
    const s = stubTables({
      [APPS]: [appRow()],
      [PREPS]: [prepRow({ id: THEIRS, userId: OTHER, applicationId: MY_APP })],
      [BULLETS]: [],
    });

    await expect(
      generateInterviewPrep({ applicationId: MY_APP } as never, CALLER)
    ).rejects.toMatchObject({
      // Past the existence check, into the caller's own (empty) catalog.
      code: 'CATALOG_EMPTY',
    });

    expectNothingForeignReached(s, PREPS, {
      table: PREPS,
      userId: CALLER,
      idKey: 'applicationId',
      ids: [MY_APP],
      extra: { id: MINE },
    });
  });

  it('getInterviewPrep does not hand back another user’s job title and company', async () => {
    const s = stubTables({
      [PREPS]: [prepRow({ applicationId: THEIR_APP })],
      [APPS]: [appRow({ id: THEIR_APP, userId: OTHER, jobTitle: 'CFO', company: 'Umbrella' })],
      [STORIES]: [],
    });

    const result = await getInterviewPrep(MINE, CALLER);

    expect(
      [result.application.jobTitle, result.application.company],
      'a foreign applicationId must degrade to the empty placeholder, not to the real row'
    ).toEqual(['', '']);
    expectNothingForeignReached(s, APPS, { table: APPS, userId: CALLER, ids: [THEIR_APP] });
  });

  it('exportInterviewPrep does not put another user’s company in the export', async () => {
    const s = stubTables({
      [PREPS]: [prepRow({ applicationId: THEIR_APP })],
      [APPS]: [appRow({ id: THEIR_APP, userId: OTHER, jobTitle: 'CFO', company: 'Umbrella' })],
      [STORIES]: [],
    });

    const result = await exportInterviewPrep(MINE, 'markdown', undefined, CALLER);

    expect(
      result.filename,
      'the foreign company name is interpolated into the filename'
    ).not.toContain('umbrella');
    expect(result.buffer.toString('utf8')).not.toContain('Umbrella');
    expectNothingForeignReached(s, APPS, { table: APPS, userId: CALLER, ids: [THEIR_APP] });
  });
});

// ── WIC-1601 — the absent-caller branch ──────────────────────────────────────
//
// The half above is "the predicate forgot the owner". This half is "the
// predicate had an owner term and threw it away when `userId` was undefined".
// Every site was `userId ? and(idTerm, ownerTerm) : idTerm`, so an anonymous
// caller read the whole table — the fail-open idiom WIC-1482 records on
// `fetchStarEntries` and WIC-1500 found reachable in a fully-configured
// deployment through a `sub`-less JWT.
//
// `expectScopedTo` is deliberately the wrong assertion here: its probe 3 rejects
// `user_id IS NULL` rows, which is exactly what the anonymous caller is supposed
// to get. So this section asserts the anonymous predicate directly.

/**
 * The anonymous counterpart of `expectScopedTo`: the orphan row is admitted and
 * every *owned* row — the caller's and a stranger's alike — is not.
 *
 * The third probe is the one that matters. Two of the three would pass under the
 * old `: idTerm` fallback as well, because a bare id term admits the orphan row
 * too; only "a row owned by somebody is rejected" tells the scoped predicate
 * from the discarded one.
 */
function expectScopedToOrphans(
  clause: unknown,
  table: string,
  opts: { idKey?: string; id?: string; extra?: ProbeRow } = {}
): void {
  const { idKey = 'id', id = MINE, extra = {} } = opts;
  const admits = predicateFor(clause, table);
  const row = (userId: string | null): ProbeRow => ({ [idKey]: id, ...extra, userId });

  expect(admits(row(null)), `anonymous read excludes the unowned row it is for`).toBe(true);
  expect(admits(row(CALLER)), `anonymous read admits a row owned by a real user`).toBe(false);
  expect(admits(row(OTHER)), `anonymous read admits a row owned by a real user`).toBe(false);
}

describe('an absent caller reads the rows nobody owns, not every row', () => {
  const orphanVariant = () => [
    variantRow({ userId: null }),
    variantRow({ id: THEIRS, userId: OTHER }),
  ];
  const orphanPrep = () => [
    prepRow({ userId: null }),
    prepRow({ id: THEIRS, userId: OTHER, applicationId: THEIR_APP }),
  ];

  it('getResumeVariant refuses an owned variant', async () => {
    const s = stubTables({ [VARIANTS]: orphanVariant(), [BULLETS]: [] });

    await expect(getResumeVariant(THEIRS, undefined)).rejects.toBeInstanceOf(NotFoundError);
    expectScopedToOrphans(s.clausesOn(VARIANTS)[0], VARIANTS, { id: THEIRS });
  });

  it('getResumeVariant still resolves the unowned variant it is for', async () => {
    // Without this the fix could be "match nothing", which is not scoping —
    // the same trap `expectScopedTo`'s probe 1 exists to catch.
    const s = stubTables({ [VARIANTS]: orphanVariant(), [BULLETS]: [] });

    const result = await getResumeVariant(MINE, undefined);

    expect(result.variant.id).toBe(MINE);
    expect(s.opsOn(VARIANTS)[0].rows.map((r) => r.id)).toEqual([MINE]);
  });

  it('deleteResumeVariant refuses an owned variant', async () => {
    const s = stubTables({ [VARIANTS]: orphanVariant() });

    await expect(deleteResumeVariant(THEIRS, undefined)).rejects.toBeInstanceOf(NotFoundError);
    expectScopedToOrphans(s.clausesOn(VARIANTS)[0], VARIANTS, { id: THEIRS });
  });

  it('updateResumeVariant refuses an owned variant on both predicates', async () => {
    const s = stubTables({ [VARIANTS]: orphanVariant() });

    await expect(
      updateResumeVariant(THEIRS, { title: 'Renamed', version: 1 } as never, undefined)
    ).rejects.toBeInstanceOf(NotFoundError);

    // The three-term UPDATE and the two-term re-check are separate sites and the
    // fallback was dropped on each independently.
    const [update, recheck] = s.opsOn(VARIANTS);
    expectScopedToOrphans(update.clause, VARIANTS, { id: THEIRS, extra: { version: 1 } });
    expectScopedToOrphans(recheck.clause, VARIANTS, { id: THEIRS });
  });

  it('listResumeVariants does not spill owned variants into the unfiltered list', async () => {
    // The `conditions.length === 1` shortcut means an anonymous unfiltered list
    // used to reach `.where(undefined)` — no predicate at all, whole table.
    const s = stubTables({ [VARIANTS]: orphanVariant() });

    const result = await listResumeVariants({}, undefined);

    expect(result.variants.map((v) => v.id)).toEqual([MINE]);
    expectScopedToOrphans(s.clausesOn(VARIANTS)[0], VARIANTS);
  });

  it('getInterviewPrep refuses an owned prep', async () => {
    const s = stubTables({ [PREPS]: orphanPrep(), [STORIES]: [], [APPS]: [] });

    await expect(getInterviewPrep(THEIRS, undefined)).rejects.toBeInstanceOf(NotFoundError);
    expectScopedToOrphans(s.clausesOn(PREPS)[0], PREPS, { id: THEIRS });
  });

  it('getInterviewPrepByApplication refuses an owned prep', async () => {
    const s = stubTables({ [PREPS]: orphanPrep(), [STORIES]: [], [APPS]: [] });

    await expect(getInterviewPrepByApplication(THEIR_APP, undefined)).rejects.toBeInstanceOf(
      NotFoundError
    );
    expectScopedToOrphans(s.clausesOn(PREPS)[0], PREPS, {
      idKey: 'applicationId',
      id: THEIR_APP,
    });
  });

  it('generateResumeVariant refuses an owned resume as the base', async () => {
    const s = stubTables({
      [RESUMES]: [resumeRow({ userId: null }), resumeRow({ id: THEIR_RESUME, userId: OTHER })],
      [BULLETS]: [],
    });

    await expect(
      generateResumeVariant({ ...JD, baseResumeId: THEIR_RESUME } as never, undefined)
    ).rejects.toMatchObject({ code: 'BASE_RESUME_NOT_FOUND' });
    expectScopedToOrphans(s.clausesOn(RESUMES)[0], RESUMES, { id: THEIR_RESUME });
  });

  it('generateInterviewPrep refuses an owned application', async () => {
    const s = stubTables({
      [APPS]: [appRow({ userId: null }), appRow({ id: THEIR_APP, userId: OTHER })],
      [PREPS]: [],
      [BULLETS]: [],
    });

    await expect(
      generateInterviewPrep({ applicationId: THEIR_APP } as never, undefined)
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
    expectScopedToOrphans(s.clausesOn(APPS)[0], APPS, { id: THEIR_APP });
  });

  it('tech_stack_tags scopes an absent caller to the empty set, by design', async () => {
    // `tech_stack_tags.user_id` is `.notNull()` since 0017, so `IS NULL` reaches
    // no rows at all. That is the intended answer, not an accident: an anonymous
    // caller gets nothing rather than everything. Pinned because it is the one
    // table in these two services where `IS NULL` is not a reachable row state,
    // and a future reader is entitled to know the empty result is deliberate.
    const s = stubTables({
      [TAGS]: [tagRow(), tagRow({ id: THEIR_TAG, userId: OTHER })],
      [BULLETS]: [],
    });

    await expect(
      generateResumeVariant({ ...JD, selectedTechTags: [MY_TAG] } as never, undefined)
    ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });

    expect(s.opsOn(TAGS)[0].rows, 'no tag row is owned by nobody').toEqual([]);
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
