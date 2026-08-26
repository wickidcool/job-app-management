/**
 * Shared tenancy-assertion harness for the API test suite (WIC-1491).
 *
 * ## Why this file exists
 *
 * Every tenancy test in this repo has, independently, re-derived the same
 * assertion and re-derived it *weak*:
 *
 * ```ts
 * expect(sql).toContain('"quantified_bullets"."user_id" = $');
 * expect(params).toContain(userId);
 * ```
 *
 * That is a **presence** check, and presence is not scoping. It cannot tell
 * `and(idTerm, ownerTerm)` from `or(idTerm, ownerTerm)` — both render the owner
 * term, both bind the caller id — yet under `OR` Postgres returns the union and
 * the caller reads every row in the table. The suite stays green through the
 * exact leak it was written to prevent. This shipped three times in nine hours
 * (WIC-1378, WIC-1449, WIC-1437) because the hardened version lived only inside
 * whichever PR happened to fix it, and `packages/api/test/` had nowhere to put a
 * shared one.
 *
 * A second, subtler variant is just as blind: deciding each constraint with its
 * own independent regex and then applying them conjunctively. The conjunction is
 * the test's assumption, not the query's structure, so `or` again reads green.
 *
 * ## What this file does instead
 *
 * It answers the question the assertion is actually for:
 *
 * > **Is there any row this predicate admits that the caller does not own?**
 *
 * `expectScopedTo` renders the real drizzle clause, parses the rendered SQL into
 * a boolean tree, and evaluates that tree against probe rows. `and` and `or` are
 * evaluated as `and` and `or`, so flipping one to the other admits the foreign
 * probe row and the assertion goes red. `applyTenancyPredicate` runs the same
 * evaluator over fixture rows, so a fake `db` can filter honestly instead of
 * resolving a canned row set regardless of the predicate it was handed.
 *
 * ## Fail-closed by construction
 *
 * Operators this parser does not model (`ilike`, ranges, `exists`, …) and columns
 * belonging to another table evaluate to **true** — the most permissive value.
 * That is deliberate and it is the safe direction: an unmodelled term can only
 * ever make the predicate look *more* leaky, never less, so `expectScopedTo`
 * cannot be talked into passing by an operator it failed to understand. It also
 * means a term on the wrong table is invisible as a constraint, which is what
 * makes `expectScopedTo` catch the wrong-table predicate that table-qualified
 * substring matching misses.
 *
 * The `and`→`or` mutation is a standing check in `tenancy.helper.test.ts`. If
 * this evaluator is ever weakened back into a presence check, that file is what
 * goes red.
 */
import { expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();

/** A row as the fake dbs hold it: camelCase keys, arbitrary extra columns. */
export type ProbeRow = Record<string, unknown>;

export interface RenderedClause {
  sql: string;
  params: unknown[];
}

/**
 * Render a drizzle predicate to SQL text plus bound parameters.
 *
 * `undefined` is what a missing `.where()` and a bare `.where(undefined)` both
 * amount to, and what `and()` collapses to when every argument is `undefined` —
 * so it is a real value here, not a caller mistake, and it renders to the empty
 * predicate that matches everything.
 */
export function renderClause(clause: unknown): RenderedClause {
  if (clause === undefined || clause === null) return { sql: '', params: [] };
  const { sql, params } = dialect.sqlToQuery(clause as Parameters<PgDialect['sqlToQuery']>[0]);
  return { sql, params: [...params] };
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

type Token =
  | { t: 'ident'; v: string } // "quantified_bullets"
  | { t: 'word'; v: string } // and / or / not / is / null / in / …
  | { t: 'param'; v: number } // $1 → index 1
  | { t: 'string'; v: string } // 'literal'
  | { t: 'punct'; v: string }; // ( ) , . = <> != …

const OPERATOR_CHARS = new Set(['=', '<', '>', '!', '~', '+', '-', '*', '/', '%', '|', '@', '#']);

function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === '"') {
      // Postgres doubles an embedded quote; drizzle never emits one, but the
      // loop costs nothing and stops a stray `""` from desynchronising the rest.
      let j = i + 1;
      let v = '';
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          v += '"';
          j += 2;
        } else if (sql[j] === '"') {
          break;
        } else {
          v += sql[j];
          j += 1;
        }
      }
      out.push({ t: 'ident', v });
      i = j + 1;
    } else if (c === "'") {
      let j = i + 1;
      let v = '';
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          v += "'";
          j += 2;
        } else if (sql[j] === "'") {
          break;
        } else {
          v += sql[j];
          j += 1;
        }
      }
      out.push({ t: 'string', v });
      i = j + 1;
    } else if (c === '$' && /\d/.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (j < sql.length && /\d/.test(sql[j])) j += 1;
      out.push({ t: 'param', v: Number(sql.slice(i + 1, j)) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
      out.push({ t: 'word', v: sql.slice(i, j).toLowerCase() });
      i = j;
    } else if (/\d/.test(c)) {
      let j = i;
      while (j < sql.length && /[\d.]/.test(sql[j])) j += 1;
      out.push({ t: 'string', v: sql.slice(i, j) });
      i = j;
    } else if (OPERATOR_CHARS.has(c)) {
      let j = i;
      while (j < sql.length && OPERATOR_CHARS.has(sql[j])) j += 1;
      out.push({ t: 'punct', v: sql.slice(i, j) });
      i = j;
    } else {
      out.push({ t: 'punct', v: c });
      i += 1;
    }
  }
  return out;
}

// ── Parser ───────────────────────────────────────────────────────────────────

export interface ColumnRef {
  table: string | null;
  column: string;
}

type Node =
  | { kind: 'and'; children: Node[] }
  | { kind: 'or'; children: Node[] }
  | { kind: 'not'; child: Node }
  | { kind: 'cmp'; column: ColumnRef | null; op: Op; values: unknown[] }
  | { kind: 'opaque' };

/**
 * Every operator `interpret` can put on a `cmp` node. An operator outside this
 * set never becomes a `cmp` at all — it parses to `{ kind: 'opaque' }`, which
 * `evaluate` admits. Keeping `'opaque'` out of this union is deliberate: it
 * makes the operator switch in `evaluate` exhaustive by type, so there is no
 * unreachable `default:` arm that a mutation could silently flip fail-open and
 * that no test could ever pin.
 */
type Op = '=' | '<>' | 'is null' | 'is not null' | 'in' | 'not in';

const isWord = (tk: Token | undefined, v: string): boolean =>
  tk !== undefined && tk.t === 'word' && tk.v === v;
const isPunct = (tk: Token | undefined, v: string): boolean =>
  tk !== undefined && tk.t === 'punct' && tk.v === v;

/**
 * Recursive descent over the fragment of SQL drizzle actually emits for a
 * `where`. Anything outside that fragment degrades to an `opaque` node rather
 * than throwing — a predicate this parser cannot read must not take the whole
 * suite down, and `opaque` is already the permissive value, so the degradation
 * is fail-closed for the assertions built on top.
 */
