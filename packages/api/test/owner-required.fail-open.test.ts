/**
 * WIC-2071 (ADR-010 D2, slice 2) — the five owner ternaries that failed **OPEN**.
 *
 * Slice 1 (WIC-2070) narrowed `project.service.ts`, whose fallback was already
 * inert: `projects.user_id` is NOT NULL, so its `isNull()` reading selected the
 * empty set. This file covers the other class. Each site below dropped the owner
 * term rather than inverting it, so an absent owner **widened** the query:
 *
 *   1 catalog.service.ts    listStarEntries      `: undefined`  -> no predicate
 *   2 dashboard.service.ts  getDashboardStats    `: undefined`  -> no predicate
 *   3 resume.service.ts     listResumes          `: undefined`  -> no predicate
 *   4 resume.service.ts     listResumeExports    `: eq(id)`     -> IDOR read
 *   5 application.service.ts updateApplication   `: baseWhere`  -> IDOR **write**
 *
 * Sites 4-5 are the `userId ? and(idTerm, ownerTerm) : idTerm` idiom that
 * `resume-variant.service.ts:55` records as the WIC-1482 / WIC-1500 defect. Their
 * fallback still *looks* scoped because the id term survives, which is why a
 * `: undefined` grep does not find them.
 *
 * ## What these tests grade, and why a status code cannot
 *
 * ADR-010 AC-4: a response code cannot distinguish a not-found guard from an
 * ownership guard. So the load-bearing assertion here is **`getDb` was never
 * called** — the guard refuses before a connection is opened, which is the one
 * thing only *this* function's guard can do and the strongest available reading
 * of "zero rows read or written". Borrowed from `project.owner-required.test.ts`
 * AC-R8, which exists because a revert matrix showed every status-shaped
 * assertion still passing with the guard deleted.
 *
 * `getDb` is spied over a **real migrated Postgres** (PGlite, the project's own
 * migration files replayed in journal order) rather than a query double. A double
 * that ignores the predicate handed to it passes with the bug in place; sites 4-5
 * are write paths whose whole claim is *which rows the WHERE clause matched*, so
 * the planner has to be real.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createMigratedDb } from './helpers/pglite-db.js';

let harness: Awaited<ReturnType<typeof createMigratedDb>>;

const getDbSpy = vi.fn(() => harness.db);

vi.mock('../src/db/client.js', () => ({
  getDb: () => getDbSpy(),
  closeDb: async () => {},
}));

const { listStarEntries } = await import('../src/services/catalog.service.js');
const { getDashboardStats } = await import('../src/services/dashboard.service.js');
const { listResumes, listResumeExports } = await import('../src/services/resume.service.js');
const { updateApplication } = await import('../src/services/application.service.js');
const { applications, resumes, resumeExports, quantifiedBullets } =
  await import('../src/db/schema.js');
const { AppError } = await import('../src/types/index.js');

const CALLER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/**
 * No owner. Cast rather than `any`: the narrowed signature makes the compiler the
 * first line of defence, and these tests are the second — they cover JS callers
 * and the authenticated-but-`sub`-less JWT, where the value is absent at runtime
 * however the type reads. Deleting the runtime guard leaves `tsc` at exit 0.
 */
const NO_OWNER = undefined as unknown as string;

beforeAll(async () => {
  harness = await createMigratedDb();
});

beforeEach(async () => {
  await harness.client.exec(
    'TRUNCATE applications, resumes, resume_exports, quantified_bullets CASCADE;'
  );
  getDbSpy.mockClear();
});

/** One row per table, all owned by OTHER — the tenant the caller must not reach. */
async function seedOther() {
  await harness.db.insert(applications).values({
    id: 'app-other',
    userId: OTHER,
    jobTitle: 'Staff Engineer',
    company: 'Acme',
    status: 'saved',
    version: 3,
  });
  await harness.db.insert(resumes).values({
    id: 'res-other',
    userId: OTHER,
    fileName: 'other.pdf',
    fileSize: 10,
    mimeType: 'application/pdf',
    filePath: 'other/res.pdf',
  });
  await harness.db.insert(resumeExports).values({
    id: 'exp-other',
    resumeId: 'res-other',
    filePath: 'other/exp.md',
  });
  await harness.db.insert(quantifiedBullets).values({
    id: 'bul-other',
    userId: OTHER,
    sourceType: 'resume',
    sourceId: 'res-other',
    rawText: "OTHER's confidential achievement",
    metricType: 'percentage',
    metricValue: '42',
  });
}

/**
 * The five sites, each as `[name, ownerless invocation]`. Table-driven so a sixth
 * fail-open site added later is one row, and so none of the five can be quietly
 * dropped from the sweep.
 */
const SITES: [string, () => Promise<unknown>, RegExp][] = [
  ['1 listStarEntries', () => listStarEntries(NO_OWNER), /required to list STAR entries/i],
  ['2 getDashboardStats', () => getDashboardStats(NO_OWNER), /required to read dashboard stats/i],
  ['3 listResumes', () => listResumes(NO_OWNER), /required to list resumes/i],
  [
    '4 listResumeExports',
    () => listResumeExports('res-other', NO_OWNER),
    /required to list resume exports/i,
  ],
  [
    '5 updateApplication',
    () => updateApplication('app-other', { jobTitle: 'PWNED', version: 3 }, NO_OWNER),
    /required to update an application/i,
  ],
];

