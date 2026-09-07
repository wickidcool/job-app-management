// WIC-2222. Tests for the checkout-currency guard in scripts/tree-currency-guard.mjs.
//
// These drive REAL git repositories rather than passing a behind-count into the
// checker. That is the whole point: the arithmetic (`behind > 0`) is trivial and
// cannot plausibly break, while the measurement — resolving the upstream, counting
// the gap, staying fail-closed when the ref is missing — is where a defect would
// actually live. A fixture that handed `inspectTree` its answer would certify the
// one part that was never in doubt.
//
// Every repository here is local (a bare repo on disk acting as `origin`), so the
// real `git fetch` path is exercised with no network.
import { describe, expect, it, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  inspectTree,
  assertTreeCurrent,
  evaluateCurrency,
} from '../../../scripts/tree-currency-guard.mjs';

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
 * Build a work tree whose `origin/main` has `remoteAhead` commits the tree lacks.
 *
 * `remoteAhead: 0` is the current tree; anything higher is the stale tree. Both
 * directions come from the same builder so the only difference between the passing
 * and failing case is the thing under test.
 */
function repo({ remoteAhead = 0, localAhead = 0, fileName = 'app.ts' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wic2222-'));
  scratch.push(root);
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');

  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '--quiet', '-b', 'main', work]);
  git(['remote', 'add', 'origin', remote], work);

  writeFileSync(join(work, 'README.md'), 'base\n');
  git(['add', '.'], work);
  git(['commit', '--quiet', '-m', 'base'], work);
  git(['push', '--quiet', 'origin', 'main'], work);

  // Advance the REMOTE past this tree, via a throwaway clone, so the work tree is
  // left genuinely behind without ever being told so.
  if (remoteAhead > 0) {
    const other = join(root, 'other');
    execFileSync('git', ['clone', '--quiet', remote, other]);
    for (let i = 0; i < remoteAhead; i += 1) {
      // `fileName` may be nested (the AC4 case commits docs/unrelated.md).
      mkdirSync(dirname(join(other, fileName)), { recursive: true });
      writeFileSync(join(other, fileName), `shipped fix ${i}\n`);
      git(['add', '.'], other);
      git(['commit', '--quiet', '-m', `fix(guard): shipped change ${i}`], other);
    }
    git(['push', '--quiet', 'origin', 'main'], other);
  }

  for (let i = 0; i < localAhead; i += 1) {
    writeFileSync(join(work, `local-${i}.ts`), 'wip\n');
    git(['add', '.'], work);
    git(['commit', '--quiet', '-m', `wip ${i}`], work);
  }

  return { root, work, remote };
}

describe('tree-currency-guard — both directions on real repositories (WIC-2222)', () => {
  it('PASSES when the tree is level with origin/main', () => {
    const { work } = repo({ remoteAhead: 0 });
    const measured = assertTreeCurrent({ cwd: work });
    expect(measured.behind).toBe(0);
    expect(measured.missing).toEqual([]);
  });

  it('FAILS when the tree is behind, and names the missing commits', () => {
    const { work } = repo({ remoteAhead: 3 });
    // The positive direction above and this one differ only in `remoteAhead`, so a
    // guard that always passed would fail here and a guard that always failed would
    // fail there. Neither direction is vacuous.
    expect(() => assertTreeCurrent({ cwd: work })).toThrow(/3 commits behind origin\/main/);
    expect(() => assertTreeCurrent({ cwd: work })).toThrow(/shipped change 2/);
  });

  it('counts the gap exactly, not merely "non-zero"', () => {
    const { work } = repo({ remoteAhead: 5 });
    const measured = inspectTree({ cwd: work });
    expect(measured.behind).toBe(5);
    expect(measured.missing).toHaveLength(5);
  });
});

