/**
 * WIC-1469 — pins for the two guards in `project.service` that the API suite at
 * `7886b59` left entirely unconstrained.
 *
 * Neither guard is a defect and neither is a leak: the owner-namespaced storage
 * key introduced by WIC-1433 carries tenancy on its own, which is *why* both
 * survive deletion with a green suite. That is exactly the problem. A future
 * "this looks redundant now" pass deletes them and CI says yes.
 *
 *  1. **`assertProjectOwned`** — measured no-op ⇒ 471/471 still passed. It is
 *     redundant for *exposure* (a cross-tenant key simply does not resolve) but
 *     not for *behaviour*: without it, a file mutation against a slug you hold
 *     no row for stops being a `NotFoundError` and becomes a silent write into
 *     your own namespace plus a zero-row `touchProject` — an orphaned object
 *     with no project record behind it. WIC-1433 consolidated five inline
 *     copies of this check into the one helper, so one `return;` disarms all
 *     five call sites at once. Each of the five is pinned below.
 *
 *  2. **`storageOwner`'s traversal guard** — deleted ⇒ 471/471 still passed,
 *     and there was no test for it anywhere in `packages/api/test/`. It is
 *     unreachable today because `userId` is a Supabase `sub`, i.e. a UUID
 *     (`middleware/auth.ts` verifies with `jose` at `audience: 'authenticated'`).
 *     It is defence-in-depth against a future IdP whose subject is shaped
 *     `provider|id`, and it is load-bearing only on the local-filesystem
 *     backend, where the owner segment becomes a real path component.
 *
 * The two disjuncts of that guard are pinned *separately*. `/^[A-Za-z0-9._-]+$/`
 * admits `..` (the dot is inside the class), so `owner.includes('..')` is not
 * redundant with it, and dropping either half alone must fail a case here.
 *
 * Harness notes, both inherited from `project.tenancy.test.ts` for the same
 * reasons documented there: `getDb` is real PGlite rather than a stub, because
 * only a real planner distinguishes a scoped predicate from an unscoped one;
 * and `storage.service` is a real key→value `Map`, because a `vi.fn()` spy that
 * ignores the key it is handed cannot observe an orphaned write.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

let db: ReturnType<typeof drizzle>;
let client: PGlite;

vi.mock('../src/db/client.js', () => ({
  // Lazy: `db` is assigned in beforeAll, long after this factory is hoisted.
  getDb: () => db,
  closeDb: async () => {},
}));

/** The object store, keyed by the *actual* storage key the service computes. */
const OBJECTS = new Map<string, string>();

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ dataDir: './data' }),
}));

// deliberate-total-mock: a real in-memory fake backed by OBJECTS, not a spy stub — spreading the real module would pull in R2/filesystem I/O this suite has no way to satisfy
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

const {
  createProject,
  createProjectFile,
  updateProjectFile,
  deleteProjectFile,
  listProjectFiles,
  getProjectFile,
  projectFileKey,
  localProjectsDir,
} = await import('../src/services/project.service.js');
const { NotFoundError, AppError } = await import('../src/types/index.js');

/** Supabase `sub` claims: UUIDs. This is the only owner shape production sees. */
const USER_A = '11111111-1111-4111-8111-111111111111';
/** Authenticated, but owns no project by `SLUG`. The caller under test. */
const USER_C = '33333333-3333-4333-8333-333333333333';

const SLUG = 'acme-corp';
const FILE = 'acme-corp-staff-engineer.md';
const A_SECRET = '# Staff Engineer at Acme Corp\n\n- **Situation:** A wrote this.';
const C_CONTENT = '# Staff Engineer at Acme Corp\n\n- **Situation:** C wrote this.';

const A_KEY = `projects/${USER_A}/${SLUG}/${FILE}`;

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

/**
 * A owns `acme-corp` and has a file in it. C is a real authenticated user who
 * owns no project by that name. Seeding A matters: it makes the store non-empty,
 * so "C wrote nothing" is measured as *the store is unchanged*, not as the
 * vacuously-empty store a broken storage fake would also produce.
 */
async function seedAOnly() {
  await createProject({ name: 'Acme Corp', slug: SLUG }, USER_A);
  await createProjectFile(SLUG, FILE, A_SECRET, USER_A);
}

/** The store as it must remain when C's call is refused. */
function storeSnapshot() {
  return [...OBJECTS.entries()].sort();
}

