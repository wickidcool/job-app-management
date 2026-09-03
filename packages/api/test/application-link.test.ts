import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createMigratedDb } from './helpers/pglite-db.js';

/**
 * WIC-1544 — a cover letter / resume variant must record the application it was
 * written for.
 *
 * These run against a real Postgres (PGlite) with the project's real migrations
 * replayed, not against a query stub. That is deliberate and not merely
 * thorough: three of the five acceptance criteria are properties of the
 * *database*, not of the service code. AC-3 (exact, not substring) is a claim
 * about the SQL a predicate compiles to; AC-4 (existing rows keep working) is a
 * claim about column nullability; AC-5 (deleting an application does not delete
 * its letters) is a claim about a foreign key's ON DELETE action, which no
 * amount of TypeScript can demonstrate. A stub would have to model each of them
 * to be checked, and a stub that models the answer is not evidence.
 */

const harness = vi.hoisted(() => ({ db: null as any }));

vi.mock('../src/db/client.js', () => ({
  getDb: () => harness.db,
}));

// The generate paths call Anthropic. Return a fixed body per service so the
// tests are about persistence, not prose.
vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages = {
      create: vi.fn(async ({ max_tokens }: { max_tokens: number }) => ({
        // The resume-variant prompt asks for JSON and uses a 4096 budget; the
        // cover-letter prompt asks for prose at 2048.
        content: [
          {
            type: 'text',
            text:
              max_tokens >= 4096
                ? JSON.stringify({
                    summary: 'A summary.',
                    experience: [],
                    skills: { categories: [{ name: 'Backend', skills: ['TypeScript'] }] },
                    projects: [],
                    education: [],
                    certifications: [],
                  })
                : 'Dear Hiring Manager,\n\nI am writing to apply.\n\nSincerely,\n[Your Name]',
          },
        ],
        stop_reason: 'end_turn',
      })),
    };
  }
  return { default: FakeAnthropic };
});

import { _resetConfig } from '../src/config.js';
import { generateCoverLetter, listCoverLetters } from '../src/services/cover-letter.service.js';
import {
  generateResumeVariant,
  listResumeVariants,
} from '../src/services/resume-variant.service.js';
import { CoverLetterError, ResumeVariantError } from '../src/types/index.js';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

// Two applications belonging to USER_A for *the same role at the same company*.
// This is the exact pair the WIC-1533 client-side heuristic cannot separate —
// `packages/web/src/constants/coverLetterMatch.test.ts` pins it as a known
// ceiling. If the id is genuinely persisted, these become distinguishable.
const APP_1 = 'APP00000000000000000000001';
const APP_2 = 'APP00000000000000000000002';
// Same shape, different owner.
const APP_OTHER = 'APP00000000000000000000003';

const BULLET = 'BUL00000000000000000000001';

let client: Awaited<ReturnType<typeof createMigratedDb>>['client'];

async function seed() {
  // One statement per call: the PGlite wire path prepares each statement, and a
  // prepared statement may not carry multiple commands.
  await harness.db.execute(sql`DELETE FROM cover_letters`);
  await harness.db.execute(sql`DELETE FROM resume_variants`);
  await harness.db.execute(sql`DELETE FROM quantified_bullets`);
  await harness.db.execute(sql`DELETE FROM applications`);
  await harness.db.execute(sql`
    INSERT INTO applications (id, user_id, job_title, company) VALUES
      (${APP_1},     ${USER_A}, 'Staff Engineer', 'Acme Corp'),
      (${APP_2},     ${USER_A}, 'Staff Engineer', 'Acme Corp'),
      (${APP_OTHER}, ${USER_B}, 'Staff Engineer', 'Acme Corp')
  `);
  await harness.db.execute(sql`
    INSERT INTO quantified_bullets
      (id, user_id, source_type, source_id, raw_text, metric_type, metric_value, impact_category)
    VALUES
      (${BULLET}, ${USER_A}, 'resume', 'SRC1', 'Cut p99 latency by 40%.', 'percentage', 40, 'performance')
  `);
}

const generateArgs = {
  jobDescriptionText: 'x'.repeat(60),
  targetCompany: 'Acme Corp',
  targetRole: 'Staff Engineer',
};

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  _resetConfig();
  const made = await createMigratedDb();
  client = made.client;
  harness.db = made.db;
});

afterAll(async () => {
  await client?.close();
  delete process.env.ANTHROPIC_API_KEY;
  _resetConfig();
});

beforeEach(seed);

