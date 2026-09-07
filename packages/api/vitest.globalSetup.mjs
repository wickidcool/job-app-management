// WIC-2209. Thin per-package wrapper around the shared runner-version guard.
//
// It exists so the guard learns which package it is checking from `import.meta.url`
// rather than from `process.cwd()`. cwd varies with how vitest was invoked (`npm
// test`, `npm test -w packages/api`, a bare `npx vitest run` from either directory),
// and a guard that resolves the wrong package.json would compare against the wrong
// pin — the same class of silent-wrong-answer it is here to prevent.
//
// WIC-2228 adds the second half of the same idea. The version guard answers "is this
// the right RUNNER?"; the currency arm answers "is this the right TREE?". Both are
// ways for a suite to produce a confidently wrong green, and both have to run inside
// the process being graded, because `npx vitest run` skips npm scripts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertPinnedVitest } from '../../scripts/vitest-version-guard.mjs';
import { maybeAssertTreeCurrent } from '../../scripts/tree-currency-autoarm.mjs';

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');

export function setup() {
  assertPinnedVitest(PACKAGE_DIR);
  // Repo root, not the package dir: currency is a property of the checkout, and the
  // package dir is only ever a subdirectory of it. Derived from `import.meta.url` for
  // the same reason the line above is — cwd is not reliable here.
  maybeAssertTreeCurrent({ cwd: REPO_ROOT });
}
