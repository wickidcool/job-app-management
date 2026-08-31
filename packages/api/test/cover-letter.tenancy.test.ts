/**
 * WIC-1437 — cover letter generation must not act on caller-supplied ids it does
 * not own (WIC-127 AC-20, AC-T4, AC-T5).
 *
 * Two pre-existing defects are covered here:
 *   1. `fetchStarEntries` selected `quantified_bullets` by id with no owner
 *      predicate, so another user's `rawText` came back in `usedStarEntries`,
 *      was interpolated into the LLM prompt, and was persisted as the caller's
 *      cover letter.
 *   2. `generateOutreach` loaded a cover letter by caller-supplied id with no
 *      owner predicate, so the first 500 chars of another user's letter became
 *      LLM context.
 *
 * Harness note: the fake `getDb()` below does NOT resolve a canned row set. It
 * renders the actual `where` clause with `PgDialect.sqlToQuery` and filters the
 * fixtures by the predicate that was really built. That is deliberate — a stub
 * whose `where` returns rows regardless of the predicate passes just as happily
 * with the bug present, which is exactly how this class of defect has shipped
 * green before. Every leak assertion here fails against the unfixed service.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { eq, and, inArray } from 'drizzle-orm';
import { quantifiedBullets } from '../src/db/schema.js';
import { _resetConfig } from '../src/config.js';
import { applyTenancyPredicate, expectEveryReadScopedTo } from './helpers/tenancy.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ATTACKER = '11111111-1111-4111-8111-111111111111';
const VICTIM = '22222222-2222-4222-8222-222222222222';

const BULLET_ATTACKER = '01HXK5R3J7Q8N2M4P6W9Y1Z3A1';
const BULLET_VICTIM = '01HXK5R3J7Q8N2M4P6W9Y1Z3V1';

const VICTIM_BULLET_TEXT = 'VICTIM_BULLET_SECRET cut churn 42% at a company nobody else may see';
const ATTACKER_BULLET_TEXT = 'ATTACKER_BULLET shipped a thing';

const CL_ATTACKER = '01HXK5R3J7Q8N2M4P6W9Y1Z3A9';
const CL_VICTIM = '01HXK5R3J7Q8N2M4P6W9Y1Z3V9';

const VICTIM_CL_CONTENT =
  'VICTIM_LETTER_SECRET Dear Hiring Manager, my confidential salary ask is 250k.';
const ATTACKER_CL_CONTENT = 'ATTACKER_LETTER Dear Hiring Manager, I am writing to apply.';

const bulletRows = [
  { id: BULLET_ATTACKER, userId: ATTACKER, rawText: ATTACKER_BULLET_TEXT },
  { id: BULLET_VICTIM, userId: VICTIM, rawText: VICTIM_BULLET_TEXT },
];

function coverLetterRow(id: string, userId: string, content: string) {
  return {
    id,
    userId,
    status: 'draft',
    title: 'Cover Letter',
    targetCompany: 'Acme',
    targetRole: 'Engineer',
    tone: 'professional',
    lengthVariant: 'standard',
    emphasis: 'balanced',
    jobDescriptionText: 'JD text',
    jobDescriptionUrl: null,
    jobFitAnalysisId: null,
    selectedStarEntryIds: [userId === ATTACKER ? BULLET_ATTACKER : BULLET_VICTIM],
    content,
    revisionHistory: [],
    createdAt: new Date('2026-04-26T14:30:00.000Z'),
    updatedAt: new Date('2026-04-26T14:30:00.000Z'),
    version: 1,
  };
}

/**
 * A row the *pre-fix* generate path could persist: owned by the attacker, but
 * carrying a STAR id that belongs to the victim. Rows in this shape already
 * exist wherever the unscoped `fetchStarEntries` ran, so `getCoverLetter` has
 * to scope its own STAR read too — the ids on the row are not trustworthy just
 * because the row is owned.
 */
