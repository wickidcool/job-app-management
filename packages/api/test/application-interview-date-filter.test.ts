import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createMigratedDb } from './helpers/pglite-db.js';

/**
 * WIC-2189 — the `interview_date` range filter and `sortBy: 'interviewDate'`.
 *
 * These run against a real Postgres (PGlite) with the project's real migrations
 * replayed, not against a query stub, because every claim under test is a
 * property of the emitted SQL rather than of the TypeScript around it:
 *
 *   - NULLS LAST is a clause on the ORDER BY. A stub that returns rows in the
 *     order the test wants proves only that the test author knew the answer.
 *   - "a NULL interview date falls out of a bounded range" is the behaviour of
 *     three-valued logic in the WHERE clause, not of any code in the service.
 *   - the tiebreaker matters only when the database is free to reorder an
 *     equal-ranked block, which a stub never is.
 *
 * The direction that actually bites is DESC. Postgres defaults to NULLS LAST
 * for ASC and NULLS FIRST for DESC, so an implementation that inherits the
 * default passes every ASC assertion and fails only on DESC — which is why the
 * two directions are asserted separately below rather than as one round trip.
 */

const harness = vi.hoisted(() => ({ db: null as any }));

vi.mock('../src/db/client.js', () => ({
  getDb: () => harness.db,
}));

const OWNER = '11111111-1111-4111-8111-111111111111';

// Three scheduled interviews plus two unscheduled. The two NULL rows are what
// make the ordering assertions meaningful; a fixture with none would pass
// against an implementation that never emits NULLS LAST at all.
const SCHEDULED = [
  { id: 'app_wic2189_a', when: '2026-09-10T09:00:00.000Z' },
  { id: 'app_wic2189_b', when: '2026-09-15T13:30:00.000Z' },
  { id: 'app_wic2189_c', when: '2026-09-20T17:45:00.000Z' },
];
const UNSCHEDULED = ['app_wic2189_y', 'app_wic2189_z'];

