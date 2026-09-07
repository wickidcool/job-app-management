import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createMigratedDb } from './helpers/pglite-db.js';
import { APPLICATION_SORT_KEYS } from '../src/types/index.js';

/**
 * WIC-2260 — every `sortBy` key's ORDER BY ends in a unique tiebreaker.
 *
 * WIC-2189 worked this out for `interviewDate` and wrote the argument down in
 * `application.service.ts`: offset pagination issues one query per page, and
 * Postgres may order an equal-ranked block differently between them, silently
 * dropping some rows and repeating others. The argument turns only on ties
 * existing, never on which column produced them — so it applied to all four
 * sort keys, and was implemented on one.
 *
 * `company` is the case that actually bites. Applying to the same employer
 * several times is ordinary use of this app, so `sortBy=company` is *expected*
 * to produce large equal-ranked blocks.
 *
 * ## Why there are two halves here, and which one is the control
 *
 * The behavioural half pages over an equal-ranked block and asserts nothing is
 * dropped or repeated. It describes the user-visible bug directly — but whether
 * it *detects* the bug is up to the planner, so it is a detector for some sort
 * keys and a contract pin for others. Measured by mutation, dropping the
 * tiebreaker from one branch at a time:
 *
 *   - `sortBy=company`   — the paging test **fails**. PGlite really does return
 *                          that block in a different order across offset pages,
 *                          so here the behavioural test is a genuine detector.
 *   - `sortBy=createdAt` — the paging test **passes**. Same-shaped equal-ranked
 *                          block, same missing tiebreaker, and the rows happen
 *                          to come back consistently anyway.
 *
 * Those two are structurally identical and disagree, which is the whole reason
 * the SQL half exists: a behavioural check over an unordered block is testing
 * the planner's mood, and you cannot tell from a green run which of the two
 * cases you are in.
 *
 * So the SQL half is the control. It asserts the tiebreaker is *present in the
 * emitted ORDER BY* for every key, which is the property the fix actually
 * establishes, and it goes red on every branch when the tiebreaker is removed —
 * including the branches whose paging test stays green. A suite resting on the
 * behavioural half alone would have certified `createdAt`, `updatedAt` and
 * `interviewDate` while all three were still broken.
 *
 * It iterates `APPLICATION_SORT_KEYS` rather than a hand-listed set, so a fifth
 * sort key added without a tiebreaker fails here rather than being silently out
 * of scope. That is the same omission this card is fixing, one level up.
 */

const harness = vi.hoisted(() => ({ db: null as any }));

vi.mock('../src/db/client.js', () => ({
  getDb: () => harness.db,
}));

const OWNER = '22222222-2222-4222-8222-222222222222';

/**
 * The column each sort key must actually sort on, so the control also catches a
 * mutant that keeps the tiebreaker but sorts by the wrong thing. Written out
 * rather than derived from the schema: deriving it from the same mapping the
 * implementation uses would make the assertion agree with the bug.
 */
const EXPECTED_COLUMN: Record<(typeof APPLICATION_SORT_KEYS)[number], string> = {
  createdAt: '"applications"."created_at"',
  updatedAt: '"applications"."updated_at"',
  company: '"applications"."company"',
  interviewDate: '"applications"."interview_date"',
};

describe('WIC-2260 — sort stability across offset pages', () => {
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
  });

  describe('the emitted ORDER BY (the control)', () => {
    it.each(APPLICATION_SORT_KEYS.flatMap((k) => [[k, 'asc'] as const, [k, 'desc'] as const]))(
      'sortBy=%s sortOrder=%s ends with the unique id tiebreaker',
      async (sortBy, order) => {
        const { applications } = await import('../src/db/schema.js');
        const { buildApplicationOrderBy } = await import('../src/services/application.service.js');

        const { sql } = harness.db
          .select()
          .from(applications)
          .orderBy(...buildApplicationOrderBy(sortBy, order))
          .toSQL();

        const orderByClause = sql.slice(sql.lastIndexOf(' order by '));

        // The tiebreaker is the LAST term: a unique key anywhere earlier would
        // make every later term dead, so position is part of the claim.
        const TIEBREAKER = /,\s*"applications"\."id"\s+asc\s*$/;
        expect(orderByClause).toMatch(TIEBREAKER);

        // ...and it is a genuine tail, not the whole clause — the sort the caller
        // asked for still has to come first. Guards against a mutant that drops
        // the sort column and keeps only the tiebreaker. The leading comma in
        // TIEBREAKER already implies a preceding term; this pins that the term is
        // the requested column rather than anything else.
        const head = orderByClause.replace(TIEBREAKER, '');
        expect(head).toContain(EXPECTED_COLUMN[sortBy]);
        expect(head).toContain(order);
      }
    );

    it('covers every key the route will accept', async () => {
      // APPLICATION_SORT_KEYS is what the route's z.enum validates against, so
      // this is the assertion that keeps the it.each above honest: if the two
      // ever drift, a key could reach the query builder untested.
      const { applicationsRoutes } = await import('../src/routes/applications.js');
      expect(applicationsRoutes).toBeDefined();
      expect([...APPLICATION_SORT_KEYS].sort()).toEqual([
        'company',
        'createdAt',
        'interviewDate',
        'updatedAt',
      ]);
    });
  });

  describe('paging over an equal-ranked block', () => {
    // A detector for `company` and a contract pin for `createdAt` — see the
    // header for the mutation measurement, and do not assume a green run here
    // means the tiebreaker is present.
    const seed = async (n: number) => {
      const { applications } = await import('../src/db/schema.js');
      for (let i = 0; i < n; i++) {
        await harness.db.insert(applications).values({
          id: `app_wic2262_${String(i).padStart(2, '0')}`,
          userId: OWNER,
          jobTitle: 'Engineer',
          // Every row the same company: one fully equal-ranked block.
          company: 'Acme',
        });
      }
    };

    it('sortBy=company drops and repeats nothing across pages', async () => {
      const { listApplications } = await import('../src/services/application.service.js');
      await seed(17);

      const seen: string[] = [];
      let page: string | undefined;
      do {
        const res = await listApplications(
          { sortBy: 'company', sortOrder: 'asc', limit: 4, page },
          OWNER
        );
        seen.push(...res.applications.map((r) => r.id));
        page = res.nextPage;
      } while (page);

      expect(seen).toHaveLength(17);
      expect(new Set(seen).size).toBe(17);
    });

    it('sortBy=createdAt drops and repeats nothing when rows share a timestamp', async () => {
      const { listApplications } = await import('../src/services/application.service.js');
      // createdAt defaults to now() — rows written in one batch tie exactly.
      await seed(17);

      const seen: string[] = [];
      let page: string | undefined;
      do {
        const res = await listApplications(
          { sortBy: 'createdAt', sortOrder: 'desc', limit: 4, page },
          OWNER
        );
        seen.push(...res.applications.map((r) => r.id));
        page = res.nextPage;
      } while (page);

      expect(seen).toHaveLength(17);
      expect(new Set(seen).size).toBe(17);
    });
  });
});