const CL_LEGACY = '01HXK5R3J7Q8N2M4P6W9Y1Z3L9';
const legacyRow = {
  ...coverLetterRow(CL_LEGACY, ATTACKER, ATTACKER_CL_CONTENT),
  selectedStarEntryIds: [BULLET_ATTACKER, BULLET_VICTIM],
};

const coverLetterRows = [
  coverLetterRow(CL_ATTACKER, ATTACKER, ATTACKER_CL_CONTENT),
  coverLetterRow(CL_VICTIM, VICTIM, VICTIM_CL_CONTENT),
  legacyRow,
];

// ── Predicate-honest fake db ──────────────────────────────────────────────────

const dialect = new PgDialect();

/**
 * Filter `rows` by the predicate the service really built (WIC-1502).
 *
 * This delegates to the shared harness (WIC-1491). The local `applyPredicate`
 * that used to live here decided each constraint with its own independent regex
 * and then applied both *conjunctively* — so the conjunction was the test's
 * assumption rather than the query's structure, and flipping any `and(id, owner)`
 * to `or(id, owner)` left this file green. Measured on `fd37a8e`: all seven
 * tenancy predicates in `cover-letter.service.ts` flipped to `or` and the suite
 * still reported 16/16. `applyTenancyPredicate` parses the rendered SQL into a
 * real boolean tree and evaluates `or` as `or`, so that mutation now goes red.
 */
const applyPredicate = <T extends { id: string; userId: string }>(
  rows: T[],
  clause: unknown,
  table: 'quantified_bullets' | 'cover_letters'
): T[] => applyTenancyPredicate(rows, clause, table);

/** Records which tables were read and with what clause, for assertions. */
let readLog: {
  table: string;
  clause: unknown;
  sql: string;
  params: readonly unknown[];
}[] = [];

/** Records write-side predicates (update/delete), so a write leak is visible too. */
let deleteLog: { table: string; clause: unknown; op: 'update' | 'delete'; ids?: string[] }[] = [];

function tableNameOf(table: any): 'quantified_bullets' | 'cover_letters' | 'other' {
  const name = table?.[Symbol.for('drizzle:Name')] ?? table?.[Symbol.for('drizzle:BaseName')];
  if (name === 'quantified_bullets') return 'quantified_bullets';
  if (name === 'cover_letters') return 'cover_letters';
  return 'other';
}

function makeFakeDb() {
  return {
    select: (_fields?: unknown) => ({
      from: (table: any) => {
        const name = tableNameOf(table);
        const source =
          name === 'quantified_bullets'
            ? bulletRows
            : name === 'cover_letters'
              ? coverLetterRows
              : [];
        const build = (clause: unknown) => {
          if (clause) {
            const q = dialect.sqlToQuery(clause as any);
            readLog.push({ table: name, clause, sql: q.sql, params: q.params });
          }
          const result = applyPredicate(source as any[], clause, name as any);
          const thenable: any = {
            limit: (n: number) => Promise.resolve(result.slice(0, n)),
            orderBy: () => thenable,
            then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
          };
          return thenable;
        };
        const noWhere: any = {
          where: (clause: unknown) => build(clause),
          limit: (n: number) => Promise.resolve(source.slice(0, n)),
          then: (res: any, rej: any) => Promise.resolve(source).then(res, rej),
        };
        return noWhere;
      },
    }),
    insert: (_table: any) => ({
      values: (vals: any) => ({
        returning: () =>
          Promise.resolve([
            {
              ...vals,
              createdAt: vals.createdAt ?? new Date(),
              updatedAt: vals.updatedAt ?? new Date(),
            },
          ]),
      }),
    }),
    // Predicate-honest, like `select`. The previous stub resolved
    // `[{...coverLetterRows[0], ...vals}]` for *any* predicate, so the
    // not-found branch below it was unreachable and its owner term was never
    // exercised by anything.
    update: (table: any) => ({
      set: (vals: any) => ({
        where: (clause: unknown) => ({
          returning: () => {
            const name = tableNameOf(table);
            const matched = applyPredicate(coverLetterRows as any[], clause, name as any);
            deleteLog.push({ table: name, clause, op: 'update' });
            return Promise.resolve(
              matched.map((r) => ({ ...r, ...vals, version: (r as any).version + 1 }))
            );
          },
        }),
      }),
    }),
    delete: (table: any) => ({
      where: (clause: unknown) => {
        const name = tableNameOf(table);
        const matched = applyPredicate(coverLetterRows as any[], clause, name as any);
        deleteLog.push({ table: name, clause, op: 'delete', ids: matched.map((r) => r.id) });
        return Promise.resolve(matched);
      },
    }),
  };
}

