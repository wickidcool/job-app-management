// WIC-2209. Thin per-package wrapper around the shared runner-version guard.
//
// It exists so the guard learns which package it is checking from `import.meta.url`
// rather than from `process.cwd()`. cwd varies with how vitest was invoked (`npm
// test`, `npm test -w packages/api`, a bare `npx vitest run` from either directory),
// and a guard that resolves the wrong package.json would compare against the wrong
// pin — the same class of silent-wrong-answer it is here to prevent.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertPinnedVitest } from '../../scripts/vitest-version-guard.mjs';

export function setup() {
  assertPinnedVitest(path.dirname(fileURLToPath(import.meta.url)));
}