describe('WIC-2071 AC-3 — an absent owner reads and writes zero rows', () => {
  it.each(SITES)('%s rejects rather than widening', async (_name, call) => {
    await seedOther();

    await expect(call()).rejects.toBeInstanceOf(AppError);
    await expect(call()).rejects.toMatchObject({ code: 'BAD_REQUEST', statusCode: 400 });
  });

  it.each(SITES)('%s refuses before opening a connection', async (_name, call, _msg) => {
    await seedOther();
    getDbSpy.mockClear();

    await expect(call()).rejects.toBeInstanceOf(AppError);

    // The assertion that grades the fix. Without it, sites 1-3 would still
    // "pass" a rows-returned check by accident on an empty table, and sites 4-5
    // would pass one by binding a NULL owner into a real query that happens to
    // match nothing. No query should be issued for a caller with no identity.
    expect(getDbSpy, 'no database work was done for an unidentified caller').not.toHaveBeenCalled();
  });

  it.each(SITES)('%s names its own guard in the failure', async (_name, call, msg) => {
    // Which guard fired matters. Every downstream owner guard in this repo also
    // answers BAD_REQUEST/400, so the code-and-status assertions above still hold
    // with *this* site's guard deleted and a deeper one catching the call. The
    // message is what distinguishes them.
    await expect(call()).rejects.toThrow(msg);
  });
});

describe("WIC-2071 AC-3 — OTHER's rows survive an ownerless call", () => {
  it('site 5: the IDOR write leaves the target row byte-for-byte unchanged', async () => {
    await seedOther();
    const [before] = await harness.db
      .select()
      .from(applications)
      .where(eq(applications.id, 'app-other'));

    await updateApplication('app-other', { jobTitle: 'PWNED', version: 3 }, NO_OWNER).catch(
      () => undefined
    );

    const [after] = await harness.db
      .select()
      .from(applications)
      .where(eq(applications.id, 'app-other'));

    // Pre-fix, `baseWhere` pinned only `(id, version)` — both caller-supplied,
    // and `version` is a small integer that starts at 1. This rewrote another
    // tenant's application and bumped its version, so the row was mutated even
    // though the request carried no identity at all.
    expect(after.jobTitle).toBe('Staff Engineer');
    expect(after.version).toBe(before.version);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("site 4: the IDOR read discloses nothing about OTHER's exports", async () => {
    await seedOther();

    const err = await listResumeExports('res-other', NO_OWNER).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    // An error carrying the export's path would be a disclosure even though the
    // call "failed". Pre-fix this resolved and returned the row outright.
    expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain('other/exp.md');
  });
});

/**
 * Controls. Without these every assertion above passes vacuously for the wrong
 * reason — a function that always throws satisfies all of them, and so does one
 * whose owner term is `sql\`false\``.
 */
describe('WIC-2071 — the guard is not a blanket deny, and the owner term is real', () => {
  it('a real owner reaches the database and sees only their own rows', async () => {
    await seedOther();
    await harness.db.insert(quantifiedBullets).values({
      id: 'bul-caller',
      userId: CALLER,
      sourceType: 'resume',
      sourceId: 'res-caller',
      rawText: "CALLER's own achievement",
      metricType: 'percentage',
      metricValue: '7',
    });
    await harness.db.insert(resumes).values({
      id: 'res-caller',
      userId: CALLER,
      fileName: 'caller.pdf',
      fileSize: 10,
      mimeType: 'application/pdf',
      filePath: 'caller/res.pdf',
    });

    const entries = await listStarEntries(CALLER);
    expect(entries.map((e) => e.id)).toEqual(['bul-caller']);

    const mine = await listResumes(CALLER);
    expect(mine.map((r) => r.id)).toEqual(['res-caller']);

    // Scoping, not emptiness: OTHER still sees exactly their own row, so the
    // predicate is discriminating rather than uniformly false.
    expect((await listResumes(OTHER)).map((r) => r.id)).toEqual(['res-other']);
    expect(getDbSpy).toHaveBeenCalled();
  });

  it("site 4: a real owner cannot reach another tenant's resume by id", async () => {
    await seedOther();

    // The owner term is in the *probe*, not merely in the guard. The exports read
    // that follows the probe is keyed on `resumeId` alone, so the probe throwing
    // is this function's entire tenancy guarantee.
    await expect(listResumeExports('res-other', CALLER)).rejects.toThrow(/resume/i);
  });

  it('site 5: a real owner cannot update another tenant’s application by id', async () => {
    await seedOther();

    await expect(
      updateApplication('app-other', { jobTitle: 'PWNED', version: 3 }, CALLER)
    ).rejects.toThrow(/application/i);

    const [after] = await harness.db
      .select()
      .from(applications)
      .where(eq(applications.id, 'app-other'));
    expect(after.jobTitle).toBe('Staff Engineer');
    expect(after.version).toBe(3);
  });

  it('site 5: the owner still updates their own application', async () => {
    await harness.db.insert(applications).values({
      id: 'app-caller',
      userId: CALLER,
      jobTitle: 'Backend Engineer',
      company: 'Careerpin',
      status: 'saved',
      version: 1,
    });

    const { application } = await updateApplication(
      'app-caller',
      { jobTitle: 'Senior Backend Engineer', version: 1 },
      CALLER
    );

    expect(application.jobTitle).toBe('Senior Backend Engineer');
    expect(application.version).toBe(2);
  });

  it('site 2: the dashboard counts only the caller’s applications', async () => {
    await seedOther();
    await harness.db.insert(applications).values({
      id: 'app-caller',
      userId: CALLER,
      jobTitle: 'Backend Engineer',
      company: 'Careerpin',
      status: 'saved',
    });

    const { stats } = await getDashboardStats(CALLER);

    // Pre-fix an ownerless call counted both rows. With the owner required, the
    // caller's total is 1 and OTHER's is 1 — never 2 for either.
    expect(stats.total).toBe(1);
    expect((await getDashboardStats(OTHER)).stats.total).toBe(1);
  });
});