describe('WIC-1469 — assertProjectOwned pins its five call sites', () => {
  it('AC-0 — C really is authenticated and really does own no such project', async () => {
    await seedAOnly();
    // Positive control on the premise. If C could hold a row here, every case
    // below would be asserting against the wrong precondition.
    const { rows } = await client.query<{ user_id: string }>('SELECT user_id FROM projects');
    expect(rows.map((r) => r.user_id)).toEqual([USER_A]);
  });

  it('AC-1 — createProjectFile refuses a slug C owns no row for, and writes nothing', async () => {
    await seedAOnly();
    const before = storeSnapshot();

    await expect(createProjectFile(SLUG, FILE, C_CONTENT, USER_C)).rejects.toThrow(
      /^Project not found$/
    );

    // Without the guard this resolves and leaves `projects/{C}/acme-corp/...`
    // behind with no `projects` row to own it. Assert on the *store*, because
    // the rejection alone does not prove nothing was written.
    expect(storeSnapshot(), 'no orphaned object may be created').toEqual(before);
  });

  it('AC-2 — updateProjectFile refuses a slug C owns no row for, and writes nothing', async () => {
    await seedAOnly();
    const before = storeSnapshot();

    await expect(updateProjectFile(SLUG, FILE, C_CONTENT, USER_C)).rejects.toThrow(
      /^Project not found$/
    );

    // The sharper of the two: `updateProjectFile` has no existence check of its
    // own on the R2 path (`createProjectFile` at least consults `listObjectKeys`
    // for a conflict), so this guard is the only thing standing between an
    // unowned slug and an upload.
    expect(storeSnapshot(), 'no orphaned object may be created').toEqual(before);
    // A's bytes are untouched either way — stated so a future failure here is
    // read as an orphan, not as a leak.
    expect(OBJECTS.get(A_KEY)).toBe(A_SECRET);
  });

  it('AC-3 — deleteProjectFile refuses rather than silently succeeding', async () => {
    await seedAOnly();

    // Without the guard: `deleteObject` on a key that does not exist is a no-op
    // and `touchProject` updates zero rows, so the call resolves `undefined` and
    // reports a deletion that never happened.
    await expect(deleteProjectFile(SLUG, FILE, USER_C)).rejects.toThrow(/^Project not found$/);
    expect(OBJECTS.get(A_KEY)).toBe(A_SECRET);
  });

  it('AC-4 — listProjectFiles refuses rather than returning an empty list', async () => {
    await seedAOnly();

    // Without the guard this returns `[]` — indistinguishable to the caller from
    // "your project exists and is empty".
    await expect(listProjectFiles(SLUG, USER_C)).rejects.toThrow(/^Project not found$/);
  });

  it('AC-5 — getProjectFile reports the missing *project*, not a missing file', async () => {
    await seedAOnly();

    // Both paths raise `NotFoundError`, so the class alone is a vacuous oracle
    // here: without the guard the owner-namespaced key misses and the error
    // becomes `Project file not found`. The message is what separates them.
    await expect(getProjectFile(SLUG, FILE, USER_C)).rejects.toThrow(/^Project not found$/);
  });

  it('AC-6 — positive control: all five resolve once C owns the slug', async () => {
    await seedAOnly();
    await createProject({ name: 'Acme Corp', slug: SLUG }, USER_C);

    await expect(createProjectFile(SLUG, FILE, C_CONTENT, USER_C)).resolves.toBeUndefined();
    await expect(listProjectFiles(SLUG, USER_C)).resolves.toMatchObject([{ fileName: FILE }]);
    await expect(getProjectFile(SLUG, FILE, USER_C)).resolves.toBe(C_CONTENT);
    await expect(updateProjectFile(SLUG, FILE, 'edited', USER_C)).resolves.toBeUndefined();
    await expect(deleteProjectFile(SLUG, FILE, USER_C)).resolves.toBeUndefined();

    // And C never touched A's namespace on the way through.
    expect(OBJECTS.get(A_KEY)).toBe(A_SECRET);
  });

  it('AC-7 — the guard now refuses the auth-bypass dev mode (no userId)', async () => {
    // Until WIC-1554, `assertProjectOwned` returned early when `userId` was
    // absent — local dev had a single implicit user, and since that branch
    // backstopped nothing for the one caller that needed it, WIC-1554 (#210)
    // closed it: `requireOwner` now throws for every access, auth-bypass dev
    // mode included. Pin the current contract, or a future "loosen the guard"
    // pass reopens the hole with no test to say so.
    await expect(createProjectFile(SLUG, FILE, 'dev', undefined)).rejects.toThrow(
      /userId is required/
    );
    expect(OBJECTS.has(`projects/anon/${SLUG}/${FILE}`)).toBe(false);
  });
});

