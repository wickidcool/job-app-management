import { describe, expect, it } from 'vitest';

/**
 * WIC-1495 AC-2, the "by construction" half.
 *
 * `AuthContext.test.tsx` proves the four keys that exist today are swept on logout.
 * It cannot prove the *fifth* one will be — a new `localStorage.setItem('some-new-key', …)`
 * added next month leaves that test fully green while re-opening the exact defect
 * this card closed. That is what this file is for.
 *
 * The rule: outside `services/appStorage.ts`, a `localStorage` key must be an
 * identifier imported from `services/appStorage`. Never a string or template
 * literal, never a locally-declared constant. So the only way to add a key is to
 * register it, and `clearAppStorage()` enumerates the registry.
 *
 * Test files are exempt: `AuthContext.test.tsx` writes its key strings as literals
 * deliberately, so that the fixture is not a restatement of the registry it checks.
 *
 * This is a source sweep because the property is about *how* a call site is
 * written, which nothing observable at runtime distinguishes — a literal and an
 * imported constant with the same value behave identically.
 */

const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The module that is allowed to hold key literals: the registry itself. */
const REGISTRY_PATH = '/services/appStorage.ts';

/** First argument of every `localStorage.getItem/setItem/removeItem` call. */
const KEY_ARG_RE = /localStorage\.(?:get|set|remove)Item\(\s*([^,)]+?)\s*[,)]/g;

/** Named bindings imported from `…/appStorage`, e.g. `AUTH_TOKEN_KEY`. */
const REGISTRY_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*\/appStorage['"]/g;

function registryImports(src: string): Set<string> {
  const names = new Set<string>();
  for (const match of src.matchAll(REGISTRY_IMPORT_RE)) {
    for (const raw of match[1].split(',')) {
      const name = raw
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const callSites = Object.entries(sources)
  .filter(([path]) => !path.includes('.test.') && !path.endsWith(REGISTRY_PATH))
  .flatMap(([path, src]) =>
    [...src.matchAll(KEY_ARG_RE)].map((m) => ({
      path,
      keyArg: m[1],
      imported: registryImports(src),
    }))
  );

describe('localStorage key registry (WIC-1495)', () => {
  it('finds call sites to check at all', () => {
    // Without this, a renamed API or a broken regex makes every assertion below
    // iterate an empty array and report green. Measured on this branch: 16 call
    // sites across 6 files. Asserted loosely so ordinary churn does not red CI,
    // but tightly enough that "found nothing" cannot pass.
    expect(callSites.length).toBeGreaterThanOrEqual(10);
    expect(new Set(callSites.map((c) => c.path)).size).toBeGreaterThanOrEqual(4);

    // The registry module itself must be in the glob, or the exclusion above is
    // excluding nothing and this file is checking a set it does not understand.
    expect(Object.keys(sources).some((p) => p.endsWith(REGISTRY_PATH))).toBe(true);

    // At least one call site must resolve through a registry import, or the rule
    // below is satisfied only by there being nothing to satisfy it.
    expect(callSites.filter((c) => c.imported.has(c.keyArg)).length).toBeGreaterThanOrEqual(10);
  });

  it('uses no literal localStorage key outside the registry', () => {
    const literals = callSites.filter((c) => /^['"`]/.test(c.keyArg));
    expect(literals.map((c) => `${c.path}: localStorage key ${c.keyArg} is a literal`)).toEqual([]);
  });

  it('imports every localStorage key from services/appStorage', () => {
    const unregistered = callSites.filter((c) => !c.imported.has(c.keyArg));
    expect(
      unregistered.map(
        (c) =>
          `${c.path}: localStorage key \`${c.keyArg}\` is not imported from services/appStorage`
      )
    ).toEqual([]);
  });

  it('has no writer left for the dialogue-wizard draft family', () => {
    // AC-1. The prefix survives in the registry on purpose, to clear copies written
    // by earlier releases, so its presence there is not evidence the writer is gone.
    // Every other mention in src/ is a regression.
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith(REGISTRY_PATH) && !path.includes('.test.'))
      .filter(([, src]) => src.includes('dialogue-wizard-draft'))
      .map(([path]) => path);
    expect(offenders).toEqual([]);

    // Control: the string is findable by this scan when it is present, so the
    // empty result above means "absent", not "unsearchable".
    const registrySrc = Object.entries(sources).find(([p]) => p.endsWith(REGISTRY_PATH))?.[1];
    expect(registrySrc).toContain('dialogue-wizard-draft-');
  });
});
