import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Positive controls for the AC-T0 guard itself (WIC-1672).
 *
 * The guard is what is advertised to hold the tenancy line as *new* sites
 * appear, and a new site has no tests yet -- so the guard's own detection has to
 * be the thing under test. Each case here is a one-line re-spelling of a real
 * pattern; if the guard stops biting on any of them it fails silently in CI,
 * green, forever.
 *
 * Everything runs against a synthetic fixture tree via `--root`, never the real
 * package, so these cases stay stable as the burndown proceeds.
 */

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'audit-owner-predicates.mjs'
);

const SCHEMA = `
import { pgTable, text, uuid, integer, uniqueIndex } from 'drizzle-orm/pg-core';

export const widgets = pgTable(
  'widgets',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    slug: text('slug').notNull(),
    hits: integer('hits').notNull().default(0),
  },
  (t) => ({ userSlugUniq: uniqueIndex('idx_widgets_user_slug').on(t.userId, t.slug) })
);

export const globals = pgTable('globals', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
});
`;

let root: string;

/** Write one service file into the fixture tree and return the guard's findings. */
function audit(source: string): {
  findings: Array<{ file: string; line: number; check: string; detail: string }>;
  stats: {
    ownerTables: number;
    writeSites: number;
    opaquePredicates: string[];
    uniqueScopedWrites: string[];
  };
} {
  writeFileSync(join(root, 'src/services/subject.service.ts'), source);
  const out = execFileSync('node', [SCRIPT, `--root=${root}`, '--json'], { encoding: 'utf8' });
  return JSON.parse(out);
}

const checksAt = (r: ReturnType<typeof audit>, check: string) =>
  r.findings.filter((f) => f.check === check);

const PRELUDE = `import { eq, and } from 'drizzle-orm';
import { widgets, globals } from '../db/schema.js';
declare const db: any;
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ac-t0-guard-'));
  mkdirSync(join(root, 'src/db'), { recursive: true });
  mkdirSync(join(root, 'src/services'), { recursive: true });
  mkdirSync(join(root, 'src/routes'), { recursive: true });
  writeFileSync(join(root, 'src/db/schema.ts'), SCHEMA);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('[NOWNER] owner-absent writes', () => {
  it('reads owner-bearing tables out of the schema', () => {
    const r = audit(`${PRELUDE}\nexport async function noop() {}\n`);
    // `widgets` has user_id; `globals` does not and must stay out of scope.
    expect(r.stats.ownerTables).toBe(1);
  });

  it('fires on an update scoped by a non-unique business key', () => {
    const r = audit(`${PRELUDE}
