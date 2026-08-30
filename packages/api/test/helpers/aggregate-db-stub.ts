/**
 * A fake `db` for services whose answer is an **aggregate**, not a row set
 * (WIC-1515).
 *
 * ## Why this exists alongside `scoped-read-stub.ts`
 *
 * `scopedReadStub` resolves `.where()` honestly, which is what makes it able to
 * tell a scoped predicate from a leaking one. But it resolves every query to
 * *rows*: `.groupBy()` is a no-op and a `count(*)` projection is ignored, so a
 * service that returns `weekRow.count` reads `undefined` through it. It also
 * evaluates predicates with the tenancy parser, whose operator set is
 * `= <> is null in not in` — deliberately, since an unmodelled operator there
 * degrades to UNKNOWN and therefore *admits*, which is the safe direction for a
 * leak assertion.
 *
 * That safe direction is the wrong one here. `appliedThisWeek` is defined by a
 * date-window term, `applied_at >= $1`, and `>=` is exactly the operator the
 * tenancy parser does not model. Evaluated there, the window would silently
 * admit every row and a test built on it would report the same number for a
 * 7-day window, a 30-day window and no window at all — green against the very
 * defect it was written for. The metric this file tests shipped because there
 * was no test; a vacuous one would be a worse outcome than none, because it
 * also looks like coverage.
 *
 * So this stub is **fail-loud, not fail-open**: `WHERE`, `ORDER BY` and the
 * projection are each parsed, and anything the parser does not model raises.
 * A query shape it cannot evaluate stops the suite instead of quietly
 * resolving to a number nobody checked.
 *
 * ## Shape
 *
 * Rows are held per table and joined rows keep their tables distinct
 * (`{ applications: {...}, status_history: {...} }`), so a predicate on
 * `"applications"."user_id"` is resolved against the `applications` half even
 * when the query's base table is `status_history`. That is what lets the
 * recent-activity join be scoped by the same `userFilter` the counts use.
 */
import { getTableName, is, Column } from 'drizzle-orm';
import { renderClause } from './tenancy.js';

/** A row as fixtures hold it: camelCase keys, as the driver would return. */
export type StubRow = Record<string, unknown>;

/** A row under evaluation, keyed by rendered table name. */
type JoinedRow = Record<string, StubRow>;

// ── Tokenizer ────────────────────────────────────────────────────────────────

type Token =
  | { t: 'ident'; v: string }
  | { t: 'word'; v: string }
  | { t: 'param'; v: number }
  | { t: 'lit'; v: string }
  | { t: 'punct'; v: string };

const OPERATOR_CHARS = new Set(['=', '<', '>', '!']);

