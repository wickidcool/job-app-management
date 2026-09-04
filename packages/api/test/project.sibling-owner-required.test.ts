/**
 * WIC-1554 — the WIC-1434 defect class at the sibling functions PR #163 left.
 *
 * #163 required an owner in `getOrCreateProjectBySlug` and documented the
 * remaining fallback as "the deliberate local auth-bypass dev mode". Measured,
 * it was broader: `middleware/auth.ts` admitted a validly signed, unexpired JWT
 * that carried no `sub` claim with `userId: null`, every route launders that to
 * `undefined`, and `/api/projects/*` is not in `PUBLIC_PATHS` — so the
 * owner-less predicate was reachable on the *authenticated* path of a fully
 * configured deployment. `auth.test.ts` pins the boundary half of the fix; this
 * file pins the service half, which stands on its own if the boundary ever
 * regresses.
 *
 * Five predicates degraded, in three shapes, all keyed on `projects.user_id`:
 *
 *   | function             | degraded to                  | consequence          |
 *   |----------------------|------------------------------|----------------------|
 *   | `getProjectBySlug`   | `slug = $1`                  | read disclosure      |
 *   | `assertProjectOwned` | early `return` (no-op)       | backstopped nothing  |
 *   | `touchProject`       | `slug = $1`, UPDATE no LIMIT | cross-tenant write   |
 *   | `getProject`         | `id = $1`                    | read disclosure      |
 *   | `deleteProject`      | `id = $1`, reused for DELETE | **destruction**      |
 *   | `listProjects`       | `undefined` — *no* predicate | every tenant's rows  |
 *
 * The premise that makes "require it" a total fix rather than a trade is
 * AC-R0's, re-asserted here as AC-S0: `createProject` is the only
 * `insert(projects)` in `src/` and it rejects a missing `userId`, and
 * `projects.user_id` is `NOT NULL` (migration 0017). Every row has a real
 * owner, so an owner-less predicate cannot match "the anonymous user's row" —
 * only somebody else's. There is no correct owner-less outcome to preserve.
 *
 * Harness is PGlite (a real Postgres planner) plus a real key->value object
 * store, for the reason spelled out at the top of `project.tenancy.test.ts`: a
 * double that ignores the predicate it is handed passes with the bug in place.
 * Two users hold the same slug throughout, because a single-user fixture makes
 * a scoped and an unscoped predicate return the same row — the fixture has to
 * make the two branches disagree or the assertion cannot see the defect.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, and } from 'drizzle-orm';

let db: ReturnType<typeof drizzle>;
let client: PGlite;

/** Counted, so a guard can be graded on refusing *before* it opens a connection. */
const getDbSpy = vi.fn(() => db);

vi.mock('../src/db/client.js', () => ({
  getDb: () => getDbSpy(),
  closeDb: async () => {},
}));

const OBJECTS = new Map<string, string>();

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ dataDir: './data' }),
}));

vi.mock('../src/services/storage.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/storage.service.js')>()),
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

const {
  createProject,
  createProjectFile,
  updateProjectFile,
  deleteProjectFile,
  listProjectFiles,
  getProject,
  getProjectBySlug,
  deleteProject,
  listProjects,
  generateProjectIndex,
} = await import('../src/services/project.service.js');
const { projects } = await import('../src/db/schema.js');
const { AppError, NotFoundError } = await import('../src/types/index.js');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const SLUG = 'acme-corp';
const FILE = 'acme-corp-staff-engineer.md';
const A_SECRET = "# Staff Engineer at Acme Corp\n\n- **Situation:** A's private notes.";
const B_SECRET = "# Principal at Acme Corp\n\n- **Situation:** B's private notes.";

