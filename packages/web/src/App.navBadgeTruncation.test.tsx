import { describe, expect, it } from 'vitest';

import appSource from './App.tsx?raw';

/**
 * WIC-2181 — `App` must read the collection, and must hand the truncation flag to BOTH
 * nav surfaces.
 *
 * The behaviour is tested where it belongs, against the real components, in
 * `components/navigation-lower-bound-badge.test.tsx`. What is left over is the *wiring*,
 * and it is the half that fails silently: drop `applicationCountIsLowerBound` from either
 * `<TopNavigation>` or `<MobileNavigation>` and nothing type-errors — the prop is
 * optional, so the badge simply goes back to rendering a lower bound as if it were a
 * count, on one viewport only.
 *
 * ⚠️ THIS IS A SOURCE SCAN, WITH THE LIMITS THAT IMPLIES. It reads `App.tsx` as text and
 * pins the shape of the wiring, not the value that flows through it: rename the flag to
 * something that is always `false` and every assertion here stays green. It is here
 * because `App.tsx` mounts a module-scope data router over the whole route table, which is
 * why `App.dataRouter.test.tsx` reaches for `?raw` for the same reason rather than
 * rendering it. The two files together are the cover: this one says the prop is passed,
 * the nav tests say what the components do when it is.
 *
 * Every assertion runs over COMMENT-STRIPPED source. `App.tsx` names `useApplications` in
 * prose recording what it migrated away from, and deleting that history to satisfy a grep
 * would be the wrong trade — the same ruling `App.dataRouter.test.tsx` records.
 */

/** Line and block comments out, so prose naming a retired identifier does not count. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * A *call* of the retired hook, not a mention of it. The module is still called
 * `hooks/useApplications` and is imported by a dozen files for `useApplication`,
 * `useCreateApplication` and friends, so a bare substring match would flag every one of
 * them. Requiring the `(` distinguishes the identifier from the path.
 */
const CALLS_RETIRED_HOOK = /\buseApplications\s*\(/;

describe('App wires the truncation flag through to both nav surfaces (WIC-2181)', () => {
  const source = stripComments(appSource);

  it('is reading the real App.tsx', () => {
    // Positive control. `?raw` on a missing path is a build error, but a stub or a
    // mis-stripped source would make every `not.toMatch` below pass vacuously.
    expect(appSource.length).toBeGreaterThan(2000);
    expect(source).toMatch(/<Route path="\/applications" element=\{<ApplicationsList \/>\} \/>/);
    expect(source).toMatch(/<TopNavigation/);
    expect(source).toMatch(/<MobileNavigation/);
  });

  it('reads the collection hook, not the projection that hides `truncated`', () => {
    expect(source).toMatch(/\buseApplicationCollection\s*\(/);
    expect(
      source,
      'App.tsx calls useApplications() again; `truncated` is unreachable through it (WIC-2181)'
    ).not.toMatch(CALLS_RETIRED_HOOK);
  });

  it('the retired-hook matcher would actually fire (control for the assertion above)', () => {
    // Without this the `not.toMatch` is only as good as the regex, and a regex that
    // matches nothing passes every negative assertion ever written against it. This is
    // the exact line `App.tsx` carried before this change.
    expect('  const { data: applications = [] } = use' + 'Applications();').toMatch(
      CALLS_RETIRED_HOOK
    );
    // And it must not fire on the module path, which is what makes the scan usable.
    expect("import { useApplicationCollection } from './hooks/useApplications';").not.toMatch(
      CALLS_RETIRED_HOOK
    );
  });

  it('derives the lower-bound flag from `truncated`', () => {
    expect(source).toMatch(/inProgressCountIsLowerBound\s*=[^;]*\btruncated\b/);
  });

  it.each([['TopNavigation'], ['MobileNavigation']])('passes the flag to %s', (component) => {
    // Both, not either. They render the badge from separate copies of the same markup, so
    // wiring one and forgetting the other leaves the defect live on one viewport with
    // nothing red — which is the failure this assertion exists for.
    const element = new RegExp(`<${component}\\b[\\s\\S]*?/>`);
    const match = source.match(element);
    expect(match, `App.tsx no longer renders <${component}>`).not.toBeNull();
    expect(match![0]).toMatch(/applicationCountIsLowerBound=\{inProgressCountIsLowerBound\}/);
  });
});

describe('the retired hook is deleted, not merely unreferenced (WIC-2181)', () => {
  const sources = import.meta.glob('./**/*.{ts,tsx}', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;

  it('is scanning the whole app, not an empty glob', () => {
    // Scope control, per the same reasoning as `App.dataRouter.test.tsx`: a glob that
    // resolved to nothing would make the sweep below report a clean bill of health.
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(Object.keys(sources)).toContain('./App.tsx');
    expect(Object.keys(sources)).toContain('./hooks/useApplications.ts');
  });

  it('no file calls useApplications()', () => {
    const offenders = Object.entries(sources)
      .filter(([file]) => file !== './App.navBadgeTruncation.test.tsx')
      .filter(([, fileSource]) => CALLS_RETIRED_HOOK.test(stripComments(fileSource)))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  it('the hook module no longer exports it', () => {
    // The point of the migration. While the export exists, the docstring's direction to
    // prefer `useApplicationCollection` is a request a caller can decline — which is what
    // both of its callers did. Removing it makes the rule a property of the API.
    expect(sources['./hooks/useApplications.ts']).not.toMatch(/export function useApplications\b/);
    // And the module is still there, carrying everything else it always did — this is a
    // deleted export, not a deleted file.
    expect(sources['./hooks/useApplications.ts']).toMatch(
      /export function useApplicationCollection\b/
    );
    expect(sources['./hooks/useApplications.ts']).toMatch(/export function useApplication\b/);
  });
});
