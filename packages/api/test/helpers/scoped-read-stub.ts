/**
 * A fake `db` that filters by the predicate the service actually built.
 *
 * The stubs this repo has reached for until now resolve a canned row set from
 * `.where()` regardless of the clause they were handed. That is why 12 tenancy
 * predicates could be flipped `and`→`or` with the whole suite green (WIC-1537):
 * the fixture came back either way, so no assertion downstream could tell the
 * scoped service from the leaking one.
 *
 * This one delegates to `applyTenancyPredicate` from `./tenancy.js`, which
 * renders the real drizzle clause and evaluates the parsed boolean tree against
 * each fixture row. `or` therefore admits the foreign row and `and` does not —
 * the difference the service under test is supposed to make.
 *
 * It records every operation so the clause itself can additionally be asserted
 * structurally with `expectScopedTo`. Both halves matter: the behavioural half
 * proves the leak is reachable through the entry point, the structural half
 * proves the predicate is the reason it is not.
 */
import { getTableName } from 'drizzle-orm';
import { applyTenancyPredicate, type ProbeRow } from './tenancy.js';

export type DbOp = 'select' | 'update' | 'delete' | 'insert';

export interface RecordedOp {
  op: DbOp;
  /** Rendered table name, e.g. `interview_preps`. */
  table: string;
  /**
   * The clause the service passed to `.where()`, or `undefined` when it called
   * none at all — which is a real, and much worse, unscoped read, not an
   * absence of data.
   */
  clause: unknown;
  /** The rows this operation resolved, after honest predicate evaluation. */
  rows: ProbeRow[];
}

export interface ScopedReadStub {
  db: unknown;
  ops: RecordedOp[];
  /** Every operation recorded against `table`, in issue order. */
  opsOn(table: string): RecordedOp[];
  /** Every `.where()` clause recorded against `table`, in issue order. */
  clausesOn(table: string): unknown[];
}

/**
 * @param fixtures rows per rendered table name, e.g. `{ interview_preps: [...] }`.
 */
export function scopedReadStub(fixtures: Record<string, ProbeRow[]>): ScopedReadStub {
  const ops: RecordedOp[] = [];

  function chain(op: DbOp) {
    let table = '';
    // No `.where()` is the whole table, not the empty set. Defaulting to `[]`
    // here would make an entirely unscoped read look like a scoped one that
    // simply matched nothing.
    let pending: ProbeRow[] = [];
    let recorded: RecordedOp | undefined;

    const self: Record<string, unknown> = {
      from(t: unknown) {
        table = getTableName(t as Parameters<typeof getTableName>[0]);
        pending = [...(fixtures[table] ?? [])];
        recorded = { op, table, clause: undefined, rows: pending };
        ops.push(recorded);
        return self;
      },
      set() {
        return self;
      },
      values() {
        return self;
      },
      where(clause: unknown) {
        pending = applyTenancyPredicate(pending, clause, table) as ProbeRow[];
        if (recorded) {
          recorded.clause = clause;
          recorded.rows = pending;
        }
        return self;
      },
      limit(n: number) {
        pending = pending.slice(0, n);
        if (recorded) recorded.rows = pending;
        return self;
      },
      offset() {
        return self;
      },
      orderBy() {
        return self;
      },
      groupBy() {
        return self;
      },
      innerJoin() {
        return self;
      },
      leftJoin() {
        return self;
      },
      returning() {
        return self;
      },
      onConflictDoNothing() {
        return self;
      },
      onConflictDoUpdate() {
        return self;
      },
      then(resolve: (v: ProbeRow[]) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(pending).then(resolve, reject);
      },
    };
    return self;
  }

  // `update`/`delete`/`insert` name their table positionally rather than via
  // `.from()`, so route them through the same recorder.
  const withTable = (op: DbOp) => (t: unknown) => {
    const c = chain(op) as Record<string, (t: unknown) => unknown>;
    c.from(t);
    return c;
  };

  const db = {
    select: () => chain('select'),
    update: withTable('update'),
    delete: withTable('delete'),
    insert: withTable('insert'),
  };

  return {
    db,
    ops,
    opsOn: (table: string) => ops.filter((o) => o.table === table),
    clausesOn: (table: string) => ops.filter((o) => o.table === table).map((o) => o.clause),
  };
}
