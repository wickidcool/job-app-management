// WIC-2209. Fail a test run that is executing on a vitest other than the one the
// package pins.
//
// The failure this exists to catch is silent and reads GREEN. In the primary
// checkout `packages/api` had no `vitest` installed at all, so Node's resolution
// walked up and found an orphan `vitest@1.6.1` at the repo root — a package in no
// package.json and no package-lock.json entry, left behind by a tree that had not
// been reinstalled since the 1.6 -> 4 migration (WIC-2137). Every local api suite
// run printed `RUN v1.6.1` and passed, while CI ran the pinned 4.1.11.
//
// That is not a cosmetic difference. `packages/api/vitest.config.ts` documents the
// break in its own comment: vitest 4 enforces the default `hookTimeout` on the
// suites that build a real PGlite database in `beforeAll`, where 1.6 did not. So
// the stale runner can pass suites CI fails, and it does so with a plausible test
// count — the most expensive shape of wrong answer, because nothing looks off.
//
// This runs as `globalSetup` rather than a `pretest` npm script deliberately: a
// bare `npx vitest run` bypasses npm scripts entirely, and that is exactly how the
// wrong-runner result was produced. globalSetup is inside the process being
// mis-versioned, so there is no invocation that skips it.
//
// Kept dependency-free and free of any vitest API so that it behaves identically
// on the correct runner and the stale one. A guard that needs vitest 4 to run
// cannot report that you are on vitest 1.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Parse a leading `X.Y.Z` into numbers. Returns null if it does not look like semver. */
function parseVersion(raw) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(raw).trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compare(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Decide whether `installed` satisfies `range`.
 *
 * Deliberately handles only the range syntaxes this repo actually pins with
 * (`^X.Y.Z`, `~X.Y.Z`, and an exact `X.Y.Z`) instead of taking a `semver`
 * dependency. Anything else returns `null`, meaning "cannot judge" — the caller
 * treats that as a pass, because a guard that cannot parse the pin has no
 * business failing the build on it.
 *
 * WIC-2211. `null` is also returned for a `0.x` caret or tilde. npm narrows the
 * caret as the leading zeros accumulate — `^0.5.7` locks the minor, `^0.0.3`
 * locks the patch — and the `major === major` rule below is wrong for both, in
 * the fail-OPEN direction: it would bless `0.9.0` under `^0.5.7`, i.e. stay
 * silent about exactly the mismatch this file exists to catch. A `0.x` range is
 * shaped identically to `^X.Y.Z`, so it cannot be excluded by the syntax test
 * above and has to be excluded here. Declining to judge is the honest answer;
 * modelling npm's zero-rules would be a second thing to get wrong. No workspace
 * pins vitest at `0.x` today, but this repo does carry `0.x` pins (`pglite`), so
 * the helper must not be quietly wrong the day it is pointed at one.
 */
export function satisfies(installed, range) {
  const got = parseVersion(installed);
  if (!got) return null;

  const trimmed = String(range).trim();
  const operator = trimmed.startsWith('^') ? '^' : trimmed.startsWith('~') ? '~' : '';
  const want = parseVersion(operator ? trimmed.slice(1) : trimmed);
  if (!want) return null;
  // A range with anything else in it (` || `, ` - `, `>=`) is not one we model.
  if (/[|\s>=<*x]/i.test(operator ? trimmed.slice(1) : trimmed)) return null;
  if (operator && want.major === 0) return null;

  if (compare(got, want) < 0) return false;
  if (operator === '^') return got.major === want.major;
  if (operator === '~') return got.major === want.major && got.minor === want.minor;
  return compare(got, want) === 0;
}

/**
 * Throw unless the `vitest` that resolves from `packageDir` matches the version
 * that same package declares.
 */
export function assertPinnedVitest(packageDir) {
  const manifestPath = path.join(packageDir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const pin = manifest.devDependencies?.vitest ?? manifest.dependencies?.vitest;

  if (!pin) {
    throw new Error(
      `[vitest-version-guard] ${path.relative(process.cwd(), manifestPath)} declares no ` +
        `\`vitest\` dependency, so there is nothing to check the running runner against. ` +
        `Either declare the pin or drop \`globalSetup\` from this package's vitest config.`
    );
  }

  // Resolve exactly the way the package itself would, so the path we report is
  // the one this package's own imports reach.
  //
  // WIC-2211. Note what this does and does not measure. It reports the copy that
  // *resolves from this package*, not the copy the running process loaded — the
  // function's only inputs are `packageDir` and the filesystem, and it has no
  // channel to the executing runner. The two coincide in the defect this guard
  // was written for (no local vitest, so both are the hoisted one), which is why
  // it catches it. They diverge on a repaired tree driven from outside: with a
  // correct 4.1.11 installed here, a run launched by some other vitest still
  // resolves 4.1.11 from this package and the guard stays silent. That residual
  // hole is accepted rather than hidden — closing it means reading the runner out
  // of `process.argv`, which is a different and less stable measurement.
  const requireFromPackage = createRequire(manifestPath);
  let resolvedPath;
  try {
    resolvedPath = requireFromPackage.resolve('vitest/package.json');
  } catch {
    throw new Error(
      `[vitest-version-guard] \`vitest\` does not resolve from ${packageDir} at all, ` +
        `yet a vitest run is in progress — so it was loaded from somewhere outside this ` +
        `package's resolution path. Run \`npm ci\` at the repo root.`
    );
  }

  const installed = JSON.parse(readFileSync(resolvedPath, 'utf8')).version;
  const ok = satisfies(installed, pin);

  // `null` means the pin uses a range shape this guard does not model. Stay quiet
  // rather than inventing a failure — see `satisfies`.
  if (ok === null || ok === true) return;

  // WIC-2211. One `dirname`, not two. `resolvedPath` ends `.../vitest/package.json`,
  // so a single step lands on the package directory — which is what `expectedDir`
  // names. Two steps land on `.../node_modules`, which can never equal
  // `.../node_modules/vitest`, making `hoisted` a constant `true` and the
  // "out of date" branch unreachable. That shipped in the first cut of this file:
  // a correct-but-stale local install was explained as a lockfile orphan, sending
  // the reader after a file that does not exist. Fittingly, it was this guard's own
  // thesis turned on itself — a confident, plausible, wrong answer.
  const installedDir = path.dirname(resolvedPath);
  const expectedDir = path.join(packageDir, 'node_modules', 'vitest');
  const hoisted = path.resolve(installedDir) !== path.resolve(expectedDir);

  throw new Error(
    [
      `[vitest-version-guard] This run is executing on vitest ${installed}, but ` +
        `${path.basename(packageDir)} pins ${pin}.`,
      '',
      `  loaded from : ${resolvedPath}`,
      `  expected at : ${path.join(expectedDir, 'package.json')}`,
      hoisted
        ? `  cause       : no vitest is installed in this package, so resolution walked up ` +
          `and found an unrelated copy. That copy may be in no package.json and no lockfile.`
        : `  cause       : the installed copy is out of date with the declared pin.`,
      '',
      `Results from the wrong runner are not comparable to CI, and the divergence is`,
      `behavioural, not cosmetic (vitest 4 enforces hook timeouts that 1.6 ignored).`,
      `Fix the tree before trusting any suite result:`,
      '',
      `  npm ci`,
      '',
    ].join('\n')
  );
}
