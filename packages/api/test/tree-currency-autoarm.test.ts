// WIC-2228. Tests for the automatic arm in scripts/tree-currency-autoarm.mjs.
//
// Like its sibling tree-currency-guard.test.ts, these drive REAL git repositories
// (local bare repos acting as `origin`, so no network) rather than handing the
// predicate its answer. The predicate is the deliverable here, and every clause in it
// is a statement about a git fact — "is this a work tree", "is HEAD detached", "does
// `origin/main` resolve". A fixture that stubbed those would certify nothing.
//
// Two things this file is careful about:
//
//   1. `env` is passed EXPLICITLY everywhere. This suite runs in CI, where `CI` is
//      set, so a test that let `shouldArm` read the ambient `process.env` would take
//      the `ci` skip branch and pass for the wrong reason — vacuously green in
//      exactly the environment the card requires be unaffected (AC2).
//
//   2. Every skip case is paired with a CONTROL showing the same tree IS refused when
//      the skipped clause is removed. A skip test on its own passes just as happily
//      against an arm that never fires at all, which is the defect this whole lineage
//      is about.
import { describe, expect, it, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  shouldArm,
  maybeAssertTreeCurrent,
  OPT_OUT_ENV,
} from '../../../scripts/tree-currency-autoarm.mjs';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/** An environment that is NOT CI and has not opted out — the case the arm exists for. */
const LOCAL_ENV = {} as NodeJS.ProcessEnv;

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Run git with a pinned identity so the fixture does not depend on global config. */
function git(args: string[], cwd: string): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.email=guard@example.invalid',
      '-c',
      'user.name=Guard Fixture',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();
}

/**
 * Build a work tree on `main` whose `origin/main` has `remoteAhead` commits it lacks.
 *
 * `remoteBranch` exists for the "upstream does not resolve" case: an origin whose
 * only branch is something other than `main` fetches cleanly and still leaves
 * `origin/main` unresolvable, which is the shape a depth-1 CI checkout presents.
 */
function repo({ remoteAhead = 0, remoteBranch = 'main' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wic2228-'));
  scratch.push(root);
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');

  execFileSync('git', ['init', '--quiet', '--bare', '-b', remoteBranch, remote]);
  execFileSync('git', ['init', '--quiet', '-b', 'main', work]);
  git(['remote', 'add', 'origin', remote], work);

  writeFileSync(join(work, 'README.md'), 'base\n');
  git(['add', '.'], work);
  git(['commit', '--quiet', '-m', 'base'], work);
  git(['push', '--quiet', 'origin', `main:${remoteBranch}`], work);
  if (remoteBranch === 'main') {
    git(['branch', '--set-upstream-to=origin/main', 'main'], work);
  }

  // Advance the REMOTE past this tree through a throwaway clone, so the work tree is
  // left genuinely behind without ever being told so.
  if (remoteAhead > 0) {
    const other = join(root, 'other');
    execFileSync('git', ['clone', '--quiet', remote, other]);
    for (let i = 0; i < remoteAhead; i += 1) {
      writeFileSync(join(other, 'app.ts'), `shipped fix ${i}\n`);
      git(['add', '.'], other);
      git(['commit', '--quiet', '-m', `fix(guard): shipped change ${i}`], other);
    }
    git(['push', '--quiet', 'origin', remoteBranch], other);
  }

  return { root, work, remote };
}

describe('tree-currency arm — the predicate, on real repositories (WIC-2228)', () => {
  it('ARMS a local checkout on the branch that origin/main tracks', () => {
    const { work } = repo({ remoteAhead: 1 });
    expect(shouldArm({ cwd: work, env: LOCAL_ENV })).toMatchObject({
      arm: true,
      reason: 'armed',
      branch: 'main',
    });
  });

  it('SKIPS under CI, where the checkout is depth-1 and cannot answer (AC2)', () => {
    const { work } = repo({ remoteAhead: 1 });
    // Same tree as the test above, which arms. The ONLY difference is the env, so
    // this cannot pass by the arm being dead.
    expect(shouldArm({ cwd: work, env: { CI: 'true' } })).toMatchObject({
      arm: false,
      reason: 'ci',
    });
    expect(shouldArm({ cwd: work, env: LOCAL_ENV }).arm).toBe(true);
  });

  it('SKIPS when the operator opted out', () => {
    const { work } = repo({ remoteAhead: 1 });
    expect(shouldArm({ cwd: work, env: { [OPT_OUT_ENV]: '1' } })).toMatchObject({
      arm: false,
      reason: 'opted-out',
    });
    expect(shouldArm({ cwd: work, env: LOCAL_ENV }).arm).toBe(true);
  });

  it('SKIPS a feature branch that is legitimately behind origin/main (AC3)', () => {
    const { work } = repo({ remoteAhead: 2 });
    git(['checkout', '--quiet', '-b', 'fix/some-work'], work);

    expect(shouldArm({ cwd: work, env: LOCAL_ENV })).toMatchObject({
      arm: false,
      reason: 'not-tracking-main',
      branch: 'fix/some-work',
    });
    expect(() => maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV })).not.toThrow();

    // The control that makes the assertion above mean something: this SAME tree, at
    // the same commit, behind by the same 2, IS refused once it is on `main`. So the
    // pass is the branch clause working, not the arm being inert.
    git(['checkout', '--quiet', 'main'], work);
    expect(() => maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV })).toThrow(
      /2 commits behind origin\/main/
    );
  });

  it('SKIPS a detached HEAD rather than reading it as a branch named HEAD', () => {
    const { work } = repo({ remoteAhead: 1 });
    git(['checkout', '--quiet', '--detach'], work);
    expect(shouldArm({ cwd: work, env: LOCAL_ENV })).toMatchObject({
      arm: false,
      reason: 'detached-head',
    });
  });

  it('SKIPS when origin/main does not resolve, the shape a depth-1 clone presents', () => {
    // origin exists and fetches cleanly; it simply has no `main`. This is the second,
    // independent discriminator the card asked for — it holds even if `CI` is unset.
    const { work } = repo({ remoteBranch: 'trunk' });
    expect(shouldArm({ cwd: work, env: LOCAL_ENV })).toMatchObject({
      arm: false,
      reason: 'upstream-unresolvable',
    });
    expect(() => maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV })).not.toThrow();
  });

  it('SKIPS a branch named main that tracks somewhere other than origin/main', () => {
    const { work, root } = repo({ remoteAhead: 1 });
    const fork = join(root, 'fork.git');
    execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', fork]);
    git(['remote', 'add', 'fork', fork], work);
    git(['push', '--quiet', 'fork', 'main'], work);
    git(['branch', '--set-upstream-to=fork/main', 'main'], work);

    expect(shouldArm({ cwd: work, env: LOCAL_ENV })).toMatchObject({
      arm: false,
      reason: 'tracks-other-upstream',
      configured: 'fork/main',
    });
  });

  it('SKIPS a directory that is not a git work tree at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wic2228-plain-'));
    scratch.push(dir);
    expect(shouldArm({ cwd: dir, env: LOCAL_ENV })).toMatchObject({
      arm: false,
      reason: 'not-a-work-tree',
    });
  });

  it('ARMS a main branch with no upstream configured at all', () => {
    // A fresh worktree frequently has no tracking ref. `origin/main` is the right
    // default for a branch named `main`, so an unset upstream must not be confused
    // with an upstream pointing elsewhere.
    const { work } = repo({ remoteAhead: 1 });
    git(['branch', '--unset-upstream', 'main'], work);
    expect(shouldArm({ cwd: work, env: LOCAL_ENV })).toMatchObject({ arm: true, reason: 'armed' });
  });
});

