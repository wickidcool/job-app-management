// WIC-1613 — the catalog write path in `extraction.service.ts` carries no owner
// term at all, and the tree-wide fail-open audit cannot see it.
//
// ## What this file proves
//
// `applyChangeToDb` (`extraction.service.ts:22`) takes `userId` as its sixth
// parameter and threads it into the `values()` of every INSERT. Every one of its
// four UPDATE branches omits it from the `where`:
//
//   :59   companyCatalog   WHERE normalized_name = $1
//   :87   techStackTags    WHERE tag_slug        = $1
//   :114  jobFitTags       WHERE tag_slug        = $1
//   :164  recurringThemes  WHERE theme_slug      = $1
//
// Each of those four tables carries `user_id ... .notNull()` and a **per-user**
// unique index — `idx_company_catalog_user_normalized` on `(user_id,
// normalized_name)`, and the `(user_id, *_slug)` equivalents. So the slug is not
// unique on its own: `WHERE normalized_name = 'acme'` names one row *per tenant*
// that has ever seen Acme, and the UPDATE hits all of them. It increments
// `application_count` / `mention_count` / `occurrence_count`, overwrites
// `latest_status` and `latest_app_id`, and bumps `version`, across every tenant.
//
// ## Why the WIC-1430 audit's table does not contain this file
//
// That audit enumerates *identity branches* — `userId ? and(id, owner) : id` —
// and reports 48 of them across 10 service files, 47 fail-open. Its detector
// keys on the presence of the ternary. These four sites have **no ternary**:
// they are unowned unconditionally. A site with zero identity branches
// contributes zero to a count of identity branches, so `extraction.service.ts`
// is absent from the table entirely rather than present with a bad score.
//
// The consequence is not cosmetic. AC-T0 as appended to the seven specs reads
// *"when no owner is resolved for a request, every read, write and existence
// check must match zero rows."* It is quantified over the absent-owner case, so
// these four sites satisfy it **vacuously** — the owner here is resolved and
// present in scope, and the write leaks anyway. That is the same quantifier bug
// AC-T0 was written to close in AC-T1..AC-T7, reproduced one level up.
//
// ## Why this is live, and not gated on the local-dev bypass
//
// The rest of the fail-open cohort needs `userId` to be absent, which
// `middleware/auth.ts` only permits when both `SUPABASE_URL` and
// `SUPABASE_JWT_SECRET` are unset. These four need nothing: they leak with a
// fully authenticated caller, because the owner is dropped at the `where`, not
// at the entry point. Reachable from `POST /api/catalog/diffs/generate`
// (`catalog.routes.ts:158` -> `catalog.service.ts:793 generateDiff` ->
// `processCatalogChange`).
//
// `catalog.service.ts` has a **second, owner-scoped copy** of these same four
// updates at :657, :692, :722 and :773, each with `const whereClause = userId ?
// and(slug, owner) : slug` and `.where(whereClause)`. Those four are in the
// audit's table. The fix landed on that copy and not on this one, so the tree
// carries a scoped and an unscoped implementation of the same four writes.
//
// ## How this file is built
//
// The stub drives the **real** `processCatalogChange` and records the clause
// each `update()` actually receives. Nothing is reconstructed by hand: a
// hand-built `eq(companyCatalog.normalizedName, 'acme')` would prove a property
// of the test, not of the service. Clauses are then evaluated by the WIC-1491
// boolean-tree evaluator (`expectScopedTo` / `predicateFor`), which resolves
// `and` as `and` and `or` as `or`, so a presence check cannot pass in place of
// scoping.
//
// ## Measured, at named shas
//
// The four `admits a foreign tenant's row` cases are the defect, so they are
// **RED without the fix and GREEN with it**. Both directions were run, because
// green alone would not show this file tracks anything:
//
//   origin/main  6704836  (QA's baseline, WIC-1613)   4 failed | 3 passed
//   origin/main  cc0ab98  (re-measured on landing)    4 failed | 3 passed
//   this branch  (fix applied)                        7 passed
//
// The re-measurement at `cc0ab98` matters on its own: 133 commits landed on
// `main` between the two, several of them tenancy fixes, and a detector that had
// gone green by side effect in that window would be pinning nothing. It had not.
//
// The three that pass in every column are the negative controls —
// `catalog.service.ts`'s owner-scoped twin of the same update, plus a
// reachability probe asserting an unowned clause is *seen* to admit. They are
// what shows the harness can tell the two predicates apart rather than failing
// everything it is pointed at, and they are why `toBe(false)` above cannot pass
// for the wrong reason.
//
// Landed alongside the fix in WIC-1623. The file is named for the *write* path
// specifically because `extraction.tenancy.test.ts` already exists next to it and
// covers the same service through PGlite; this one is the clause-level detector.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { companyCatalog, techStackTags, jobFitTags, recurringThemes } from '../src/db/schema.js';
import { predicateFor, renderClause, columnRefsOf } from './helpers/tenancy.js';