describe('WIC-2189 — interview_date range filter and sort', () => {
  let client: Awaited<ReturnType<typeof createMigratedDb>>['client'];

  beforeAll(async () => {
    const made = await createMigratedDb();
    client = made.client;
    harness.db = made.db;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    const { applications } = await import('../src/db/schema.js');
    await harness.db.delete(applications);

    for (const { id, when } of SCHEDULED) {
      await harness.db.insert(applications).values({
        id,
        userId: OWNER,
        jobTitle: 'Engineer',
        company: 'Acme',
        interviewDate: new Date(when),
      });
    }
    for (const id of UNSCHEDULED) {
      await harness.db.insert(applications).values({
        id,
        userId: OWNER,
        jobTitle: 'Engineer',
        company: 'Acme',
        // interviewDate deliberately omitted -> NULL
      });
    }
  });

  describe('range filter', () => {
    it('bounds are inclusive on both ends', async () => {
      const { listApplications } = await import('../src/services/application.service.js');

      // Exactly the first and last scheduled instants. An exclusive
      // implementation returns 1 here instead of 3.
      const { applications: rows } = await listApplications(
        {
          interviewDateFrom: '2026-09-10T09:00:00.000Z',
          interviewDateTo: '2026-09-20T17:45:00.000Z',
        },
        OWNER
      );

      expect(rows.map((r) => r.id).sort()).toEqual([
        'app_wic2189_a',
        'app_wic2189_b',
        'app_wic2189_c',
      ]);
    });

    it('a lower bound alone excludes earlier interviews and all unscheduled rows', async () => {
      const { listApplications } = await import('../src/services/application.service.js');

      const { applications: rows } = await listApplications(
        { interviewDateFrom: '2026-09-15T00:00:00.000Z' },
        OWNER
      );

      expect(rows.map((r) => r.id).sort()).toEqual(['app_wic2189_b', 'app_wic2189_c']);
    });

    it('an upper bound alone excludes later interviews and all unscheduled rows', async () => {
      const { listApplications } = await import('../src/services/application.service.js');

      const { applications: rows } = await listApplications(
        { interviewDateTo: '2026-09-15T13:30:00.000Z' },
        OWNER
      );

      expect(rows.map((r) => r.id).sort()).toEqual(['app_wic2189_a', 'app_wic2189_b']);
    });

    it('NULL interview dates are excluded by a bound, not sorted to an end', async () => {
      const { listApplications } = await import('../src/services/application.service.js');

      // The distinction this pins: a bound is a *filter*, so unscheduled rows
      // disappear entirely. It is not the ordering rule wearing a different hat.
      const { applications: rows, totalCount } = await listApplications(
        { interviewDateFrom: '2000-01-01T00:00:00.000Z' },
        OWNER
      );

      const ids = rows.map((r) => r.id);
      for (const id of UNSCHEDULED) {
        expect(ids).not.toContain(id);
      }
      expect(totalCount).toBe(3);
    });

    it('totalCount reflects the range, not the whole table', async () => {
      const { listApplications } = await import('../src/services/application.service.js');

      // The count query and the row query are issued separately against the
      // same where clause; a filter threaded into only one of them is a
      // pagination bug that the row assertions above would not catch.
      const { applications: rows, totalCount } = await listApplications(
        {
          interviewDateFrom: '2026-09-14T00:00:00.000Z',
          interviewDateTo: '2026-09-16T00:00:00.000Z',
        },
        OWNER
      );

      expect(rows).toHaveLength(1);
      expect(totalCount).toBe(1);
    });

    it('composes with the other filters rather than replacing them', async () => {
      const { applications } = await import('../src/db/schema.js');
      const { listApplications } = await import('../src/services/application.service.js');

      await harness.db.insert(applications).values({
        id: 'app_wic2189_other',
        userId: OWNER,
        jobTitle: 'Engineer',
        company: 'Globex',
        interviewDate: new Date('2026-09-15T13:30:00.000Z'),
      });

      const { applications: rows } = await listApplications(
        {
          company: 'Globex',
          interviewDateFrom: '2026-09-01T00:00:00.000Z',
          interviewDateTo: '2026-09-30T00:00:00.000Z',
        },
        OWNER
      );

      expect(rows.map((r) => r.id)).toEqual(['app_wic2189_other']);
    });

    it('stays scoped to the owner', async () => {
      const { applications } = await import('../src/db/schema.js');
      const { listApplications } = await import('../src/services/application.service.js');

      await harness.db.insert(applications).values({
        id: 'app_wic2189_tenant',
        userId: '22222222-2222-4222-8222-222222222222',
        jobTitle: 'Engineer',
        company: 'Acme',
        interviewDate: new Date('2026-09-15T13:30:00.000Z'),
      });

      const { applications: rows } = await listApplications(
        { interviewDateFrom: '2026-09-01T00:00:00.000Z' },
        OWNER
      );

      expect(rows.map((r) => r.id)).not.toContain('app_wic2189_tenant');
    });
  });

  describe("sortBy: 'interviewDate' — NULL placement", () => {
    it('ASC puts scheduled interviews first, in time order, unscheduled last', async () => {
      const { listApplications } = await import('../src/services/application.service.js');

      const { applications: rows } = await listApplications(
        { sortBy: 'interviewDate', sortOrder: 'asc' },
        OWNER
      );

      expect(rows.map((r) => r.id)).toEqual([
        'app_wic2189_a',
        'app_wic2189_b',
        'app_wic2189_c',
        ...UNSCHEDULED,
      ]);
    });

    it('DESC puts scheduled interviews first too — NULLS LAST is pinned, not inherited', async () => {
      const { listApplications } = await import('../src/services/application.service.js');

      const { applications: rows } = await listApplications(
        { sortBy: 'interviewDate', sortOrder: 'desc' },
        OWNER
      );

      // This is the assertion the whole file exists for. Postgres defaults to
      // NULLS FIRST for DESC, so an implementation that leans on `desc(col)`
      // alone returns the two unscheduled rows here first and fails on the very
      // first element.
      expect(rows.map((r) => r.id)).toEqual([
        'app_wic2189_c',
        'app_wic2189_b',
        'app_wic2189_a',
        ...UNSCHEDULED,
      ]);
    });

    it('defaults to DESC when no sortOrder is given, still NULLS LAST', async () => {
      const { listApplications } = await import('../src/services/application.service.js');

      const { applications: rows } = await listApplications({ sortBy: 'interviewDate' }, OWNER);

      expect(rows.map((r) => r.id).slice(0, 3)).toEqual([
        'app_wic2189_c',
        'app_wic2189_b',
        'app_wic2189_a',
      ]);
      expect(rows.map((r) => r.id).slice(3)).toEqual(UNSCHEDULED);
    });

    it('orders the NULL block deterministically, so offset pages do not drop or repeat rows', async () => {
      const { applications } = await import('../src/db/schema.js');
      const { listApplications } = await import('../src/services/application.service.js');

      // Enough equal-ranked NULL rows that an unspecified order has room to
      // differ between the two queries a page pair issues.
      for (let i = 0; i < 12; i++) {
        await harness.db.insert(applications).values({
          id: `app_wic2189_null_${String(i).padStart(2, '0')}`,
          userId: OWNER,
          jobTitle: 'Engineer',
          company: 'Acme',
        });
      }

      const seen: string[] = [];
      let page: string | undefined;
      do {
        const res = await listApplications(
          { sortBy: 'interviewDate', sortOrder: 'desc', limit: 4, page },
          OWNER
        );
        seen.push(...res.applications.map((r) => r.id));
        page = res.nextPage;
      } while (page);

      // 3 scheduled + 2 + 12 unscheduled, each exactly once.
      expect(seen).toHaveLength(17);
      expect(new Set(seen).size).toBe(17);
      expect(seen.slice(0, 3)).toEqual(['app_wic2189_c', 'app_wic2189_b', 'app_wic2189_a']);
    });

    it('leaves the other sort keys alone', async () => {
      const { listApplications } = await import('../src/services/application.service.js');

      // Regression guard for the `orderBy` refactor from a single value to a
      // spread array: a mistake there would surface as a wrong order here, not
      // as a type error.
      const { applications: rows } = await listApplications(
        { sortBy: 'company', sortOrder: 'asc' },
        OWNER
      );

      expect(rows).toHaveLength(5);
      expect(rows.every((r) => r.company === 'Acme')).toBe(true);
    });
  });
});