function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === '"') {
      const j = sql.indexOf('"', i + 1);
      if (j < 0) throw new Error(`aggregateDbStub: unterminated identifier in: ${sql}`);
      out.push({ t: 'ident', v: sql.slice(i + 1, j) });
      i = j + 1;
    } else if (c === "'") {
      const j = sql.indexOf("'", i + 1);
      if (j < 0) throw new Error(`aggregateDbStub: unterminated literal in: ${sql}`);
      out.push({ t: 'lit', v: sql.slice(i + 1, j) });
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

type CmpOp = '=' | '<>' | '>=' | '>' | '<=' | '<';

/**
 * The right-hand side of a comparison. A bound parameter is the common case;
 * a column reference is what a join condition
 * (`"status_history"."application_id" = "applications"."id"`) emits.
 */
type Rhs = { k: 'value'; v: unknown } | { k: 'col'; table: string; column: string };

type Node =
  | { kind: 'and'; children: Node[] }
  | { kind: 'or'; children: Node[] }
  | { kind: 'cmp'; table: string; column: string; op: CmpOp; rhs: Rhs }
  | { kind: 'null'; table: string; column: string; negated: boolean };

const CMP_OPS = new Set<string>(['=', '<>', '!=', '>=', '>', '<=', '<']);

function parse(tokens: Token[], params: unknown[], sql: string): Node {
  let pos = 0;
  const fail = (why: string): never => {
    throw new Error(
      `aggregateDbStub cannot model this WHERE clause (${why}). ` +
        `Extend the parser rather than letting the query resolve unfiltered.\n  SQL: ${sql}`
    );
  };

  const parseOr = (): Node => {
    const children = [parseAnd()];
    while (tokens[pos]?.t === 'word' && (tokens[pos] as { v: string }).v === 'or') {
      pos += 1;
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  };

  const parseAnd = (): Node => {
    const children = [parsePrimary()];
    while (tokens[pos]?.t === 'word' && (tokens[pos] as { v: string }).v === 'and') {
      pos += 1;
      children.push(parsePrimary());
    }
    return children.length === 1 ? children[0] : { kind: 'and', children };
  };

  const parsePrimary = (): Node => {
    const tk = tokens[pos];
    if (tk?.t === 'punct' && tk.v === '(') {
      pos += 1;
      const inner = parseOr();
      const close = tokens[pos];
      if (!(close?.t === 'punct' && close.v === ')')) fail('unbalanced parentheses');
      pos += 1;
      return inner;
    }

    // "table"."column" <op> <value>
    const t0 = tokens[pos];
    const t1 = tokens[pos + 1];
    const t2 = tokens[pos + 2];
    if (!(t0?.t === 'ident' && t1?.t === 'punct' && t1.v === '.' && t2?.t === 'ident')) {
      fail('expected a qualified "table"."column" reference');
    }
    const table = (t0 as { v: string }).v;
    const column = (t2 as { v: string }).v;
    pos += 3;

    const op = tokens[pos];

    if (op?.t === 'word' && op.v === 'is') {
      pos += 1;
      let negated = false;
      if (tokens[pos]?.t === 'word' && (tokens[pos] as { v: string }).v === 'not') {
        negated = true;
        pos += 1;
      }
      if (!(tokens[pos]?.t === 'word' && (tokens[pos] as { v: string }).v === 'null')) {
        fail('only `IS [NOT] NULL` is modelled after `IS`');
      }
      pos += 1;
      return { kind: 'null', table, column, negated };
    }

    if (!(op?.t === 'punct' && CMP_OPS.has(op.v))) {
      fail(`unmodelled operator \`${op && 'v' in op ? String(op.v) : '<end>'}\``);
    }
    pos += 1;

    const val = tokens[pos];
    let rhs: Rhs;
    if (val?.t === 'param') {
      rhs = { k: 'value', v: params[val.v - 1] };
      pos += 1;
    } else if (val?.t === 'lit') {
      rhs = { k: 'value', v: val.v };
      pos += 1;
    } else if (
      val?.t === 'ident' &&
      tokens[pos + 1]?.t === 'punct' &&
      (tokens[pos + 1] as { v: string }).v === '.' &&
      tokens[pos + 2]?.t === 'ident'
    ) {
      // Join condition: compare one table's column against another's.
      rhs = { k: 'col', table: val.v, column: (tokens[pos + 2] as { v: string }).v };
      pos += 3;
    } else {
      fail('comparison right-hand side is not a bound parameter, literal or column');
    }

    const raw = (op as { v: string }).v;
    return {
      kind: 'cmp',
      table,
      column,
      op: raw === '!=' ? '<>' : (raw as CmpOp),
      rhs: rhs!,
    };
  };

  const node = parseOr();
  if (pos < tokens.length) fail('trailing tokens the parser did not consume');
  return node;
}

// ── Evaluation ───────────────────────────────────────────────────────────────

const snakeToCamel = (s: string): string =>
  s.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}[T ]/;

/** Epoch ms if this value is a timestamp, else `null`. */
function asTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' && ISO_LIKE.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function readColumn(row: JoinedRow, table: string, column: string): unknown {
  const half = row[table];
  if (half === undefined) {
    throw new Error(
      `aggregateDbStub: predicate references "${table}"."${column}", but no fixture ` +
        `for table "${table}" is in scope for this query. Add it to the fixture or ` +
        `to the join, rather than letting the term evaluate to nothing.`
    );
  }
  for (const key of [snakeToCamel(column), column]) {
    if (Object.prototype.hasOwnProperty.call(half, key)) return half[key];
  }
  // A column the fixture does not model would otherwise compare as NULL and
  // silently drop the row. Say so instead.
  throw new Error(
    `aggregateDbStub: fixture row for "${table}" does not model column "${column}". ` +
      `Fixture keys: ${Object.keys(half).join(', ') || '<none>'}`
  );
}