function parse(tokens: Token[], params: unknown[]): Node {
  let pos = 0;

  const parseOr = (): Node => {
    const children: Node[] = [parseAnd()];
    while (isWord(tokens[pos], 'or')) {
      pos += 1;
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  };

  const parseAnd = (): Node => {
    const children: Node[] = [parseUnary()];
    while (isWord(tokens[pos], 'and')) {
      pos += 1;
      children.push(parseUnary());
    }
    return children.length === 1 ? children[0] : { kind: 'and', children };
  };

  const parseUnary = (): Node => {
    // `not "t"."c" = $1` — but not `not in`, which belongs to the comparison.
    if (isWord(tokens[pos], 'not') && !isWord(tokens[pos + 1], 'in')) {
      pos += 1;
      return { kind: 'not', child: parseUnary() };
    }
    return parsePrimary();
  };

  const parsePrimary = (): Node => {
    if (isPunct(tokens[pos], '(')) {
      pos += 1;
      const inner = parseOr();
      if (isPunct(tokens[pos], ')')) pos += 1;
      return inner;
    }
    return parseComparison();
  };

  /**
   * Consume every token up to the next `and`/`or`/`)` at this paren depth, then
   * interpret the run. Collecting first and interpreting second is what lets an
   * unrecognised operator degrade to `opaque` without desynchronising the parse.
   */
  const parseComparison = (): Node => {
    const run: Token[] = [];
    let depth = 0;
    while (pos < tokens.length) {
      const tk = tokens[pos];
      if (depth === 0 && (isWord(tk, 'and') || isWord(tk, 'or'))) break;
      if (depth === 0 && isPunct(tk, ')')) break;
      if (isPunct(tk, '(')) depth += 1;
      if (isPunct(tk, ')')) depth -= 1;
      run.push(tk);
      pos += 1;
    }
    return interpret(run, params);
  };

  const node = parseOr();
  return pos >= tokens.length ? node : { kind: 'and', children: [node, { kind: 'opaque' }] };
}

function interpret(run: Token[], params: unknown[]): Node {
  if (run.length === 0) return { kind: 'opaque' };

  let column: ColumnRef | null = null;
  let rest = run;
  if (run[0].t === 'ident' && isPunct(run[1], '.') && run[2]?.t === 'ident') {
    column = { table: run[0].v, column: (run[2] as { v: string }).v };
    rest = run.slice(3);
  } else if (run[0].t === 'ident') {
    column = { table: null, column: run[0].v };
    rest = run.slice(1);
  }
  if (column === null) return { kind: 'opaque' };

  const valueOf = (tk: Token | undefined): { ok: boolean; value: unknown } => {
    if (tk === undefined) return { ok: false, value: undefined };
    if (tk.t === 'param') return { ok: true, value: params[tk.v - 1] };
    if (tk.t === 'string') return { ok: true, value: tk.v };
    if (tk.t === 'word' && tk.v === 'null') return { ok: true, value: null };
    return { ok: false, value: undefined };
  };

  const head = rest[0];

  if (isPunct(head, '=') || isPunct(head, '<>') || isPunct(head, '!=')) {
    const { ok, value } = valueOf(rest[1]);
    if (!ok || rest.length > 2) return { kind: 'opaque' };
    return { kind: 'cmp', column, op: isPunct(head, '=') ? '=' : '<>', values: [value] };
  }

  if (isWord(head, 'is')) {
    if (isWord(rest[1], 'null') && rest.length === 2)
      return { kind: 'cmp', column, op: 'is null', values: [] };
    if (isWord(rest[1], 'not') && isWord(rest[2], 'null') && rest.length === 3)
      return { kind: 'cmp', column, op: 'is not null', values: [] };
    return { kind: 'opaque' };
  }

  const negated = isWord(head, 'not') && isWord(rest[1], 'in');
  if (isWord(head, 'in') || negated) {
    const listStart = negated ? 2 : 1;
    if (!isPunct(rest[listStart], '(')) return { kind: 'opaque' };
    const values: unknown[] = [];
    for (let k = listStart + 1; k < rest.length; k += 1) {
      const tk = rest[k];
      if (isPunct(tk, ')')) {
        // Trailing tokens after the list mean this is something richer than a
        // plain `in (...)`; refuse to guess.
        return k === rest.length - 1
          ? { kind: 'cmp', column, op: negated ? 'not in' : 'in', values }
          : { kind: 'opaque' };
      }
      if (isPunct(tk, ',')) continue;
      const { ok, value } = valueOf(tk);
      if (!ok) return { kind: 'opaque' };
      values.push(value);
    }
    return { kind: 'opaque' };
  }

  return { kind: 'opaque' };
}

// ── Evaluation ───────────────────────────────────────────────────────────────

const snakeToCamel = (s: string): string =>
  s.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());