describe('tree-currency-guard — it must not mutate the tree (AC3)', () => {
  it('leaves HEAD, the index, and the working tree untouched when it refuses', () => {
    const { work } = repo({ remoteAhead: 2 });
    writeFileSync(join(work, 'dirty.txt'), 'uncommitted\n');

    const headBefore = git(['rev-parse', 'HEAD'], work);
    const statusBefore = git(['status', '--porcelain'], work);

    expect(() => assertTreeCurrent({ cwd: work })).toThrow();

    expect(git(['rev-parse', 'HEAD'], work)).toBe(headBefore);
    expect(git(['status', '--porcelain'], work)).toBe(statusBefore);
    // The uncommitted file is the canary a reset or checkout would have destroyed.
    expect(readFileSync(join(work, 'dirty.txt'), 'utf8')).toBe('uncommitted\n');
    // And it did not quietly fast-forward us to safety.
    expect(inspectTree({ cwd: work, fetch: false }).behind).toBe(2);
  });
});

describe('tree-currency-guard — fail-closed, not fail-open', () => {
  it('refuses to certify when the upstream ref cannot be resolved', () => {
    const { work } = repo({ remoteAhead: 0 });
    expect(() =>
      assertTreeCurrent({ cwd: work, upstream: 'origin/nonexistent', fetch: false })
    ).toThrow(/Refusing to certify/);
  });

  it('refuses when pointed at something that is not a work tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wic2222-nonrepo-'));
    scratch.push(dir);
    // Assert the MESSAGE, not merely that it throws. A bare `.toThrow()` passed even
    // when the work-tree clause was unreachable on this path: `rev-parse` exits 128
    // on a non-repository, so the operator got raw `fatal: not a git repository`
    // porcelain instead of a sentence naming the directory they passed. The clause's
    // stated purpose ("a wrong cwd reports as a wrong cwd") was untested and untrue
    // for the common case.
    expect(() => assertTreeCurrent({ cwd: dir, fetch: false })).toThrow(/is not a git work tree/);
    expect(() => assertTreeCurrent({ cwd: dir, fetch: false })).toThrow(dir);
  });

  it('refuses on a BARE repository, the other way to not be a work tree', () => {
    // The two non-work-tree inputs fail differently and only this one reaches the
    // `inside !== 'true'` clause: a bare repo answers `false` with exit 0, while a
    // non-repository exits 128. Both must land on the same message.
    const dir = mkdtempSync(join(tmpdir(), 'wic2222-bare-'));
    scratch.push(dir);
    const bare = join(dir, 'bare.git');
    execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', bare]);
    expect(git(['rev-parse', '--is-inside-work-tree'], bare)).toBe('false');
    expect(() => assertTreeCurrent({ cwd: bare, fetch: false })).toThrow(/is not a git work tree/);
  });

  it('treats an unmeasured gap as not-current', () => {
    expect(evaluateCurrency({ behind: NaN }).current).toBe(false);
    expect(evaluateCurrency({ behind: undefined as unknown as number }).current).toBe(false);
  });
});

describe('tree-currency-guard — keyed on the hazard, not a consequence (AC4)', () => {
  it('trips on a stale tree even when the missing commit touches an unrelated file', () => {
    // Nothing here mentions the vitest guard. If the check were keyed on "the vitest
    // guard file differs" it would stay silent; keyed on "behind the remote" it trips.
    const { work } = repo({ remoteAhead: 1, fileName: 'docs/unrelated.md' });
    expect(() => assertTreeCurrent({ cwd: work })).toThrow(/1 commit behind/);
  });

  it('does not false-alarm on a tree that is only AHEAD of the remote', () => {
    const { work } = repo({ remoteAhead: 0, localAhead: 2 });
    const measured = assertTreeCurrent({ cwd: work });
    expect(measured.ahead).toBe(2);
    expect(measured.behind).toBe(0);
  });

  it('tells a tree that is both ahead and behind to reconcile, never to reset', () => {
    const { work } = repo({ remoteAhead: 1, localAhead: 1 });
    expect(() => assertTreeCurrent({ cwd: work })).toThrow(/Do NOT reset to the remote/);
  });
});

