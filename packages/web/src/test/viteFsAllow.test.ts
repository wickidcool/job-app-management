import { describe, expect, it } from 'vitest';
import { isFileServingAllowed, resolveConfig } from 'vite';

/**
 * WIC-1980. `packages/web/vite.config.ts` sets `server.fs.allow: ['..']`, which
 * bounds what the dev server will serve off disk. The line reached `main` inside a
 * merge-conflict resolution (`d59c74bf`) and is present in **neither parent** — so
 * it appears in no commit's own diff, `git log -p` does not render it, and it was
 * never in a reviewed diff. This file is what makes the boundary reviewable.
 *
 * It asserts *behaviour*, via Vite's own `resolveConfig` + `isFileServingAllowed`,
 * rather than reading the config source as text. A source scan would go green on
 * the literal `['..']` while saying nothing about what that value resolves to —
 * and what it resolves to is the entire point, because the value is counter-
 * intuitive in two independent ways:
 *
 * 1. **`fs.allow` REPLACES Vite's default, it does not extend it.**
 *    `allow: raw?.fs?.allow ?? [searchForWorkspaceRoot(root)]`.
 * 2. **The default is the repo root**, because the root `package.json` declares
 *    `workspaces: ["packages/*"]` and `searchForWorkspaceRoot` stops at the
 *    nearest ancestor carrying that field.
 *
 * So `['..']` — resolved against this config's root, `packages/web` — yields
 * `packages/`, a strict SUBSET of the default. The line **tightens** the boundary.
 * Deleting it does not restore a neutral default; it widens the dev server back
 * out to the whole repository.
 *
 * That inversion is the thing worth guarding. The reflex on reading
 * `allow: ['..']` is that someone widened a security boundary, and the reflex fix
 * is to delete it — which is precisely backwards. `the default is broader than
 * what we configure` below exists to make that concrete at the point of failure,
 * so the next reader gets the measurement rather than the reflex.
 */

/**
 * The real config, exactly as `vite dev` loads it.
 *
 * `resolveConfig({}, 'serve')` takes `root` from the cwd, which is the package
 * directory under `npm test` (root `npm run test` delegates per workspace). That
 * assumption is not left implicit — `the audit is reading this package's real
 * config` asserts it, so a runner invoked from somewhere else is a loud RED rather
 * than a silent pass over the wrong config file.
 *
 * `'serve'` and not `'build'`: `server.*` only exists in the dev config, and
 * resolving for `'build'` would make every assertion here vacuous.
 */
const config = await resolveConfig({}, 'serve');

/**
 * The same resolution with the config file skipped — i.e. what Vite would do if
 * the `fs.allow` line did not exist.
 *
 * This is the control, and it is what stops the assertions below from being
 * satisfiable by a broken reading. Comparing the two is what varies the
 * load-bearing thing; asserting only against `config` would leave `repo root is
 * denied` green even if the denial came from somewhere unrelated.
 */
const defaults = await resolveConfig({ configFile: false }, 'serve');

/** `<repo>/packages/web` -> `<repo>/packages`. Vite normalises to posix separators. */
const parentOf = (dir: string): string => dir.slice(0, dir.lastIndexOf('/'));

const webDir = config.root;
const packagesDir = parentOf(webDir);
const repoRoot = parentOf(packagesDir);

describe('vite dev server filesystem boundary (WIC-1980)', () => {
  /**
   * Reachability, in a plain `it` and ahead of everything else: every assertion
   * below is derived from `config.root` by string surgery, so a cwd that is not
   * `packages/web` silently re-points all of them at the wrong directories.
   */
  it('the audit is reading the real config for this package', () => {
    expect(
      webDir.endsWith('/packages/web'),
      `Expected vite's resolved root to be <repo>/packages/web, got ${webDir}. This audit ` +
        'derives every path below from that root, so it is measuring the wrong tree. Run ' +
        'vitest with packages/web as the cwd (`npm test --workspace=@wic/web`).'
    ).toBe(true);

    expect(
      config.server.fs.strict,
      'server.fs.strict is off, so the allow-list is not enforced at all and every ' +
        'assertion in this file is vacuous.'
    ).toBe(true);
  });

  it('the dev server is bounded to packages/, not the repo root', () => {
    expect(
      config.server.fs.allow,
      'The resolved dev-server allow-list changed. If `fs.allow` was removed from ' +
        'vite.config.ts this is now the repo root — see the header comment there before ' +
        '"restoring the default", because the default is WIDER than what we set.'
    ).toEqual([packagesDir]);
  });

  it('serves files inside packages/', () => {
    // The positive half. Without it, an allow-list that denies everything — or a
    // typo'd path matching nothing — would satisfy the denial assertions below.
    expect(isFileServingAllowed(config, `${webDir}/package.json`)).toBe(true);
    expect(isFileServingAllowed(config, `${packagesDir}/api/package.json`)).toBe(true);
  });

  it('refuses files above packages/', () => {
    // `.dev.vars` (Worker secrets for local dev) and `supabase/` both sit at the
    // repo root, which is what the pre-merge config exposed.
    for (const path of [
      `${repoRoot}/package.json`,
      `${repoRoot}/.dev.vars`,
      `${repoRoot}/wrangler.jsonc`,
      `${repoRoot}/supabase/config.toml`,
    ]) {
      expect(
        isFileServingAllowed(config, path),
        `${path} is above packages/ and must not be servable by the dev server.`
      ).toBe(false);
    }
  });

  /**
   * The control that gives the test above its meaning.
   *
   * Vite's default allow-list is `[searchForWorkspaceRoot(root)]` = the repo root,
   * so with `fs.allow` deleted the repo root becomes servable. Asserting that here
   * proves the denial above is caused by our config rather than by some unrelated
   * default, and pins the direction of the change: `['..']` is a NARROWING.
   *
   * If this ever goes red, Vite changed how it derives the default — at which
   * point the header comment in vite.config.ts needs re-deriving too, not just
   * this line updating.
   */
  it('the default is broader than what we configure, so the line narrows rather than widens', () => {
    expect(defaults.server.fs.allow).toEqual([repoRoot]);
    expect(isFileServingAllowed(defaults, `${repoRoot}/package.json`)).toBe(true);

    // The comparison stated as the property that actually matters, rather than as
    // two path literals that could drift apart: what we configure is strictly
    // contained in what Vite would default to.
    expect(config.server.fs.allow.every((dir) => dir.startsWith(repoRoot))).toBe(true);
    expect(config.server.fs.allow).not.toEqual(defaults.server.fs.allow);
  });
});