/**
 * Read a rendered column off a camelCase fixture row. Returns `undefined` for
 * "this row does not model that column", which the caller turns into `opaque` —
 * distinct from a column that is present and holds SQL `NULL`.
 */
function readColumn(row: ProbeRow, ref: ColumnRef): { known: boolean; value: unknown } {
  for (const key of [snakeToCamel(ref.column), ref.column]) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return { known: true, value: row[key] };
  }
  return { known: false, value: undefined };
}

const same = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);

/**
 * Does `row` satisfy `node`?
 *
 * `table` names the table the row belongs to. A term on any *other* table is
 * opaque here: this evaluator models one table's rows, and a predicate that
 * constrains a different table constrains nothing about this row — which is
 * precisely the wrong-table defect, surfaced as "admits the foreign row".
 */
function evaluate(node: Node, row: ProbeRow, table: string): boolean {
  switch (node.kind) {
    case 'and':
      return node.children.every((c) => evaluate(c, row, table));
    case 'or':
      return node.children.some((c) => evaluate(c, row, table));
    case 'not':
      return !evaluate(node.child, row, table);
    case 'opaque':
      return true;
    case 'cmp': {
      if (node.column === null) return true;
      if (node.column.table !== null && node.column.table !== table) return true;
      const { known, value } = readColumn(row, node.column);
      if (!known) return true;
      switch (node.op) {
        case '=':
          return same(value, node.values[0]);
        case '<>':
          return !same(value, node.values[0]);
        case 'is null':
          return (value ?? null) === null;
        case 'is not null':
          return (value ?? null) !== null;
        case 'in':
          return node.values.some((v) => same(value, v));
        case 'not in':
          return !node.values.some((v) => same(value, v));
      }
    }
  }
}

/** Parse a rendered clause into an evaluable predicate over `table`'s rows. */
export function predicateFor(clause: unknown, table: string): (row: ProbeRow) => boolean {
  const { sql, params } = renderClause(clause);
  if (sql.trim() === '') return () => true;
  const node = parse(tokenize(sql), params);
  return (row: ProbeRow) => evaluate(node, row, table);
}

/**
 * Filter `rows` by the predicate a service really built.
 *
 * This is the honest replacement for a fake `db` whose `where` resolves the same
 * fixture whatever it is handed. Such a stub reports green against the fixed and
 * the broken service alike, because the foreign row comes back either way.
 */
export function applyTenancyPredicate<T extends ProbeRow>(
  rows: readonly T[],
  clause: unknown,
  table: string
): T[] {
  const admits = predicateFor(clause, table);
  return rows.filter((r) => admits(r));
}

/** Every distinct `"table"."column"` the clause references, in source order. */
export function columnRefsOf(clause: unknown): ColumnRef[] {
  const { sql } = renderClause(clause);
  const refs: ColumnRef[] = [];
  const seen = new Set<string>();
  const re = /"([^"]+)"\s*\.\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const key = `${m[1]}.${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ table: m[1], column: m[2] });
    }
  }
  return refs;
}

// ── Assertions ───────────────────────────────────────────────────────────────

const PROBE_OTHER_USER = '00000000-0000-4000-8000-0000000000ff';
const PROBE_OTHER_ID = '00000000000000000000000ffe';

export interface ScopeExpectation {
  /** Rendered table name the read runs against, e.g. `quantified_bullets`. */
  table: string;
  /** The caller whose rows are the only ones this read may return. */
  userId: string;
  /**
   * The caller-supplied ids the read is meant to be restricted to. Supply these
   * whenever the query takes ids from the request: the id half is asserted as
   * well, so a predicate that scopes the owner but forgets the id — or binds the
   * id to the wrong column — is caught too.
   */
  ids?: readonly string[];
  /** Owner column, if the table does not use `userId`. */
  ownerKey?: string;
  /** Primary-key column, if the table does not use `id`. */
  idKey?: string;
  /**
   * Extra columns to put on every probe row. Needed when the predicate also
   * constrains a column the probe rows would otherwise not model — an unmodelled
   * column is permissive, so omitting this can only under-report, never
   * over-report.
   */
  extra?: ProbeRow;
}

