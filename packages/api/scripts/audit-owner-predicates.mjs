#!/usr/bin/env node
/**
 * AC-T0 guard: an authenticated request with no resolved owner must match zero rows.
 *
 * Three checks, run over `packages/api/src/services` and `packages/api/src/routes`:
 *
 *   [SIG]    an exported service function whose owner parameter is optional or
 *            nullable.  This is the *precondition* for a fail-open predicate --
 *            you cannot branch on an absent owner if absence is unrepresentable.
 *
 *   [COND]   the owner identifier used in a conditional position (ternary test,
 *            `if`, `&&`/`||`, `!owner`, `owner == null`).  Defence in depth, and
 *            the check that catches a predicate reintroduced against a
 *            still-optional signature.
 *
 *   [NOWNER] an UPDATE or DELETE against an owner-bearing table whose `where`
 *            predicate contains no owner column at all.  See the scope note.
 *
 * SCOPE NOTE -- what a green run does and does not assert.
 *
 *   [SIG] and [COND] measure *fail-open owner predicates*: sites where the owner
 *   is representable-as-absent and branched on.  They say nothing about a site
 *   that never mentions the owner in the first place.  A write that ignores the
 *   owner entirely satisfies the letter of both checks while maximally violating
 *   the premise above -- it yields no finding, so it appears in neither the
 *   numerator nor the denominator of the burndown count printed below.
 *
 *   That hole is why [NOWNER] exists (WIC-1672).  It keys on the *schema column*
 *   rather than on a parameter name, so unlike [SIG]/[COND] it cannot be evaded
 *   by renaming the owner parameter (`userId` -> `callerId`) or by hiding its
 *   optionality behind a type alias.
 *
 *   Still out of scope, and so still NOT asserted by a green run.  Each is
 *   counted on every run and listed by `--stats`, never silently dropped:
 *     - writes scoped by a primary key or `.unique()` column.  Those match at
 *       most one row, so they cannot fan out across tenants -- but whether that
 *       id was itself owner-checked upstream is an IDOR question this guard does
 *       not answer.
 *     - predicates it cannot see through: a `where` argument that is neither
 *       inline nor resolvable to a const/array declared in an enclosing scope.
 *     - SELECTs with no owner term (read-side cross-tenant leaks).  Real, but a
 *       far larger population; measure before gating.
 *     - anything outside SCAN_DIRS, and any owner column not in OWNER_COLUMNS.
 *
 * Uses the TypeScript compiler's own parser, so it sees every syntactic shape
 * (ternary, `if (userId) conditions.push(...)`, `...(userId ? [x] : [])`)
 * rather than the one shape a regex or a naive lint selector was written for.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// `--root=<dir>` points the scan at a fixture tree instead of the package, so
// the guard can have positive controls of its own (test/audit-owner-predicates.test.ts).
// A check with no test is a check that only *claims* to hold the line.
const rootArg = process.argv.find((a) => a.startsWith('--root='));
const API_ROOT = rootArg
  ? resolve(process.cwd(), rootArg.slice('--root='.length))
  : fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['src/services', 'src/routes'];
const SCHEMA_PATH = 'src/db/schema.ts';
const OWNER_NAMES = new Set(['userId', 'ownerId']);
/** Schema-side owner columns, as declared on the drizzle table objects. */
const OWNER_COLUMNS = new Set(['userId', 'ownerId']);
/** Raw SQL spellings of the same, for `sql` template predicates. */
const OWNER_SQL_COLUMNS = [/\buser_id\b/, /\bowner_id\b/];

/**
 * Sites that are fail-closed on purpose. Each needs a reason and a test.
 *
 * Deliberately empty. Its one entry -- personal-info.service.ts:34, the
 * `userFilter` fail-closed isNull (0014:44-48) -- is now recognised by *shape*
 * via scopeHelperOwner(), which is strictly better: this map is keyed by line
 * number while the baseline below is deliberately line-agnostic, so an entry
 * here silently stops matching the moment anything above the site shifts.
 * Prefer teaching the checks a shape over pinning a coordinate. (WIC-1853)
 */
const ALLOWLIST = new Map([]);

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function parse(file) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
}

/**
 * Owner-bearing tables, read out of the schema rather than hard-coded, so a new
 * table declared with a `user_id` column is in [NOWNER] scope the day it lands.
 * Returns Map<exported drizzle table name, owner column name>.
 */