vi.mock('../src/db/client.js', () => ({
  getDb: () => makeFakeDb(),
}));

// ── Fake Anthropic client (captures the prompt) ───────────────────────────────

let prompts: string[] = [];
const createMock = vi.fn(async ({ messages }: any) => {
  prompts.push(messages[0].content);
  return {
    content: [
      {
        type: 'text',
        text: 'Dear Hiring Manager,\n\nGenerated letter.\n\nSincerely,\n[Your Name]',
      },
    ],
    stop_reason: 'end_turn',
  };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import {
  generateCoverLetter,
  generateOutreach,
  reviseCoverLetter,
  getCoverLetter,
  updateCoverLetter,
  deleteCoverLetter,
  exportCoverLetter,
} from '../src/services/cover-letter.service.js';
import { CoverLetterError } from '../src/types/index.js';

/** Everything the LLM saw this test, concatenated. */
const allPrompts = () => prompts.join('\n---\n');

beforeEach(() => {
  prompts = [];
  readLog = [];
  deleteLog = [];
  createMock.mockClear();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-for-tenancy-suite';
  _resetConfig();
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  _resetConfig();
});

// ── Harness self-check ────────────────────────────────────────────────────────
//
// If these two fail, every leak assertion below is vacuous.

describe('WIC-1437 harness', () => {
  it("an owner-scoped predicate really does exclude the other user's bullet", () => {
    const scoped = and(
      inArray(quantifiedBullets.id, [BULLET_ATTACKER, BULLET_VICTIM]),
      eq(quantifiedBullets.userId, ATTACKER)
    );
    expect(applyPredicate(bulletRows, scoped, 'quantified_bullets').map((r) => r.id)).toEqual([
      BULLET_ATTACKER,
    ]);
  });

  it("an unscoped predicate returns the other user's bullet (the defect shape)", () => {
    const unscoped = inArray(quantifiedBullets.id, [BULLET_ATTACKER, BULLET_VICTIM]);
    expect(applyPredicate(bulletRows, unscoped, 'quantified_bullets').map((r) => r.id)).toEqual([
      BULLET_ATTACKER,
      BULLET_VICTIM,
    ]);
  });
});

// ── Defect 1: fetchStarEntries ────────────────────────────────────────────────

describe('WIC-1437 defect 1 — STAR entries are scoped to the caller', () => {
  const baseInput = {
    jobDescriptionText: 'We need an engineer.',
    targetCompany: 'Acme',
    targetRole: 'Engineer',
  };

  it("generateCoverLetter rejects another user's STAR ids as not found", async () => {
    const err = await generateCoverLetter(
      { ...baseInput, selectedStarEntryIds: [BULLET_VICTIM] } as any,
      ATTACKER
    ).catch((e) => e);

    expect(err).toBeInstanceOf(CoverLetterError);
    expect(err.code).toBe('STAR_ENTRY_NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.details?.invalidIds).toEqual([BULLET_VICTIM]);
  });

  it("generateCoverLetter never sends another user's STAR text to the LLM", async () => {
    await generateCoverLetter(
      { ...baseInput, selectedStarEntryIds: [BULLET_ATTACKER, BULLET_VICTIM] } as any,
      ATTACKER
    ).catch(() => undefined);

    expect(createMock).not.toHaveBeenCalled();
    expect(allPrompts()).not.toContain(VICTIM_BULLET_TEXT);
  });

  it("generateCoverLetter never returns another user's STAR text in usedStarEntries", async () => {
    const result = await generateCoverLetter(
      { ...baseInput, selectedStarEntryIds: [BULLET_ATTACKER, BULLET_VICTIM] } as any,
      ATTACKER
    ).catch(() => null);

    const leaked = JSON.stringify(result ?? {});
    expect(leaked).not.toContain(VICTIM_BULLET_TEXT);
    expect(leaked).not.toContain(BULLET_VICTIM);
  });

  it('the quantified_bullets read is structurally scoped to the caller', async () => {
    await generateCoverLetter(
      { ...baseInput, selectedStarEntryIds: [BULLET_ATTACKER] } as any,
      ATTACKER
    );
    // Was a presence check (`sql` matches `user_id =`, `params` contains the
    // caller). That passes identically under `or(idTerm, ownerTerm)`, which
    // returns the union. `expectEveryReadScopedTo` evaluates the real boolean
    // tree against probe rows, and fails loudly if no such read was recorded.
    expectEveryReadScopedTo(readLog, {
      table: 'quantified_bullets',
      userId: ATTACKER,
      ids: [BULLET_ATTACKER],
    });
  });

  it('the caller still gets their OWN STAR entries back', async () => {
    const result = await generateCoverLetter(
      { ...baseInput, selectedStarEntryIds: [BULLET_ATTACKER] } as any,
      ATTACKER
    );
    expect(result.usedStarEntries.map((e) => e.id)).toEqual([BULLET_ATTACKER]);
    expect(result.usedStarEntries[0].rawText).toBe(ATTACKER_BULLET_TEXT);
    expect(allPrompts()).toContain(ATTACKER_BULLET_TEXT);
  });

  it("reviseCoverLetter ignores another user's STAR ids supplied in the body", async () => {
    await reviseCoverLetter(
      CL_ATTACKER,
      { revisionInstructions: 'punchier', selectedStarEntryIds: [BULLET_VICTIM] } as any,
      ATTACKER
    ).catch(() => undefined);

    expect(allPrompts()).not.toContain(VICTIM_BULLET_TEXT);
  });

  it("generateOutreach ignores another user's STAR ids supplied in the body", async () => {
    await generateOutreach(
      { platform: 'linkedin', selectedStarEntryIds: [BULLET_VICTIM] } as any,
      ATTACKER
    ).catch(() => undefined);

    expect(allPrompts()).not.toContain(VICTIM_BULLET_TEXT);
  });

  it("getCoverLetter still resolves the owner's own STAR entries", async () => {
    const result = await getCoverLetter(CL_ATTACKER, ATTACKER);
    expect(result.usedStarEntries.map((e) => e.rawText)).toEqual([ATTACKER_BULLET_TEXT]);
  });

  it('getCoverLetter drops a foreign STAR id left on a legacy row by the old path', async () => {
    const result = await getCoverLetter(CL_LEGACY, ATTACKER);
    expect(result.usedStarEntries.map((e) => e.id)).toEqual([BULLET_ATTACKER]);
    expect(JSON.stringify(result)).not.toContain(VICTIM_BULLET_TEXT);
  });
});

// ── Defect 2: generateOutreach cover-letter lookup ────────────────────────────

describe('WIC-1437 defect 2 — outreach cover-letter lookup is scoped to the caller', () => {
  it("rejects another user's coverLetterId as not found", async () => {
    const err = await generateOutreach(
      { platform: 'linkedin', coverLetterId: CL_VICTIM } as any,
      ATTACKER
    ).catch((e) => e);

    expect(err).toBeInstanceOf(CoverLetterError);
    expect(err.code).toBe('COVER_LETTER_NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it("never leaks another user's letter content into the LLM context", async () => {
    await generateOutreach(
      { platform: 'linkedin', coverLetterId: CL_VICTIM } as any,
      ATTACKER
    ).catch(() => undefined);

    expect(createMock).not.toHaveBeenCalled();
    expect(allPrompts()).not.toContain(VICTIM_CL_CONTENT);
    expect(allPrompts()).not.toContain('VICTIM_LETTER_SECRET');
  });

  it('the cover_letters read is structurally scoped to the caller', async () => {
    await generateOutreach({ platform: 'linkedin', coverLetterId: CL_ATTACKER } as any, ATTACKER);
    expectEveryReadScopedTo(readLog, {
      table: 'cover_letters',
      userId: ATTACKER,
      ids: [CL_ATTACKER],
    });
  });

  it("the caller's OWN cover letter still becomes outreach context", async () => {
    await generateOutreach({ platform: 'linkedin', coverLetterId: CL_ATTACKER } as any, ATTACKER);
    expect(createMock).toHaveBeenCalled();
    expect(allPrompts()).toContain(ATTACKER_CL_CONTENT.slice(0, 40));
  });
});

// ── Every id-addressed cover_letters predicate ───────────────────────────────
//
// WIC-1502. Adopting the shared evaluator made the `and`→`or` mutation
// detectable, but detectable is not detected: a predicate is only pinned where
// some test actually asks for a row the caller does not own. Mutating each of
// the seven `and(id, owner)` sites in `cover-letter.service.ts` *alone* showed
// only `:130` (fetchStarEntries) and `:610` (generateOutreach) going red. The
// other five survived — not because the evaluator missed them, but because
// nothing here ever addressed them with a foreign id:
//
//   :342 getCoverLetter     — only ever called with the caller's own id, and
//                             `.limit(1)` hid the union the `or` admitted
//   :446 updateCoverLetter  — branch was unreachable behind a stub `update`
//                             that resolved a row for any predicate
//   :461 deleteCoverLetter  — never exercised (there was no `delete` stub)
//   :481 reviseCoverLetter  — only ever called with the caller's own id
//   :715 exportCoverLetter  — never exercised
//
// One negative case each. All five now go red under `or`, which is what the
// acceptance criterion on WIC-1502 asks for.
//
// Re-measured on the current head, widening the matrix to every owner-bearing
// conjunction rather than the seven `and(id, owner)` reads alone. That adds
// `:435`, `updateCoverLetter`'s `and(id, version, owner)` UPDATE predicate,
// which is not an `and(id, owner)` read and so fell outside the earlier sweep —
// the `deleteLog` assertion in the update test below is what pins it. Flipping
// each site to `or` alone: :130 → 7 failed, :342 → 1, :435 → 1, :446 → 1,
// :461 → 1, :481 → 1, :610 → 3, :715 → 1. Zero survivors across all eight.

describe('WIC-1502 — every id-addressed cover_letters read rejects a foreign id', () => {
  const VERSION = 1;

  it('getCoverLetter refuses another user’s letter', async () => {
    const err = await getCoverLetter(CL_VICTIM, ATTACKER).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/i);
    expectEveryReadScopedTo(readLog, {
      table: 'cover_letters',
      userId: ATTACKER,
      ids: [CL_VICTIM],
    });
  });

  it('updateCoverLetter refuses another user’s letter, and reports it as not-found', async () => {
    const err = await updateCoverLetter(
      CL_VICTIM,
      { version: VERSION, title: 'pwned' } as any,
      ATTACKER
    ).catch((e) => e);
    // Must be NotFoundError, NOT VersionConflictError: a conflict would mean the
    // fallback lookup found the victim's row and merely disagreed on version,
    // which is the `or` shape leaking existence.
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/i);
    // and nothing was written to a row the attacker does not own
    for (const w of deleteLog.filter((w) => w.op === 'update')) {
      expect(applyPredicate(coverLetterRows as any[], w.clause, 'cover_letters')).toEqual([]);
    }
  });

  it('deleteCoverLetter refuses another user’s letter and deletes nothing', async () => {
    const err = await deleteCoverLetter(CL_VICTIM, ATTACKER).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/i);
    expect(deleteLog.filter((w) => w.op === 'delete').flatMap((w) => w.ids ?? [])).toEqual([]);
  });

  it('reviseCoverLetter refuses another user’s letter', async () => {
    const err = await reviseCoverLetter(
      CL_VICTIM,
      { revisionInstructions: 'punchier' } as any,
      ATTACKER
    ).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/i);
    expect(allPrompts()).not.toContain(VICTIM_CL_CONTENT);
  });

  it('exportCoverLetter refuses another user’s letter', async () => {
    const err = await exportCoverLetter(CL_VICTIM, { format: 'docx' } as any, ATTACKER).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/i);
  });

  it('the caller’s own letter still works on each of those paths', async () => {
    await expect(getCoverLetter(CL_ATTACKER, ATTACKER)).resolves.toBeTruthy();
    await expect(
      updateCoverLetter(CL_ATTACKER, { version: VERSION, title: 'mine' } as any, ATTACKER)
    ).resolves.toBeTruthy();
    await expect(deleteCoverLetter(CL_ATTACKER, ATTACKER)).resolves.toBeUndefined();
  });
});

