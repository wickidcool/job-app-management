#!/usr/bin/env node
/**
 * AC-T0 guard: an authenticated request with no resolved owner must match zero rows.
 *
 * Two checks, run over `packages/api/src/services` and `packages/api/src/routes`:
 *
 *   [SIG]  an exported service function whose owner parameter is optional or
 *          nullable.  This is the *precondition* for a fail-open predicate --
 *          you cannot branch on an absent owner if absence is unrepresentable.
 *
 *   [COND] the owner identifier used in a conditional position (ternary test,
 *          `if`, `&&`/`||`).  Defence in depth, and the check that catches a
 *          predicate reintroduced against a still-optional signature.
 *
 * Uses the TypeScript compiler's own parser, so it sees every syntactic shape
 * (ternary, `if (userId) conditions.push(...)`, `...(userId ? [x] : [])`)
 * rather than the one shape a regex or a naive lint selector was written for.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['src/services', 'src/routes'];
const OWNER_NAMES = new Set(['userId', 'ownerId']);

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

/** Is this type node optional/nullable -- i.e. can the owner be absent? */
function ownerMayBeAbsent(param) {
  if (param.questionToken || param.initializer) return true;
  const t = param.type;
  if (!t) return true; // untyped => implicitly any => absent is representable
  if (t.kind === ts.SyntaxKind.UnionType) {
    return t.types.some(
      (m) =>
        m.kind === ts.SyntaxKind.UndefinedKeyword ||
        m.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isLiteralTypeNode(m) && m.literal.kind === ts.SyntaxKind.NullKeyword)
    );
  }
  return false;
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

for (const scanDir of SCAN_DIRS) {
  let files;
  try {
    files = walkFiles(join(API_ROOT, scanDir));
  } catch {
    continue;
  }

  for (const file of files) {
    const rel = relative(API_ROOT, file);
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
    const lineOf = (node) => src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;

    const report = (node, check, detail) => {
      const line = lineOf(node);
      if (ALLOWLIST.has(`${rel}:${line}`)) return;
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
          if (ts.isIdentifier(p.name) && OWNER_NAMES.has(p.name.text) && ownerMayBeAbsent(p)) {
            if (p.name.text === helperOwner) continue; // fail-closed scope helper
            report(p, 'SIG', `owner parameter '${p.name.text}' is optional or nullable`);
          }
        }
      }

      // [COND] owner identifier in a conditional position
      const flagIfOwner = (expr, where) => {
        if (expr && ts.isIdentifier(expr) && OWNER_NAMES.has(expr.text)) {
          report(expr, 'COND', `'${expr.text}' branched on in ${where}`);
        }
      };
      if (ts.isConditionalExpression(node) && !failClosedOwnerTernary(node))
        flagIfOwner(node.condition, 'a ternary test');
      if (ts.isIfStatement(node)) flagIfOwner(node.expression, 'an if test');
      if (
        ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      ) {
        flagIfOwner(node.left, `a ${node.operatorToken.getText(src)} guard`);
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

if (regressions.length === 0) {
  console.log(
    `audit-owner-predicates: no new owner-absent branches. ` +
      `${findings.length} baselined site(s) remain${fixed ? `, ${fixed} fixed since baseline` : ''}.`
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