function readOwnerTables() {
  const tables = new Map();
  let src;
  try {
    src = parse(join(API_ROOT, SCHEMA_PATH));
  } catch {
    return tables; // no schema => [NOWNER] finds nothing; --stats says so
  }
  for (const stmt of src.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      const init = decl.initializer;
      if (!ts.isIdentifier(decl.name) || !init || !ts.isCallExpression(init)) continue;
      if (!ts.isIdentifier(init.expression) || !/Table$/.test(init.expression.text)) continue;
      // pgTable('name', { columns }, ...) -- columns is the first object literal arg
      const columns = init.arguments.find((a) => ts.isObjectLiteralExpression(a));
      if (!columns) continue;
      let owner = null;
      const unique = new Set();
      for (const prop of columns.properties) {
        const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : null;
        if (!name) continue;
        if (OWNER_COLUMNS.has(name)) owner = name;
        // `.primaryKey()` / `.unique()` anywhere in the column's builder chain
        const text = prop.getText(src);
        if (/\.primaryKey\(|\.unique\(/.test(text)) unique.add(name);
      }
      if (owner) tables.set(decl.name.text, { owner, unique });
    }
  }
  return tables;
}

const OWNER_TABLES = readOwnerTables();

/** The identifier a drizzle table argument refers to: `t` or `schema.t`. */
function tableNameOf(arg) {
  if (!arg) return null;
  if (ts.isIdentifier(arg)) return arg.text;
  if (ts.isPropertyAccessExpression(arg)) return arg.name.text;
  return null;
}

/** The `.set(...).where(...)` calls chained onto an `.update(t)` / `.delete(t)`. */
function chainedCallsFrom(call) {
  const out = [];
  let cur = call;
  while (
    cur.parent &&
    ts.isPropertyAccessExpression(cur.parent) &&
    cur.parent.expression === cur &&
    cur.parent.parent &&
    ts.isCallExpression(cur.parent.parent) &&
    cur.parent.parent.expression === cur.parent
  ) {
    out.push({ name: cur.parent.name.text, call: cur.parent.parent });
    cur = cur.parent.parent;
  }
  return out;
}

/** Nearest enclosing function/method body, for one-hop local resolution. */
function enclosingFunction(node) {
  let cur = node.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isSourceFile(cur)
    ) {
      return cur;
    }
    cur = cur.parent;
  }
  return null;
}

/**
 * Everything a locally-declared name could hold: its initialiser plus anything
 * pushed into it. Covers the `const conditions = [...]; conditions.push(eq(t.userId, u))`
 * idiom this codebase uses to build predicates. Returns null when the name is
 * not declared in the enclosing function -- i.e. the predicate is opaque to us.
 */
function resolveLocal(name, fromNode) {
  // Climb enclosing scopes: a predicate built outside a `db.transaction(tx => ...)`
  // callback and used inside it is still perfectly visible, and stopping at the
  // innermost arrow function scored 4 real catalog predicates as opaque.
  let scope = enclosingFunction(fromNode);
  while (scope) {
    const nodes = [];
    let declared = false;
    const scan = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
        declared = true;
        if (n.initializer) nodes.push(n.initializer);
      }
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === name &&
        n.expression.name.text === 'push'
      ) {
        nodes.push(...n.arguments);
      }
      ts.forEachChild(n, scan);
    };
    scan(scope);
    if (declared) return nodes;
    if (ts.isSourceFile(scope)) break;
    scope = enclosingFunction(scope);
  }
  return null;
}

/**
 * Does this `where` argument constrain the owner column?
 * `true` = yes, `false` = provably not, `'opaque'` = we could not see through it.
 * Only a hard `false` is reported; `'opaque'` is counted and surfaced by --stats,
 * never silently dropped.
 */
/** Combinators whose arguments are themselves predicates, not column/value operands. */
const PREDICATE_COMBINATORS = new Set(['and', 'or', 'not']);