/**
 * No `userId`. The parameters are still `userId?: string` — these are service
 * functions reachable from JS callers and, before the boundary fix, from a
 * `sub`-less JWT where the value is absent at runtime however the type reads.
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
  getDbSpy.mockClear();
  await client.exec('TRUNCATE projects CASCADE;');
});

/** A and B both hold `acme-corp`, each with one private document under it. */
async function seedBoth() {
  await createProject({ name: 'Acme Corp', slug: SLUG, description: "A's private notes" }, USER_A);
  await createProjectFile(SLUG, FILE, A_SECRET, USER_A);
  await createProject({ name: 'Acme Corp', slug: SLUG, description: "B's private notes" }, USER_B);
  await createProjectFile(SLUG, FILE, B_SECRET, USER_B);
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

function objectKeys() {
  return [...OBJECTS.keys()].sort();
}

/** Every seeded object, for the "nothing was destroyed" assertions. */
const ALL_OBJECTS = [
  `projects/${USER_A}/${SLUG}/${FILE}`,
  `projects/${USER_B}/${SLUG}/${FILE}`,
].sort();

describe('WIC-1554 — AC-S0: the premise', () => {
  it('AC-S0 — every project row has a real owner, so no owner-less call can be correct', async () => {
    await expect(createProject({ name: 'Acme Corp', slug: SLUG }, NO_OWNER)).rejects.toThrow(
      /userId is required/i
    );
    expect(await rowsForSlug(), 'no row was created without an owner').toEqual([]);

    await seedBoth();
    const rows = await rowsForSlug();
    // Two rows, same slug, different owners — this is the fixture that makes a
    // scoped and an unscoped predicate disagree. Without it every case below
    // would pass against the unfixed code.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([USER_A, USER_B].sort());
  });
});

describe('WIC-1554 — getProjectBySlug (read disclosure)', () => {
  it('AC-S1 — an owner-less lookup is rejected, not answered with a stranger’s row', async () => {
    await seedBoth();

    // The card's measured repro: pre-fix this resolved and returned
    // {"name":"Acme Corp","description":"A's private notes","fileCount":1}.
    await expect(getProjectBySlug(SLUG, NO_OWNER)).rejects.toBeInstanceOf(AppError);
    await expect(getProjectBySlug(SLUG, NO_OWNER)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
    });
    // Which guard fired matters: several guards in this module answer
    // BAD_REQUEST/400, so a code-and-status assertion alone is satisfied by the
    // wrong one. This is `projectScope`'s message, reached from this function.
    await expect(getProjectBySlug(SLUG, NO_OWNER)).rejects.toThrow(
      /required to resolve a project by slug/i
    );
  });

  it('AC-S2 — the rejection discloses nothing about either user’s project', async () => {
    await seedBoth();
    const a = await rowFor(USER_A);
    const b = await rowFor(USER_B);

    // Deliberately NOT `.catch((e) => e)`. The mutation matrix caught this
    // cell failing open: with the guard reverted the call *resolves*, so `err`
    // was the leaked ProjectMeta, `err.message` was `undefined`, and the
    // no-secret scan passed — the disclosure assertion passed exactly when the
    // disclosure happened. Settle the promise explicitly and grade the
    // rejection itself first.
    const outcome = await getProjectBySlug(SLUG, NO_OWNER).then(
      (value) => ({ rejected: false, payload: value }),
      (err) => ({ rejected: true, payload: err })
    );
    expect(outcome.rejected, 'a resolved value IS the disclosure').toBe(true);

    const err = outcome.payload as InstanceType<typeof AppError>;
    // An error carrying a real project id, name or description would still be
    // the disclosure this card is about, even though the call "failed". Scan
    // the whole settled value, so a leak through any field is caught.
    const serialised = JSON.stringify({ m: err.message, d: err.details, all: outcome.payload });
    for (const secret of [a.id, b.id, "A's private notes", "B's private notes"]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('AC-S3 — the guard refuses before opening a connection', async () => {
    await seedBoth();
    getDbSpy.mockClear();

    await expect(getProjectBySlug(SLUG, NO_OWNER)).rejects.toBeInstanceOf(AppError);

    // Remove the guard and the call still ends in an error — but only after
    // binding an undefined owner into a real query. No query should be issued
    // on behalf of a caller with no identity.
    expect(getDbSpy, 'no database work was done for an unidentified caller').not.toHaveBeenCalled();
  });

  it('AC-S3b — an empty-string owner is rejected too, not treated as an owner', async () => {
    await seedBoth();
    getDbSpy.mockClear(); // the seed itself opens connections

    // `requireOwner` tests falsiness, not `=== undefined`, and that is
    // load-bearing: `''` is a string, so a `=== undefined` check would pass it
    // through into `eq(projects.userId, '')`. That predicate matches no row on
    // a `NOT NULL uuid` column — but it reaches the database to find out, and
    // it means an identity-less caller was accepted as identified.
    await expect(getProjectBySlug(SLUG, '')).rejects.toMatchObject({ statusCode: 400 });
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it('AC-S4 — control: each real owner still resolves their own row, not the other’s', async () => {
    await seedBoth();

    // Without this the cases above are all satisfied by a function that always
    // throws, and the fix would read as correct while having broken the feature.
    const a = await getProjectBySlug(SLUG, USER_A);
    const b = await getProjectBySlug(SLUG, USER_B);

    expect(a.description).toBe("A's private notes");
    expect(b.description).toBe("B's private notes");
    expect(a.id).not.toBe(b.id);
    expect(a.fileCount).toBe(1);
    expect(b.fileCount).toBe(1);
  });
});

describe('WIC-1554 — deleteProject (destruction)', () => {
  it('AC-S5 — the route’s delete flow destroys nothing when the caller has no owner', async () => {
    await seedBoth();
    const a = await rowFor(USER_A);

    // Written exactly as `routes/projects.ts:38-40` composes it. The card
    // measured this leaving 0 rows for A and an empty object store.
    const flow = async () => {
      const project = await getProjectBySlug(SLUG, NO_OWNER);
      await deleteProject(project.id, NO_OWNER);
    };
    const err = await flow().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    // Graded on *where* the flow stops, not merely that it stops. Asserting
    // only "it rejected" made this cell unkillable by any single mutation: with
    // the lookup guard reverted, step 1 resolved a stranger's row and step 2's
    // guard caught it, so the test stayed green while half the fix was gone.
    // The route must never get as far as holding another user's project id.
    expect(err.message, 'rejected at the lookup, before any id was resolved').toMatch(
      /required to resolve a project by slug/i
    );

    expect(await rowsForSlug(), 'both rows survive').toHaveLength(2);
    expect(await rowFor(USER_A)).toMatchObject({ id: a.id });
    expect(objectKeys(), 'no stored object was deleted').toEqual(ALL_OBJECTS);
  });

  it('AC-S6 — deleteProject called directly with a real id refuses on its own guard', async () => {
    await seedBoth();
    const a = await rowFor(USER_A);

    // AC-S5 alone does not grade `deleteProject`: `getProjectBySlug` throws
    // first, so the destructive guard never runs and could be deleted with
    // AC-S5 still green. This is the path #163's own docstring flags — a JS
    // caller, holding an id it obtained some other way.
    const err = await deleteProject(a.id, NO_OWNER).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.statusCode).toBe(400);
    expect(err.message, "graded on deleteProject's own message").toMatch(
      /required to delete a project/i
    );

    expect(await rowsForSlug()).toHaveLength(2);
    // `deleteProject` built its storage prefix from `project.userId` — the
    // *victim's* namespace — so an id-only match emptied a stranger's objects.
    expect(objectKeys()).toEqual(ALL_OBJECTS);
  });

  it('AC-S7 — the destructive guard refuses before opening a connection', async () => {
    await seedBoth();
    const a = await rowFor(USER_A);
    getDbSpy.mockClear();

    await expect(deleteProject(a.id, NO_OWNER)).rejects.toBeInstanceOf(AppError);
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it('AC-S8 — control: an owner deletes only their own row and only their own objects', async () => {
    await seedBoth();
    const a = await rowFor(USER_A);
    const b = await rowFor(USER_B);

    await deleteProject(b.id, USER_B);

    const rows = await rowsForSlug();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(a.id);
    expect(objectKeys(), "only B's namespace was emptied").toEqual([
      `projects/${USER_A}/${SLUG}/${FILE}`,
    ]);
    expect(OBJECTS.get(`projects/${USER_A}/${SLUG}/${FILE}`)).toBe(A_SECRET);
  });

  it('AC-S9 — control: an owner cannot delete a row they do not own', async () => {
    await seedBoth();
    const a = await rowFor(USER_A);

    // The scoping that already worked whenever an owner was present. Pinned so
    // that "require the owner" cannot be mistaken for "any owner will do".
    await expect(deleteProject(a.id, USER_B)).rejects.toBeInstanceOf(NotFoundError);
    expect(await rowsForSlug()).toHaveLength(2);
    expect(objectKeys()).toEqual(ALL_OBJECTS);
  });
});

describe('WIC-1554 — getProject (id-keyed read)', () => {
  it('AC-S10 — an owner-less id lookup is rejected on its own message', async () => {
    await seedBoth();
    const a = await rowFor(USER_A);

    const err = await getProject(a.id, NO_OWNER).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/required to load a project/i);
  });

  it('AC-S11 — control: the owner reads their row; a stranger with the id gets 404', async () => {
    await seedBoth();
    const a = await rowFor(USER_A);

    await expect(getProject(a.id, USER_A)).resolves.toMatchObject({
      description: "A's private notes",
      fileCount: 1,
    });
    await expect(getProject(a.id, USER_B)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('WIC-1554 — listProjects (no predicate at all)', () => {
  it('AC-S12 — an owner-less list is rejected, not answered with every tenant’s projects', async () => {
    await seedBoth();

    // The widest degradation: `where(undefined)` is not a permissive predicate,
    // it is *no* predicate, so this returned both users' rows rather than one
    // slug's worth.
    const err = await listProjects(NO_OWNER).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/required to list projects/i);
  });

  it('AC-S13 — control: each owner sees exactly one project, their own', async () => {
    await seedBoth();

    const forA = await listProjects(USER_A);
    const forB = await listProjects(USER_B);

    expect(forA).toHaveLength(1);
    expect(forB).toHaveLength(1);
    expect(forA[0].description).toBe("A's private notes");
    expect(forB[0].description).toBe("B's private notes");
  });

  it('AC-S14 — generateProjectIndex inherits the guard rather than indexing everyone', async () => {
    await seedBoth();

    // It calls `listProjects(userId)` and then writes an index into
    // `projects/{owner}/index.md`. Owner-less, it enumerated both users'
    // projects and file names into a single document.
    await expect(generateProjectIndex(NO_OWNER)).rejects.toMatchObject({ statusCode: 400 });
    expect(objectKeys(), 'no index document was written').toEqual(ALL_OBJECTS);

    // Control: a real owner still gets an index, containing only their own.
    const res = await generateProjectIndex(USER_A);
    expect(res.projectCount).toBe(1);
    const index = OBJECTS.get(`projects/${USER_A}/index.md`);
    expect(index).toContain(FILE);
    expect(res.path).toBe(`projects/${USER_A}/index.md`);
  });
});

describe('WIC-1554 — assertProjectOwned / touchProject (file mutations)', () => {
  /**
   * `assertProjectOwned` was an explicit `if (!userId) return;`, so it
   * backstopped nothing for the one caller that needed it. It gates all five
   * file entry points, which means it now also masks `touchProject`'s guard on
   * every reachable path — `touchProject` is a second line of defence here, not
   * something these cases grade directly. Stated rather than implied, because a
   * matrix that assumed otherwise would mis-credit which guard it was testing.
   */
  it('AC-S15 — every owner-less file entry point is rejected on the ownership guard', async () => {
    await seedBoth();

    for (const [label, call] of [
      ['listProjectFiles', () => listProjectFiles(SLUG, NO_OWNER)],
      ['updateProjectFile', () => updateProjectFile(SLUG, FILE, 'overwritten', NO_OWNER)],
      ['createProjectFile', () => createProjectFile(SLUG, 'new-file.md', 'x', NO_OWNER)],
      ['deleteProjectFile', () => deleteProjectFile(SLUG, FILE, NO_OWNER)],
    ] as const) {
      const err = await call().catch((e) => e);
      expect(err, `${label} rejected`).toBeInstanceOf(AppError);
      expect(err.statusCode, `${label} status`).toBe(400);
      expect(err.message, `${label} message`).toMatch(/required to access a project/i);
    }
  });

  it('AC-S16 — an owner-less file mutation re-stamps nobody’s updated_at', async () => {
    await seedBoth();
    const beforeA = await rowFor(USER_A);
    const beforeB = await rowFor(USER_B);

    // `touchProject` is an UPDATE with no `LIMIT`, so a slug-only predicate
    // rewrote *every* tenant's row holding this slug and reshuffled their
    // `listProjects` ordering, which sorts on `updatedAt DESC`.
    await updateProjectFile(SLUG, FILE, 'overwritten', NO_OWNER).catch(() => undefined);
    await createProjectFile(SLUG, 'new-file.md', 'x', NO_OWNER).catch(() => undefined);
    await deleteProjectFile(SLUG, FILE, NO_OWNER).catch(() => undefined);

    expect((await rowFor(USER_A)).updatedAt.getTime()).toBe(beforeA.updatedAt.getTime());
    expect((await rowFor(USER_B)).updatedAt.getTime()).toBe(beforeB.updatedAt.getTime());
    expect(objectKeys(), 'and no document was written, overwritten or deleted').toEqual(
      ALL_OBJECTS
    );
    expect(OBJECTS.get(`projects/${USER_A}/${SLUG}/${FILE}`)).toBe(A_SECRET);
    expect(OBJECTS.get(`projects/${USER_B}/${SLUG}/${FILE}`)).toBe(B_SECRET);
  });

  it('AC-S17 — control: an owner’s file mutation re-stamps their row and only theirs', async () => {
    await seedBoth();
    const beforeA = await rowFor(USER_A);
    const beforeB = await rowFor(USER_B);
    // `updated_at` has timestamp resolution; without a gap "unchanged" and
    // "re-stamped in the same tick" are indistinguishable and AC-S16 would pass
    // for the wrong reason.
    await client.exec(`UPDATE projects SET updated_at = updated_at - interval '1 hour';`);

    await updateProjectFile(SLUG, FILE, "A's revision", USER_A);

    const afterA = await rowFor(USER_A);
    const afterB = await rowFor(USER_B);
    expect(afterA.updatedAt.getTime(), "A's row was re-stamped").toBeGreaterThan(
      beforeA.updatedAt.getTime() - 3600_000
    );
    expect(afterB.updatedAt.getTime(), "B's row was not").toBe(
      beforeB.updatedAt.getTime() - 3600_000
    );
    expect(OBJECTS.get(`projects/${USER_A}/${SLUG}/${FILE}`)).toBe("A's revision");
    expect(OBJECTS.get(`projects/${USER_B}/${SLUG}/${FILE}`), "B's document untouched").toBe(
      B_SECRET
    );
  });
});