describe('cover letters record their application (WIC-1544)', () => {
  it('AC-1: persists the application id the letter was generated from', async () => {
    const { coverLetter } = await generateCoverLetter(
      { ...generateArgs, applicationId: APP_1, selectedStarEntryIds: [BULLET] },
      USER_A
    );

    expect(coverLetter.applicationId).toBe(APP_1);

    // Assert the column, not just the DTO: a mapper can echo an input back
    // without anything reaching the table.
    const stored = await harness.db.execute(
      sql`SELECT application_id FROM cover_letters WHERE id = ${coverLetter.id}`
    );
    expect(stored.rows[0].application_id).toBe(APP_1);
  });

  it('AC-2: the filter returns exactly that application, separating two same-role/same-company applications', async () => {
    const first = await generateCoverLetter(
      { ...generateArgs, applicationId: APP_1, selectedStarEntryIds: [BULLET] },
      USER_A
    );
    const second = await generateCoverLetter(
      { ...generateArgs, applicationId: APP_2, selectedStarEntryIds: [BULLET] },
      USER_A
    );

    // Control: the pair the old heuristic keys on is identical across the two,
    // so anything short of the id genuinely cannot tell them apart.
    expect([first, second].map((r) => r.coverLetter.targetCompany)).toEqual([
      'Acme Corp',
      'Acme Corp',
    ]);
    expect([first, second].map((r) => r.coverLetter.targetRole)).toEqual([
      'Staff Engineer',
      'Staff Engineer',
    ]);

    const filtered = await listCoverLetters({ applicationId: APP_1 }, USER_A);
    expect(filtered.coverLetters.map((c) => c.id)).toEqual([first.coverLetter.id]);

    const unfiltered = await listCoverLetters({}, USER_A);
    expect(unfiltered.coverLetters).toHaveLength(2);
  });

  it('AC-3: the match is exact — a prefix of the id matches nothing', async () => {
    await generateCoverLetter(
      { ...generateArgs, applicationId: APP_1, selectedStarEntryIds: [BULLET] },
      USER_A
    );

    // The discriminating oracle. Under the `ilike('%' || term || '%')` shape the
    // neighbouring `company` filter uses, this prefix would match APP_1 and the
    // filter would silently widen. Under `eq` it matches nothing.
    const prefix = APP_1.slice(0, 12);
    expect(APP_1.startsWith(prefix)).toBe(true);

    const byPrefix = await listCoverLetters({ applicationId: prefix }, USER_A);
    expect(byPrefix.coverLetters).toEqual([]);
  });

  it('AC-4: rows written before the column existed still list and carry a null id', async () => {
    // Inserted without `application_id` — exactly the shape of every row already
    // in production, since the migration deliberately does not backfill.
    await harness.db.execute(sql`
      INSERT INTO cover_letters (id, user_id, title, target_company, target_role, content)
      VALUES ('LEGACY0000000000000000001', ${USER_A}, 'Legacy letter', 'Acme Corp', 'Staff Engineer', 'Dear Hiring Manager,');
    `);

    const all = await listCoverLetters({}, USER_A);
    expect(all.coverLetters.map((c) => c.id)).toContain('LEGACY0000000000000000001');
    expect(all.coverLetters[0].applicationId).toBeNull();

    // And it is invisible to a filter for a real application, rather than
    // matching everything.
    const filtered = await listCoverLetters({ applicationId: APP_1 }, USER_A);
    expect(filtered.coverLetters).toEqual([]);
  });

  it('AC-5: deleting the application keeps the letter and clears the association', async () => {
    const { coverLetter } = await generateCoverLetter(
      { ...generateArgs, applicationId: APP_1, selectedStarEntryIds: [BULLET] },
      USER_A
    );

    await harness.db.execute(sql`DELETE FROM applications WHERE id = ${APP_1}`);

    const rows = await harness.db.execute(
      sql`SELECT id, application_id, content FROM cover_letters WHERE id = ${coverLetter.id}`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].application_id).toBeNull();
    expect(rows.rows[0].content).toContain('Dear Hiring Manager');
  });

  it('rejects an application the caller does not own, and writes nothing', async () => {
    await expect(
      generateCoverLetter(
        { ...generateArgs, applicationId: APP_OTHER, selectedStarEntryIds: [BULLET] },
        USER_A
      )
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });

    const rows = await harness.db.execute(sql`SELECT id FROM cover_letters`);
    expect(rows.rows).toEqual([]);
  });

  it('rejects an application id that does not exist at all', async () => {
    await expect(
      generateCoverLetter(
        { ...generateArgs, applicationId: 'NOPE', selectedStarEntryIds: [BULLET] },
        USER_A
      )
    ).rejects.toBeInstanceOf(CoverLetterError);
  });
});

describe('resume variants record their application (WIC-1544)', () => {
  it('AC-1: persists the application id the variant was generated from', async () => {
    const { variant } = await generateResumeVariant(
      { ...generateArgs, applicationId: APP_1 },
      USER_A
    );

    expect(variant.applicationId).toBe(APP_1);

    const stored = await harness.db.execute(
      sql`SELECT application_id FROM resume_variants WHERE id = ${variant.id}`
    );
    expect(stored.rows[0].application_id).toBe(APP_1);
  });

  it('AC-2/AC-3: the filter is exact and separates two same-role/same-company applications', async () => {
    const first = await generateResumeVariant({ ...generateArgs, applicationId: APP_1 }, USER_A);
    await generateResumeVariant({ ...generateArgs, applicationId: APP_2 }, USER_A);

    const filtered = await listResumeVariants({ applicationId: APP_1 }, USER_A);
    expect(filtered.variants.map((v) => v.id)).toEqual([first.variant.id]);

    expect((await listResumeVariants({}, USER_A)).variants).toHaveLength(2);
    expect(
      (await listResumeVariants({ applicationId: APP_1.slice(0, 12) }, USER_A)).variants
    ).toEqual([]);
  });

  it('AC-5: deleting the application keeps the variant and clears the association', async () => {
    const { variant } = await generateResumeVariant(
      { ...generateArgs, applicationId: APP_1 },
      USER_A
    );

    await harness.db.execute(sql`DELETE FROM applications WHERE id = ${APP_1}`);

    const rows = await harness.db.execute(
      sql`SELECT id, application_id FROM resume_variants WHERE id = ${variant.id}`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].application_id).toBeNull();
  });

  it('rejects an application the caller does not own, and writes nothing', async () => {
    await expect(
      generateResumeVariant({ ...generateArgs, applicationId: APP_OTHER }, USER_A)
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });

    expect((await harness.db.execute(sql`SELECT id FROM resume_variants`)).rows).toEqual([]);
    expect(ResumeVariantError).toBeDefined();
  });
});