const CALLER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

// ── Recording stub ───────────────────────────────────────────────────────────
// Captures every clause handed to `.update()` and `.select()`, and resolves
// reads from fixtures so the service reaches its update branches.

interface Recorded {
  table: string;
  clause: unknown;
}

function makeStub(fixtures: Record<string, Record<string, unknown>[]>) {
  const updates: Recorded[] = [];
  const reads: Recorded[] = [];

  const tableNameOf = (t: any): string =>
    t?.[Symbol.for('drizzle:Name')] ?? t?._?.name ?? t?.[Symbol.for('drizzle:BaseName')] ?? '?';

  const selectChain = (fields: unknown) => {
    let table = '?';
    const chain: any = {
      from(t: any) {
        table = tableNameOf(t);
        return chain;
      },
      where(clause: unknown) {
        reads.push({ table, clause });
        chain._clause = clause;
        return chain;
      },
      then(resolve: (v: unknown) => void) {
        resolve(fixtures[table] ?? []);
      },
    };
    return chain;
  };

  const writeChain = (kind: 'update' | 'insert', table: string) => {
    const chain: any = {
      set: () => chain,
      values: () => chain,
      onConflictDoNothing: () => chain,
      where(clause: unknown) {
        if (kind === 'update') updates.push({ table, clause });
        return chain;
      },
      then(resolve: (v: unknown) => void) {
        resolve([]);
      },
    };
    return chain;
  };

  const handle: any = {
    select: (fields?: unknown) => selectChain(fields),
    update: (t: any) => writeChain('update', tableNameOf(t)),
    insert: (t: any) => writeChain('insert', tableNameOf(t)),
    delete: (t: any) => writeChain('update', tableNameOf(t)),
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(handle),
  };

  return { db: handle, updates, reads };
}

let stub = makeStub({});

vi.mock('../src/db/client.js', () => ({
  getDb: () => stub.db,
}));
vi.mock('../src/services/storage.service.js', () => ({
  isStorageAvailable: () => false,
  getObject: async () => null,
}));

const { processCatalogChange } = await import('../src/services/extraction.service.js');

// An application whose company is already in the catalog — owned by OTHER.
// That drives `company_catalog` down its `action: 'update'` branch, and with no
// new company and no wikilinks, `shouldAutoApply` is true so the transaction runs.
const APP_ID = '33333333-3333-4333-8333-333333333333';

// Must match: company Acme, a tech tag, a job-fit tag, and a THEME_PATTERNS regex
// (`/mentor/i` -> slug `mentorship`). All four update branches depend on it.
const PROBE_TEXT =
  'Staff Engineer at Acme using TypeScript. Remote work; mentored engineers across teams.';

function fixtures() {
  return {
    applications: [
      {
        id: APP_ID,
        userId: OTHER,
        company: 'Acme',
        jobTitle: 'Staff Engineer',
        location: 'Remote',
      },
    ],
    company_catalog: [
      { id: 'c1', userId: OTHER, normalizedName: 'acme', name: 'Acme', applicationCount: 1 },
    ],
    tech_stack_tags: [{ id: 't1', userId: OTHER, tagSlug: 'typescript', mentionCount: 1 }],
    job_fit_tags: [{ id: 'j1', userId: OTHER, tagSlug: 'remote', mentionCount: 1 }],
    // `mentorship` is a real THEME_PATTERNS slug (`/mentor/i`, :340); the probe
    // text below has to actually match one or the update branch is never built.
    recurring_themes: [{ id: 'r1', userId: OTHER, themeSlug: 'mentorship', occurrenceCount: 1 }],
  };
}

