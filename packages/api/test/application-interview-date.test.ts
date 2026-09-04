import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createMigratedDb } from './helpers/pglite-db.js';

/**
 * WIC-2023 — `applications.interview_date`, migration 0026.
 *
 * This file exists because the card's stated acceptance criterion does not
 * actually reach the migration. `interviewPrep.drift.test.ts` parses the
 * *declared return type* of `interviewPrep.service.ts` out of its source text;
 * it never opens `schema.ts` and never touches a database. Measured both ways
 * while building this change:
 *
 *   - revert `interviewPrep.service.ts`  -> drift test RED   (it covers that file)
 *   - revert `db/schema.ts`              -> drift test GREEN, `tsc` RED
 *   - revert `0026_*.sql` + its journal entry -> drift test GREEN, `tsc` GREEN
 *
 * So the drift test proves the service/web contract, `tsc` proves the drizzle
 * column binding, and until this file **nothing at all** proved the migration.
 * That third line is the gap: the column could be absent from the real database
 * and every gate the card named would still pass. These assertions run against
 * PGlite with the project's real migrations replayed in `_journal.json` order,
 * so a `.sql` that is on disk but unregistered fails here rather than in prod.
 */
describe('migration 0026 — applications.interview_date', () => {
  let client: Awaited<ReturnType<typeof createMigratedDb>>['client'];
  let db: Awaited<ReturnType<typeof createMigratedDb>>['db'];

  beforeAll(async () => {
    ({ client, db } = await createMigratedDb());
  });

  afterAll(async () => {
    await client.close();
  });

  it('adds the column, and it is journal-registered (a bare .sql would not apply)', async () => {
    const rows = await client.query<{
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'applications' AND column_name = 'interview_date'`
    );

    expect(
      rows.rows.length,
      'applications.interview_date is missing. Either 0026_application_interview_date.sql did ' +
        'not apply, or it is absent from meta/_journal.json — drizzle applies by journal entry, ' +
        'so an unregistered .sql file silently never runs (WIC-1955).'
    ).toBe(1);

    // TIMESTAMPTZ, not DATE. The UI does `new Date(application.interviewDate)`
    // and formats a time from it, so a date-only column would render as UTC
    // midnight -- the previous evening for any user west of Greenwich.
    expect(rows.rows[0].data_type).toBe('timestamp with time zone');
    expect(rows.rows[0].is_nullable).toBe('YES');
    expect(rows.rows[0].column_default).toBeNull();
  });

  it('round-trips an instant through the drizzle schema binding', async () => {
    // The information_schema assertion above proves the DDL. This proves the
    // `schema.ts` column maps onto it: a name or mode mismatch there compiles
    // fine and fails only at query time.
    const { applications } = await import('../src/db/schema.js');
    const when = new Date('2026-09-11T14:30:00.000Z');

    await db.insert(applications).values({
      id: 'app_wic2023',
      jobTitle: 'Staff Engineer',
      company: 'Acme',
      interviewDate: when,
    });

    const [row] = await db.select().from(applications);
    expect(row.interviewDate).toBeInstanceOf(Date);
    expect(row.interviewDate!.toISOString()).toBe('2026-09-11T14:30:00.000Z');
  });

  it('defaults to NULL for a row that does not set it', async () => {
    // The no-backfill half of the migration. Every pre-existing row genuinely
    // has no known interview date, and NULL is the honest encoding -- a default
    // would manufacture data, and the UI branches on absence.
    const { applications } = await import('../src/db/schema.js');

    await db.insert(applications).values({
      id: 'app_wic2023_unset',
      jobTitle: 'Engineer',
      company: 'Beta',
    });

    const [row] = await db
      .select()
      .from(applications)
      .where(sql`id = 'app_wic2023_unset'`);
    expect(row.interviewDate).toBeNull();
  });
});
