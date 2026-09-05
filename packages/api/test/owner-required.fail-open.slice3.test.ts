/**
 * WIC-2072 (ADR-010 D2, slice 3) — the 13 remaining owner ternaries that failed **OPEN**.
 *
 * Companion to `owner-required.fail-open.test.ts` (slice 2, WIC-2071), which closed the first
 * five. Every site here is the *same* idiom, and it is the one that hides best:
 *
 *     const whereClause = userId
 *       ? and(eq(t.id, id), eq(t.userId, userId))
 *       : eq(t.id, id);                              // <- owner term DROPPED, id term survives
 *
 * `resume-variant.service.ts:55` records this as the WIC-1482 / WIC-1500 defect. The fallback
 * still *looks* scoped, because the id term is right there — which is why the `: undefined` grep
 * that found slice 2's sites 1-3 does not find these. Match on the fallback, not the literal.
 *
 * 13 ternaries across 12 functions (`updateCoverLetter` carries two):
 *
 *   cover-letter.service.ts  getCoverLetter, updateCoverLetter (x2), deleteCoverLetter,
 *                            reviseCoverLetter, generateOutreach, exportCoverLetter
 *   application.service.ts   getApplication, deleteApplication, updateApplicationStatus
 *   resume.service.ts        getResumeExport, deleteResume, getResumeDownloadUrl
 *
 * ## What these tests grade, and why a status code cannot
 *
 * ADR-010 AC-4: a response code cannot distinguish a not-found guard from an ownership guard. So
 * the load-bearing assertion is **`getDb` was never called** — the guard refuses before a
 * connection is opened, which is the one thing only *this* function's guard can do and the
 * strongest available reading of "zero rows read or written". Inherited from slice 2, which
 * inherited it from `project.owner-required.test.ts` AC-R8, which exists because a revert matrix
 * showed every status-shaped assertion still passing with the guard deleted.
 *
 * `getDb` is spied over a **real migrated Postgres** (PGlite, the project's own migrations
 * replayed in journal order) rather than a query double. A double that ignores the predicate
 * handed to it passes with the bug still in place, and four of these sites are DELETE/UPDATE paths
 * whose entire claim is *which rows the WHERE clause matched* — so the planner has to be real.
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

const { getApplication, deleteApplication, updateApplicationStatus } =
  await import('../src/services/application.service.js');
const {
  getCoverLetter,
  updateCoverLetter,
  deleteCoverLetter,
  reviseCoverLetter,
  generateOutreach,
  exportCoverLetter,
} = await import('../src/services/cover-letter.service.js');
const { getResumeExport, deleteResume, getResumeDownloadUrl } =
  await import('../src/services/resume.service.js');
const { applications, coverLetters, resumes, resumeExports } = await import('../src/db/schema.js');
const { AppError } = await import('../src/types/index.js');

const CALLER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const VICTIM_CONTENT = "OTHER's confidential cover letter body";

/**
 * No owner. Cast rather than `any`: the narrowed signature makes the compiler the first line of
 * defence and these tests are the second — they cover JS callers and the authenticated-but-`sub`-
 * less JWT, where the value is absent at runtime however the type reads. Deleting the runtime
 * guard leaves `tsc` at exit 0, so the type cannot be the thing under test here.
 */
const NO_OWNER = undefined as unknown as string;

beforeAll(async () => {
  harness = await createMigratedDb();
});

