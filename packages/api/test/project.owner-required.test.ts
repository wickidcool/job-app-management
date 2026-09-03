/**
 * WIC-1434 — `getOrCreateProjectBySlug` requires an owner.
 *
 * WIC-1433 scoped the SELECT, but through `projectScope(slug, userId)`, which
 * degrades to a slug-only predicate on a falsy `userId`. The scoping was
 * therefore only as good as the identity the entry point carried, and two of
 * the three entry points (`uploadResume`, `captureProjectFile`) take
 * `userId?: string`. This file pins the case that fallback left open.
 *
 * The premise being tested — and the reason "require it" is a total fix rather
 * than a trade — is that **no owner-less call can ever be correct here**:
 * `createProject` is the only `insert(projects)` in the codebase and it rejects
 * a missing `userId`, so every row has a real owner. AC-R0 asserts that premise
 * directly, so if it ever stops holding these cases fail loudly instead of
 * quietly testing nothing.
 *
 * Harness is PGlite (a real Postgres planner) plus a real key->value object
 * store, for the reason spelled out at the top of `project.tenancy.test.ts`: a
 * double that ignores the predicate it is handed passes with the bug in place.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, and } from 'drizzle-orm';

let db: ReturnType<typeof drizzle>;
let client: PGlite;

/**
 * Counted, not just stubbed. The revert matrix showed AC-R1/R2/R3/R5 all still
 * passing with the lookup guard removed: an owner-less call renders
 * `user_id = $n` with the param bound to `null` (verified against `PgDialect`),
 * `user_id` is NOT NULL, so the predicate matches zero rows and the call falls
 * through to `createProject`, which throws its own 400. Same status, same
 * shape — so every assertion about "it was rejected" was really grading
 * `createProject`'s guard. AC-R8 grades *this* function's guard by the one
 * thing only it can do: refuse before opening a connection.
 */
const getDbSpy = vi.fn(() => db);

vi.mock('../src/db/client.js', () => ({
  getDb: () => getDbSpy(),
  closeDb: async () => {},
}));

const OBJECTS = new Map<string, string>();

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ dataDir: './data' }),
}));

vi.mock('../src/services/storage.service.js', () => ({
  isStorageAvailable: () => true,
  uploadObject: async (key: string, body: Buffer | string) => {
    OBJECTS.set(key, typeof body === 'string' ? body : body.toString('utf-8'));
  },
  getObject: async (key: string) => {
    const v = OBJECTS.get(key);
    return v === undefined ? null : Buffer.from(v, 'utf-8');
  },
  deleteObject: async (key: string) => {
    OBJECTS.delete(key);
  },
  deleteObjects: async (keys: string[]) => {
    for (const k of keys) OBJECTS.delete(k);
  },
  listObjectKeys: async (prefix: string) =>
    [...OBJECTS.keys()].filter((k) => k.startsWith(prefix)).sort(),
}));

const { createProject, createProjectFile, getOrCreateProjectBySlug } =
  await import('../src/services/project.service.js');
// The real dialogue service, over the real project service, over PGlite — the
// 404-on-a-project-that-exists case is an interaction between the two, so
// mocking either end would remove the thing under test.
const { captureProjectFile } = await import('../src/services/dialogue.service.js');
const { projects } = await import('../src/db/schema.js');
const { AppError } = await import('../src/types/index.js');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const SLUG = 'acme-corp';
const FILE = 'acme-corp-staff-engineer.md';
const A_SECRET = '# Staff Engineer at Acme Corp\n\n- **Situation:** A wrote this.';

/**
 * No `userId`. Cast rather than `any`: the signature now requires the argument,
 * so the compiler is the first line of defence and these tests are the second —
 * they cover the JS callers and the authenticated-but-`sub`-less JWT, where the
 * value is absent at runtime however the type reads.
 */
const NO_OWNER = undefined as unknown as string;