describe('tree-currency arm — what it does once armed (WIC-2228)', () => {
  it('REFUSES a tree on main that is behind origin/main (AC1)', () => {
    const { work } = repo({ remoteAhead: 3 });
    expect(() => maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV })).toThrow(
      /3 commits behind origin\/main/
    );
    // It names the commits, exactly as the CLI does — the refusal has to be
    // actionable from inside a test run, where the operator did not ask for it.
    expect(() => maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV })).toThrow(
      /shipped change 2/
    );
  });

  it('explains that the refusal came from globalSetup, and how to get out', () => {
    const { work } = repo({ remoteAhead: 1 });
    // A refusal an operator cannot interpret or escape is one they delete. Both
    // halves are load-bearing: what refused them, and the documented way past it.
    expect(() => maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV })).toThrow(
      /vitest globalSetup/
    );
    expect(() => maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV })).toThrow(
      new RegExp(`${OPT_OUT_ENV}=1`)
    );
  });

  it('PASSES a tree that is level with origin/main', () => {
    const { work } = repo({ remoteAhead: 0 });
    const result = maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV });
    expect(result.arm).toBe(true);
    expect(result.measured.behind).toBe(0);
  });

  it('PASSES a level tree that is dirty — the arm grades the commit graph only', () => {
    // Deliberate, and the opposite of what `npm run preflight` does. Editing a file
    // and running the tests is the entire inner development loop; an arm that refused
    // it would refuse every local run and be removed. The strict check stays on the
    // explicit entry point (AC4).
    const { work } = repo({ remoteAhead: 0 });
    writeFileSync(join(work, 'README.md'), 'edited in the working tree\n');
    expect(() => maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV })).not.toThrow();
  });

  it('still REFUSES a dirty tree that is ALSO behind — dirt does not mask staleness', () => {
    // The pairing that keeps the test above from being a hole: allowing dirty must
    // relax the `dirty` verdict only, never the `behind` one.
    const { work } = repo({ remoteAhead: 1 });
    writeFileSync(join(work, 'README.md'), 'edited in the working tree\n');
    expect(() => maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV })).toThrow(
      /1 commit behind origin\/main/
    );
  });

  it('PASSES a tree that is ahead of origin/main with local commits', () => {
    const { work } = repo({ remoteAhead: 0 });
    writeFileSync(join(work, 'local.ts'), 'wip\n');
    git(['add', '.'], work);
    git(['commit', '--quiet', '-m', 'local work'], work);
    const result = maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV });
    expect(result.measured.behind).toBe(0);
    expect(result.measured.ahead).toBe(1);
  });

  it('fetches before grading, so a tree that never fetched is still caught', () => {
    // The fail-open this closes: without the fetch the arm compares against whatever
    // `origin/main` pointed at last time somebody pulled, which on a stale tree is
    // itself stale, so it certifies the tree as current. Build the gap AFTER the
    // fixture's last fetch and confirm it is still seen.
    const { work, root } = repo({ remoteAhead: 0 });
    expect(() => maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV })).not.toThrow();

    const other = join(root, 'later');
    execFileSync('git', ['clone', '--quiet', join(root, 'remote.git'), other]);
    writeFileSync(join(other, 'app.ts'), 'shipped after the last fetch\n');
    git(['add', '.'], other);
    git(['commit', '--quiet', '-m', 'fix(guard): landed later'], other);
    git(['push', '--quiet', 'origin', 'main'], other);

    // Nothing fetched in `work`; the arm has to do it itself.
    expect(git(['rev-parse', 'origin/main'], work)).toBe(git(['rev-parse', 'HEAD'], work));
    expect(() => maybeAssertTreeCurrent({ cwd: work, env: LOCAL_ENV })).toThrow(
      /1 commit behind origin\/main/
    );
  });
});