beforeEach(async () => {
  await harness.client.exec(
    'TRUNCATE applications, cover_letters, resumes, resume_exports, status_history CASCADE;'
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
  await harness.db.insert(coverLetters).values({
    id: 'cl-other',
    userId: OTHER,
    title: "OTHER's letter",
    targetCompany: 'Acme',
    targetRole: 'Staff Engineer',
    content: VICTIM_CONTENT,
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
    userId: OTHER,
    resumeId: 'res-other',
    filePath: 'other/exp.md',
  });
}

/**
 * The 13 sites, each as `[name, ownerless invocation, own-guard message]`. Table-driven so that a
 * fourteenth site added later is one row, and so none of the thirteen can be quietly dropped.
 *
 * `updateCoverLetter` appears once: its two ternaries share one signature and therefore one guard.
 * The second (the 404-vs-409 read) needs a *reachability* case rather than a guard case, and gets
 * one of its own further down.
 */
const SITES: [string, () => Promise<unknown>, RegExp][] = [
  [
    '01 getApplication',
    () => getApplication('app-other', NO_OWNER),
    /required to read an application/i,
  ],
  [
    '02 deleteApplication',
    () => deleteApplication('app-other', NO_OWNER),
    /required to delete an application/i,
  ],
  [
    '03 updateApplicationStatus',
    () =>
      updateApplicationStatus('app-other', { status: 'applied', version: 3 } as never, NO_OWNER),
    /required to update an application status/i,
  ],
  [
    '04 getCoverLetter',
    () => getCoverLetter('cl-other', NO_OWNER),
    /required to read a cover letter/i,
  ],
  [
    '05 updateCoverLetter',
    () => updateCoverLetter('cl-other', { title: 'PWNED', version: 3 } as never, NO_OWNER),
    /required to update a cover letter/i,
  ],
  [
    '06 deleteCoverLetter',
    () => deleteCoverLetter('cl-other', NO_OWNER),
    /required to delete a cover letter/i,
  ],
  [
    '07 reviseCoverLetter',
    () => reviseCoverLetter('cl-other', { revisionInstructions: 'punchier' } as never, NO_OWNER),
    /required to revise a cover letter/i,
  ],
  [
    '08 generateOutreach',
    () => generateOutreach({ platform: 'linkedin', coverLetterId: 'cl-other' } as never, NO_OWNER),
    /required to generate an outreach message/i,
  ],
  [
    '09 exportCoverLetter',
    () => exportCoverLetter('cl-other', { format: 'docx' } as never, NO_OWNER),
    /required to export a cover letter/i,
  ],
  [
    '10 getResumeExport',
    () => getResumeExport('res-other', 'exp-other', NO_OWNER),
    /required to read a resume export/i,
  ],
  ['11 deleteResume', () => deleteResume('res-other', NO_OWNER), /required to delete a resume/i],
  [
    '12 getResumeDownloadUrl',
    () => getResumeDownloadUrl('res-other', NO_OWNER),
    /required to get a resume download URL/i,
  ],
];

describe('WIC-2072 AC-3 — an absent owner reads and writes zero rows', () => {
  it('covers every function the sweep found, with none dropped', () => {
    // Guards the table itself. The per-site cases below are only as complete as this list, and a
    // silently shortened list is exactly how a burndown reports a clean sweep it did not do.
    expect(SITES).toHaveLength(12);
  });

  it.each(SITES)('%s rejects rather than widening', async (_name, call) => {
    await seedOther();

    await expect(call()).rejects.toBeInstanceOf(AppError);
    await expect(call()).rejects.toMatchObject({ code: 'BAD_REQUEST', statusCode: 400 });
  });

  it.each(SITES)('%s refuses before opening a connection', async (_name, call) => {
    await seedOther();
    getDbSpy.mockClear();

    await expect(call()).rejects.toBeInstanceOf(AppError);

    // The assertion that grades the fix. A rows-returned check would pass by accident here: the
    // pre-fix fallback bound no owner into a real query, so on a sparse table it can match nothing
    // and look correct. No query should be issued at all for a caller with no identity.
    expect(getDbSpy, 'no database work was done for an unidentified caller').not.toHaveBeenCalled();
  });

  it.each(SITES)('%s names its own guard in the failure', async (_name, call, msg) => {
    // Which guard fired matters. Every downstream owner guard in this repo also answers
    // BAD_REQUEST/400, so the code-and-status assertions above still hold with *this* site's guard
    // deleted and a deeper one catching the call. The message is what distinguishes them.
    await expect(call()).rejects.toThrow(msg);
  });
});

describe("WIC-2072 AC-3 — OTHER's rows survive an ownerless call", () => {
  it('the three DELETE paths leave the target row in place', async () => {
    await seedOther();

    await deleteApplication('app-other', NO_OWNER).catch(() => undefined);
    await deleteCoverLetter('cl-other', NO_OWNER).catch(() => undefined);
    await deleteResume('res-other', NO_OWNER).catch(() => undefined);

    // Pre-fix each fallback pinned `id` alone — caller-supplied — so an unidentified request
    // destroyed another tenant's row outright. `deleteResume` also unlinked the stored object,
    // which no database rollback recovers.
    expect(
      await harness.db.select().from(applications).where(eq(applications.id, 'app-other'))
    ).toHaveLength(1);
    expect(
      await harness.db.select().from(coverLetters).where(eq(coverLetters.id, 'cl-other'))
    ).toHaveLength(1);
    expect(await harness.db.select().from(resumes).where(eq(resumes.id, 'res-other'))).toHaveLength(
      1
    );
  });

  it('the IDOR write leaves the target cover letter byte-for-byte unchanged', async () => {
    await seedOther();
    const [before] = await harness.db
      .select()
      .from(coverLetters)
      .where(eq(coverLetters.id, 'cl-other'));

    await updateCoverLetter('cl-other', { title: 'PWNED', version: 3 } as never, NO_OWNER).catch(
      () => undefined
    );

    const [after] = await harness.db
      .select()
      .from(coverLetters)
      .where(eq(coverLetters.id, 'cl-other'));

    // Pre-fix the UPDATE predicate pinned only `(id, version)` — both caller-supplied, and
    // `version` is a small integer starting at 1, so it is guessable in a handful of tries.
    expect(after.title).toBe("OTHER's letter");
    expect(after.content).toBe(VICTIM_CONTENT);
    expect(after.version).toBe(before.version);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('the status transition neither locks nor moves the target application', async () => {
    await seedOther();

    await updateApplicationStatus(
      'app-other',
      { status: 'applied', version: 3 } as never,
      NO_OWNER
    ).catch(() => undefined);

    const [after] = await harness.db
      .select()
      .from(applications)
      .where(eq(applications.id, 'app-other'));
    // The `SELECT ... FOR UPDATE` that opened this transaction was the only ownership check on
    // the path; every write after it keys on `id` alone and trusts it.
    expect(after.status).toBe('saved');
    expect(after.version).toBe(3);
  });

  it('the reads disclose nothing about OTHER’s rows, not even in the error', async () => {
    await seedOther();

    const errs = await Promise.all([
      getApplication('app-other', NO_OWNER).catch((e) => e),
      getCoverLetter('cl-other', NO_OWNER).catch((e) => e),
      getResumeExport('res-other', 'exp-other', NO_OWNER).catch((e) => e),
      getResumeDownloadUrl('res-other', NO_OWNER).catch((e) => e),
    ]);

    for (const err of errs) {
      expect(err).toBeInstanceOf(AppError);
      // An error carrying the content or the storage path would be a disclosure even though the
      // call "failed". Pre-fix these resolved and returned the row outright.
      const payload = JSON.stringify({ m: err.message, d: err.details });
      expect(payload).not.toContain(VICTIM_CONTENT);
      expect(payload).not.toContain('other/res.pdf');
      expect(payload).not.toContain('other/exp.md');
    }
  });
});

/**
 * Controls. Without these every assertion above passes vacuously for the wrong reason — a function
 * that always throws satisfies all of them, and so does one whose owner term is `sql\`false\``.
 */
describe('WIC-2072 — the guard is not a blanket deny, and the owner term is real', () => {
  async function seedCaller() {
    await harness.db.insert(applications).values({
      id: 'app-caller',
      userId: CALLER,
      jobTitle: 'Backend Engineer',
      company: 'Careerpin',
      status: 'saved',
      version: 1,
    });
    await harness.db.insert(coverLetters).values({
      id: 'cl-caller',
      userId: CALLER,
      title: "CALLER's letter",
      targetCompany: 'Careerpin',
      targetRole: 'Backend Engineer',
      content: "CALLER's own words",
      version: 1,
    });
    await harness.db.insert(resumes).values({
      id: 'res-caller',
      userId: CALLER,
      fileName: 'caller.pdf',
      fileSize: 10,
      mimeType: 'application/pdf',
      filePath: 'caller/res.pdf',
    });
    await harness.db.insert(resumeExports).values({
      id: 'exp-caller',
      userId: CALLER,
      resumeId: 'res-caller',
      filePath: 'caller/exp.md',
    });
  }

  it('a real owner reaches the database and reads their own rows', async () => {
    await seedOther();
    await seedCaller();

    const { application } = await getApplication('app-caller', CALLER);
    expect(application.id).toBe('app-caller');

    const { coverLetter } = await getCoverLetter('cl-caller', CALLER);
    expect(coverLetter.id).toBe('cl-caller');

    const exp = await getResumeExport('res-caller', 'exp-caller', CALLER);
    expect(exp.id).toBe('exp-caller');

    expect(getDbSpy).toHaveBeenCalled();
  });

  it('the predicate discriminates rather than being uniformly false', async () => {
    await seedOther();
    await seedCaller();

    // Scoping, not emptiness. OTHER still reaches exactly their own row through the same code
    // path, so the owner term is doing work rather than matching nothing for everyone.
    expect((await getApplication('app-other', OTHER)).application.id).toBe('app-other');
    expect((await getCoverLetter('cl-other', OTHER)).coverLetter.id).toBe('cl-other');
  });

  it("a real owner cannot reach another tenant's rows by id", async () => {
    await seedOther();
    await seedCaller();

    await expect(getApplication('app-other', CALLER)).rejects.toThrow(/application/i);
    await expect(getCoverLetter('cl-other', CALLER)).rejects.toThrow(/cover letter/i);
    await expect(deleteCoverLetter('cl-other', CALLER)).rejects.toThrow(/cover letter/i);
    await expect(deleteApplication('app-other', CALLER)).rejects.toThrow(/application/i);
    // The probe, not the guard: the exports read that follows keys on `resumeId` alone, so this
    // throwing is the entire tenancy guarantee of `getResumeExport`.
    await expect(getResumeExport('res-other', 'exp-other', CALLER)).rejects.toThrow(/resume/i);

    expect(
      await harness.db.select().from(coverLetters).where(eq(coverLetters.id, 'cl-other'))
    ).toHaveLength(1);
  });

  it('the owner still updates and deletes their own rows', async () => {
    await seedCaller();

    const updated = await updateCoverLetter(
      'cl-caller',
      { title: 'Sharper letter', version: 1 } as never,
      CALLER
    );
    expect(updated.title).toBe('Sharper letter');
    expect(updated.version).toBe(2);

    const { application } = await updateApplicationStatus(
      'app-caller',
      { status: 'applied', version: 1 } as never,
      CALLER
    );
    expect(application.status).toBe('applied');

    await expect(deleteCoverLetter('cl-caller', CALLER)).resolves.toBeUndefined();
    expect(
      await harness.db.select().from(coverLetters).where(eq(coverLetters.id, 'cl-caller'))
    ).toHaveLength(0);
  });

  /**
   * Ternary 2 of 2 in `updateCoverLetter` — the read that decides 404-vs-409.
   *
   * This one needs its own case because the guard cannot reach it and the write predicate does not
   * either. With the write correctly refused, the pre-fix fallback `eq(coverLetters.id, id)` still
   * answered `VersionConflictError` for another tenant's letter rather than `NotFoundError` —
   * confirming the row exists, and re-opening precisely the distinction the owner term erases.
   * Fixing only the write predicate would have left that oracle intact and every other test here
   * would still be green.
   */
  it('the 404-vs-409 read does not confirm that another tenant’s letter exists', async () => {
    await seedOther();
    await seedCaller();

    // A deliberately wrong version, so the UPDATE matches nothing and control reaches the
    // disambiguating read. `cl-other` exists; the answer must not say so.
    const foreign = await updateCoverLetter(
      'cl-other',
      { title: 'PWNED', version: 99 } as never,
      CALLER
    ).catch((e) => e);

    // An id that exists for nobody, as the reference answer for "not found".
    const absent = await updateCoverLetter(
      'cl-missing',
      { title: 'PWNED', version: 99 } as never,
      CALLER
    ).catch((e) => e);

    expect(foreign.constructor).toBe(absent.constructor);
    expect(foreign.message).toBe(absent.message);
  });
});
