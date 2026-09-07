// WIC-2228. Arm the tree-currency guard automatically, from inside the test run.
//
// WIC-2222 shipped `scripts/tree-currency-guard.mjs` with zero call sites, so it
// could never fire. WIC-2225 added `npm run preflight`, which made it *reachable*.
// Neither made it *fire before a suite*, which was the stated remedy — and "reachable
// if you remember" is not a guard, it is a convention. This module closes that: it
// runs the currency check from each package's `globalSetup`, so no invocation of the
// suite can skip it. Same reasoning as `scripts/vitest-version-guard.mjs`, which is
// wired the same way for the same reason: `npx vitest run` bypasses npm scripts
// entirely, and that is exactly how a wrong-tree result gets produced.
//
// ── Why this is a separate module and not a call to `assertTreeCurrent` ──────────
//
// The CLI guard fails CLOSED on everything, including "I could not measure". That is
// correct for `npm run preflight`, where an operator is deliberately asking to
// certify a result and an unknown answer must not read as a pass.
//
// It is wrong for `globalSetup`, and wiring it there unconditionally would break the
// repository. The `Lint & Test` job in `.github/workflows/deploy.yml` checks out with
// `actions/checkout@v4` and no `fetch-depth`, i.e. depth 1, where `origin/main` does
// not resolve — so the CLI guard exits 1. An unconditional arm therefore hard-fails
// EVERY CI run, and a guard that fails every run is a guard that gets deleted rather
// than a guard that fires.
//
// So the arm inverts one half of the policy and keeps the other:
//
//   measured and stale  -> REFUSE   (fail closed; this is the whole point)
//   cannot measure      -> SKIP     (fail open, silently; CI, no upstream, offline)
//
// The inversion is safe precisely because it is scoped to the *unmeasurable* case.
// It never converts a known-stale tree into a pass. What it gives up is coverage in
// environments that cannot answer the question at all — and in those environments the
// CLI guard's refusal carried no information either, it was pure noise.
//
// ── The predicate ───────────────────────────────────────────────────────────────
//
// Arm only when all of these hold:
//
//   1. `CI` is unset            — a CI checkout is depth-1 and cannot answer.
//   2. not opted out            — `WIC_SKIP_TREE_CURRENCY` escape hatch.
//   3. a git work tree          — a tarball export has no currency to check.
//   4. on a named branch        — detached HEAD is a bisect/replay, not a dev tree.
//   5. that branch is `main`    — AC3: a feature branch is LEGITIMATELY behind
//                                 `origin/main` and must not be refused.
//   6. tracking `origin`        — a local `main` tracking a fork is a different tree.
//   7. `origin/main` resolves   — belt-and-braces for (1); a depth-1 clone that
//                                 somehow lacks `CI` still cannot be graded.
//
// (5) is the clause that bounds this feature's reach, and it is deliberate. Being
// behind `origin/main` is a DEFECT on `main` and a NORMAL STATE on a feature branch,
// so the same measurement means opposite things and only one of them is refusable.
//
// ── Dirty trees are not refused here ────────────────────────────────────────────
//
// `assertTreeCurrent` refuses a tree that is level with the remote but carries
// uncommitted changes, and that is right for an explicit certification request: the
// suite about to run is not the suite at HEAD, so its result certifies no commit.
//
// From `globalSetup` it would refuse essentially every local run, because editing a
// file and running the tests is the entire inner development loop. Measured in this
// fleet's primary checkout on 2026-09-07, `git status --porcelain` was non-empty on a
// tree that was exactly level with `origin/main` — five entries, all nested `wt-*`
// worktree directories that live there permanently. A dirty-refusing arm would have
// refused that tree on every single run, forever, without ever being wrong about
// currency.
//
// So the arm passes `allowDirty: true` and grades the commit graph alone. The strict
// check remains available and unchanged through `npm run preflight`, which is where
// someone asking to certify a result should be looking anyway.
//
// Kept dependency-free for the same reason its siblings are: it must be able to run
// in a tree whose node_modules is stale or absent.

import { execFileSync } from 'node:child_process';

import { assertTreeCurrent } from './tree-currency-guard.mjs';

/** Env var an operator sets to silence the arm (bisect, offline, air-gapped). */
export const OPT_OUT_ENV = 'WIC_SKIP_TREE_CURRENCY';

/**
 * Bound on the `git fetch`.
 *
 * The arm sits in front of every local suite run, so its cost is paid constantly and
 * its failure mode on a slow or unreachable remote is a hang, not an error. A bounded
 * fetch that times out degrades to "cannot measure", which the predicate already
 * handles by skipping.
 */
export const FETCH_TIMEOUT_MS = 15_000;

