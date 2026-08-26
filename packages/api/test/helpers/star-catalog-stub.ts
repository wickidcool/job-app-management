// Shared harness for the WIC-1449 STAR-catalog tenancy tests (UC-6 / UC-7).
//
// The point of this file is that the stub *honours the predicate it is handed*.
// The obvious alternative — a `where` spy that resolves the same fixture whatever
// it is asked — reports green for both the fixed and the broken service, because
// the foreign row comes back either way. WIC-1373 lost a review round to exactly
// that. Here, the rows a read sees are derived from the owner term in its own
// rendered SQL, so deleting the predicate from the service puts the foreign row
// back into the response and turns the assertions red.
//
// A real-Postgres harness would be better still, but `@electric-sql/pglite` is
// only declared on an unmerged branch; depending on it here is how WIC-1433 broke
// CI at import while the local suite was green.
import { vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  applyTenancyPredicate,
  expectScopedTo as expectScopedToShared,
  type ProbeRow,
} from './tenancy.js';

const CATALOG_TABLE = 'quantified_bullets';

const dialect = new PgDialect();

export function render(clause: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(clause as Parameters<PgDialect['sqlToQuery']>[0]);
}

/**
 * The owner a clause actually restricts `quantified_bullets` to, read off the
 * rendered SQL: a user id for `user_id = $n`, `null` for `user_id is null`, and
 * `undefined` when the clause carries no owner term at all — which is what a
 * missing `.where()`, a bare `.where(undefined)`, and a lone `notInArray`/
 * `inArray` all render to. That last case is the whole point: a
 * `toHaveBeenCalled()` check on `where` passes against a `WHERE` that filters
 * nothing, which is precisely what shipped.
 */
export function ownerParamOf(clause: unknown): string | null | undefined {
  if (clause === undefined || clause === null) return undefined;
  const { sql, params } = render(clause);
  const bound = /"quantified_bullets"\."user_id" = \$(\d+)/.exec(sql);
  if (bound) return params[Number(bound[1]) - 1] as string;
  if (/"quantified_bullets"\."user_id" is null/i.test(sql)) return null;
  return undefined;
}

/**
 * The clause restricts `quantified_bullets` to rows this caller owns.
 *
 * WIC-1502: delegates to the shared evaluator (WIC-1491). The body this
 * replaced was the presence form —
 *
 * ```ts
 * expect(sql).toContain('"quantified_bullets"."user_id" = $');
 * expect(params).toContain(userId);
 * ```
 *
 * — which passes identically for `and(idTerm, ownerTerm)` and
 * `or(idTerm, ownerTerm)`, though only the first restricts anything. Measured
 * on bf9a265: an `or`-shaped fix to `fetchStarEntries` fired the D5 trip-wires,
 * and converting them per this file's own protocol gave 8/8 green with a live
 * IDOR. The shared version evaluates the real boolean tree against probe rows,
 * so the `or` shape throws.
 *
 * Pass `ids` whenever the read also constrains by caller-supplied id — the id
 * half is then asserted by column, not merely by presence in `params`.
 */
export function expectScopedTo(clause: unknown, userId: string, ids?: readonly string[]): void {
  expectScopedToShared(clause, { table: CATALOG_TABLE, userId, ids });
}

export interface CatalogRow {
  id: string;
  rawText: string;
  impactCategory: string;
  sourceId: string;
  userId: string | null;
}

export interface RecordedRead {
  table: unknown;
  clause?: unknown;
  limit?: number;
  isCount: boolean;
}

export interface StubOptions {
  /** `quantified_bullets` fixture. Reads of it are filtered by their own owner term. */
  catalog: CatalogRow[];
  /**
   * Fixtures for every other table, as `[table, rows]`. These are returned as
   * given — this harness models catalog tenancy, not the whole query planner —
   * and rows inserted during the run are appended, so a read-back after an
   * insert sees what was written.
   */
  tables?: Array<[unknown, Record<string, unknown>[]]>;
}