function classifyPredicate(expr, src, uniqueColumns) {
  const out = { owner: false, unique: false, opaque: false };
  const seen = new Set();

  /**
   * `predPos` tracks whether we are somewhere a *condition* is expected. Only
   * there can an unresolvable name hide an owner term: in `eq(projects.slug, slug)`
   * the bare `slug` is a value operand, and failing to resolve it tells us nothing
   * about owner scoping. Scoring those as opaque buried the real ones (21 vs 4).
   */
  const scan = (n, predPos) => {
    if (out.owner) return;

    // `eq(companyCatalog.userId, userId)` / `t.ownerId`
    if (ts.isPropertyAccessExpression(n)) {
      if (OWNER_COLUMNS.has(n.name.text)) {
        out.owner = true;
        return;
      }
      if (uniqueColumns.has(n.name.text)) out.unique = true;
    }

    // `sql\`user_id = ${u}\`` and friends
    if (ts.isTaggedTemplateExpression(n) || ts.isTemplateExpression(n)) {
      if (OWNER_SQL_COLUMNS.some((re) => re.test(n.getText(src)))) {
        out.owner = true;
        return;
      }
    }

    // a bare name standing in for the predicate: resolve it one hop, locally
    if (ts.isIdentifier(n) && predPos) {
      const p = n.parent;
      const inMemberExpr = ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p);
      const isCallee = ts.isCallExpression(p) && p.expression === n;
      if (!inMemberExpr && !isCallee && !seen.has(n.text)) {
        seen.add(n.text);
        const resolved = resolveLocal(n.text, n);
        if (resolved === null) out.opaque = true;
        else for (const r of resolved) scan(r, true);
        if (out.owner) return;
      }
    }

    if (ts.isCallExpression(n)) {
      const callee = ts.isIdentifier(n.expression)
        ? n.expression.text
        : ts.isPropertyAccessExpression(n.expression)
          ? n.expression.name.text
          : null;
      const argsArePredicates = predPos && callee !== null && PREDICATE_COMBINATORS.has(callee);
      scan(n.expression, false);
      for (const a of n.arguments) scan(a, argsArePredicates);
      return;
    }

    // `and(...conditions)`, `[eq(a,b), ...more]`, `cond ? x : y` all stay in position
    if (ts.isSpreadElement(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) {
      scan(n.expression, predPos);
      return;
    }
    if (ts.isArrayLiteralExpression(n)) {
      for (const el of n.elements) scan(el, predPos);
      return;
    }
    if (ts.isConditionalExpression(n)) {
      scan(n.condition, false);
      scan(n.whenTrue, predPos);
      scan(n.whenFalse, predPos);
      return;
    }

    ts.forEachChild(n, (c) => scan(c, predPos));
  };

  scan(expr, true);
  return out;
}

/**
 * `if (!userId) throw 401` is the posture ADR-010 asks for, not a violation of
 * it. An early-exit guard on an ABSENT owner is fail-CLOSED, so the negated
 * forms of [COND] must exempt it -- otherwise the check counts the fix as the
 * defect and the burndown number inverts (the WIC-1623 shape).
 */
function alwaysExits(stmt) {
  if (!stmt) return false;
  if (
    ts.isThrowStatement(stmt) ||
    ts.isReturnStatement(stmt) ||
    ts.isContinueStatement(stmt) ||
    ts.isBreakStatement(stmt)
  ) {
    return true;
  }
  if (ts.isBlock(stmt)) return stmt.statements.some(alwaysExits);
  return false;
}

/** Is the owner reached only through a negation / null comparison? */
function isNegatedOwnerTest(expr, depth = 0) {
  if (!expr || depth > 6) return false;
  if (ts.isParenthesizedExpression(expr)) return isNegatedOwnerTest(expr.expression, depth + 1);
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
    return ownerIdentIn(expr.operand) !== null;
  }
  if (ts.isBinaryExpression(expr)) {
    const K = ts.SyntaxKind;
    const k = expr.operatorToken.kind;
    if (
      k === K.EqualsEqualsToken ||
      k === K.EqualsEqualsEqualsToken ||
      k === K.ExclamationEqualsToken ||
      k === K.ExclamationEqualsEqualsToken
    ) {
      return ownerIdentIn(expr.left) !== null || ownerIdentIn(expr.right) !== null;
    }
    if (k === K.AmpersandAmpersandToken || k === K.BarBarToken) {
      return isNegatedOwnerTest(expr.left, depth + 1) || isNegatedOwnerTest(expr.right, depth + 1);
    }
  }
  return false;
}

