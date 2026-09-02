// WIC-1676 — the `updated_at` re-stamp after a project file mutation must carry
// the owner.
//
// `updateProjectFile`, `createProjectFile` and `deleteProjectFile` each ended in
//
//     db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.slug, slug))
//
// and `projects` declares `uniqueIndex('idx_projects_user_slug').on(t.userId, t.slug)`,
// so a slug is unique only *within* a user. An UPDATE carries no `LIMIT`, so that
// predicate rewrote one row per tenant holding the slug — unconditionally, with a
// present owner, which is why it was invisible to the fail-open `[SIG]`/`[COND]`
// checks and only surfaced under `[NOWNER]` (WIC-1672 / ADR-010 D5).
//
// The assertion is structural, not a substring match: `expectScopedTo` renders the
// real drizzle clause and evaluates it against probe rows, so dropping the owner
// term, flipping `and`→`or`, or binding the owner to the wrong column all fail it.
// A `toContain('"user_id" = $')` check passes for all three (WIC-1491).
//
// This suite is a **regression pin, not a fix**. The predicate is already correct on
// `main`: `touchProject` routes through `projectScope`, which emits
// `and(eq(projects.slug, slug), eq(projects.userId, owner))` and requires the owner
// (WIC-1433 `fd7e1d40` scoped it; WIC-1554 `54460cc2` removed the owner-less
// degradation). What this file adds is the half `main` does not yet grade.
//
// Measured against `main` @ 4957738d (WIC-1970), mutating `touchProject` alone and
// running `project.tenancy.test.ts` + `project.sibling-owner-required.test.ts`
// (35 tests baseline; every mutant held that total, so none merely failed to compile):
//
//   | mutant                                            | existing suites | this file |
//   |---------------------------------------------------|-----------------|-----------|
//   | drop the owner term (the original defect)          | RED (2 failed)  | RED       |
//   | `and` -> `or`                                      | RED (2 failed)  | RED       |
//   | drop the *slug* term, keep the owner               | **GREEN 35/35** | **RED**   |
//
// The third row is why this file exists. `eq(projects.userId, owner)` with no slug
// term is owner-scoped — so it leaks nothing across tenants and every existing
// cross-tenant assertion stays green — but it re-stamps *all* of the caller's own
// projects on every file save, silently reshuffling their `listProjects` ordering
// (which sorts on `updatedAt DESC`). `idKey: 'slug'` grades that half by column.
// Note `or` is not imported by `project.service.ts`, so an `and`->`or` mutant does
// not compile unless the import is added first; without that step it reads as a
// false GREEN rather than a kill.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));
vi.mock('../src/services/storage.service.js', () => ({
  isStorageAvailable: vi.fn(() => true),
  uploadObject: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
  deleteObjects: vi.fn(async () => undefined),
  getObject: vi.fn(async () => 'existing content'),
  listObjectKeys: vi.fn(async () => [] as string[]),
}));

import { getDb } from '../src/db/client.js';
import {
  updateProjectFile,
  createProjectFile,
  deleteProjectFile,
} from '../src/services/project.service.js';
import { expectScopedTo } from './helpers/tenancy.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';
const SLUG = 'acme-corp';
const FILE = 'notes.md';

/**
 * A fake `db` that records every `where` handed to an UPDATE. The ownership
 * pre-check's SELECT resolves a row unconditionally — this test grades the
 * write predicate, and a SELECT that returned nothing would abort the function
 * before the write and pass the assertions vacuously. `expectUpdateCount`
 * guards that: an assertion over zero recorded writes proves nothing.
 */
function stubDb() {
  const updateWheres: unknown[] = [];
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn(async () => [{ id: '01HZPROJECT0000000000000001' }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn(async (clause: unknown) => {
          updateWheres.push(clause);
        }),
      }),
    }),
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return updateWheres;
}

const CASES = [
  ['updateProjectFile', () => updateProjectFile(SLUG, FILE, 'new body', CALLER)],
  ['createProjectFile', () => createProjectFile(SLUG, FILE, 'new body', CALLER)],
  ['deleteProjectFile', () => deleteProjectFile(SLUG, FILE, CALLER)],
] as const;

describe('project updated_at re-stamp is owner-scoped (WIC-1676)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe.each(CASES)('%s', (_name, call) => {
    it('scopes the UPDATE to the caller and to the requested slug', async () => {
      const updateWheres = stubDb();

      await call();

      // Positive control. Without it, a change that stopped writing altogether
      // would satisfy every assertion below by never reaching them.
      expect(
        updateWheres.length,
        'no UPDATE on "projects" was recorded — the scoping assertion would pass vacuously'
      ).toBe(1);

      // `idKey: 'slug'` grades the slug half by *column*, so an owner term that
      // replaced the slug term rather than joining it is caught too.
      expectScopedTo(updateWheres[0], {
        table: 'projects',
        userId: CALLER,
        idKey: 'slug',
        ids: [SLUG],
      });
    });
  });

  // The owner-absent path is fail-closed by rejection. When this suite was
  // written the branch skipped the re-stamp silently, because rejecting outright
  // was ADR-010 D1+D2 and had not landed yet; WIC-1554 / PR #210 has since merged
  // to main, so `projectScope` -> `requireOwner` now throws a 400 before any
  // statement is built. Both clauses are asserted below, because the rejection is
  // the weaker guarantee: what must never happen is the slug-only UPDATE, which
  // rewrote every tenant's row precisely when the caller had no identity to
  // scope by.
  describe.each([
    ['updateProjectFile', () => updateProjectFile(SLUG, FILE, 'new body', undefined)],
    ['createProjectFile', () => createProjectFile(SLUG, FILE, 'new body', undefined)],
    ['deleteProjectFile', () => deleteProjectFile(SLUG, FILE, undefined)],
  ] as const)('%s without an owner', (_name, call) => {
    it('writes no UPDATE at all rather than one keyed on slug alone', async () => {
      const updateWheres = stubDb();

      await expect(
        call(),
        'an owner-less caller must be rejected outright (ADR-010 D1, landed via WIC-1554)'
      ).rejects.toThrow(/userId is required/);

      expect(
        updateWheres,
        'an owner-less caller emitted an UPDATE; if it is not owner-scoped it rewrites every tenant holding this slug'
      ).toEqual([]);
    });
  });
});
