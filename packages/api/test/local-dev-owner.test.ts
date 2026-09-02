/**
 * WIC-1964 / ADR-010 D3 — the auth bypass supplies an owner, not an absence.
 *
 * D2 landed before D1/D3 (the sequencing inverted in practice), so for a while
 * `requireOwner` rejected the local-dev bypass caller and every project route
 * answered 401/400 in the auth-bypass dev mode. D3 closes that by giving the
 * bypass a *real* tenant — `LOCAL_DEV_USER_ID`, defaulting to the sentinel that
 * migration `0017` backfilled every pre-tenancy row to.
 *
 * The point is not merely that dev works again. It is that dev now works *the
 * same way production does*: `userId` is a concrete uuid, so every tenancy
 * predicate runs its owner branch instead of being skipped. There is no
 * owner-absent code path left for local dev to exercise, which is what D1
 * commits the codebase to. These tests are therefore written to fail if the
 * bypass ever goes back to yielding a falsy owner, by whatever route.
 *
 * Driven through the **real Hono app** (`buildApp()`) rather than by calling the
 * services with a hardcoded sentinel. The bypass lives in `middleware/auth.ts`,
 * so a service-level test with the owner passed in would assert nothing about
 * it — it would pass identically on `main`, before this change.
 *
 * Harness is PGlite (a real Postgres planner) plus an in-memory object store,
 * for the reason given at the top of `project.tenancy.test.ts`: a double that
 * ignores the predicate it is handed passes with the bug in place.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, and } from 'drizzle-orm';

let db: ReturnType<typeof drizzle>;
let client: PGlite;

vi.mock('../src/db/client.js', () => ({
  getDb: () => db,
  closeDb: async () => {},
}));

const OBJECTS = new Map<string, string>();

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

const { buildApp } = await import('../src/app.js');
const { getConfig, _resetConfig, LOCAL_DEV_USER_ID_DEFAULT } = await import('../src/config.js');
const { _resetJwksCache } = await import('../src/middleware/auth.js');
const { createProject, createProjectFile } = await import('../src/services/project.service.js');
const { projects } = await import('../src/db/schema.js');

/** A real, unrelated tenant. Nothing the dev caller does may reach this user. */
const USER_A = '11111111-1111-4111-8111-111111111111';
const SLUG = 'acme-corp';
const FILE = 'acme-corp-staff-engineer.md';
const A_SECRET = '# Staff Engineer at Acme Corp\n\n- **Situation:** A wrote this.';

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
-- Migration 0017: ownership is (user_id, slug), so two tenants can hold one slug.
CREATE UNIQUE INDEX idx_projects_user_slug ON projects(user_id, slug);
`;

const originalEnv = process.env;

/** The env the bypass actually fires on: neither Supabase variable present. */
function bypassEnv(extra: Record<string, string> = {}) {
  const env = { ...originalEnv, ...extra };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_JWT_SECRET;
  return env;
}

/**
 * `getConfig()` memoises, so the env must be in effect for the whole request —
 * not merely while the app is being built.
 */
function buildBypassApp(extra: Record<string, string> = {}) {
  process.env = bypassEnv(extra);
  _resetConfig();
  _resetJwksCache();
  return buildApp();
}

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  await client.exec(SCHEMA_DDL);
});

beforeEach(async () => {
  OBJECTS.clear();
  await client.exec('TRUNCATE projects CASCADE;');
});

afterEach(() => {
  process.env = originalEnv;
  _resetConfig();
  _resetJwksCache();
});

function rowFor(userId: string, slug = SLUG) {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.slug, slug)))
    .limit(1)
    .then((r) => r[0]);
}

describe('AC-2 — the default is the sentinel migration 0017 backfills to', () => {
  /**
   * Parsed out of the migration rather than compared to a second copy of the
   * literal. A copied constant proves only that someone typed the same string
   * twice; this fails if either side is ever changed without the other, which
   * is the drift AC-2 asks to be made impossible.
   */
  it('AC-2-1 — the config default is read back out of 0017, not copied', async () => {
    const sql = await readFile(
      fileURLToPath(
        new URL('../src/db/migrations/0017_enforce_userid_not_null.sql', import.meta.url)
      ),
      'utf-8'
    );

    const declared = sql.match(/placeholder\s+UUID\s*:=\s*'([0-9a-fA-F-]{36})'/);
    expect(
      declared,
      '0017 no longer declares a `placeholder UUID := ...` — re-point this test'
    ).not.toBeNull();

    expect(declared![1]).toBe(LOCAL_DEV_USER_ID_DEFAULT);

    // And the migration really does assign it to `projects.user_id`, so the
    // sentinel we adopt is the one that owns the backfilled rows rather than
    // some other uuid that happens to appear in the file.
    expect(sql).toMatch(/UPDATE\s+projects\s+SET\s+user_id\s*=\s*placeholder/i);
  });

  it('AC-2-2 — the bypass default resolves to that sentinel, and LOCAL_DEV_USER_ID overrides it', () => {
    process.env = bypassEnv();
    _resetConfig();
    expect(getConfig().localDevUserId).toBe(LOCAL_DEV_USER_ID_DEFAULT);

    process.env = bypassEnv({ LOCAL_DEV_USER_ID: USER_A });
    _resetConfig();
    expect(getConfig().localDevUserId).toBe(USER_A);

    // A blank override must not degrade to `''` — that is falsy, and
    // `requireOwner` rejects it, which would reintroduce the owner-absent
    // outcome D3 exists to delete.
    for (const blank of ['', '   ']) {
      process.env = bypassEnv({ LOCAL_DEV_USER_ID: blank });
      _resetConfig();
      expect(getConfig().localDevUserId, `LOCAL_DEV_USER_ID=${JSON.stringify(blank)}`).toBe(
        LOCAL_DEV_USER_ID_DEFAULT
      );
    }
  });
});

describe('AC-3 — D3 changes what the bypass supplies, not when it fires', () => {
  /**
   * The security-relevant half. If D3 had widened the *condition*, a configured
   * deployment would start serving unauthenticated requests as the sentinel
   * tenant — strictly worse than the 400 it replaces. Each case below sets only
   * one variable, which must be enough to leave the bypass switched off.
   */
  it.each([
    ['SUPABASE_JWT_SECRET only', { SUPABASE_JWT_SECRET: 'super-secret-jwt-key-for-testing!!' }],
    ['SUPABASE_URL only', { SUPABASE_URL: 'https://example.supabase.co' }],
  ])('AC-3-1 — %s still 401s a request with no token', async (_name, vars) => {
    process.env = { ...bypassEnv(), ...vars };
    _resetConfig();
    _resetJwksCache();
    const app = buildApp();

    const res = await app.request('/api/projects');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('AC-3-2 — a configured deployment still 401s an invalid token', async () => {
    process.env = { ...bypassEnv(), SUPABASE_JWT_SECRET: 'super-secret-jwt-key-for-testing!!' };
    _resetConfig();
    _resetJwksCache();
    const app = buildApp();

    const res = await app.request('/api/projects', {
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.status).toBe(401);
  });
});

describe('AC-4 — local dev runs the owner branch as the sentinel tenant', () => {
  /**
   * Re-pointed from PR #316's `AC-T0-2`. There the dev caller was owner-less and
   * the assertion was that it reached *no* row; here it is a tenant, and the
   * assertion is that it reaches *its own* row and still not anybody else's.
   * The control matters as much as the case: without a second tenant holding
   * the same slug, a scoped and an unscoped predicate return the same thing.
   */
  it('AC-4-1 — a dev read returns the sentinel’s project, never another tenant’s', async () => {
    const app = buildBypassApp();
    const sentinel = getConfig().localDevUserId;

    await createProject({ name: 'A’s Acme', slug: SLUG }, USER_A);
    await createProjectFile(SLUG, FILE, A_SECRET, USER_A);
    await createProject({ name: 'Dev’s Acme', slug: SLUG }, sentinel);

    const res = await app.request(`/api/projects/${SLUG}`);
    expect(res.status, 'the bypass caller must no longer be rejected').toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Dev’s Acme', slug: SLUG });

    // A's document is not reachable through the dev caller's file listing.
    const files = await app.request(`/api/projects/${SLUG}/files`);
    expect(await files.json()).toEqual({ files: [] });
  });

  it('AC-4-2 — a dev write lands on the sentinel’s row and re-stamps only it', async () => {
    const app = buildBypassApp();
    const sentinel = getConfig().localDevUserId;

    await createProject({ name: 'A’s Acme', slug: SLUG }, USER_A);
    await createProject({ name: 'Dev’s Acme', slug: SLUG }, sentinel);
    // Aged so a stray cross-tenant re-stamp is visible without racing the clock.
    const AGED = '2020-01-01T00:00:00Z';
    await client.exec(`UPDATE projects SET updated_at = '${AGED}';`);

    const res = await app.request(`/api/projects/${SLUG}/files/${FILE}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# written by local dev' }),
    });
    expect(res.status, 'a dev write must succeed, not 400/401').toBeLessThan(300);

    // The owner branch ran: the sentinel's row moved, A's did not.
    expect((await rowFor(sentinel)).updatedAt.getTime()).toBeGreaterThan(new Date(AGED).getTime());
    expect(
      (await rowFor(USER_A)).updatedAt.toISOString(),
      'the dev write re-stamped a tenant who does not own it'
    ).toBe(new Date(AGED).toISOString());
  });

  /**
   * Re-pointed from PR #316's `AC-T0-1` + `AC-T0-5`. #316 asserted that the dev
   * caller owned a *directory-only* project under `projects/anon/…`, reached
   * through the filesystem fallback because it could hold no row. Under D3 it
   * holds a row like any tenant, so the sentinel — not `anon` — is the thing to
   * pin, and the round trip goes through the database rather than around it.
   */
  it('AC-4-3 — a dev-created project is a real row owned by the sentinel', async () => {
    const app = buildBypassApp();
    const sentinel = getConfig().localDevUserId;

    const created = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Dev’s Acme', slug: SLUG }),
    });
    expect(created.status, 'local dev could not create a project before D3').toBe(201);

    const row = await rowFor(sentinel);
    expect(row, 'the dev project must be a real row, not a bare directory').toBeDefined();
    expect(row.userId).toBe(LOCAL_DEV_USER_ID_DEFAULT);

    // Round-trips through the same bypass identity on a fresh app instance,
    // i.e. the owner is stable across requests rather than per-process.
    const reread = await buildBypassApp().request(`/api/projects/${SLUG}`);
    expect(reread.status).toBe(200);
  });

  it('AC-4-4 — LOCAL_DEV_USER_ID re-points dev at a different tenant', async () => {
    // The discriminating test for "the bypass reads config" rather than "the
    // services happen to default to the sentinel somewhere downstream".
    await createProject({ name: 'A’s Acme', slug: SLUG }, USER_A);

    const app = buildBypassApp({ LOCAL_DEV_USER_ID: USER_A });
    const res = await app.request(`/api/projects/${SLUG}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'A’s Acme' });

    // ...and the sentinel, which owns nothing here, gets a 404 rather than A's row.
    const sentinelApp = buildBypassApp();
    expect((await sentinelApp.request(`/api/projects/${SLUG}`)).status).toBe(404);
  });
});
