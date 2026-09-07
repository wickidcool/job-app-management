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
function git(args, cwd, { raw = false } = {}) {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // `--porcelain` encodes status in the first two columns, so a leading space is
    // data. Trimming the whole buffer eats it on the first line only, which silently
    // misaligns the listing; `raw` strips the trailing newline and nothing else.
    return raw ? out.replace(/\n$/, '') : out.trim();
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
export function evaluateCurrency({
  behind,
  missing = [],
  upstream,
  head,
  dirty = [],
  allowDirty = false,
}) {
  if (typeof behind !== 'number' || Number.isNaN(behind)) {
    return { current: false, reason: 'unmeasured', behind: null, missing: [], upstream, head, dirty };
  }
  if (behind > 0) {
    return { current: false, reason: 'behind', behind, missing, upstream, head, dirty };
  }
  // Level with the remote but carrying uncommitted edits: the suite about to run is
  // not the suite at `head`, so its result certifies no commit. Refuse by default
  // for the same fail-closed reason the `behind` case refuses.
  if (dirty.length > 0 && !allowDirty) {
    return { current: false, reason: 'dirty', behind: 0, missing: [], upstream, head, dirty };
  }
  return { current: true, reason: 'current', behind: 0, missing: [], upstream, head, dirty };
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
  //
  // The two ways to not be a work tree fail differently and BOTH have to land here:
  // a bare repository answers `false` with exit 0, while a directory that is not a
  // repository at all makes `rev-parse` exit 128, which `git()` turns into a
  // `GitError` carrying raw porcelain. Letting that GitError escape was the common
  // case and it defeated the stated purpose of this check — the operator saw
  // `fatal: not a git repository` rather than a sentence naming the directory they
  // actually passed. Catch it and report the same thing either way.
  let inside;
  try {
    inside = git(['rev-parse', '--is-inside-work-tree'], cwd);
  } catch {
    throw new Error(
      `[tree-currency-guard] ${cwd} is not a git work tree (not a repository).`
    );
  }
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

  // Uncommitted work is a SECOND way the tree can differ from what `head` names,
  // and `behind` cannot see it. Without this, an operator can revert a shipped fix
  // as a working-tree edit, sit at `behind == 0`, and be told the tree is current —
  // reproducing the exact fail-open in the opening paragraph through another
  // channel. `--porcelain` is read-only and leaves AC3 intact.
  const dirty = git(['status', '--porcelain'], cwd, { raw: true }).split('\n').filter(Boolean);

  return { head, upstreamSha, upstream, behind, ahead, missing, dirty };
}

/** Render the refusal an operator reads. Names the commits, never guesses a fix. */
export function formatFailure({ upstream, behind, missing, ahead, head }) {
  const listed = missing.slice(0, MAX_LISTED);
  const rest = missing.length - listed.length;
  // Width from the actual label, not a literal: `origin/main` is 11 characters, so a
  // hard-coded pad of 9 never fired and the two rows did not line up.
  const label = Math.max('HEAD'.length, upstream.length);
  return [
    `[tree-currency-guard] This checkout is ${behind} commit${behind === 1 ? '' : 's'} ` +
      `behind ${upstream}. Refusing to certify any suite result from it.`,
    '',
    `  ${'HEAD'.padEnd(label)} : ${head}`,
    `  ${upstream.padEnd(label)} : ahead of you by ${behind}` +
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

/** Render the refusal for a tree that is level with the remote but not clean. */
export function formatDirtyFailure({ upstream, dirty, head }) {
  const listed = dirty.slice(0, MAX_LISTED);
  const rest = dirty.length - listed.length;
  return [
    `[tree-currency-guard] This checkout is level with ${upstream} but has ` +
      `${dirty.length} uncommitted change${dirty.length === 1 ? '' : 's'}. ` +
      `Refusing to certify any suite result from it.`,
    '',
    `  HEAD : ${head}`,
    '',
    'Uncommitted changes:',
    ...listed.map((line) => `  ${line}`),
    ...(rest > 0 ? [`  ... and ${rest} more`] : []),
    '',
    'Being level with the remote only says the COMMITTED tree is current. A working-',
    'tree edit can revert a shipped fix while the commit graph still reads clean, so',
    'a suite run here certifies no commit at all.',
    '',
    'Commit or stash, or pass --allow-dirty to certify the commit graph alone.',
    '',
  ].join('\n');
}

/** Throw unless the checkout is current. Returns the measurement when it passes. */
export function assertTreeCurrent(options = {}) {
  const measured = inspectTree(options);
  const verdict = evaluateCurrency({ ...measured, allowDirty: options.allowDirty });
  if (verdict.reason === 'dirty') throw new Error(formatDirtyFailure(measured));
  if (!verdict.current) throw new Error(formatFailure(measured));
  return measured;
}

function parseArgv(argv) {
  const opts = { cwd: process.cwd(), upstream: 'origin/main', fetch: true, allowDirty: false };
  // A flag whose value is missing must throw, never fall back. `--cwd` with nothing
  // after it used to yield `undefined`, which the destructuring default in
  // `inspectTree` quietly turned back into `process.cwd()` — so the operator asked
  // about one tree and got a green about a different one, with no directory named.
  const value = (flag, v) => {
    if (v === undefined) throw new Error(`[tree-currency-guard] ${flag} requires a value.`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-fetch') opts.fetch = false;
    else if (arg === '--allow-dirty') opts.allowDirty = true;
    else if (arg === '--upstream') opts.upstream = value(arg, argv[(i += 1)]);
    else if (arg === '--cwd') opts.cwd = value(arg, argv[(i += 1)]);
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
          'Usage: node scripts/tree-currency-guard.mjs [--upstream <ref>] [--cwd <dir>]',
          '                                           [--no-fetch] [--allow-dirty]',
          '',
          "  Exits non-zero when the checkout is behind its upstream, naming the commits",
          '  that are missing, or when it carries uncommitted changes. Never modifies',
          '  the working tree, index, or HEAD.',
          '',
          '  --no-fetch     Skip updating remote-tracking refs. Only safe when something',
          '                 else has already fetched; otherwise this guard can fail open.',
          '  --allow-dirty  Certify the commit graph alone, ignoring uncommitted changes.',
          '',
          '  Checks commit currency only. A pass does NOT check installed dependencies:',
          '  a tree level with the remote can still have stale or absent node_modules.',
          '',
        ].join('\n')
      );
      process.exit(0);
    }
    const measured = assertTreeCurrent(opts);
    // State the boundary of the green. This tool's whole value is the trust its pass
    // buys, so the pass must not imply more than was measured: it certifies commit
    // currency and nothing else. Dependency currency in particular is unchecked, and
    // is a live hazard in this repo — a tree level with the remote has been found
    // running its suite on an orphan vitest that answers a different question.
    process.stdout.write(
      `[tree-currency-guard] Tree is current with ${measured.upstream} ` +
        `(${measured.upstreamSha.slice(0, 8)})` +
        (measured.ahead ? `, ${measured.ahead} local commit(s) ahead` : '') +
        (measured.dirty.length
          ? `, ${measured.dirty.length} uncommitted change(s) IGNORED (--allow-dirty)`
          : '') +
        '.\n' +
        '[tree-currency-guard] Commit currency only. Not checked: installed ' +
        'dependencies (node_modules may be stale or absent).\n'
    );
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