/** Local `type X = ...` aliases, so a renamed union is still seen as nullable. */
function typeAliases(src) {
  const m = new Map();
  const scan = (n) => {
    if (ts.isTypeAliasDeclaration(n) && ts.isIdentifier(n.name)) m.set(n.name.text, n.type);
    ts.forEachChild(n, scan);
  };
  scan(src);
  return m;
}

/** Is this type node optional/nullable -- i.e. can the owner be absent? */
function typeAllowsAbsent(t, aliases, depth = 0) {
  if (!t) return true; // untyped => implicitly any => absent is representable
  if (depth > 8) return false;
  if (t.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  if (t.kind === ts.SyntaxKind.NullKeyword) return true;
  if (t.kind === ts.SyntaxKind.AnyKeyword || t.kind === ts.SyntaxKind.UnknownKeyword) return true;
  if (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isParenthesizedTypeNode(t)) return typeAllowsAbsent(t.type, aliases, depth + 1);
  if (t.kind === ts.SyntaxKind.UnionType) {
    return t.types.some((m) => typeAllowsAbsent(m, aliases, depth + 1));
  }
  // `userId: MaybeOwner` -- unwrap a local alias rather than trusting the name
  if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
    const alias = aliases.get(t.typeName.text);
    if (alias) return typeAllowsAbsent(alias, aliases, depth + 1);
  }
  return false;
}

function ownerMayBeAbsent(param, aliases) {
  if (param.questionToken || param.initializer) return true;
  return typeAllowsAbsent(param.type, aliases);
}

/** The owner identifier being tested, seen through `!`, `== null`, `typeof`. */
function ownerIdentIn(expr, depth = 0) {
  if (!expr || depth > 6) return null;
  if (ts.isIdentifier(expr)) return OWNER_NAMES.has(expr.text) ? expr : null;
  if (ts.isParenthesizedExpression(expr)) return ownerIdentIn(expr.expression, depth + 1);
  if (ts.isTypeOfExpression(expr)) return ownerIdentIn(expr.expression, depth + 1);
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken // `!userId`
  ) {
    return ownerIdentIn(expr.operand, depth + 1);
  }
  if (ts.isBinaryExpression(expr)) {
    const K = ts.SyntaxKind;
    const testing = new Set([
      K.EqualsEqualsToken, // userId == null
      K.EqualsEqualsEqualsToken, // userId === undefined
      K.ExclamationEqualsToken, // userId != null
      K.ExclamationEqualsEqualsToken,
      K.AmpersandAmpersandToken,
      K.BarBarToken,
      K.QuestionQuestionToken,
    ]);
    if (testing.has(expr.operatorToken.kind)) {
      return ownerIdentIn(expr.left, depth + 1) ?? ownerIdentIn(expr.right, depth + 1);
    }
  }
  return null;
}

/**
 * A *fail-closed owner scope helper*: a function whose body is just
 *   `return userId ? eq(t.userId, userId) : isNull(t.userId);`
 *
 * Absence here selects the genuinely-unowned rows instead of dropping the owner
 * term, so it is the remediation this guard exists to drive people toward
 * (WIC-1601's `ownerScope`) -- not the defect. Both checks must exempt it:
 * [COND] would flag the ternary, and [SIG] would flag the `userId?` parameter
 * that the helper needs in order to represent absence at all. Flagging either
 * makes the guard reject its own recommended fix, which is what it did before
 * WIC-1853: adopting the verbatim helper in any service that lacked one failed
 * CI, and SIG headroom was 0 in all 14 baselined service files.
 *
 * Precedent: ALLOWLIST already conceded this shape for
 * personal-info.service.ts:34 -- but by line number, which silently stops
 * matching when the file shifts. This recognises it by shape instead, so the
 * line-keyed entry is no longer needed.
 *
 * SCOPE LIMIT (AC-3). `isNull(user_id)` is genuinely fail-closed only where
 * migration 0017 rewrote pre-existing NULLs to the all-zero sentinel. On the
 * still-nullable tables -- applications, status_history, resumes,
 * resume_exports, cover_letters, outreach_messages, personal_info -- `IS NULL`
 * matches real rows, so it denies-and-narrows rather than matching zero rows.
 * This exemption is a *syntactic* proxy: the AST cannot see column nullability.
 * It is the right call because dropping the owner term entirely selects every
 * tenant while `isNull` selects at most the unowned one, so the shape is always
 * strictly safer than the defect it replaces -- but on a nullable table it is
 * not yet AC-T0-clean, and AC-3/AC-4 remain the checks that close that gap.
 */