/** Run git, returning trimmed stdout, or `null` if it failed for any reason. */
function tryGit(args, cwd, timeout) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(timeout ? { timeout } : {}),
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Decide whether the currency check can say anything meaningful about this tree.
 *
 * Returns `{ arm, reason }`. Every `arm: false` reason is a case where the answer is
 * unknowable, never a case where the answer is known and inconvenient.
 *
 * `env` is a parameter rather than a read of `process.env` so the CI branch is
 * testable without mutating the ambient environment of the process running the tests
 * — which, in a vitest worker, is shared.
 */
export function shouldArm({ cwd = process.cwd(), upstream = 'origin/main', env = process.env } = {}) {
  // Cheapest checks first: both are free, and both are the common case in the
  // environment they describe.
  if (env.CI) return { arm: false, reason: 'ci' };
  if (env[OPT_OUT_ENV]) return { arm: false, reason: 'opted-out' };

  if (tryGit(['rev-parse', '--is-inside-work-tree'], cwd) !== 'true') {
    return { arm: false, reason: 'not-a-work-tree' };
  }

  // `symbolic-ref` fails on a detached HEAD rather than answering the literal string
  // "HEAD" the way `rev-parse --abbrev-ref` does, so the detached case cannot be
  // mistaken for a branch that happens to be named HEAD.
  const branch = tryGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
  if (branch === null) return { arm: false, reason: 'detached-head' };

  // The branch component of the upstream: `origin/main` -> `main`.
  const slash = upstream.indexOf('/');
  const upstreamBranch = slash === -1 ? upstream : upstream.slice(slash + 1);
  if (branch !== upstreamBranch) return { arm: false, reason: 'not-tracking-main', branch };

  // A local branch named `main` that tracks somewhere other than `origin/main` is a
  // fork or a mirror; comparing it against `origin/main` would refuse it for being
  // behind a remote it never claimed to follow. An UNSET upstream still arms —
  // `origin/main` is the right default for a branch named `main`, and a fresh
  // worktree often has no tracking ref configured.
  const configured = tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], cwd);
  if (configured !== null && configured !== upstream) {
    return { arm: false, reason: 'tracks-other-upstream', branch, configured };
  }

  // Update remote-tracking refs before resolving, so a tree that has not fetched in a
  // week is graded against the real remote rather than against its own stale idea of
  // it. Without this the arm fails open in exactly the direction it exists to close.
  // A failure here (offline, unreachable remote, timeout) is unmeasurable, not stale.
  // Same remote-name derivation the CLI guard uses: an upstream with no slash names a
  // branch, not a remote, so it falls back to `origin` rather than fetching a remote
  // called `main`.
  const remote = slash === -1 ? 'origin' : upstream.slice(0, slash);
  if (tryGit(['fetch', '--quiet', remote], cwd, FETCH_TIMEOUT_MS) === null) {
    return { arm: false, reason: 'fetch-failed', branch };
  }

  if (tryGit(['rev-parse', '--verify', `${upstream}^{commit}`], cwd) === null) {
    return { arm: false, reason: 'upstream-unresolvable', branch };
  }

  return { arm: true, reason: 'armed', branch };
}

/**
 * Append the context a `globalSetup` refusal needs that a CLI refusal does not.
 *
 * The CLI message assumes the operator just typed the command. Here they typed
 * `npm test` and got a wall of git output, so the message has to say what refused
 * them and how to proceed — including the escape hatch. A guard whose refusal has no
 * documented way out is one someone deletes at 2am.
 */
function withArmContext(message, upstream) {
  return [
    message,
    'This refusal came from vitest globalSetup, not from a command you typed: the',
    'tree-currency guard is armed automatically for local checkouts on the branch',
    `tracked by ${upstream} (WIC-2228). CI is unaffected — it cannot resolve the`,
    'upstream and is skipped.',
    '',
    `To run the suite anyway, knowing its result certifies nothing: ${OPT_OUT_ENV}=1 npm test`,
    '',
  ].join('\n');
}

/**
 * Run the currency check when the predicate says it can be meaningful.
 *
 * Throws the guard's own refusal (plus arm context) when the tree is measurably
 * behind. Returns the `shouldArm` decision otherwise, so a caller — or a test — can
 * see WHICH clause declined rather than only that nothing happened.
 */
export function maybeAssertTreeCurrent({ cwd = process.cwd(), upstream = 'origin/main', env = process.env } = {}) {
  const decision = shouldArm({ cwd, upstream, env });
  if (!decision.arm) return decision;

  try {
    // `fetch: false` because `shouldArm` already fetched, and it had to: it needed
    // fresh refs to decide whether the upstream resolves at all. Fetching twice would
    // double the cost of every local run to buy nothing.
    //
    // `allowDirty: true` — see the header. The arm grades the commit graph; the
    // strict check stays on `npm run preflight`.
    const measured = assertTreeCurrent({ cwd, upstream, fetch: false, allowDirty: true });
    return { ...decision, measured };
  } catch (err) {
    const e = new Error(withArmContext(err.message, upstream));
    e.name = 'TreeCurrencyError';
    throw e;
  }
}