export async function bump(slug: string, userId: string) {
  await db.update(widgets).set({ hits: 1 }).where(eq(widgets.slug, slug));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
    expect(checksAt(r, 'NOWNER')[0].detail).toContain('non-unique key');
  });

  it('is silent once the owner term is restored', () => {
    const r = audit(`${PRELUDE}
export async function bump(slug: string, userId: string) {
  await db
    .update(widgets)
    .set({ hits: 1 })
    .where(and(eq(widgets.slug, slug), eq(widgets.userId, userId)));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
  });

  it('survives the renames that defeat [COND] and [SIG]', () => {
    // The whole point of keying on the schema column: renaming the parameter
    // hides the site from every name-based check, but not from this one.
    const r = audit(`${PRELUDE}
export async function bump(slug: string, callerId: string) {
  await db.update(widgets).set({ hits: 1 }).where(eq(widgets.slug, slug));
}
`);
    expect(checksAt(r, 'SIG')).toHaveLength(0);
    expect(checksAt(r, 'COND')).toHaveLength(0);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
  });

  it('fires on a write with no where clause at all', () => {
    const r = audit(`${PRELUDE}
export async function wipe() {
  await db.delete(widgets);
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
    expect(checksAt(r, 'NOWNER')[0].detail).toContain('no where clause');
  });

  it('ignores tables with no owner column', () => {
    const r = audit(`${PRELUDE}
export async function bump(id: string) {
  await db.update(globals).set({ label: 'x' }).where(eq(globals.id, id));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
    expect(r.stats.writeSites).toBe(0);
  });

  it('ignores non-drizzle .update()/.delete() calls', () => {
    const r = audit(`${PRELUDE}
import { createHash } from 'node:crypto';
export function digest(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex');
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
  });

  it('counts pk-scoped writes separately instead of gating on them', () => {
    // At most one row, so not cross-tenant by cardinality -- but not silently
    // dropped either, or the guard's denominator lies again.
    const r = audit(`${PRELUDE}
export async function touch(id: string) {
  await db.update(widgets).set({ hits: 1 }).where(eq(widgets.id, id));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
    expect(r.stats.uniqueScopedWrites).toHaveLength(1);
  });

  it('sees through a predicate built in an enclosing scope', () => {
    const r = audit(`${PRELUDE}
export async function bump(slug: string, userId: string) {
  const clause = and(eq(widgets.slug, slug), eq(widgets.userId, userId));
  await db.transaction(async (tx: any) => {
    await tx.update(widgets).set({ hits: 1 }).where(clause);
  });
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
    expect(r.stats.opaquePredicates).toHaveLength(0);
  });

  it('sees through a conditions array assembled by push', () => {
    const r = audit(`${PRELUDE}
export async function bump(slug: string, userId: string) {
  const conditions = [eq(widgets.slug, slug)];
  conditions.push(eq(widgets.userId, userId));
  await db.update(widgets).set({ hits: 1 }).where(and(...conditions));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
  });

  it('counts a predicate it cannot resolve rather than passing it', () => {
    const r = audit(`${PRELUDE}
import { mysteryClause } from '../lib/elsewhere.js';
export async function bump() {
  await db.update(widgets).set({ hits: 1 }).where(and(mysteryClause));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
    expect(r.stats.opaquePredicates).toHaveLength(1);
  });

  it('does not score a value operand as an unresolvable predicate', () => {
    // `eq(widgets.slug, slug)` -- `slug` is a value, not a hidden condition.
    const r = audit(`${PRELUDE}
export async function bump(slug: string) {
  await db.update(widgets).set({ hits: 1 }).where(eq(widgets.slug, slug));
}
`);
    expect(r.stats.opaquePredicates).toHaveLength(0);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
  });
});

/**
 * WIC-2067 -- the ternary fallback, which [NOWNER] was structurally blind to for
 * its whole first life (WIC-1672 Finding 2).
 *
 * `classifyPredicate` used to scan both arms of a conditional into one flat
 * result, so an owner-scoped consequent answered for the entire predicate and
 * the owner-LESS alternate was never weighed. The two writes in the first case
 * below have *identical* absent-owner runtime behaviour -- both match one row
 * per tenant against a composite `(userId, slug)` unique -- yet only the inline
 * one was reported. The severity was inverted: the site that looks scoped, and
 * degrades silently, got the milder grade.
 *
 * The negative controls matter as much as the positive one. This change makes
 * five more ternary fallbacks visible in the real tree, and every one is
 * id-scoped and therefore harmless; if they ever start being *reported*, someone
 * will "fix the flood" by reverting the branch-awareness and take the real
 * finding out with it.
 */
describe('[NOWNER] ternary fallbacks (WIC-2067)', () => {
  it('flags a ternary whose fallback arm drops the owner term', () => {
    // Line 10 is the `catalog.service.ts` applyChange shape; line 15 is the same
    // defect written inline. Both must be reported, and for the same reason.
    const r = audit(`${PRELUDE}
export async function bump(slug: string, userId?: string) {
  await db.transaction(async (tx: any) => {
    const whereClause = userId
      ? and(eq(widgets.slug, slug), eq(widgets.userId, userId))
      : eq(widgets.slug, slug);
    await tx.update(widgets).set({ hits: 1 }).where(whereClause);

    await tx.update(widgets).set({ hits: 1 }).where(eq(widgets.slug, slug));
  });
}
`);
    // Line 10 is the ternary write, line 12 the inline one. The guard anchors on
    // the `await tx.update(...)` call node, so these are the write lines rather
    // than the `const whereClause` line the defect is spelled on.
    const nowner = checksAt(r, 'NOWNER');
    expect(nowner.map((f) => f.line)).toEqual([10, 12]);
    expect(r.stats.uniqueScopedWrites).toHaveLength(0);
  });

  it('flags the same shape written inline at the .where() call', () => {
    // No `const whereClause` hop -- the conditional is the argument itself, so
    // this fails if the fix only expanded top-level identifiers.
    const r = audit(`${PRELUDE}
export async function bump(slug: string, userId?: string) {
  await db
    .update(widgets)
    .set({ hits: 1 })
    .where(userId ? and(eq(widgets.slug, slug), eq(widgets.userId, userId)) : eq(widgets.slug, slug));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
  });

  it('weighs a ternary nested inside a combinator', () => {
    // `and(<always>, <conditional>)`. A top-level-only expansion of the `where`
    // argument sees a call expression, returns it unchanged, and goes blind again.
    const r = audit(`${PRELUDE}
export async function bump(slug: string, userId?: string) {
  await db
    .update(widgets)
    .set({ hits: 1 })
    .where(and(eq(widgets.slug, slug), userId ? eq(widgets.userId, userId) : eq(widgets.slug, slug)));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
  });

  it('does NOT flag an id-scoped fallback -- it stays counted as pk-scoped', () => {
    // NEGATIVE CONTROL. The `userId ? and(id, owner) : id` idiom is everywhere in
    // cover-letter/resume/interviewPrep. Its fallback matches at most one row, so
    // it cannot fan out across tenants and must not be reported -- but it must
    // still be COUNTED, or the guard's denominator lies.
    const r = audit(`${PRELUDE}
export async function touch(id: string, userId?: string) {
  const whereClause = userId
    ? and(eq(widgets.id, id), eq(widgets.userId, userId))
    : eq(widgets.id, id);
  await db.update(widgets).set({ hits: 1 }).where(whereClause);
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
    expect(r.stats.uniqueScopedWrites).toHaveLength(1);
  });

  it('keeps the fail-closed owner ternary clean', () => {
    // `userId ? eq(t.userId, userId) : isNull(t.userId)` is the ADR-010 target
    // posture, not a defect: BOTH arms carry the owner term. Branch-awareness
    // must not turn the prescribed fix into a finding (the WIC-1853 inversion).
    const r = audit(`import { eq, and, isNull } from 'drizzle-orm';
import { widgets, globals } from '../db/schema.js';
declare const db: any;
export async function bump(userId?: string) {
  const whereClause = userId ? eq(widgets.userId, userId) : isNull(widgets.userId);
  await db.update(widgets).set({ hits: 1 }).where(whereClause);
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
    expect(r.stats.uniqueScopedWrites).toHaveLength(0);
  });

  it('is not fooled when the owner arm also touches a unique column', () => {
    // The masking hazard in a `some(unique)` formulation: the consequent's
    // `eq(widgets.id, id)` sets `unique` for the whole predicate, so the site
    // files under pk-scoped and the non-unique slug fallback -- which DOES fan
    // out across tenants -- disappears from the report. `unique` has to be the
    // intersection across arms, not the union.
    const r = audit(`${PRELUDE}
export async function bump(id: string, slug: string, userId?: string) {
  const whereClause = userId
    ? and(eq(widgets.id, id), eq(widgets.userId, userId))
    : eq(widgets.slug, slug);
  await db.update(widgets).set({ hits: 1 }).where(whereClause);
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
    expect(r.stats.uniqueScopedWrites).toHaveLength(0);
  });

  it('treats an unreadable arm as unreadable, not as clean', () => {
    const r = audit(`${PRELUDE}
import { mysteryClause } from '../lib/elsewhere.js';
export async function bump(userId?: string) {
  const whereClause = userId ? eq(widgets.userId, userId) : and(mysteryClause);
  await db.update(widgets).set({ hits: 1 }).where(whereClause);
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
    expect(r.stats.opaquePredicates).toHaveLength(1);
  });
});

/**
 * The same defect as the ternary, in the two other spellings `PREDICATE_COMBINATORS`
 * admits (WIC-2069). `and` narrows, so one conjunct carrying the owner term proves
 * scoping; `or` widens and `not` inverts, and until this landed the flat scan let
 * their owner term answer for the whole predicate anyway.
 *
 * Live exposure when these were written was ZERO -- no write predicate in the tree
 * used either shape -- so every case below is a synthetic fixture and nothing here
 * is evidence about the real tree. That is the point: these exist so the ADR-010 D2
 * predicate rewrite cannot introduce the shape silently. The controls that matter
 * are the negative ones: an over-eager fix that reported any `or`/`not` outright
 * would pass the first two cases and fail the rest.
 */
describe('[NOWNER] combinators quantify differently (WIC-2069)', () => {
  const OPS = `import { eq, and, or, not } from 'drizzle-orm';
import { widgets, globals } from '../db/schema.js';
declare const db: any;`;

  it('flags or() whose other disjunct drops the owner term', () => {
    // M-C. `or(owner, slug)` matches every tenant's row whose slug matches. The
    // owner term is present and not load-bearing -- exactly the ternary shape.
    const r = audit(`${OPS}
export async function bump(slug: string, userId: string) {
  await db
    .update(widgets)
    .set({ hits: 1 })
    .where(or(eq(widgets.userId, userId), eq(widgets.slug, slug)));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
    expect(r.stats.uniqueScopedWrites).toHaveLength(0);
  });

  it('flags an owner term that survives only under not()', () => {
    // M-D. This writes to every tenant EXCEPT the caller -- strictly worse than
    // dropping the term, and it scored CLEAN off the same `widgets.userId`.
    const r = audit(`${OPS}
export async function bump(slug: string, userId: string) {
  await db
    .update(widgets)
    .set({ hits: 1 })
    .where(and(eq(widgets.slug, slug), not(eq(widgets.userId, userId))));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
  });

  it('flags a bare not() on a unique column instead of counting it pk-scoped', () => {
    // The masking hazard on the `unique` side: `eq(widgets.id, id)` alone is one
    // row, so it files under pk-scoped and is never reported. Its COMPLEMENT is
    // every row but that one. If `not` passed `unique` through, this whole class
    // would leave the report through the stats door.
    const r = audit(`${OPS}
export async function bump(id: string) {
  await db.update(widgets).set({ hits: 1 }).where(not(eq(widgets.id, id)));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
    expect(r.stats.uniqueScopedWrites).toHaveLength(0);
  });

  it('flags a disjunction of unique keys with one non-unique arm', () => {
    // `unique` under `or` is the intersection for the same reason it is across
    // ternary arms: the slug disjunct fans out across tenants on its own.
    const r = audit(`${OPS}
export async function bump(id: string, slug: string) {
  await db.update(widgets).set({ hits: 1 }).where(or(eq(widgets.id, id), eq(widgets.slug, slug)));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
    expect(r.stats.uniqueScopedWrites).toHaveLength(0);
  });

  it('weighs an or() nested inside an and()', () => {
    // A top-level-only expansion of the `where` argument sees `and(...)`, keeps
    // the `some` quantifier, and goes blind again -- the WIC-2067 lesson.
    const r = audit(`${OPS}
export async function bump(slug: string, userId: string) {
  await db
    .update(widgets)
    .set({ hits: 1 })
    .where(and(eq(widgets.slug, slug), or(eq(widgets.userId, userId), eq(widgets.slug, slug))));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(1);
  });

  it('does NOT flag and(), where one owner conjunct still proves scoping', () => {
    // NEGATIVE CONTROL, and the one that guards the whole tree: this is the shape
    // of nearly every clean write predicate in `packages/api`. `and` keeps `some`.
    const r = audit(`${OPS}
export async function bump(slug: string, userId: string) {
  await db
    .update(widgets)
    .set({ hits: 1 })
    .where(and(eq(widgets.slug, slug), eq(widgets.userId, userId)));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
  });

  it('does NOT flag an or() whose every disjunct carries the owner term', () => {
    // NEGATIVE CONTROL. A disjunction is owner-scoped when it is owner-scoped on
    // both sides; reporting `or` outright would be a rule keyed on the spelling
    // rather than on the hazard.
    const r = audit(`${OPS}
export async function bump(slug: string, userId: string) {
  await db
    .update(widgets)
    .set({ hits: 1 })
    .where(or(eq(widgets.userId, userId), and(eq(widgets.userId, userId), eq(widgets.slug, slug))));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
  });

  it('does NOT flag a not() sitting beside a real owner conjunct', () => {
    // NEGATIVE CONTROL. `not` contributes nothing; it must not subtract either.
    // `and(owner, not(slug))` is a legitimate exclusion inside the caller's rows.
    const r = audit(`${OPS}
export async function bump(slug: string, userId: string) {
  await db
    .update(widgets)
    .set({ hits: 1 })
    .where(and(eq(widgets.userId, userId), not(eq(widgets.slug, slug))));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
  });

  it('treats an unreadable disjunct as unreadable, not as clean', () => {
    // `opaque` is the union under every combinator: one unreadable operand makes
    // the predicate unreadable, so it is counted rather than reported or dropped.
    const r = audit(`${OPS}
import { mysteryClause } from '../lib/elsewhere.js';
export async function bump(userId: string) {
  await db.update(widgets).set({ hits: 1 }).where(or(eq(widgets.userId, userId), mysteryClause));
}
`);
    expect(checksAt(r, 'NOWNER')).toHaveLength(0);
    expect(r.stats.opaquePredicates).toHaveLength(1);
  });
});

describe('[COND] fail-open owner branches', () => {
  it('flags a bare owner ternary', () => {
    const r = audit(`${PRELUDE}
export function build(userId?: string) {
  return userId ? eq(widgets.userId, userId) : undefined;
}
`);
    expect(checksAt(r, 'COND')).toHaveLength(1);
  });

  it('flags the null-comparison re-spelling of that ternary', () => {
    // `userId != null ? ... : ...` is a BinaryExpression, and used to be silent.
    const r = audit(`${PRELUDE}
export function build(userId?: string) {
  return userId != null ? eq(widgets.userId, userId) : undefined;
}
`);
    expect(checksAt(r, 'COND')).toHaveLength(1);
  });

  it('does NOT flag a fail-closed early exit on an absent owner', () => {
    // This is the posture ADR-010 asks for. Counting it as a violation would
    // invert the burndown metric -- the fix would read as the defect.
    const r = audit(`${PRELUDE}
export async function bump(userId?: string) {
  if (!userId) throw new Error('Authentication required');
  await db.update(widgets).set({ hits: 1 }).where(eq(widgets.userId, userId));
}
`);
    expect(checksAt(r, 'COND')).toHaveLength(0);
  });

  it('still flags a negated owner test that falls through', () => {
    const r = audit(`${PRELUDE}
export function build(userId?: string) {
  const conditions = [];
  if (!userId) {
    conditions.push(eq(widgets.slug, 'x'));
  }
  return conditions;
}
`);
    expect(checksAt(r, 'COND')).toHaveLength(1);
  });

  it('reports a site reachable by two rules exactly once', () => {
    const r = audit(`${PRELUDE}
export function build(userId?: string, other?: string) {
  return userId && other ? eq(widgets.userId, userId) : undefined;
}
`);
    expect(checksAt(r, 'COND')).toHaveLength(1);
  });
});

describe('[SIG] owner absence representable in the signature', () => {
  it('flags an optional owner parameter', () => {
    const r = audit(`${PRELUDE}
export async function bump(userId?: string) {
  return userId;
}
`);
    expect(checksAt(r, 'SIG')).toHaveLength(1);
  });

  it('flags an owner hidden behind a local type alias', () => {
    // `userId: MaybeOwner` is a TypeReference, and used to be silent.
    const r = audit(`${PRELUDE}
type MaybeOwner = string | undefined;
export async function bump(userId: MaybeOwner) {
  return userId;
}
`);
    expect(checksAt(r, 'SIG')).toHaveLength(1);
  });

  it('flags a destructured optional owner', () => {
    const r = audit(`${PRELUDE}
export async function bump({ userId }: { userId?: string }) {
  return userId;
}
`);
    expect(checksAt(r, 'SIG')).toHaveLength(1);
  });

  it('is silent on a required owner', () => {
    const r = audit(`${PRELUDE}
export async function bump(userId: string) {
  return userId;
}
`);
    expect(checksAt(r, 'SIG')).toHaveLength(0);
  });
});

/**
 * [LAUNDER] — the route-layer choke point (ADR-010 D1.3, WIC-1600).
 *
 * These cases matter more than their size suggests, because [LAUNDER] is the one
 * check with no compiler backstop behind it. `tsc` accepts
 * `c.get('userId') ?? undefined` even with `HonoVariables.userId` narrowed to
 * `string` — a redundant `??` is legal, not an error — so if this check stops
 * biting, the 66-site burndown silently reopens with nothing else to catch it.
 *
 * Writes a *route* fixture rather than a service one, and removes it afterwards
 * so the file cannot leak findings into the service-scoped counts above.
 */
describe('[LAUNDER] route-layer owner laundering', () => {
  const ROUTE = 'src/routes/subject.routes.ts';

  /** Write one route file into the fixture tree and return the guard's findings. */
  function auditRoute(source: string) {
    writeFileSync(join(root, ROUTE), source);
    try {
      return JSON.parse(
        execFileSync('node', [SCRIPT, `--root=${root}`, '--json'], { encoding: 'utf8' })
      ) as ReturnType<typeof audit>;
    } finally {
      rmSync(join(root, ROUTE), { force: true });
    }
  }

  const HANDLER = `declare const c: any;\ndeclare function serve(owner?: string): void;\n`;

  it('fires on the exact shape the burndown deleted', () => {
    const r = auditRoute(
      `${HANDLER}\nexport const h = () => serve(c.get('userId') ?? undefined);\n`
    );
    expect(checksAt(r, 'LAUNDER')).toHaveLength(1);
    expect(checksAt(r, 'LAUNDER')[0].detail).toContain('requireOwner(c)');
  });

  // Any fallback restores a representable absence, which is the precondition
  // [SIG] measures downstream — so the check keys on the fallback, not on the
  // literal `undefined` that happened to be used at all 66 original sites.
  it.each([
    ['?? null', `serve(c.get('userId') ?? null)`],
    ["|| ''", `serve(c.get('userId') || '')`],
    ['?? a default', `serve(c.get('userId') ?? 'anonymous')`],
  ])('fires on a %s fallback too', (_label, expr) => {
    const r = auditRoute(`${HANDLER}\nexport const h = () => ${expr};\n`);
    expect(checksAt(r, 'LAUNDER')).toHaveLength(1);
  });

  it('is silent on requireOwner, the target posture', () => {
    const r = auditRoute(
      `${HANDLER}\ndeclare function requireOwner(c: any): string;\n` +
        `export const h = () => serve(requireOwner(c));\n`
    );
    expect(checksAt(r, 'LAUNDER')).toHaveLength(0);
  });

  // `requireOwner` reads the context bare and throws; a bare read is not a
  // laundering and must not be flagged, or the helper would report itself.
  it('is silent on a bare context read with no fallback', () => {
    const r = auditRoute(`${HANDLER}\nexport const h = () => serve(c.get('userId'));\n`);
    expect(checksAt(r, 'LAUNDER')).toHaveLength(0);
  });

  it('ignores a fallback on a non-owner context key', () => {
    const r = auditRoute(
      `${HANDLER}\nexport const h = () => serve(c.get('requestId') ?? undefined);\n`
    );
    expect(checksAt(r, 'LAUNDER')).toHaveLength(0);
  });
});

/**
 * The ungated population is pinned for growth (WIC-2300).
 *
 * The guard's `unique/pk-scoped` bucket is out of scope by design, and that is
 * not what these cases test. They test that the bucket cannot GROW unnoticed —
 * because a write only ever lands in it by *failing* to resolve to an owner
 * term, so growth means the audit stopped seeing something it used to see.
 *
 * The mechanism is reproduced in miniature: the same `ownerScope` helper, once
 * defined in the file that uses it and once imported. On `origin/main` dc333a0b
 * that edit moved two DELETE paths and one UPDATE out of the gated set while
 * `findings` stayed at 24 and the guard exited 0 — so the exit code is the thing
 * under test here, not the finding list.
 */
describe('ungated-population pin', () => {
  let root: string;

  const SCHEMA_MIN = `
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
export const widgets = pgTable('widgets', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull(),
});
`;

  /** The owner term resolvable inside the file — what `main` actually does. */
  const IN_FILE = `import { eq, and, isNull } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { widgets } from '../db/schema.js';
declare const db: any;

function ownerScope<T extends { userId: PgColumn }>(table: T, userId?: string) {
  return userId ? eq(table.userId, userId) : isNull(table.userId);
}

export async function removeWidget(id: string, userId: string) {
  await db.delete(widgets).where(and(eq(widgets.id, id), ownerScope(widgets, userId)));
}
`;

  /** Byte-identical call sites; the helper now lives in `lib/`. The mutant. */
  const IMPORTED = `import { eq, and } from 'drizzle-orm';
import { widgets } from '../db/schema.js';
import { ownerScope } from '../lib/owner-scope.js';
declare const db: any;

export async function removeWidget(id: string, userId: string) {
  await db.delete(widgets).where(and(eq(widgets.id, id), ownerScope(widgets, userId)));
}
`;

  const write = (source: string) =>
    writeFileSync(join(root, 'src/services/subject.service.ts'), source);

  /** Run the guard for its EXIT CODE — the `--json` path exits before the gate. */
  function gate(): { status: number; stderr: string; stdout: string } {
    const r = spawnSync('node', [SCRIPT, `--root=${root}`], { encoding: 'utf8' });
    return { status: r.status ?? -1, stderr: r.stderr, stdout: r.stdout };
  }

  const acceptCurrentAsBaseline = () =>
    spawnSync('node', [SCRIPT, `--root=${root}`, '--write-baseline'], { encoding: 'utf8' });

  const ungatedOf = (source: string) => {
    write(source);
    const out = spawnSync('node', [SCRIPT, `--root=${root}`, '--json'], { encoding: 'utf8' });
    return JSON.parse(out.stdout).stats.ungated as Array<Record<string, string>>;
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ac-t0-ungated-'));
    mkdirSync(join(root, 'src/db'), { recursive: true });
    mkdirSync(join(root, 'src/services'), { recursive: true });
    mkdirSync(join(root, 'src/routes'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'src/db/schema.ts'), SCHEMA_MIN);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // The mechanism, isolated. If this pair ever stops differing, every gate case
  // below goes vacuous while still passing — so assert the delta, not just the
  // exit code.
  it('reclassifies an owner-scoped write into the ungated bucket when the helper is imported', () => {
    expect(ungatedOf(IN_FILE)).toEqual([]);
    expect(ungatedOf(IMPORTED)).toEqual([
      {
        file: 'src/services/subject.service.ts',
        bucket: 'unique',
        verb: 'delete',
        table: 'widgets',
      },
    ]);
  });

  it('fails when the extraction moves a write out of the gated set', () => {
    write(IN_FILE);
    acceptCurrentAsBaseline();
    expect(gate().status).toBe(0);

    write(IMPORTED);
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('MOVED OUT of the gated set');
    expect(r.stderr).toContain("delete 'widgets'");
    // The failure must not be misread as a new fail-open branch: the AC-T0
    // finding list is unchanged, and the message has to say so.
    expect(r.stderr).toContain('failed on the ungated population');
  });

  // The real WIC-2300 delta included a key going 1 -> 2. A set-valued pin sees
  // that key as already present and stays green, so the counting is the check.
  it('fails on a COUNT increase for a key already in the baseline', () => {
    write(IMPORTED);
    acceptCurrentAsBaseline();
    expect(gate().status).toBe(0);

    write(`${IMPORTED}
export async function removeWidgetAgain(id: string, userId: string) {
  await db.delete(widgets).where(and(eq(widgets.id, id), ownerScope(widgets, userId)));
}
`);
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('(1 -> 2)');
  });

  // Shrinkage means the guard can see a write it previously could not. That is
  // the burndown direction and must never fail, or nobody will run it.
  it('stays green when the ungated population shrinks', () => {
    write(IMPORTED);
    acceptCurrentAsBaseline();
    write(IN_FILE);
    const r = gate();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('newly visible to the guard');
  });

  // Deleting the pin is the cheapest way to disarm this check, and an absent
  // file must not read as an empty population.
  it('fails when the ungated baseline is missing rather than passing silently', () => {
    write(IMPORTED);
    acceptCurrentAsBaseline();
    expect(gate().status).toBe(0);

    rmSync(join(root, 'scripts/owner-predicates.ungated.baseline.json'));
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ungated-population baseline is MISSING');
  });
});

// ---------------------------------------------------------------------------
// [UNRESOLVED] -- the escape the ungated pin above structurally cannot see
// (WIC-2304). That pin fails when a write MOVES OUT of the gated set. This one
// fails when a write never entered EITHER set, because `tableNameOf` resolved
// its table to a helper's parameter name instead of a schema table.
//
// The two directions are NOT the same test and neither implies the other:
//
//   ADDITION   -- a new ungated write in parameter shape. writeSites 1 -> 1,
//                 ungated unchanged, so the pin is byte-identical to clean.
//   CONVERSION -- an existing counted write rewritten into parameter shape.
//                 writeSites 1 -> 0. The pin SEES this and deliberately does
//                 not fail on it, because shrinkage is the burndown direction.
//
// Both exited 0 before this gate. Assert both, and assert the counters, so a
// future change that makes one of them merely *reported* fails here.
// ---------------------------------------------------------------------------
describe('[UNRESOLVED] writes whose table does not resolve to a schema table', () => {
  let root: string;

  const SCHEMA_MIN = `
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
export const widgets = pgTable('widgets', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull(),
});
export const globals = pgTable('globals', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
});
`;

  const HEAD = `import { eq, and } from 'drizzle-orm';
import { widgets, globals } from '../db/schema.js';
declare const db: any;
`;

  /** One ordinary owner-scoped write, so the tree is non-empty and green. */
  const CLEAN = `${HEAD}
export async function removeWidget(id: string, userId: string) {
  await db.delete(widgets).where(and(eq(widgets.id, id), eq(widgets.userId, userId)));
}
`;

  const write = (source: string) =>
    writeFileSync(join(root, 'src/services/subject.service.ts'), source);

  function gate(): { status: number; stderr: string; stdout: string } {
    const r = spawnSync('node', [SCRIPT, `--root=${root}`], { encoding: 'utf8' });
    return { status: r.status ?? -1, stderr: r.stderr, stdout: r.stdout };
  }

  const acceptCurrentAsBaseline = () =>
    spawnSync('node', [SCRIPT, `--root=${root}`, '--write-baseline'], { encoding: 'utf8' });

  const statsOf = (source: string) => {
    write(source);
    const out = spawnSync('node', [SCRIPT, `--root=${root}`, '--json'], { encoding: 'utf8' });
    return JSON.parse(out.stdout).stats as {
      writeSites: number;
      ungated: Array<Record<string, string>>;
      unresolvedWriteTables: Array<Record<string, string | number>>;
    };
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ac-t0-unresolved-'));
    mkdirSync(join(root, 'src/db'), { recursive: true });
    mkdirSync(join(root, 'src/services'), { recursive: true });
    mkdirSync(join(root, 'src/routes'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'src/db/schema.ts'), SCHEMA_MIN);
    write(CLEAN);
    acceptCurrentAsBaseline();
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is empty on a clean tree, so the gate starts armed at zero', () => {
    const s = statsOf(CLEAN);
    expect(s.unresolvedWriteTables).toEqual([]);
    expect(gate().status).toBe(0);
  });

  // ADDITION. The counters the two existing pins read are byte-identical to
  // CLEAN, which is exactly why this escaped before -- assert that explicitly,
  // or the test passes for the wrong reason if the classification ever moves.
  it('fails on a NEW ungated write whose table is a helper parameter', () => {
    const clean = statsOf(CLEAN);
    const s = statsOf(`${CLEAN}
export async function touch(tbl: any, id: string) {
  await db.update(tbl).set({ label: 'x' }).where(eq(tbl.id, id));
}
`);
    expect(s.writeSites).toBe(clean.writeSites);
    expect(s.ungated).toEqual(clean.ungated);
    expect(s.unresolvedWriteTables).toHaveLength(1);

    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('could not be resolved to any table in the schema');
    expect(r.stderr).toContain("update 'tbl'");
  });

  // CONVERSION. The mirror image: the ungated pin does see the write leave, and
  // deliberately reports rather than fails. Without this gate that is an exit 0.
  it('fails when an EXISTING counted write is rewritten into parameter shape', () => {
    const clean = statsOf(CLEAN);
    const s = statsOf(`${HEAD}
export async function removeWidget(id: string, userId: string) {
  const tbl = widgets;
  await db.delete(tbl).where(and(eq(tbl.id, id), eq(tbl.userId, userId)));
}
`);
    expect(s.writeSites).toBe(clean.writeSites - 1);
    expect(s.unresolvedWriteTables).toHaveLength(1);
    expect(gate().status).toBe(1);
  });

  // Negative controls. The gate is at zero with no baseline to absorb a false
  // positive, so noise here is not a nuisance -- it is a permanently red main.
  // These are the four real shapes that tripped the first draft on `baca0685`:
  // Map.delete, R2Bucket.delete (scalar and array), createHash().update.
  it('ignores non-drizzle .update/.delete calls', () => {
    const s = statsOf(`${CLEAN}
import { createHash } from 'node:crypto';
declare const r2: { delete(k: string | string[]): Promise<void> };

export function evict(buckets: Map<string, number>, key: string) {
  buckets.delete(key);
}
export function hash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
export async function removeObject(key: string, keys: string[]) {
  await r2.delete(key);
  await r2.delete(keys.slice(0, 100));
}
`);
    expect(s.unresolvedWriteTables).toEqual([]);
    expect(gate().status).toBe(0);
  });

  // A write against a real table that simply has no owner column is a decision
  // the guard is entitled to make, and must stay silent -- this is the whole
  // reason the check tests membership in ALL_TABLES rather than OWNER_TABLES.
  it('ignores a write against a declared but owner-free table', () => {
    const s = statsOf(`${CLEAN}
export async function relabel(id: string) {
  await db.update(globals).set({ label: 'x' }).where(eq(globals.id, id));
}
`);
    expect(s.unresolvedWriteTables).toEqual([]);
    expect(gate().status).toBe(0);
  });

  // The receiver list cannot enumerate every name a db handle might take, so
  // the chain shape has to carry it alone. Kill the receiver signal and the
  // site must still be caught.
  it('catches a parameter-shaped write through a differently-named handle', () => {
    const s = statsOf(`${CLEAN}
declare const database: any;
export async function touch(tbl: any, id: string) {
  await database.update(tbl).set({ label: 'x' }).where(eq(tbl.id, id));
}
`);
    expect(s.unresolvedWriteTables).toHaveLength(1);
    expect(gate().status).toBe(1);
  });

  // ...and symmetrically, a chainless write has no shape to match, so the
  // receiver signal has to carry that one. Neither signal alone is sufficient.
  it('catches a chainless parameter-shaped write via the receiver', () => {
    const s = statsOf(`${CLEAN}
export async function wipe(tbl: any) {
  await db.delete(tbl);
}
`);
    expect(s.unresolvedWriteTables).toHaveLength(1);
    expect(gate().status).toBe(1);
  });

  it('names the unresolved gate in the failure summary, not the ungated pin', () => {
    write(`${CLEAN}
export async function touch(tbl: any, id: string) {
  await db.update(tbl).set({ label: 'x' }).where(eq(tbl.id, id));
}
`);
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('failed on an unresolvable write table');
    expect(r.stderr).not.toContain('failed on the ungated population');
  });
});