function ownerColumnRef(arg) {
  // `t.userId` / `personalInfo.userId` -- the owner column of some table.
  return (
    arg &&
    ts.isPropertyAccessExpression(arg) &&
    ts.isIdentifier(arg.name) &&
    OWNER_NAMES.has(arg.name.text)
  );
}

function failClosedOwnerTernary(expr) {
  if (!expr || !ts.isConditionalExpression(expr)) return null;
  if (!ts.isIdentifier(expr.condition) || !OWNER_NAMES.has(expr.condition.text)) return null;
  const f = expr.whenFalse;
  // Must be `isNull(<something>.userId)`. Checking the *argument* matters:
  // `userId ? eq(t.userId, userId) : isNull(t.deletedAt)` is fail-OPEN -- it
  // drops the owner term for a predicate on an unrelated column -- and an
  // `isNull`-callee-only test would have exempted it.
  const isOwnerIsNull =
    ts.isCallExpression(f) &&
    ts.isIdentifier(f.expression) &&
    f.expression.text === 'isNull' &&
    f.arguments.length === 1 &&
    ownerColumnRef(f.arguments[0]);
  return isOwnerIsNull ? expr.condition.text : null;
}

/** The function is a scope helper iff its whole body is one such return. */
function scopeHelperOwner(node) {
  const body = node.body;
  if (!body) return null;
  if (!ts.isBlock(body)) return failClosedOwnerTernary(body);
  const stmts = body.statements.filter((st) => !ts.isEmptyStatement(st));
  if (stmts.length !== 1 || !ts.isReturnStatement(stmts[0])) return null;
  return failClosedOwnerTernary(stmts[0].expression);
}

const findings = [];
const stats = {
  ownerTables: OWNER_TABLES.size,
  writeSites: 0,
  opaquePredicates: [],
  uniqueScopedWrites: [],
};