// The lineage this card closes is not "the guard is wrong", it is "the guard is not
// attached to anything". WIC-2222 shipped it with zero call sites; WIC-2225 gave it an
// npm script, which arms it only for someone who remembers to type it. So the wiring
// is what has to be pinned, and pinned by the HAZARD — "no globalSetup invokes the
// arm" — rather than by any string that a rename would silently satisfy.
describe('tree-currency arm — the arm is attached to every vitest package (WIC-2228)', () => {
  // Discovered off the filesystem, not written down: a hardcoded ['api', 'web'] would
  // still pass on the day someone adds packages/worker with an unarmed config.
  const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PACKAGES_DIR, e.name, 'vitest.config.ts')))
    .map((e) => e.name)
    .sort();

  it('found the workspaces that run vitest', () => {
    // Guards the discovery itself. An empty `packages` makes every `it.each` below
    // register ZERO cases, which reports as a shrinking test count and a green run —
    // byte-indistinguishable from a passing suite unless something asserts the count.
    expect(packages.length).toBeGreaterThanOrEqual(2);
    expect(packages).toEqual(expect.arrayContaining(['api', 'web']));
  });

  it.each(packages)('packages/%s globalSetup calls the arm', (name) => {
    const wrapper = readFileSync(join(PACKAGES_DIR, name, 'vitest.globalSetup.mjs'), 'utf8');
    // A CALL, not a mention: `/maybeAssertTreeCurrent/` alone would keep matching the
    // import statement after the call itself was deleted, which is precisely the
    // "shipped but not armed" shape this card exists to close.
    expect(wrapper).toMatch(/maybeAssertTreeCurrent\s*\(\s*\{/);
    expect(wrapper).toMatch(/scripts\/tree-currency-autoarm\.mjs/);
    expect(wrapper).toMatch(/export function setup\s*\(/);
  });

  it.each(packages)('packages/%s vitest config still loads that wrapper', (name) => {
    const config = readFileSync(join(PACKAGES_DIR, name, 'vitest.config.ts'), 'utf8');
    expect(config).toMatch(/globalSetup:\s*\['\.\/vitest\.globalSetup\.mjs'\]/);
  });

  // The three above are textual and would pass on a wrapper that imports and calls the
  // arm with an argument that never resolves. This one EXECUTES the real wrapper and
  // observes the call, so the wiring is proven to run rather than proven to be spelled
  // correctly. `doMock` (not `mock`) so it is scoped to this test and the real module
  // imported at the top of the file is untouched.
  it('executing the real api globalSetup actually invokes the arm, at the repo root', async () => {
    vi.resetModules();
    const seen: Array<{ cwd?: string }> = [];
    vi.doMock('../../../scripts/tree-currency-autoarm.mjs', () => ({
      OPT_OUT_ENV,
      maybeAssertTreeCurrent: (opts: { cwd?: string }) => {
        seen.push(opts);
        return { arm: false, reason: 'stubbed' };
      },
    }));

    const wrapper = await import('../vitest.globalSetup.mjs');
    wrapper.setup();

    expect(seen).toHaveLength(1);
    // Repo root, not the package dir. Currency is a property of the checkout; pointed
    // at packages/api the arm would still be inside the same work tree and would
    // silently grade the right thing for the wrong reason — until someone vendored a
    // nested repository, at which point it would grade a different one.
    expect(seen[0].cwd).toBe(REPO_ROOT);

    vi.doUnmock('../../../scripts/tree-currency-autoarm.mjs');
    vi.resetModules();
  });

  it('npm run preflight remains the explicit manual entry point (AC4)', () => {
    const scripts: Record<string, string> = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')
    ).scripts;
    expect(scripts.preflight).toMatch(/scripts\/tree-currency-guard\.mjs/);
  });
});
