// WIC-2222. Refuse to certify a suite result produced by a checkout that is behind
// the remote.
//
// The failure this exists to catch reads GREEN, and the test suite is the thing
// concealing it. A stale checkout runs the stale *tests* against the stale *code*,
// so the two agree and the tree passes. Concretely (2026-09-07): the primary
// checkout sat 3 commits behind `origin/main`, missing the WIC-2217 fix that stopped
// `scripts/vitest-version-guard.mjs` fail-opening on semver prereleases. In that
// tree `4.2.0-beta.1` satisfied `^4.1.11` — a confidently wrong answer in the
// fail-open direction — and the suite passed, because the pre-2217 tests do not
// contain the prerelease cases. Independently, a second workspace checkout was
// found 16 commits behind the same day, so this is a pattern across trees rather
// than one operator forgetting to pull.
//
// Green-in-my-tree therefore carries no information about whether a shipped fix is
// armed there. A guard cannot check its own currency: every file is stale together,
// including the assertions that would have caught it. The only way out is to
// compare the tree against the remote, which is what this does.
//
// Deliberately NOT a sync helper. It never resets, merges, or fast-forwards — a
// helper that resets to the remote drops local commits, a failure already
// reproduced byte-for-byte in this fleet. This refuses to certify and names the
// missing commits; a human or the operator decides how to reconcile.
//
// Kept dependency-free so it can run in any tree, including one whose node_modules
// is itself stale or absent.

import { execFileSync } from 'node:child_process';

/** Commits listed by name before the message collapses to a count. */
const MAX_LISTED = 20;

/**
 * Run git and return trimmed stdout, or throw a `GitError` carrying stderr.
 *
 * `execFileSync` (not `exec`) so nothing goes through a shell: refs and paths reach
 * git as argv entries and cannot be reinterpreted as shell syntax.
 */
function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const e = new Error(
      `git ${args.join(' ')} failed: ${String(err.stderr || err.message).trim()}`
    );
    e.name = 'GitError';
    throw e;
  }
}

/**
 * Update remote-tracking refs only.
 *
 * This is load-bearing and is the one place the guard touches the repository at
 * all. Without it the comparison runs against whatever `origin/main` happened to
 * point at the last time somebody fetched, so a tree that is genuinely behind can
 * be certified current — the guard would fail open in exactly the direction it
 * exists to close. The card's sketch of this check omitted the fetch; that sketch
 * is only safe when some earlier step already fetched.
 *
 * It writes refs, never the working tree, index, or HEAD. That distinction is what
 * keeps AC3 ("does not mutate the tree") true: `git fetch` with no refspec beyond
 * the remote's default updates `refs/remotes/*` and nothing a build could observe.
 * There is no fast-forward here and no checkout.
 */
function fetchRefs(remote, cwd) {
  git(['fetch', '--quiet', remote], cwd);
}

/**
 * Decide currency from already-measured facts.
 *
 * Split out from the measurement so the ruling is inspectable on its own, but note
 * the measurement is the part that can realistically break, so the tests drive real
 * repositories through `inspectTree` rather than leaning on this.
 */
export function evaluateCurrency({ behind, missing = [], upstream, head }) {
  if (typeof behind !== 'number' || Number.isNaN(behind)) {
    return { current: false, reason: 'unmeasured', behind: null, missing: [], upstream, head };
  }
  if (behind > 0) return { current: false, reason: 'behind', behind, missing, upstream, head };
  return { current: true, reason: 'current', behind: 0, missing: [], upstream, head };
}

/**
 * Measure this checkout against `upstream` using real git.
 *
 * Fails CLOSED. Any condition that leaves currency unknown — not a repository, the
 * upstream ref absent, a fetch that could not reach the remote — raises rather than
 * returning "current". An unknown answer here is indistinguishable from a stale
 * tree, and treating it as a pass reintroduces the whole defect: the guard would go
 * quiet precisely when it cannot see.
 */