for (const scanDir of SCAN_DIRS) {
  let files;
  try {
    files = walkFiles(join(API_ROOT, scanDir));
  } catch {
    continue;
  }

  for (const file of files) {
    const rel = relative(API_ROOT, file);
    const src = parse(file);
    const aliases = typeAliases(src);
    const lineOf = (node) => src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;

    // One site can now be reached by more than one rule (`if (!userId && x)` is
    // both an if-test and a `&&` guard). Report each syntactic site once, or the
    // counts drift against the baseline for a reason that is not a regression.
    const emitted = new Set();
    const report = (node, check, detail) => {
      const line = lineOf(node);
      if (ALLOWLIST.has(`${rel}:${line}`)) return;
      const site = `${check}\u0000${node.getStart(src)}`;
      if (emitted.has(site)) return;
      emitted.add(site);
      findings.push({ file: rel, line, check, detail });
    };

    const visit = (node) => {
      // [SIG] optional / nullable owner parameter on a function signature
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      ) {
        const helperOwner = scopeHelperOwner(node);
        for (const p of node.parameters) {
          if (ts.isIdentifier(p.name)) {
            if (OWNER_NAMES.has(p.name.text) && ownerMayBeAbsent(p, aliases)) {
              // A fail-closed owner scope helper needs an optional owner in
              // order to represent absence at all -- flagging it makes the
              // guard reject its own recommended fix (WIC-1853 / WIC-1858).
              if (p.name.text === helperOwner) continue;
              report(p, 'SIG', `owner parameter '${p.name.text}' is optional or nullable`);
            }
          } else if (ts.isObjectBindingPattern(p.name)) {
            // `{ userId }: { userId?: string }` -- destructured, still an owner
            for (const el of p.name.elements) {
              const name = ts.isIdentifier(el.name) ? el.name.text : null;
              if (!name || !OWNER_NAMES.has(name)) continue;
              if (p.questionToken || p.initializer || el.initializer) {
                report(el, 'SIG', `owner parameter '${name}' is optional or nullable`);
                continue;
              }
              const member =
                p.type && ts.isTypeLiteralNode(p.type)
                  ? p.type.members.find(
                      (m) => m.name && ts.isIdentifier(m.name) && m.name.text === name
                    )
                  : null;
              if (!member) continue;
              if (member.questionToken || typeAllowsAbsent(member.type, aliases)) {
                report(el, 'SIG', `owner parameter '${name}' is optional or nullable`);
              }
            }
          }
        }
      }

      // [COND] owner identifier in a conditional position
      const flagIfOwner = (expr, where) => {
        const ident = ownerIdentIn(expr);
        if (ident) report(ident, 'COND', `'${ident.text}' branched on in ${where}`);
      };
      // A fail-closed `userId ? eq(t.userId, userId) : isNull(t.userId)` is the
      // target posture, not a finding (WIC-1853 / WIC-1858).
      if (ts.isConditionalExpression(node) && !failClosedOwnerTernary(node))
        flagIfOwner(node.condition, 'a ternary test');
      if (ts.isIfStatement(node)) {
        // fail-closed early exit on an absent owner is the target posture, not a finding
        const failClosed =
          isNegatedOwnerTest(node.expression) &&
          !node.elseStatement &&
          alwaysExits(node.thenStatement);
        if (!failClosed) flagIfOwner(node.expression, 'an if test');
      }
      if (
        ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      ) {
        flagIfOwner(node.left, `a ${node.operatorToken.getText(src)} guard`);
      }

      // [NOWNER] update/delete on an owner-bearing table with no owner term
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === 'update' || node.expression.name.text === 'delete') &&
        node.arguments.length === 1
      ) {
        const verb = node.expression.name.text;
        const table = tableNameOf(node.arguments[0]);
        const meta = table ? OWNER_TABLES.get(table) : null;
        if (meta) {
          stats.writeSites += 1;
          const site = `${rel}:${lineOf(node)} ${verb} '${table}'`;
          const wheres = chainedCallsFrom(node)
            .filter((c) => c.name === 'where')
            .flatMap((c) => c.call.arguments);
          if (wheres.length === 0) {
            report(node, 'NOWNER', `${verb} on '${table}' has no where clause`);
          } else {
            const v = wheres.map((w) => classifyPredicate(w, src, meta.unique));
            if (v.some((r) => r.owner)) {
              // owner-scoped: clean
            } else if (v.some((r) => r.opaque)) {
              stats.opaquePredicates.push(site);
            } else if (v.some((r) => r.unique)) {
              // Scoped by a primary key / unique column, so the write matches at
              // most one row and cannot fan out across tenants. Whether the id
              // was itself owner-checked upstream is an IDOR question this guard
              // does not answer -- counted here so it is not silently dropped.
              stats.uniqueScopedWrites.push(site);
            } else {
              report(
                node,
                'NOWNER',
                `${verb} on owner-bearing '${table}' is scoped by a non-unique key ` +
                  `with no owner column ('${meta.owner}') in its where predicate`
              );
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(src);
  }
}

findings.sort(
  (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.check.localeCompare(b.check)
);

// ---------------------------------------------------------------------------
// `--stats` prints what the guard deliberately does NOT gate on. A guard that
// only ever prints its own findings makes its blind spots invisible, which is
// how "green" came to read as "tree-wide owner-scoping health" (WIC-1672).
// ---------------------------------------------------------------------------
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ findings, stats }, null, 2));
  process.exit(0);
}

