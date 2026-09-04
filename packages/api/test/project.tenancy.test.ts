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

vi.mock('../src/services/storage.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/storage.service.js')>()),
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
  getProject,
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
 * WIC-1976 — AC-T0: the *absent* owner.
 *
 * Every case above hands the service a real `userId`, so none of them can tell
 * a correctly scoped predicate apart from one that simply never runs. AC-T0 is
 * the other half: an authenticated request whose owner did **not** resolve must
 * reach **zero** rows, never "whichever tenant the planner happens to hit
 * first".
 *
 * This is not a hypothetical input. `middleware/auth.ts` sets `userId` to
 * `null` on two live paths — the local auth-bypass dev mode (no Supabase
 * config, ADR-003) *and* a fully verified JWT carrying no `sub` claim
 * (`(payload.sub as string) ?? null`), which is production-reachable. The
 * routes then pass `c.get('userId') ?? undefined` straight through.
 *
 * **The 400 is the specification, not an accident.** ADR-010 (WIC-1962) refused
 * the alternative design in which these calls succeed under dev mode: making
 * project routes work without an owner means resolving an absent owner to
 * *something*, and every such something is a real tenant's data or a shared
 * pseudo-tenant that later collides with one. Do not "fix" a 400 here by
 * relaxing `requireOwner` — that is the exact recurrence ADR-010 exists to
 * stop. (ADR-010 D3, resolving a real `LOCAL_DEV_USER_ID` in local dev, is a
 * separate open question and is deliberately not exercised here.)
 *
 * Numbering is inherited from PR #316's AC-T0 block, which is where AC-T0-3 and
 * AC-T0-4 were written; #316's AC-T0-1, AC-T0-2 and AC-T0-5 asserted the
 * refused design and are deliberately absent, so the gap is intentional rather
 * than a porting slip. AC-T0-6 and AC-T0-7 are new here — they are the two
 * owner-less paths no branch has ever asserted.
 *
 * `NotFoundError` and `ConflictError` both extend `AppError`, so
 * `toBeInstanceOf(AppError)` is satisfied by a 404 and a 409 alike. Every case
 * below therefore pins `statusCode` and `message`: *which* rejection fires is
 * the whole finding, and the bare "it throws" assertion is vacuous.
 */
describe('WIC-1976 — AC-T0: an owner-less caller reaches no tenant’s row', () => {
  it('AC-T0-3 — getOrCreateProjectBySlug binds an owner-less caller to nobody', async () => {
    await seedBothUsers();
    const aRow = await rowFor(USER_A);
    const bRow = await rowFor(USER_B);

    // Unscoped this returned A's row, and every downstream write — resume
    // upload (`resume.service.ts`), dialogue capture (`dialogue.service.ts`) —
    // then landed in a project the caller does not own.
    //
    // The cast is the point being tested, not a way around the type: this
    // function alone declares `userId: string` (required), and the guard under
    // test exists precisely because the runtime value is `null` anyway on the
    // no-`sub`-claim path, "however the signature reads" (its own comment).
    // Asserting only what the signature permits would skip the guard entirely.
    const noOwner = undefined as unknown as string;
    await expect(getOrCreateProjectBySlug(SLUG, 'Acme Corp', noOwner)).rejects.toMatchObject({
      statusCode: 400,
      message: 'userId is required to resolve a project by slug',
    });

    // ...and it did not create a row of its own either, so the failure is a
    // rejection and not a silent third tenant.
    const rows = await db.select().from(projects).where(eq(projects.slug, SLUG));
    expect(rows.map((r) => r.id).sort()).toEqual([aRow.id, bRow.id].sort());
  });

  it('AC-T0-4 — createProject rejects before the existence check, not after it', async () => {
    await seedBothUsers();

    // The discriminating assertion. The owner-less caller always ended in a
    // rejection, so "it throws" proves nothing — *which* error it throws is the
    // finding. With the checks in the other order the slug-only SELECT runs
    // first and produces `409 Project with this slug already exists`, which
    // discloses that some other tenant holds `acme-corp` and turns the endpoint
    // into an existence oracle over other tenants' project names. It must be
    // the 400, which discloses nothing.
    await expect(createProject({ name: 'Acme Corp', slug: SLUG }, undefined)).rejects.toMatchObject(
      { statusCode: 400, message: 'userId is required to create a project' }
    );
    await expect(
      createProject({ name: 'Acme Corp', slug: SLUG }, undefined)
    ).rejects.not.toBeInstanceOf(ConflictError);

    // Control: a slug no tenant holds takes the same 400 — i.e. the answer does
    // not vary with another tenant's data, which is what makes it not an oracle.
    await expect(
      createProject({ name: 'Nobody Holds This', slug: 'nobody-holds-this' }, undefined)
    ).rejects.toMatchObject({ statusCode: 400 });

    // Control: within one owner the conflict still fires, so the 400 above is
    // the owner guard and not the conflict check having stopped working.
    await expect(createProject({ name: 'Acme Corp', slug: SLUG }, USER_A)).rejects.toBeInstanceOf(
      ConflictError
    );
  });

  it('AC-T0-6 — listProjects refuses an owner-less caller instead of returning every tenant', async () => {
    await seedBothUsers();

    // The widest of the degradations this file guards. A falsy `userId` handed
    // Drizzle `undefined`, which is not a permissive predicate so much as *no*
    // predicate: the SELECT returned every tenant's projects, unfiltered.
    await expect(listProjects(undefined)).rejects.toMatchObject({
      statusCode: 400,
      message: 'userId is required to list projects',
    });
    await expect(listProjects(undefined)).rejects.not.toBeInstanceOf(NotFoundError);

    // Control: both tenants' rows are genuinely present and reachable by their
    // own owners, so the rejection above is scoping and not an empty table.
    expect((await listProjects(USER_A)).map((p) => p.slug)).toEqual([SLUG]);
    expect((await listProjects(USER_B)).map((p) => p.slug)).toEqual([SLUG]);
  });

  it('AC-T0-7 — getProject refuses an owner-less caller holding a real project id', async () => {
    await seedBothUsers();
    const aRow = await rowFor(USER_A);

    // The id is real and it is A's. An id-only predicate would return the row:
    // a project id is unguessable, but it is routinely in scope for a caller
    // who has seen it once — a shared link, a log line, a prior tenancy.
    await expect(getProject(aRow.id, undefined)).rejects.toMatchObject({
      statusCode: 400,
      message: 'userId is required to load a project',
    });

    // Control: the same id resolves for its owner...
    await expect(getProject(aRow.id, USER_A)).resolves.toMatchObject({
      id: aRow.id,
      slug: SLUG,
    });
    // ...and for a *different real* tenant it is a 404, not the 400. That is
    // what makes the assertion above about the absent owner specifically,
    // rather than about the id failing to match anything.
    await expect(getProject(aRow.id, USER_B)).rejects.toBeInstanceOf(NotFoundError);
  });
});
