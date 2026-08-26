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

/** Filter `rows` by actually rendering and interpreting the drizzle predicate. */
function applyPredicate<T extends { id: string; userId: string }>(
  rows: T[],
  clause: unknown,
  table: 'quantified_bullets' | 'cover_letters'
): T[] {
  if (!clause) return rows;
  const { sql: text, params } = dialect.sqlToQuery(clause as any);
  const constrainsId = new RegExp(`"${table}"\\."id"\\s*(=|in\\s*\\()`).test(text);
  const scopesOwner = new RegExp(`"${table}"\\."user_id"\\s*=`).test(text);
  return rows.filter((r) => {
    if (constrainsId && !params.includes(r.id)) return false;
    if (scopesOwner && !params.includes(r.userId)) return false;
    return true;
  });
}

/** Records which tables were read and with what rendered SQL, for assertions. */
let readLog: { table: string; sql: string; params: readonly unknown[] }[] = [];

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
            readLog.push({ table: name, sql: q.sql, params: q.params });
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
    update: (_table: any) => ({
      set: (vals: any) => ({
        where: () => ({ returning: () => Promise.resolve([{ ...coverLetterRows[0], ...vals }]) }),
      }),
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
} from '../src/services/cover-letter.service.js';
import { CoverLetterError } from '../src/types/index.js';

/** Everything the LLM saw this test, concatenated. */
const allPrompts = () => prompts.join('\n---\n');

beforeEach(() => {
  prompts = [];
  readLog = [];
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

  it('the quantified_bullets read carries a user_id predicate', async () => {
    await generateCoverLetter(
      { ...baseInput, selectedStarEntryIds: [BULLET_ATTACKER] } as any,
      ATTACKER
    );
    const bulletReads = readLog.filter((r) => r.table === 'quantified_bullets');
    expect(bulletReads.length).toBeGreaterThan(0);
    for (const read of bulletReads) {
      expect(read.sql).toMatch(/"quantified_bullets"\."user_id"\s*=/);
      expect(read.params).toContain(ATTACKER);
    }
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

  it('the cover_letters read carries a user_id predicate', async () => {
    await generateOutreach({ platform: 'linkedin', coverLetterId: CL_ATTACKER } as any, ATTACKER);
    const clReads = readLog.filter((r) => r.table === 'cover_letters');
    expect(clReads.length).toBeGreaterThan(0);
    for (const read of clReads) {
      expect(read.sql).toMatch(/"cover_letters"\."user_id"\s*=/);
      expect(read.params).toContain(ATTACKER);
    }
  });

  it("the caller's OWN cover letter still becomes outreach context", async () => {
    await generateOutreach({ platform: 'linkedin', coverLetterId: CL_ATTACKER } as any, ATTACKER);
    expect(createMock).toHaveBeenCalled();
    expect(allPrompts()).toContain(ATTACKER_CL_CONTENT.slice(0, 40));
  });
});

// ── Deliberate auth-bypass behaviour ─────────────────────────────────────────

describe('WIC-1437 — undefined userId keeps the documented auth-bypass behaviour', () => {
  it('is unscoped when no identity is present, matching the row-addressed siblings', async () => {
    // Routes pass `c.get('userId') ?? undefined`, and auth is bypassed only when
    // both SUPABASE_URL and SUPABASE_JWT_SECRET are absent (ADR-003). The eight
    // row-addressed handlers all degrade to unscoped in that mode; the two
    // body-id paths fixed here now behave identically rather than filtering on
    // an `undefined` owner (quantified_bullets.user_id is NOT NULL, so an
    // IS NULL predicate would match zero rows and break local dev).
    const result = await generateCoverLetter(
      {
        jobDescriptionText: 'We need an engineer.',
        targetCompany: 'Acme',
        targetRole: 'Engineer',
        selectedStarEntryIds: [BULLET_VICTIM],
      } as any,
      undefined
    );
    expect(result.usedStarEntries.map((e) => e.id)).toEqual([BULLET_VICTIM]);
    const bulletReads = readLog.filter((r) => r.table === 'quantified_bullets');
    for (const read of bulletReads) {
      expect(read.sql).not.toMatch(/"quantified_bullets"\."user_id"/);
    }
  });
});
