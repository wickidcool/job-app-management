import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
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