if (process.argv.includes('--stats')) {
  const byCheck = findings.reduce((m, f) => m.set(f.check, (m.get(f.check) ?? 0) + 1), new Map());
  console.log(`owner-bearing tables in schema : ${stats.ownerTables}`);
  console.log(`update/delete sites against them: ${stats.writeSites}`);
  for (const check of ['SIG', 'COND', 'NOWNER']) {
    console.log(`findings [${check.padEnd(6)}]            : ${byCheck.get(check) ?? 0}`);
  }
  console.log(`\nNOT gated on -- unique/pk-scoped writes (${stats.uniqueScopedWrites.length}):`);
  console.log(
    '  one row at most, so not cross-tenant by cardinality; whether the id was\n' +
      '  owner-checked upstream is an IDOR question outside this guard.'
  );
  for (const s of stats.uniqueScopedWrites) console.log(`    ${s}`);
  console.log(
    `\nNOT gated on -- predicates we cannot see through (${stats.opaquePredicates.length}):`
  );
  for (const s of stats.opaquePredicates) console.log(`    ${s}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Baseline. `origin/main` carries a large pre-existing population of these
// sites; failing on all of them would make the guard unlandable until the last
// one is fixed, which is the deadlock that let the count reach 48 in the first
// place. So we freeze the known set and fail only on *new* ones. The baseline
// is keyed on file + check + a normalised snippet, NOT on line number, so that
// unrelated edits above a site do not spuriously "add" it.
// Burn the baseline down; never append to it by hand.
//   --write-baseline   regenerate (only when deliberately accepting the set)
// ---------------------------------------------------------------------------
const BASELINE_PATH = join(API_ROOT, 'scripts/owner-predicates.baseline.json');
const keyOf = (f) => `${f.file}\u0000${f.check}\u0000${f.detail}`;

// Multiple identical findings can occur in one file (e.g. five identical
// ternaries); count them so removing one cannot mask adding another.
const tally = (list) => {
  const m = new Map();
  for (const f of list) m.set(keyOf(f), (m.get(keyOf(f)) ?? 0) + 1);
  return m;
};

if (process.argv.includes('--write-baseline')) {
  const { writeFileSync } = await import('node:fs');
  const out = [...tally(findings).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, count]) => {
      const [file, check, detail] = k.split('\u0000');
      return { file, check, detail, count };
    });
  writeFileSync(BASELINE_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`audit-owner-predicates: wrote baseline with ${findings.length} finding(s).`);
  process.exit(0);
}

let baseline = new Map();
try {
  for (const e of JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))) {
    baseline.set(`${e.file}\u0000${e.check}\u0000${e.detail}`, e.count);
  }
} catch {
  baseline = new Map(); // no baseline yet => every finding is new
}

const current = tally(findings);
// A tripped key prints *every* site sharing it, because the key is deliberately
// line-agnostic and cannot say which physical site is the new one. So carry the
// arithmetic: a key going 3 -> 4 is one new site among four candidates, not four
// new violations. Without this the report reads far worse than the regression is
// (13 sites printed for a 2-site regression, measured in WIC-1853's repro).
const regressions = [];
let addedTotal = 0;
let trippedKeys = 0;
for (const [k, count] of current) {
  const allowed = baseline.get(k) ?? 0;
  const added = count - allowed;
  if (added > 0) {
    addedTotal += added;
    trippedKeys += 1;
    const [file, check, detail] = k.split('\u0000');
    for (const f of findings) {
      if (keyOf(f) === k) regressions.push({ file, check, detail, line: f.line, added, count });
    }
  }
}

const fixed = [...baseline.entries()].reduce(
  (n, [k, count]) => n + Math.max(0, count - (current.get(k) ?? 0)),
  0
);

// A guard that prints only its own findings makes its blind spots invisible,
// which is how a green run came to be read as tree-wide owner-scoping health.
// The counts below are NOT gated on; `--stats` lists the sites (WIC-1672).
const blindSpots =
  `${stats.uniqueScopedWrites.length} unique/pk-scoped write(s) and ` +
  `${stats.opaquePredicates.length} unresolved predicate(s) not gated on (--stats)`;

if (regressions.length === 0) {
  console.log(
    `audit-owner-predicates: no new owner-absent branches. ` +
      `${findings.length} baselined site(s) remain${fixed ? `, ${fixed} fixed since baseline` : ''}.\n` +
      `  scope: fail-open predicates + owner-absent writes; ${blindSpots}.`
  );
  process.exit(0);
}

console.error(
  `audit-owner-predicates: ${addedTotal} NEW site(s) allow an absent owner (AC-T0),\n` +
    `across ${regressions.length} candidate site(s) in ${trippedKeys} tripped key(s).\n` +
    `An authenticated request with no resolved owner must match zero rows.\n` +
    `Require the owner (userId: string) instead of branching on its absence.\n` +
    `A fail-closed 'userId ? eq(t.userId, userId) : isNull(t.userId)' scope helper\n` +
    `is exempt by shape -- see the note above failClosedOwnerTernary().\n`
);
let lastFile = null;
for (const f of regressions.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  if (f.file !== lastFile) {
    console.error(`  ${f.file}`);
    lastFile = f.file;
  }
  const share = f.count > f.added ? `  (${f.added} of ${f.count} in this key are new)` : '';
  console.error(`    :${String(f.line).padStart(4)}  [${f.check}]  ${f.detail}${share}`);
}
console.error(`\n  ${findings.length} total site(s), ${baseline.size} baselined key(s).`);
process.exit(1);