describe('tree-currency-guard — a clean commit graph is not a clean tree (WIC-2224)', () => {
  // `behind` cannot see uncommitted work, so a working-tree edit can revert a shipped
  // fix while the tree still reads `behind == 0`. That reproduces the exact fail-open
  // in this guard's opening paragraph through a different channel: the motivating
  // defect was a MISSING COMMIT, and this is the same wrong answer as an EDIT.
  it('refuses a tree that is level with the remote but carries uncommitted changes', () => {
    const { work } = repo({ remoteAhead: 0 });
    // Level with origin/main: certified green before this fix.
    expect(inspectTree({ cwd: work, fetch: false }).behind).toBe(0);

    writeFileSync(join(work, 'README.md'), 'reverted a shipped fix as a working-tree edit\n');
    expect(() => assertTreeCurrent({ cwd: work })).toThrow(/uncommitted change/);
    expect(() => assertTreeCurrent({ cwd: work })).toThrow(/Refusing to certify/);
  });

  it('reports the dirty paths with their porcelain status columns intact', () => {
    const { work } = repo({ remoteAhead: 0 });
    writeFileSync(join(work, 'untracked.ts'), 'new\n');
    const measured = inspectTree({ cwd: work, fetch: false });
    expect(measured.dirty).toContain('?? untracked.ts');
  });

  it('still certifies under --allow-dirty, and the escape hatch is opt-in only', () => {
    const { work } = repo({ remoteAhead: 0 });
    writeFileSync(join(work, 'wip.ts'), 'wip\n');
    expect(() => assertTreeCurrent({ cwd: work, fetch: false })).toThrow();
    const measured = assertTreeCurrent({ cwd: work, fetch: false, allowDirty: true });
    expect(measured.behind).toBe(0);
    expect(measured.dirty).toHaveLength(1);
  });

  it('does not let --allow-dirty rescue a tree that is actually behind', () => {
    // The two refusals are independent; the dirty hatch must not widen the original.
    const { work } = repo({ remoteAhead: 2 });
    writeFileSync(join(work, 'wip.ts'), 'wip\n');
    expect(() => assertTreeCurrent({ cwd: work, allowDirty: true })).toThrow(
      /2 commits behind origin\/main/
    );
  });

  it('reading status does not mutate the tree (AC3 still holds)', () => {
    const { work } = repo({ remoteAhead: 0 });
    writeFileSync(join(work, 'dirty.txt'), 'uncommitted\n');
    const headBefore = git(['rev-parse', 'HEAD'], work);
    const statusBefore = git(['status', '--porcelain'], work);
    expect(() => assertTreeCurrent({ cwd: work, fetch: false })).toThrow();
    expect(git(['rev-parse', 'HEAD'], work)).toBe(headBefore);
    expect(git(['status', '--porcelain'], work)).toBe(statusBefore);
    expect(readFileSync(join(work, 'dirty.txt'), 'utf8')).toBe('uncommitted\n');
  });
});

describe('tree-currency-guard — the script is real and executable', () => {
  it('exists at the path the docs and CI reference', () => {
    const script = join(__dirname, '..', '..', '..', 'scripts', 'tree-currency-guard.mjs');
    expect(existsSync(script)).toBe(true);
  });

  it('exits non-zero from the CLI on a stale tree and zero on a current one', () => {
    const script = join(__dirname, '..', '..', '..', 'scripts', 'tree-currency-guard.mjs');
    const stale = repo({ remoteAhead: 1 });
    const current = repo({ remoteAhead: 0 });

    expect(() =>
      execFileSync('node', [script, '--cwd', stale.work], { encoding: 'utf8', stdio: 'pipe' })
    ).toThrow();

    const ok = execFileSync('node', [script, '--cwd', current.work], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(ok).toMatch(/Tree is current/);
    // The pass must state its own boundary. This tool's value is the trust its green
    // buys, so a green that reads as blanket certification is worse than no green.
    expect(ok).toMatch(/Not checked: installed dependencies/);
  });

  it('throws on a flag whose value is missing instead of grading a different tree', () => {
    // `--cwd` with nothing after it yielded `undefined`, which `inspectTree`'s
    // destructuring default silently restored to `process.cwd()` — so the operator
    // asked about one tree and got a green about another, with no directory named.
    const script = join(__dirname, '..', '..', '..', 'scripts', 'tree-currency-guard.mjs');
    for (const flag of ['--cwd', '--upstream']) {
      expect(() =>
        execFileSync('node', [script, '--no-fetch', flag], { encoding: 'utf8', stdio: 'pipe' })
      ).toThrow(new RegExp(`${flag} requires a value`));
    }
  });
});
