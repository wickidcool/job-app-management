/**
 * WIC-1433 — project files must be namespaced by owner in storage.
 *
 * Two independent fakes here are load-bearing, and both are chosen for the same
 * reason: **the defect is a key that omits the owner, so any test double that
 * ignores the key it is handed passes with the bug in place.**
 *
 *  1. `getDb` is **PGlite**, a real Postgres engine, not a hand-rolled stub.
 *     WIC-1373 shipped two tenancy assertions that passed *with* the bug
 *     because `stubDb`'s `where` spy resolves whatever rows it was primed with
 *     regardless of the predicate. Only a real planner can tell
 *     `WHERE slug = 'acme-corp'` (matches every tenant, and as an UPDATE
 *     carries no LIMIT) apart from `... AND user_id = $1`.
 *
 *  2. `storage.service` is a real key→value `Map` with real prefix listing, not
 *     `vi.fn()`s. Asserting "uploadObject was called with the namespaced key"
 *     would only restate the fix. A Map makes the *consequence* observable:
 *     when two users resolve to one key, the second write really does destroy
 *     the first user's bytes, and the assertion fails on the data.
 *
 * The DDL mirrors `db/schema.ts` after migration 0017 — `user_id NOT NULL` and
 * the global unique on `slug` replaced by the composite
 * `idx_projects_user_slug (user_id, slug)`. That composite is the precondition
 * for the whole defect: it is what lets two users legitimately hold
 * `acme-corp`, and every DB ownership guard in `project.service` is *satisfied*
 * for both of them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, and } from 'drizzle-orm';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: ReturnType<typeof drizzle>;
let client: PGlite;

vi.mock('../src/db/client.js', () => ({
  // Lazy: `db` is assigned in beforeAll, long after this factory is hoisted.
  getDb: () => db,
  closeDb: async () => {},
}));

/** The object store. Keyed by the *actual* storage key the service computes. */
const OBJECTS = new Map<string, string>();
/** Flipped per-describe to exercise the R2 backend and the local-FS backend. */
let storageAvailable = true;
let dataDir = './data';

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ dataDir }),
}));