/** SQL three-valued logic, collapsed at the top: WHERE keeps only TRUE. */
function evaluate(node: Node, row: JoinedRow): boolean | null {
  switch (node.kind) {
    case 'and': {
      const vs = node.children.map((c) => evaluate(c, row));
      if (vs.some((v) => v === false)) return false;
      return vs.some((v) => v === null) ? null : true;
    }
    case 'or': {
      const vs = node.children.map((c) => evaluate(c, row));
      if (vs.some((v) => v === true)) return true;
      return vs.some((v) => v === null) ? null : false;
    }
    case 'null': {
      const v = readColumn(row, node.table, node.column) ?? null;
      return node.negated ? v !== null : v === null;
    }
    case 'cmp': {
      const raw = readColumn(row, node.table, node.column);
      const other =
        node.rhs.k === 'value' ? node.rhs.v : readColumn(row, node.rhs.table, node.rhs.column);

      // NULL compared with anything is UNKNOWN — which is how a never-submitted
      // application (`applied_at IS NULL`) falls out of a date window.
      if (raw === null || raw === undefined) return null;
      if (other === null || other === undefined) return null;

      const lt = asTime(raw);
      const rt = asTime(other);
      const [a, b]: [unknown, unknown] = lt !== null && rt !== null ? [lt, rt] : [raw, other];

      switch (node.op) {
        case '=':
          return a === b;
        case '<>':
          return a !== b;
        default: {
          if (typeof a !== typeof b) {
            throw new Error(
              `aggregateDbStub: refusing to order-compare ${typeof a} with ${typeof b} ` +
                `on "${node.table}"."${node.column}" — the fixture and the bound parameter disagree in type.`
            );
          }
          const x = a as number | string;
          const y = b as number | string;
          if (node.op === '>=') return x >= y;
          if (node.op === '>') return x > y;
          if (node.op === '<=') return x <= y;
          return x < y;
        }
      }
    }
  }
}

function admits(clause: unknown, row: JoinedRow): boolean {
  const { sql, params } = renderClause(clause);
  // No WHERE at all is the whole table — a real, and much worse, unscoped read.
  if (sql.trim() === '') return true;
  return evaluate(parse(tokenize(sql), params, sql), row) === true;
}

// ── Projection ───────────────────────────────────────────────────────────────

interface ProjEntry {
  key: string;
  table?: string;
  column?: string;
  aggregate?: 'count';
}