describe("WIC-1469 — storageOwner's traversal guard", () => {
  /**
   * Both exported functions that turn an owner into a path/key segment. The
   * guard lives in the shared helper, so a pin that exercised only one of them
   * would still pass if the helper were bypassed at the other call site.
   */
  const reachers: [string, (owner: string) => string][] = [
    ['projectFileKey', (owner) => projectFileKey(owner, SLUG, FILE)],
    ['localProjectsDir', (owner) => localProjectsDir(owner)],
  ];

  it('AC-8 — a Supabase UUID sub passes both reachers', () => {
    // The positive control. Without it, a guard that rejected *everything* would
    // satisfy every negative case below.
    expect(projectFileKey(USER_A, SLUG, FILE)).toBe(A_KEY);
    expect(localProjectsDir(USER_A)).toBe(`./data/projects/${USER_A}`);
  });

  /**
   * ADR-010 D2 (WIC-2070) — **this AC is inverted from what it pinned before.**
   * It used to assert that an absent owner resolved to `anon`. `storageOwner`'s
   * `userId ?? 'anon'` is now deleted, so an absent owner throws instead.
   *
   * The cast is deliberate and is the whole point of the test. The narrowed
   * `userId: string` makes this call unrepresentable to `tsc`, but the type is
   * not the mechanism: `userId` originates in a JWT `sub` claim that can be
   * absent at runtime, and JS callers are not bound by the signature at all. So
   * the runtime throw needs a pin that the type cannot supply, and reaching it
   * requires stepping around the type on purpose.
   */
  it.each(reachers)(
    'AC-9 — %s rejects an absent owner rather than inventing a tenant',
    (_n, call) => {
      const absent = undefined as unknown as string;
      expect(() => call(absent)).toThrow(AppError);
      try {
        call(absent);
        expect.unreachable('an absent owner must not become a storage key');
      } catch (err) {
        expect((err as AppError).code).toBe('BAD_REQUEST');
        expect((err as AppError).statusCode).toBe(400);
      }
    }
  );

  /**
   * The hazard is **ordering**, not the throw's existence, and this is the case
   * that discriminates. `/^[A-Za-z0-9._-]+$/.test(undefined)` coerces its
   * argument to the *string* `'undefined'`, which passes the character class and
   * contains no `..` — so a `storageOwner` that dropped the `?? 'anon'` but left
   * the falsy check *below* the regex would return `'undefined'` and silently
   * rename the shared ownerless tenant from `projects/anon/` to
   * `projects/undefined/`, with AC-8 and AC-10..12 all still green.
   *
   * `''` pins the same ordering from the other side: it is falsy, so it must
   * answer `BAD_REQUEST`, whereas the regex (which requires at least one
   * character) would answer `INVALID_PATH`. Reading the *code* off each error is
   * what makes this test able to tell the two orderings apart at all.
   */
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
  ])('AC-9b — an absent owner (%s) never becomes a tenant segment', (_label, absent) => {
    const owner = absent as unknown as string;
    for (const [name, call] of reachers) {
      let key: string | undefined;
      try {
        key = call(owner);
      } catch (err) {
        expect((err as AppError).code, `${name} must reject before the traversal guard`).toBe(
          'BAD_REQUEST'
        );
        continue;
      }
      expect.unreachable(`${name} returned ${String(key)} for an absent owner`);
    }
  });

  it.each(reachers)(
    'AC-10 — %s rejects a `provider|id` subject (regex disjunct)',
    (_name, call) => {
      // The concrete future-IdP shape this guard exists for: Auth0/Cognito issue
      // subjects like `google-oauth2|1234`. No `..`, so *only* the character-class
      // half of the guard catches it.
      expect(() => call('google-oauth2|110123456789')).toThrow(AppError);
      try {
        call('google-oauth2|110123456789');
        expect.unreachable('the owner segment must not be accepted');
      } catch (err) {
        expect((err as AppError).code).toBe('INVALID_PATH');
        expect((err as AppError).statusCode).toBe(400);
      }
    }
  );

  it.each(reachers)('AC-11 — %s rejects a bare `..` (includes disjunct)', (_name, call) => {
    // `/^[A-Za-z0-9._-]+$/` *admits* `..` — the dot is inside the class — so this
    // is the case that proves `owner.includes('..')` is not dead code. Deleting
    // that clause alone fails here and nowhere else.
    expect(() => call('..')).toThrow(AppError);
    try {
      call('..');
      expect.unreachable('a bare `..` must not become a path segment');
    } catch (err) {
      expect((err as AppError).code).toBe('INVALID_PATH');
    }
  });

  it.each(reachers)('AC-12 — %s rejects an escaping owner segment', (_name, call) => {
    // The headline case, caught by both disjuncts. On the local-filesystem
    // backend this segment is joined straight into a real path, so an accepted
    // `../../etc` would place the whole project tree outside `dataDir`.
    expect(() => call('../../etc')).toThrow(/Invalid storage owner/);
  });
});