vi.mock('../src/services/storage.service.js', () => ({
  isStorageAvailable: () => storageAvailable,
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

const {
  createProject,
  deleteProject,
  listProjectFiles,
  getProjectFile,
  updateProjectFile,
  createProjectFile,
  deleteProjectFile,
  generateProjectIndex,
  getOrCreateProjectBySlug,
  getProjectBySlug,
  listProjects,
} = await import('../src/services/project.service.js');
const { projects } = await import('../src/db/schema.js');
const { NotFoundError, ConflictError, AppError } = await import('../src/types/index.js');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

/** The shared slug. Both users legitimately own a project by this name. */
const SLUG = 'acme-corp';
const FILE = 'acme-corp-staff-engineer.md';

/** User A's STAR document — the artefact that must never leak. */
const A_SECRET =
  '# Staff Engineer at Acme Corp\n\n- **Situation:** 2021-03 to 2024-11, Acme Corp payments team.';
const B_CONTENT = '# Staff Engineer at Acme Corp\n\n- **Situation:** user B wrote this.';

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
-- Migration 0017: the global unique on slug is gone; ownership is (user_id, slug).
CREATE UNIQUE INDEX idx_projects_user_slug ON projects(user_id, slug);
`;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  await client.exec(SCHEMA_DDL);
});

beforeEach(async () => {
  OBJECTS.clear();
  storageAvailable = true;
  dataDir = './data';
  await client.exec('TRUNCATE projects CASCADE;');
});

/** A owns `acme-corp` with one STAR file; B owns a project of the same name. */
async function seedBothUsers() {
  await createProject({ name: 'Acme Corp', slug: SLUG }, USER_A);
  await createProjectFile(SLUG, FILE, A_SECRET, USER_A);
  await createProject({ name: 'Acme Corp', slug: SLUG }, USER_B);
}

function rowFor(userId: string, slug = SLUG) {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.slug, slug)))
    .limit(1)
    .then((r) => r[0]);
}

describe('WIC-1433 — object storage (R2) backend', () => {
  it('AC-0 — the composite index really does let both users hold the slug', async () => {
    await seedBothUsers();
    const rows = await db.select().from(projects).where(eq(projects.slug, SLUG));
    expect(
      rows.map((r) => r.userId).sort(),
      'if this fails the whole defect is unreachable and every case below is vacuous'
    ).toEqual([USER_A, USER_B].sort());
  });

  it('AC-1 — B listing their own project does not enumerate A’s files', async () => {
    await seedBothUsers();

    const bFiles = await listProjectFiles(SLUG, USER_B);
    expect(bFiles.map((f) => f.fileName)).toEqual([]);

    // Control: A still sees their own file, so an empty list above is scoping,
    // not a storage fake that lost the write.
    const aFiles = await listProjectFiles(SLUG, USER_A);
    expect(aFiles.map((f) => f.fileName)).toEqual([FILE]);
  });

  it('AC-2 — B cannot read A’s STAR document', async () => {
    await seedBothUsers();

    await expect(getProjectFile(SLUG, FILE, USER_B)).rejects.toBeInstanceOf(NotFoundError);
    // Control: the bytes are genuinely retrievable by their owner.
    await expect(getProjectFile(SLUG, FILE, USER_A)).resolves.toBe(A_SECRET);
  });

  it('AC-3 — B writing the same file name does not overwrite A’s document', async () => {
    await seedBothUsers();

    await updateProjectFile(SLUG, FILE, B_CONTENT, USER_B);

    expect(await getProjectFile(SLUG, FILE, USER_A)).toBe(A_SECRET);
    expect(await getProjectFile(SLUG, FILE, USER_B)).toBe(B_CONTENT);
    // Two distinct objects, not one.
    expect(OBJECTS.size).toBe(2);
  });

  it('AC-4 — B deleting the same file name does not delete A’s document', async () => {
    await seedBothUsers();
    await updateProjectFile(SLUG, FILE, B_CONTENT, USER_B);

    await deleteProjectFile(SLUG, FILE, USER_B);

    expect(await getProjectFile(SLUG, FILE, USER_A)).toBe(A_SECRET);
    await expect(getProjectFile(SLUG, FILE, USER_B)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('AC-5 — A’s file name is not reserved against B (no existence leak)', async () => {
    await seedBothUsers();

    // Previously this threw ConflictError, which both disclosed that A holds the
    // name and denied B the use of it.
    await expect(createProjectFile(SLUG, FILE, B_CONTENT, USER_B)).resolves.toBeUndefined();
    expect(await getProjectFile(SLUG, FILE, USER_B)).toBe(B_CONTENT);
    expect(await getProjectFile(SLUG, FILE, USER_A)).toBe(A_SECRET);

    // Control: the conflict still fires within one owner's namespace.
    await expect(createProjectFile(SLUG, FILE, 'again', USER_B)).rejects.toBeInstanceOf(
      ConflictError
    );
  });

  it('AC-6 — B’s file write does not re-stamp A’s updated_at', async () => {
    await seedBothUsers();
    // Age A's row so a stray bump is visible rather than racing the clock.
    await client.exec(
      `UPDATE projects SET updated_at = '2020-01-01T00:00:00Z' WHERE user_id = '${USER_A}';`
    );
    const before = await rowFor(USER_A);

    await updateProjectFile(SLUG, FILE, B_CONTENT, USER_B);
    await createProjectFile(SLUG, 'another.md', B_CONTENT, USER_B);
    await deleteProjectFile(SLUG, 'another.md', USER_B);

    const after = await rowFor(USER_A);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    // Control: B's own row *was* bumped, so the UPDATE is running at all.
    const bRow = await rowFor(USER_B);
    expect(bRow.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it('AC-7 — the generated index never names another user’s files', async () => {
    await seedBothUsers();

    const result = await generateProjectIndex(USER_B);

    expect(result.path).toBe(`projects/${USER_B}/index.md`);
    const bIndex = OBJECTS.get(result.path)!;
    expect(bIndex).not.toContain(FILE);
    expect(bIndex).toContain('- **Files:** 0');
  });

  it('AC-8 — one user’s index does not clobber another’s', async () => {
    await seedBothUsers();

    const aResult = await generateProjectIndex(USER_A);
    const aIndex = OBJECTS.get(aResult.path)!;
    expect(aIndex).toContain(FILE);

    await generateProjectIndex(USER_B);

    expect(aResult.path).not.toBe(`projects/${USER_B}/index.md`);
    expect(OBJECTS.get(aResult.path), "A's index survives B regenerating theirs").toBe(aIndex);
  });

  it('AC-9 — getOrCreateProjectBySlug returns B’s own row, never A’s', async () => {
    const a = await createProject({ name: 'Acme Corp', slug: SLUG }, USER_A);

    const b = await getOrCreateProjectBySlug(SLUG, 'Acme Corp', USER_B);

    expect(b.id).not.toBe(a.id);
    const bRow = await rowFor(USER_B);
    expect(bRow, 'B must get a row of their own, not a handle on A’s').toBeDefined();
    expect(b.id).toBe(bRow.id);
  });

  it('AC-10 — B deleting their project leaves A’s objects intact', async () => {
    await seedBothUsers();
    await createProjectFile(SLUG, FILE, B_CONTENT, USER_B);
    const bRow = await rowFor(USER_B);

    await deleteProject(bRow.id, USER_B);

    expect(await getProjectFile(SLUG, FILE, USER_A)).toBe(A_SECRET);
    expect([...OBJECTS.keys()]).toEqual([`projects/${USER_A}/${SLUG}/${FILE}`]);
  });

  it('AC-11 — fileCount is per-owner, not per-slug', async () => {
    await seedBothUsers();

    const [bProject] = await listProjects(USER_B);
    expect(bProject.fileCount, "B's brand-new project has no files").toBe(0);

    const [aProject] = await listProjects(USER_A);
    expect(aProject.fileCount).toBe(1);
  });
});

describe('WIC-1433 — local filesystem backend', () => {
  let tmp: string;

  beforeEach(async () => {
    storageAvailable = false;
    tmp = await fs.mkdtemp(join(tmpdir(), 'wic1433-'));
    dataDir = tmp;
  });

  afterAll(async () => {
    storageAvailable = true;
  });

  it('AC-12 — files land under the owner’s directory, not a shared one', async () => {
    await seedBothUsers();
    await createProjectFile(SLUG, FILE, B_CONTENT, USER_B);

    expect(await fs.readFile(join(tmp, 'projects', USER_A, SLUG, FILE), 'utf-8')).toBe(A_SECRET);
    expect(await fs.readFile(join(tmp, 'projects', USER_B, SLUG, FILE), 'utf-8')).toBe(B_CONTENT);
    // Nothing at the old shared path.
    await expect(fs.stat(join(tmp, 'projects', SLUG))).rejects.toThrow();
  });

  it('AC-13 — the getProjectBySlug fallback is not an existence oracle', async () => {
    // A has a project on disk with no DB row of B's to match. Before the fix the
    // scoped DB lookup missed, the fallback stat'd `data/projects/{slug}`, found
    // A's directory and returned its fileCount and timestamps to B.
    await createProject({ name: 'Acme Corp', slug: SLUG }, USER_A);
    await createProjectFile(SLUG, FILE, A_SECRET, USER_A);

    await expect(getProjectBySlug(SLUG, USER_B)).rejects.toBeInstanceOf(NotFoundError);
    // Control: A still resolves through the same code path.
    await expect(getProjectBySlug(SLUG, USER_A)).resolves.toMatchObject({ fileCount: 1 });
  });

  it('AC-14 — filesystem discovery in listProjects stays within the owner tree', async () => {
    // An orphan directory of A's, with no DB row (the case the discovery branch
    // exists for). B must not see it.
    await fs.mkdir(join(tmp, 'projects', USER_A, 'orphan-co'), { recursive: true });
    await fs.writeFile(join(tmp, 'projects', USER_A, 'orphan-co', 'x.md'), A_SECRET, 'utf-8');

    expect(await listProjects(USER_B)).toEqual([]);
    expect((await listProjects(USER_A)).map((p) => p.slug)).toEqual(['orphan-co']);
  });

  it('AC-15 — a directory at the legacy shared path is invisible to everyone', async () => {
    // `data/projects/{slug}` is where every project's files lived before this
    // change. Nothing may read it any more: it is un-owned by construction, so
    // serving it to a caller is serving them someone else's data. This is also
    // the guard against "fix it with a legacy read-fallback", which would
    // reinstate the leak verbatim.
    await fs.mkdir(join(tmp, 'projects', 'legacy-co'), { recursive: true });
    await fs.writeFile(join(tmp, 'projects', 'legacy-co', 'x.md'), A_SECRET, 'utf-8');

    for (const user of [USER_A, USER_B]) {
      expect((await listProjects(user)).map((p) => p.slug)).toEqual([]);
      await expect(getProjectBySlug('legacy-co', user)).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});

/**
 * WIC-1901 — AC-T0: the *absent* owner.
 *
 * Every case above hands the service a real `userId`, so all of them pass with
 * `projectScope`'s fail-open `else` branch (`eq(projects.slug, slug)`) still in
 * place: that branch is only reachable when the owner is `undefined`. AC-T0
 * (ADR-010) is the missing half — an **authenticated request whose owner did
 * not resolve** must match **zero** rows, never "whichever tenant's row the
 * planner reaches first".
 *
 * This is not a hypothetical input. `middleware/auth.ts` sets `userId` to
 * `null` on two live paths: the local auth-bypass dev mode (`:29`, no Supabase
 * config) *and* a fully verified JWT carrying no `sub` claim (`:62`, `:69` —
 * `(payload.sub as string) ?? null`), which is production-reachable. The routes
 * then pass `c.get('userId') ?? undefined` straight through.
 *
 * The fail-closed posture is expressed by **deleting** the absent-owner branch,
 * not by re-predicating it to `isNull(projects.userId)`: migration 0017
 * backfilled every NULL `user_id` with a placeholder UUID and set the column
 * `NOT NULL`, so an `isNull` predicate is dead code that only *looks* like a
 * tenancy guard. The DDL above mirrors that (`user_id UUID NOT NULL`).
 */
describe('WIC-1901 — AC-T0: an owner-less caller reaches no tenant’s row', () => {
  /** Both tenants' rows, aged so a stray re-stamp is visible without racing the clock. */
  const AGED = '2020-01-01T00:00:00Z';

  async function seedAndAge() {
    await seedBothUsers();
    await client.exec(`UPDATE projects SET updated_at = '${AGED}';`);
  }

  it('AC-T0-1 — an owner-less file write re-stamps zero rows', async () => {
    await seedAndAge();

    // All three `touchProject` call sites, driven with no owner.
    await updateProjectFile(SLUG, FILE, B_CONTENT, undefined);
    await createProjectFile(SLUG, 'another.md', B_CONTENT, undefined);
    await deleteProjectFile(SLUG, 'another.md', undefined);

    const rows = await db.select().from(projects).where(eq(projects.slug, SLUG));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(
        row.updatedAt.toISOString(),
        `tenant ${row.userId} was re-stamped by a caller who owns no project`
      ).toBe(new Date(AGED).toISOString());
    }

    // Control: the same call *with* an owner does re-stamp, so the assertion
    // above is scoping and not a re-stamp that silently stopped happening.
    await updateProjectFile(SLUG, FILE, B_CONTENT, USER_B);
    expect((await rowFor(USER_B)).updatedAt.getTime()).toBeGreaterThan(new Date(AGED).getTime());
    expect((await rowFor(USER_A)).updatedAt.toISOString()).toBe(new Date(AGED).toISOString());
  });

  it('AC-T0-2 — getProjectBySlug does not hand an owner-less caller a tenant’s row', async () => {
    await seedBothUsers();

    await expect(getProjectBySlug(SLUG, undefined)).rejects.toBeInstanceOf(NotFoundError);
    // Control: the row is genuinely retrievable by its owner through this path.
    await expect(getProjectBySlug(SLUG, USER_A)).resolves.toMatchObject({ fileCount: 1 });
  });

  it('AC-T0-3 — getOrCreateProjectBySlug binds an owner-less caller to nobody', async () => {
    await seedBothUsers();
    const aRow = await rowFor(USER_A);

    // Unscoped this returned A's row, and every downstream write — resume upload
    // (`resume.service.ts`), dialogue capture (`dialogue.service.ts`) — then
    // landed in a project the caller does not own.
    await expect(getOrCreateProjectBySlug(SLUG, 'Acme Corp', undefined)).rejects.toMatchObject({
      statusCode: 400,
    });

    // ...and it did not create a row of its own either, so the failure is a
    // rejection and not a silent third tenant.
    const rows = await db.select().from(projects).where(eq(projects.slug, SLUG));
    expect(rows.map((r) => r.id).sort()).toEqual([aRow.id, (await rowFor(USER_B)).id].sort());
  });

  it('AC-T0-4 — createProject rejects before the existence check, not after it', async () => {
    await seedBothUsers();

    // The discriminating assertion. The owner-less caller always ended in a
    // rejection, so "it throws" proves nothing — *which* error it throws is the
    // finding. Pre-fix the slug-only SELECT ran first and produced
    // `409 Project with this slug already exists`, disclosing that some other
    // tenant holds `acme-corp`. It must now be the 400, which discloses nothing.
    await expect(createProject({ name: 'Acme Corp', slug: SLUG }, undefined)).rejects.toMatchObject(
      { statusCode: 400 }
    );
    await expect(
      createProject({ name: 'Acme Corp', slug: SLUG }, undefined)
    ).rejects.not.toBeInstanceOf(ConflictError);

    // Control: a slug no tenant holds takes the same 400 — i.e. the answer does
    // not vary with another tenant's data, which is what makes it not an oracle.
    await expect(
      createProject({ name: 'Nobody Holds This', slug: 'nobody-holds-this' }, undefined)
    ).rejects.toMatchObject({ statusCode: 400 });

    // Control: within one owner the conflict still fires.
    await expect(createProject({ name: 'Acme Corp', slug: SLUG }, USER_A)).rejects.toBeInstanceOf(
      ConflictError
    );
    expect(AppError.name).toBe('AppError');
  });
});

describe('WIC-1901 — AC-T0: single-user local dev is unchanged', () => {
  let tmp: string;

  beforeEach(async () => {
    storageAvailable = false;
    tmp = await fs.mkdtemp(join(tmpdir(), 'wic1901-'));
    dataDir = tmp;
  });

  afterAll(async () => {
    storageAvailable = true;
  });

  it('AC-T0-5 — the auth-bypass caller still owns its own `anon` tree', async () => {
    // The local auth-bypass dev mode has no `userId` at all, so it can never
    // hold a `projects` row: `createProject` has always rejected an owner-less
    // caller with a 400 (`user_id` is `NOT NULL`), on `main` as much as here.
    // Its projects are therefore *directories only* — the same un-rowed shape
    // AC-14 exercises — living under `projects/anon/…` and reached through the
    // filesystem fallback, which is owner-namespaced and untouched by this
    // change. Fail-closing the DB reads removes cross-tenant reach, not dev
    // behaviour, because there was never a dev row for the DB read to find.
    await fs.mkdir(join(tmp, 'projects', 'anon', SLUG), { recursive: true });
    await createProjectFile(SLUG, FILE, B_CONTENT, undefined);
    expect(await fs.readFile(join(tmp, 'projects', 'anon', SLUG, FILE), 'utf-8')).toBe(B_CONTENT);
    expect(await getProjectFile(SLUG, FILE, undefined)).toBe(B_CONTENT);
    await expect(getProjectBySlug(SLUG, undefined)).resolves.toMatchObject({
      slug: SLUG,
      fileCount: 1,
    });

    // And a real tenant's row is still invisible to it: A's DB row exists and
    // holds a different document, and neither the row nor the bytes leak.
    await createProject({ name: 'Acme Corp', slug: SLUG }, USER_A);
    await createProjectFile(SLUG, 'a-only.md', A_SECRET, USER_A);
    const devView = await getProjectBySlug(SLUG, undefined);
    expect(devView.id, 'the DB row must not be served to the owner-less caller').toBe(SLUG);
    expect((await listProjectFiles(SLUG, undefined)).map((f) => f.fileName)).toEqual([FILE]);
  });
});