function describeProjection(projection: Record<string, unknown>): ProjEntry[] {
  return Object.entries(projection).map(([key, v]) => {
    if (is(v, Column)) {
      const col = v as unknown as { name: string; table: unknown };
      return {
        key,
        table: getTableName(col.table as Parameters<typeof getTableName>[0]),
        column: col.name,
      };
    }
    const { sql } = renderClause(v);
    if (/\bcount\s*\(/i.test(sql)) return { key, aggregate: 'count' as const };
    throw new Error(
      `aggregateDbStub: unmodelled projection entry "${key}" -> ${sql}. ` +
        `Only plain columns and count(...) aggregates are supported.`
    );
  });
}

// ── Order by ─────────────────────────────────────────────────────────────────

interface OrderKey {
  table: string;
  column: string;
  desc: boolean;
}

function describeOrder(terms: unknown[]): OrderKey[] {
  return terms.map((t) => {
    // `.groupBy()` is handed bare columns, which are not SQL and cannot be
    // rendered; `.orderBy()` is handed `asc()`/`desc()` wrappers, which are.
    if (is(t, Column)) {
      const col = t as unknown as { name: string; table: unknown };
      return {
        table: getTableName(col.table as Parameters<typeof getTableName>[0]),
        column: col.name,
        desc: false,
      };
    }
    const { sql } = renderClause(t);
    const m = /^"([^"]+)"\."([^"]+)"(\s+desc|\s+asc)?$/i.exec(sql.trim());
    if (!m) throw new Error(`aggregateDbStub: unmodelled ORDER BY / GROUP BY term: ${sql}`);
    return { table: m[1], column: m[2], desc: /desc/i.test(m[3] ?? '') };
  });
}

// ── Stub ─────────────────────────────────────────────────────────────────────

export interface RecordedQuery {
  table: string;
  clause: unknown;
  /** Rendered SQL of the `WHERE`, `''` when the query had none. */
  whereSql: string;
  rowsIn: number;
  rowsOut: number;
}

export interface AggregateDbStub {
  db: unknown;
  queries: RecordedQuery[];
  /** Every `.where()` clause recorded against `table`, in issue order. */
  clausesOn(table: string): unknown[];
}

/**
 * @param fixtures rows per rendered table name, e.g. `{ applications: [...] }`.
 */
export function aggregateDbStub(fixtures: Record<string, StubRow[]>): AggregateDbStub {
  const queries: RecordedQuery[] = [];

  function chain(projection: Record<string, unknown>) {
    const proj = describeProjection(projection);
    let baseTable = '';
    let rows: JoinedRow[] = [];
    let clause: unknown;
    let grouped: OrderKey[] | null = null;
    let order: OrderKey[] = [];
    let take: number | null = null;
    let recorded: RecordedQuery | undefined;

    const self: Record<string, unknown> = {
      from(t: unknown) {
        baseTable = getTableName(t as Parameters<typeof getTableName>[0]);
        rows = (fixtures[baseTable] ?? []).map((r) => ({ [baseTable]: r }));
        recorded = {
          table: baseTable,
          clause: undefined,
          whereSql: '',
          rowsIn: rows.length,
          rowsOut: rows.length,
        };
        queries.push(recorded);
        return self;
      },
      innerJoin(t: unknown, on: unknown) {
        const joinTable = getTableName(t as Parameters<typeof getTableName>[0]);
        const right = fixtures[joinTable] ?? [];
        const out: JoinedRow[] = [];
        for (const l of rows) {
          for (const r of right) {
            const candidate = { ...l, [joinTable]: r };
            if (admits(on, candidate)) out.push(candidate);
          }
        }
        rows = out;
        return self;
      },
      where(c: unknown) {
        clause = c;
        rows = rows.filter((r) => admits(c, r));
        if (recorded) {
          recorded.clause = c;
          recorded.whereSql = renderClause(c).sql;
          recorded.rowsOut = rows.length;
        }
        return self;
      },
      groupBy(...cols: unknown[]) {
        grouped = describeOrder(cols);
        return self;
      },
      orderBy(...terms: unknown[]) {
        order = describeOrder(terms);
        return self;
      },
      limit(n: number) {
        take = n;
        return self;
      },
      offset() {
        return self;
      },
      then(resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) {
        let result: unknown[];
        try {
          result = resolve_();
        } catch (e) {
          return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };

    const project = (row: JoinedRow): Record<string, unknown> =>
      Object.fromEntries(
        proj.map((p) => [
          p.key,
          p.aggregate ? 1 : readColumn(row, p.table as string, p.column as string),
        ])
      );

    function resolve_(): unknown[] {
      const hasAggregate = proj.some((p) => p.aggregate);

      if (hasAggregate) {
        const keyed = proj.filter((p) => !p.aggregate);
        if (keyed.length === 0) {
          // Scalar aggregate: `select({ count: count(*) })` — always one row,
          // even over an empty set.
          return [Object.fromEntries(proj.map((p) => [p.key, rows.length]))];
        }
        if (grouped === null) {
          throw new Error(
            'aggregateDbStub: projection mixes columns with an aggregate but the query ' +
              'called no .groupBy() — Postgres would reject this.'
          );
        }
        const buckets = new Map<string, { row: JoinedRow; n: number }>();
        for (const r of rows) {
          const k = JSON.stringify(
            keyed.map((p) => readColumn(r, p.table as string, p.column as string))
          );
          const hit = buckets.get(k);
          if (hit) hit.n += 1;
          else buckets.set(k, { row: r, n: 1 });
        }
        return [...buckets.values()].map(({ row, n }) =>
          Object.fromEntries(
            proj.map((p) => [
              p.key,
              p.aggregate ? n : readColumn(row, p.table as string, p.column as string),
            ])
          )
        );
      }

      let out = [...rows];
      for (const k of [...order].reverse()) {
        out.sort((a, b) => {
          const av = readColumn(a, k.table, k.column);
          const bv = readColumn(b, k.table, k.column);
          const at = asTime(av);
          const bt = asTime(bv);
          const [x, y] = at !== null && bt !== null ? [at, bt] : [av, bv];
          const cmp = (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0;
          return k.desc ? -cmp : cmp;
        });
      }
      if (take !== null) out = out.slice(0, take);
      return out.map(project);
    }

    return self;
  }

  return {
    db: { select: (projection: Record<string, unknown>) => chain(projection) },
    queries,
    clausesOn: (table: string) => queries.filter((q) => q.table === table).map((q) => q.clause),
  };
}