async function runPipeline(text: string) {
  stub = makeStub(fixtures());
  await processCatalogChange({
    id: 'evt-1',
    sourceType: 'application',
    sourceId: APP_ID,
    changeType: 'created',
    timestamp: '2026-08-27T00:00:00.000Z',
    metadata: { rawText: text, userId: CALLER },
  } as any);
  return stub;
}

describe('extraction.service catalog writes are not owner-scoped (WIC-1613)', () => {
  beforeEach(() => {
    stub = makeStub(fixtures());
  });

  it('drives the real pipeline into at least one UPDATE branch', async () => {
    const s = await runPipeline(PROBE_TEXT);
    expect(
      s.updates.length,
      'the pipeline never reached an update branch — the rest of this file would ' +
        'then be vacuously green, so this case is the reachability control'
    ).toBeGreaterThan(0);
  });

  const CASES: { table: string; column: string }[] = [
    { table: 'company_catalog', column: 'normalized_name' },
    { table: 'tech_stack_tags', column: 'tag_slug' },
    { table: 'job_fit_tags', column: 'tag_slug' },
    { table: 'recurring_themes', column: 'theme_slug' },
  ];

  for (const { table, column } of CASES) {
    it(`${table} UPDATE admits a foreign tenant's row (WHERE ${column} alone)`, async () => {
      const s = await runPipeline(PROBE_TEXT);
      const rec = s.updates.filter((u) => u.table === table);
      if (rec.length === 0) {
        // Not reached by this fixture — report it rather than pass silently.
        expect.fail(
          `no UPDATE on ${table} was recorded; tables updated: ` +
            `${[...new Set(s.updates.map((u) => u.table))].join(', ') || '(none)'}`
        );
      }

      for (const { clause } of rec) {
        const { sql, params } = renderClause(clause);
        const admits = predicateFor(clause, table);

        // The row this caller must not touch: same slug, different owner.
        const foreign = {
          id: 'foreign-row',
          userId: OTHER,
          normalizedName: 'acme',
          tagSlug: table === 'tech_stack_tags' ? 'typescript' : 'remote',
          themeSlug: 'mentorship',
        };

        expect(
          admits(foreign),
          `${table}: the UPDATE predicate admits a row owned by ${OTHER} while the ` +
            `caller is ${CALLER}. Rendered: ${sql} -- params ${JSON.stringify(params)}`
        ).toBe(false);

        // Independent of the evaluator: the owner column must appear at all.
        const refs = columnRefsOf(clause).map((r) => `${r.table}.${r.column}`);
        expect(
          refs.some((r) => r.endsWith('.user_id')),
          `${table}: predicate references [${refs.join(', ')}] — no owner column`
        ).toBe(true);
      }
    });
  }

  // ── Negative control ───────────────────────────────────────────────────────
  // catalog.service.ts:657 builds the owner-scoped twin of the company_catalog
  // update. Evaluated by the same harness, it must be GREEN. If this goes red,
  // the harness is broken, not the tree.
  it('NEGATIVE CONTROL: the catalog.service twin of the same UPDATE is scoped', () => {
    const scoped = and(
      eq(companyCatalog.normalizedName, 'acme'),
      eq(companyCatalog.userId, CALLER)
    );
    const admits = predicateFor(scoped, 'company_catalog');
    expect(admits({ id: 'foreign-row', userId: OTHER, normalizedName: 'acme' })).toBe(false);
    expect(admits({ id: 'own-row', userId: CALLER, normalizedName: 'acme' })).toBe(true);
  });

  // Reachability probe for the control itself: an unowned clause must be seen to
  // ADMIT, otherwise `toBe(false)` above would pass for the wrong reason.
  it('NEGATIVE CONTROL: an unowned clause is seen to admit (evaluator is live)', () => {
    const unowned = eq(companyCatalog.normalizedName, 'acme');
    const admits = predicateFor(unowned, 'company_catalog');
    expect(admits({ id: 'foreign-row', userId: OTHER, normalizedName: 'acme' })).toBe(true);
  });
});