export function inspectTree({ cwd = process.cwd(), upstream = 'origin/main', fetch = true } = {}) {
  // Establish we are in a work tree before anything else, so a wrong `cwd` reports
  // as a wrong cwd instead of as a missing ref.
  const inside = git(['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside !== 'true') {
    throw new Error(`[tree-currency-guard] ${cwd} is not a git work tree.`);
  }

  const remote = upstream.includes('/') ? upstream.slice(0, upstream.indexOf('/')) : 'origin';
  if (fetch) fetchRefs(remote, cwd);

  // Resolve the upstream explicitly. `rev-list HEAD..missing-ref` would otherwise
  // fail with a message about a bad revision that reads like a bug in this guard.
  let upstreamSha;
  try {
    upstreamSha = git(['rev-parse', '--verify', `${upstream}^{commit}`], cwd);
  } catch {
    throw new Error(
      `[tree-currency-guard] Cannot resolve '${upstream}' in ${cwd}. ` +
        `Refusing to certify: with no upstream to compare against, this guard cannot ` +
        `tell a current tree from a stale one.`
    );
  }

  const head = git(['rev-parse', 'HEAD'], cwd);
  const behind = Number(git(['rev-list', '--count', `HEAD..${upstream}`], cwd));
  const ahead = Number(git(['rev-list', '--count', `${upstream}..HEAD`], cwd));
  const missing = behind
    ? git(['log', '--oneline', '--no-decorate', `HEAD..${upstream}`], cwd).split('\n').filter(Boolean)
    : [];

  return { head, upstreamSha, upstream, behind, ahead, missing };
}

/** Render the refusal an operator reads. Names the commits, never guesses a fix. */
export function formatFailure({ upstream, behind, missing, ahead, head }) {
  const listed = missing.slice(0, MAX_LISTED);
  const rest = missing.length - listed.length;
  return [
    `[tree-currency-guard] This checkout is ${behind} commit${behind === 1 ? '' : 's'} ` +
      `behind ${upstream}. Refusing to certify any suite result from it.`,
    '',
    `  HEAD     : ${head}`,
    `  ${upstream.padEnd(9)}: ahead of you by ${behind}` +
      (ahead ? `, and you are ahead by ${ahead}` : ''),
    '',
    'Shipped commits that are NOT armed in this tree:',
    ...listed.map((line) => `  - ${line}`),
    ...(rest > 0 ? [`  ... and ${rest} more`] : []),
    '',
    'A stale tree runs stale tests against stale code, so they agree and it reads',
    'green. That green says nothing about whether the fixes above are present.',
    '',
    ahead
      ? `You have ${ahead} local commit${ahead === 1 ? '' : 's'}; reconcile with a merge or ` +
        `rebase. Do NOT reset to the remote — that would drop them.`
      : 'This tree has no local commits, so a fast-forward is lossless:\n\n  git merge --ff-only ' +
        upstream,
    '',
  ].join('\n');
}

/** Throw unless the checkout is current. Returns the measurement when it passes. */
export function assertTreeCurrent(options = {}) {
  const measured = inspectTree(options);
  const verdict = evaluateCurrency(measured);
  if (!verdict.current) throw new Error(formatFailure(measured));
  return measured;
}

function parseArgv(argv) {
  const opts = { cwd: process.cwd(), upstream: 'origin/main', fetch: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-fetch') opts.fetch = false;
    else if (arg === '--upstream') opts.upstream = argv[(i += 1)];
    else if (arg === '--cwd') opts.cwd = argv[(i += 1)];
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`[tree-currency-guard] Unknown argument: ${arg}`);
  }
  return opts;
}

// Run as a CLI only when invoked directly, so importing this from a test does not
// exit the test process.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const opts = parseArgv(process.argv.slice(2));
    if (opts.help) {
      process.stdout.write(
        [
          'Usage: node scripts/tree-currency-guard.mjs [--upstream <ref>] [--cwd <dir>] [--no-fetch]',
          '',
          "  Exits non-zero when the checkout is behind its upstream, naming the commits",
          '  that are missing. Never modifies the working tree, index, or HEAD.',
          '',
          '  --no-fetch  Skip updating remote-tracking refs. Only safe when something',
          '              else has already fetched; otherwise this guard can fail open.',
          '',
        ].join('\n')
      );
      process.exit(0);
    }
    const measured = assertTreeCurrent(opts);
    process.stdout.write(
      `[tree-currency-guard] Tree is current with ${measured.upstream} ` +
        `(${measured.upstreamSha.slice(0, 8)})` +
        (measured.ahead ? `, ${measured.ahead} local commit(s) ahead.` : '.') +
        '\n'
    );
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