export function stubDb({ catalog, tables = [] }: StubOptions) {
  const rowsByTable = new Map<unknown, Record<string, unknown>[]>(
    tables.map(([t, rows]) => [t, [...rows]])
  );
  const reads: RecordedRead[] = [];
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; values: unknown; clause?: unknown }> = [];

  const from = vi.fn();
  const select = vi.fn((selection?: Record<string, unknown>) => {
    const isCount = Object.prototype.hasOwnProperty.call(selection ?? {}, 'count');
    from.mockImplementationOnce((table: unknown) => {
      const read: RecordedRead = { table, isCount };
      reads.push(read);

      const resolve = () => {
        let visible: Record<string, unknown>[];
        if (isCatalogTable(table)) {
          // WIC-1502: filter by the predicate's real boolean structure rather
          // than by an owner id regexed out of the rendered SQL. The previous
          // version read the owner term out and filtered `userId === owner`
          // conjunctively whatever the actual operator was, so `or(id, owner)`
          // and `and(id, owner)` produced the *same* rows here while Postgres
          // returns the foreign row for only one of them. That is what let a
          // leaking fix pass the D5 trip-wires.
          visible = applyTenancyPredicate(
            catalog as unknown as ProbeRow[],
            read.clause,
            CATALOG_TABLE
          ) as Record<string, unknown>[];
        } else {
          visible = rowsByTable.get(table) ?? [];
        }

        const limited = read.limit === undefined ? visible : visible.slice(0, read.limit);
        return read.isCount ? [{ count: limited.length }] : limited;
      };

      const builder: Record<string, unknown> = {
        where: vi.fn((clause: unknown) => {
          read.clause = clause;
          return builder;
        }),
        limit: vi.fn((n: number) => {
          read.limit = n;
          return builder;
        }),
        orderBy: vi.fn(() => builder),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(resolve()).then(res, rej),
      };
      return builder;
    });
    return { from };
  });

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: unknown) => {
      inserts.push({ table, values });
      const written = (Array.isArray(values) ? values : [values]) as Record<string, unknown>[];
      rowsByTable.set(table, [...(rowsByTable.get(table) ?? []), ...written]);
      const settle = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(written).then(res, rej);
      return { returning: () => ({ then: settle }), then: settle };
    }),
  }));

  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn((clause: unknown) => {
        updates.push({ table, values, clause });
        // Write-through, so a `.returning()` caller that treats an empty result
        // as a version conflict sees the row it just wrote. The predicate is
        // recorded but not applied — this harness models catalog tenancy only.
        const existing = rowsByTable.get(table) ?? [];
        const merged = existing.map((row) => ({ ...row, ...(values as object) }));
        if (merged.length > 0) rowsByTable.set(table, merged);
        const settle = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(merged).then(res, rej);
        return { returning: () => ({ then: settle }), then: settle };
      }),
    })),
  }));

  return {
    db: { select, insert, update } as unknown,
    reads,
    inserts,
    updates,
    /** Clauses of the reads issued against `quantified_bullets`, in order. */
    catalogClauses: () => reads.filter((r) => isCatalogTable(r.table)).map((r) => r.clause),
    rowsFor: (table: unknown) => rowsByTable.get(table) ?? [],
  };
}

/**
 * Identified by table name rather than by the shape of the projection: the
 * selected-bullet validation read projects `{ id }` alone, which is
 * indistinguishable from the tech-tag read that sits four lines above it.
 */
function isCatalogTable(table: unknown): boolean {
  try {
    return getTableName(table as Parameters<typeof getTableName>[0]) === CATALOG_TABLE;
  } catch {
    return false;
  }
}

/**
 * A fake Anthropic client whose `messages.create` records the prompt it was sent
 * and replies with `reply(prompt)`. The prompt is where D2/D3 leak first — the
 * foreign `rawText` is pasted into the model input before anything is persisted —
 * so asserting on it catches the leak independently of what the model returns.
 */
export function stubAnthropic(reply: (prompt: string) => string) {
  const prompts: string[] = [];
  const create = vi.fn(async ({ messages }: { messages: Array<{ content: string }> }) => {
    const prompt = messages[0].content;
    prompts.push(prompt);
    return {
      content: [{ type: 'text', text: reply(prompt) }],
      stop_reason: 'end_turn',
    };
  });
  return { prompts, create, client: { messages: { create } } };
}