// ── Absent caller id fails closed ────────────────────────────────────────────
//
// WIC-1482. This block used to assert the opposite: that an absent `userId` left
// `fetchStarEntries` unscoped, "matching the row-addressed siblings". That was
// the fail-open half of the original defect, preserved deliberately on the
// reasoning that `quantified_bullets.user_id` is NOT NULL so `IS NULL` would
// "match zero rows and break local dev". WIC-1465's REQUIRED 2 ruled against
// exactly that idiom on `bulletOwnerScope`: matching zero rows is the *point*,
// not a regression. Selecting purely by caller-supplied ids is the IDOR itself,
// and the anonymous branch is reachable whenever both SUPABASE_URL and
// SUPABASE_JWT_SECRET are absent (ADR-003) — so it is not a safe place to
// degrade. The owner term is now unconditional; only its value varies.

describe('WIC-1482 — an absent caller id scopes to IS NULL, not to the whole table', () => {
  const baseInput = {
    jobDescriptionText: 'We need an engineer.',
    targetCompany: 'Acme',
    targetRole: 'Engineer',
  };

  it("does not resolve another user's STAR id when no identity is present", async () => {
    const err = await generateCoverLetter(
      { ...baseInput, selectedStarEntryIds: [BULLET_VICTIM] } as any,
      undefined
    ).catch((e) => e);

    expect(err).toBeInstanceOf(CoverLetterError);
    expect(err.code).toBe('STAR_ENTRY_NOT_FOUND');
    expect(err.details?.invalidIds).toEqual([BULLET_VICTIM]);
  });

  it('never reaches the LLM or the persisted row with foreign text', async () => {
    await generateCoverLetter(
      { ...baseInput, selectedStarEntryIds: [BULLET_ATTACKER, BULLET_VICTIM] } as any,
      undefined
    ).catch(() => undefined);

    expect(createMock).not.toHaveBeenCalled();
    expect(allPrompts()).not.toContain(VICTIM_BULLET_TEXT);
    expect(allPrompts()).not.toContain(ATTACKER_BULLET_TEXT);
  });

  it('carries a real IS NULL owner term rather than dropping the predicate', async () => {
    await generateCoverLetter(
      { ...baseInput, selectedStarEntryIds: [BULLET_ATTACKER] } as any,
      undefined
    ).catch(() => undefined);

    const bulletReads = readLog.filter((r) => r.table === 'quantified_bullets');
    // Fails loudly if the read stopped happening altogether — an assertion that
    // only checks "no unscoped read" passes vacuously when there is no read.
    expect(bulletReads.length).toBeGreaterThan(0);
    for (const read of bulletReads) {
      expect(read.sql).toMatch(/"quantified_bullets"\."user_id"\s+is\s+null/i);
      // The absent-caller branch must not bind an owner parameter at all.
      expect(read.params).not.toContain(ATTACKER);
      expect(read.params).not.toContain(VICTIM);
    }
  });
});
