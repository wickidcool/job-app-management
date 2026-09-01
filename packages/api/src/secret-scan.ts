/**
 * Secret-material CI lint (ADR-0001 Pillar 3 — WIC-879).
 *
 * Scans committed files for secret-shaped material sitting in non-secret
 * surfaces (binding names, resource names, labels, or any committed value) and
 * fails the job with a message pointing at the file + field. Secrets belong in
 * the secret store / injected env — never in the repo.
 *
 *   npm run -w @wic/api scan:secrets
 *   npm run -w @wic/api scan:secrets -- path/to/file ...   # scan explicit files
 *
 * Exit codes: 0 = clean; 1 = at least one finding; 2 = usage / setup error.
 *
 * False positives are handled two ways (see docs/architecture/secret-scan.md):
 *   - Inline:  add `secret-scan:allow` (or `pragma: allowlist secret`) to the line.
 *   - Central: add an entry to .github/secret-scan-allowlist.json.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { scanFiles, formatFinding, type Allowlist, type ScanFileInput } from './lib/secret-scan.js';

const ALLOWLIST_PATH = '.github/secret-scan-allowlist.json';

/** Extensions worth scanning for prefix/shape patterns. */
const SCANNABLE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.toml',
  '.yml',
  '.yaml',
  '.md',
  '.txt',
  '.env',
  '.sh',
  '.example',
  '.vars',
]);

/**
 * Dotfiles worth scanning, matched by *basename*. `extname('.env') === ''` and
 * `extname('.env.production') === '.production'`, so the `.env` entry in
 * SCANNABLE_EXT above only ever matches a file literally named `foo.env` — a
 * real `.env`-family file was never reaching the scanner.
 */
const SCANNABLE_BASENAME = /^\.(env|envrc|npmrc|netrc|secrets?|pgpass)(\..*)?$/;

/** Files/paths never worth scanning (noise, vendored, or binary). */
const IGNORE_SUBPATHS = ['node_modules/', 'dist/', 'build/', '.wrangler/', 'test-results/'];
const IGNORE_BASENAMES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

/** Config/manifest files also get generic high-entropy scanning. */
export function isConfigFile(path: string): boolean {
  const base = basename(path);
  if (base === 'wrangler.jsonc' || base === 'wrangler.toml' || base === 'wrangler.json')
    return true;
  if (path.startsWith('.github/workflows/')) return true;
  if (extname(path) === '.toml') return true;
  if (base.startsWith('.dev.vars') || base.endsWith('.vars.example')) return true;
  // Env files are a secret-bearing manifest surface, same as `.dev.vars`.
  if (SCANNABLE_BASENAME.test(base)) return true;
  return false;
}

function repoRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function listTrackedFiles(root: string): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
    return out.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

export function shouldScan(path: string): boolean {
  if (IGNORE_SUBPATHS.some((p) => path.includes(p))) return false;
  const base = basename(path);
  if (IGNORE_BASENAMES.has(base)) return false;
  if (SCANNABLE_EXT.has(extname(path))) return true;
  return SCANNABLE_BASENAME.test(base);
}

function loadAllowlist(root: string): Allowlist | undefined {
  const p = join(root, ALLOWLIST_PATH);
  if (!existsSync(p)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    if (!Array.isArray(parsed?.allow)) {
      console.error(`[secret-scan] ${ALLOWLIST_PATH}: expected { "allow": [...] } — ignoring`);
      return undefined;
    }
    return parsed as Allowlist;
  } catch (err) {
    console.error(`[secret-scan] failed to parse ${ALLOWLIST_PATH}: ${(err as Error).message}`);
    process.exit(2);
  }
}

function readFile(root: string, rel: string): ScanFileInput | undefined {
  const abs = join(root, rel);
  try {
    if (!statSync(abs).isFile()) return undefined;
    const content = readFileSync(abs, 'utf8');
    if (/[\x00-\x08]/.test(content)) return undefined; // control bytes -> binary, skip
    return { path: rel, content, enableEntropy: isConfigFile(rel) };
  } catch {
    return undefined;
  }
}

function main(): void {
  const root = repoRoot();
  const allowlist = loadAllowlist(root);

  const explicit = process.argv.slice(2);
  let candidates: string[];
  if (explicit.length) {
    candidates = explicit.map((p) => relative(root, p) || p);
  } else {
    const tracked = listTrackedFiles(root);
    if (!tracked.length) {
      console.error('[secret-scan] no tracked files found (git ls-files empty) — nothing to scan');
      process.exit(2);
    }
    candidates = tracked.filter(shouldScan);
  }

  const files = candidates
    .map((rel) => readFile(root, rel))
    .filter((f): f is ScanFileInput => Boolean(f));

  const findings = scanFiles(files, { allowlist });

  if (findings.length) {
    console.error('::group::secret-scan findings');
    for (const f of findings) {
      // GitHub Actions annotation + a plain line so it reads in any log viewer.
      console.error(
        `::error file=${f.file},line=${f.line},col=${f.column}::` +
          `Secret-shaped material [${f.pattern}]` +
          (f.field ? ` in field "${f.field}"` : '') +
          ` — move it to the secret store / injected env, or allowlist it. (${f.redacted})`
      );
      console.error(`  ${formatFinding(f)}`);
    }
    console.error('::endgroup::');
    console.error(
      `\n[secret-scan] FAILED: ${findings.length} secret-shaped value(s) in ${files.length} scanned file(s).\n` +
        `  Fix: remove the value from the committed field and source it from the secret store / injected env.\n` +
        `  False positive? Add an inline \`secret-scan:allow\` comment or an entry in ${ALLOWLIST_PATH}.`
    );
    process.exit(1);
  }

  console.log(`[secret-scan] OK: no secret material in ${files.length} scanned file(s).`);
}

// Only run the CLI when invoked directly — importing this module (e.g. from a
// test that pins the file-discovery rules) must not scan the repo or exit.
if (process.argv[1] && /secret-scan\.[tj]s$/.test(process.argv[1])) main();