const SCHEMA_DDL = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);
-- Migration 0017: ownership is (user_id, slug), so two users may hold 'acme-corp'.
CREATE UNIQUE INDEX idx_projects_user_slug ON projects(user_id, slug);
`;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  await client.exec(SCHEMA_DDL);
});

beforeEach(async () => {
  OBJECTS.clear();
  await client.exec('TRUNCATE projects CASCADE;');
});

/** A holds `acme-corp` and has filed one STAR document under it. */
async function seedUserA() {
  await createProject({ name: 'Acme Corp', slug: SLUG }, USER_A);
  await createProjectFile(SLUG, FILE, A_SECRET, USER_A);
}

function rowsForSlug(slug = SLUG) {
  return db.select().from(projects).where(eq(projects.slug, slug));
}

function rowFor(userId: string, slug = SLUG) {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.slug, slug)))
    .limit(1)
    .then((r) => r[0]);
}

const CAPTURE = {
  company: 'Acme Corp',
  role: 'Staff Engineer',
  period: '2021-2024',
  industry: 'Payments',
  technologies: ['TypeScript'],
  jobFit: ['backend'],
  accomplishments: [
    {
      title: 'Shipped the ledger',
      situation: 'S',
      task: 'T',
      action: 'A',
      result: 'R',
      technologies: ['TypeScript'],
    },
  ],
};

describe('WIC-1434 — getOrCreateProjectBySlug requires an owner', () => {
  it('AC-R0 — every project row has a real owner, so no owner-less call can be correct', async () => {
    // The premise the whole card rests on. `createProject` is the only
    // `insert(projects)` in `src/`, and it rejects a missing userId — so the
    // reuse branch of an owner-less call can only ever return a row belonging
    // to a real, different user. Nothing here is a judgement call about what
    // "should" happen; there is no correct outcome to preserve.
    await expect(createProject({ name: 'Acme Corp', slug: SLUG }, undefined)).rejects.toThrow(
      /userId is required/i
    );
    expect(await rowsForSlug(), 'no row was created without an owner').toEqual([]);

    await seedUserA();
    const rows = await rowsForSlug();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(USER_A);
  });

  it('AC-R1 — an owner-less lookup is rejected, not answered with A’s row', async () => {
    await seedUserA();

    await expect(getOrCreateProjectBySlug(SLUG, 'Acme Corp', NO_OWNER)).rejects.toBeInstanceOf(
      AppError
    );
    await expect(getOrCreateProjectBySlug(SLUG, 'Acme Corp', NO_OWNER)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
    });
    // Which guard fired matters: `createProject`'s 400 is also BAD_REQUEST/400,
    // so without this the assertions above hold with the lookup guard deleted.
    await expect(getOrCreateProjectBySlug(SLUG, 'Acme Corp', NO_OWNER)).rejects.toThrow(
      /required to resolve a project by slug/i
    );
  });

  it('AC-R8 — the owner-less lookup refuses before it opens a connection', async () => {
    await seedUserA();
    getDbSpy.mockClear();

    await expect(getOrCreateProjectBySlug(SLUG, 'Acme Corp', NO_OWNER)).rejects.toBeInstanceOf(
      AppError
    );

    // The guard sits above `const db = getDb()`. Remove it and the call still
    // ends in a 400 — but only after binding an undefined owner into a real
    // query. No query should be issued on behalf of a caller with no identity.
    expect(getDbSpy, 'no database work was done for an unidentified caller').not.toHaveBeenCalled();

    // Control: a real owner does reach the database.
    await getOrCreateProjectBySlug(SLUG, 'Acme Corp', USER_B);
    expect(getDbSpy).toHaveBeenCalled();
  });

  it('AC-R2 — the rejected call discloses nothing about A’s project', async () => {
    await seedUserA();
    const a = await rowFor(USER_A);

    // Pre-fix this resolved, handing back A's project id, name and file count.
    // Asserting on the *contents* of the failure, not just that it failed:
    // an error that carried A's id would still be a disclosure.
    const err = await getOrCreateProjectBySlug(SLUG, 'Acme Corp', NO_OWNER).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain(a.id);
  });

  it('AC-R3 — an owner-less call leaves A’s row and A’s files untouched', async () => {
    await seedUserA();
    const before = await rowFor(USER_A);

    await getOrCreateProjectBySlug(SLUG, 'Acme Corp', NO_OWNER).catch(() => undefined);

    const after = await rowFor(USER_A);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.version).toBe(before.version);
    expect(await rowsForSlug(), 'no phantom row was created either').toHaveLength(1);
    expect([...OBJECTS.keys()]).toEqual([`projects/${USER_A}/${SLUG}/${FILE}`]);
  });

  it('AC-R4 — a real owner still resolves and still creates: the guard is not a blanket deny', async () => {
    await seedUserA();

    // Control. If this regressed, every assertion above would pass vacuously
    // for the wrong reason — a function that always throws satisfies them all.
    const b = await getOrCreateProjectBySlug(SLUG, 'Acme Corp', USER_B);

    const bRow = await rowFor(USER_B);
    expect(bRow, 'B gets a row of their own').toBeDefined();
    expect(b.id).toBe(bRow.id);
    expect(b.id).not.toBe((await rowFor(USER_A)).id);
    // B's project is empty; A's file count must not bleed across.
    expect(b.fileCount).toBe(0);

    // Reuse branch: a second call returns the same row rather than conflicting.
    const again = await getOrCreateProjectBySlug(SLUG, 'Acme Corp', USER_B);
    expect(again.id).toBe(b.id);
    expect(await rowsForSlug()).toHaveLength(2);
  });

  it('AC-R7 — an owner-less create is 400, not a 409 disclosing that the slug is taken', async () => {
    await seedUserA();

    // Found by the revert matrix for AC-R1: with the lookup guard removed, the
    // call fell through to `createProject`, whose existence check ran *before*
    // its own owner check and matched A's row on a slug-only predicate. The
    // caller — who was going to be rejected either way — learned that somebody
    // holds `acme-corp`. Order the two checks so the rejection comes first.
    const err = await createProject({ name: 'Acme Corp', slug: SLUG }, undefined).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.statusCode).toBe(400);

    // Control: the conflict still fires for a real owner who already holds it.
    const conflict = await createProject({ name: 'Acme Corp', slug: SLUG }, USER_A).catch((e) => e);
    expect(conflict.statusCode).toBe(409);
  });
});

describe('WIC-1434 — captureProjectFile', () => {
  it('AC-R5 — an owner-less capture fails as BAD_REQUEST, not as a 404 on A’s project', async () => {
    await seedUserA();

    // Pre-fix this was the confusing case: the slug resolved to A's project, so
    // the service told itself the project existed, and then `createProjectFile`
    // rejected the write on its own ownership guard. The caller got
    // NotFoundError — a 404 for a project the system had just resolved.
    const err = await captureProjectFile(SLUG, CAPTURE, undefined, undefined).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.statusCode).toBe(400);
    // Grade capture's own guard, not the one it delegates to: both answer
    // BAD_REQUEST/400, so a code-and-status assertion alone passes with this
    // guard deleted. Capture is the layer that knows the caller is capturing.
    expect(err.message).toMatch(/required to capture a project file/i);

    expect([...OBJECTS.keys()], "nothing was written into A's namespace").toEqual([
      `projects/${USER_A}/${SLUG}/${FILE}`,
    ]);
  });

  it('AC-R6 — B capturing the same company gets their own project, not A’s', async () => {
    await seedUserA();

    const result = await captureProjectFile(SLUG, CAPTURE, undefined, USER_B);

    const bRow = await rowFor(USER_B);
    expect(bRow, 'the capture created B’s project rather than reusing A’s').toBeDefined();
    expect(OBJECTS.get(`projects/${USER_B}/${SLUG}/${result.fileName}`)).toContain('Acme Corp');
    expect(OBJECTS.get(`projects/${USER_A}/${SLUG}/${FILE}`), 'A’s document is untouched').toBe(
      A_SECRET
    );
  });
});