function describeClause(clause: unknown): string {
  const { sql, params } = renderClause(clause);
  return sql.trim() === ''
    ? '<no WHERE clause — this read is unscoped and returns the whole table>'
    : `${sql}   -- params: ${JSON.stringify(params)}`;
}

/**
 * Assert that `clause` restricts `table` to rows owned by `userId` — and, when
 * `ids` is given, to those ids.
 *
 * This is a **structural** assertion, not a presence one. It is evaluated by
 * running the real predicate over probe rows, so `and`→`or` fails it, a
 * predicate on the wrong table fails it, an owner term bound to the wrong column
 * fails it, and a missing `where` fails it. Compare against the form this
 * replaces, which passes for all four:
 *
 * ```ts
 * expect(sql).toContain('"quantified_bullets"."user_id" = $');
 * expect(params).toContain(userId);
 * ```
 */
export function expectScopedTo(clause: unknown, expectation: ScopeExpectation): void {
  const { table, userId, ids, ownerKey = 'userId', idKey = 'id', extra = {} } = expectation;

  expect(userId, 'expectScopedTo needs the caller id it should be bound to').toBeTruthy();

  const admits = predicateFor(clause, table);
  const rendered = describeClause(clause);
  const ownId = ids?.[0] ?? PROBE_OTHER_ID.replace(/f/g, 'a');
  const row = (over: ProbeRow): ProbeRow => ({
    [idKey]: ownId,
    [ownerKey]: userId,
    ...extra,
    ...over,
  });

  // 1. The caller's own row must still come back. Without this, a predicate that
  //    matches nothing at all — `and(eq(userId, X), eq(userId, Y))`, or an owner
  //    term bound to some unrelated constant — would read as perfectly scoped.
  expect(
    admits(row({})),
    `predicate excludes the caller's own row, so it is not scoping — it is broken:\n  ${rendered}`
  ).toBe(true);

  // 2. The whole point. A row identical but for its owner must NOT come back.
  //    `or(idTerm, ownerTerm)` admits it; `and(...)` does not.
  expect(
    admits(row({ [ownerKey]: PROBE_OTHER_USER })),
    `predicate admits a row owned by another user — this read leaks across tenants:\n  ${rendered}`
  ).toBe(false);

  // 3. Orphan rows (`user_id IS NULL`) belong to nobody and must not leak either.
  expect(
    admits(row({ [ownerKey]: null })),
    `predicate admits an unowned (${ownerKey} IS NULL) row:\n  ${rendered}`
  ).toBe(false);

  if (ids !== undefined) {
    // 4. The id half, asserted by *column* and not merely by value. `params`
    //    containing the id never proved which column it filtered on.
    expect(
      admits(row({ [idKey]: PROBE_OTHER_ID })),
      `predicate admits an id the caller did not ask for — the id half is missing or bound to the wrong column:\n  ${rendered}`
    ).toBe(false);

    for (const id of ids) {
      expect(
        admits(row({ [idKey]: id })),
        `predicate excludes requested id ${id}, which the caller owns:\n  ${rendered}`
      ).toBe(true);
    }
  }
}

/**
 * Assert that a read is scoped, given the raw arguments a fake `db` recorded.
 * Convenience wrapper for stubs that log `{ table, clause }` per read.
 */
export function expectEveryReadScopedTo(
  reads: ReadonlyArray<{ table: string; clause: unknown }>,
  expectation: ScopeExpectation
): void {
  const matching = reads.filter((r) => r.table === expectation.table);
  expect(
    matching.length,
    `no read of "${expectation.table}" was recorded at all — the assertion below would have passed vacuously`
  ).toBeGreaterThan(0);
  for (const read of matching) expectScopedTo(read.clause, expectation);
}
