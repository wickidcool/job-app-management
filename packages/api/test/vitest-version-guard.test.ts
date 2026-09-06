// WIC-2209. Tests for the runner-version guard in scripts/vitest-version-guard.mjs.
//
// Two halves, and the second is the one that matters. Grading `satisfies()` on
// fixtures proves the comparison is right but says nothing about whether the guard
// is actually *attached* to anything — a correct checker wired to no config is
// exactly as silent as the bug it replaces. So the wiring assertions below read the
// real vitest.config.ts files rather than a fixture.
import { describe, expect, it, afterAll } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { satisfies, assertPinnedVitest } from '../../../scripts/vitest-version-guard.mjs';

const PACKAGES_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Build a throwaway package that declares `pin` and has `installed` resolvable. */
function fixture(pin: string | null, installed: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'wic2209-'));
  scratch.push(dir);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture-pkg', devDependencies: pin ? { vitest: pin } : {} })
  );
  if (installed) {
    const vitestDir = join(dir, 'node_modules', 'vitest');
    mkdirSync(vitestDir, { recursive: true });
    writeFileSync(
      join(vitestDir, 'package.json'),
      JSON.stringify({ name: 'vitest', version: installed, main: 'index.js' })
    );
    writeFileSync(join(vitestDir, 'index.js'), '');
  }
  return dir;
}

describe('satisfies', () => {
  it('accepts a caret range matched within its major', () => {
    expect(satisfies('4.1.11', '^4.1.11')).toBe(true);
    expect(satisfies('4.2.0', '^4.1.11')).toBe(true);
    expect(satisfies('4.99.99', '^4.1.11')).toBe(true);
  });

  it('rejects the real defect: a lower major under a caret range', () => {
    // The exact pair observed in the primary checkout.
    expect(satisfies('1.6.1', '^4.1.11')).toBe(false);
  });

  it('rejects a higher major under a caret range', () => {
    expect(satisfies('5.0.0', '^4.1.11')).toBe(false);
  });

  it('rejects a version below the caret floor inside the same major', () => {
    expect(satisfies('4.1.10', '^4.1.11')).toBe(false);
    expect(satisfies('4.0.0', '^4.1.11')).toBe(false);
  });

  it('honours a tilde range as minor-locked', () => {
    expect(satisfies('6.0.3', '~6.0.2')).toBe(true);
    expect(satisfies('6.1.0', '~6.0.2')).toBe(false);
    expect(satisfies('6.0.1', '~6.0.2')).toBe(false);
  });

  it('treats a bare version as exact', () => {
    expect(satisfies('4.1.11', '4.1.11')).toBe(true);
    expect(satisfies('4.1.12', '4.1.11')).toBe(false);
  });

  it('returns null — "cannot judge" — for range shapes it does not model', () => {
    // A guard that cannot parse the pin must not invent a failure.
    for (const range of ['^4.1.11 || ^5.0.0', '>=4.1.11', '4.x', '*', 'workspace:*']) {
      expect(satisfies('4.1.11', range)).toBeNull();
    }
  });

  it('returns null for a non-semver installed version', () => {
    expect(satisfies('not-a-version', '^4.1.11')).toBeNull();
  });
});

describe('assertPinnedVitest', () => {
  it('is silent when the installed runner matches the pin', () => {
    expect(() => assertPinnedVitest(fixture('^4.1.11', '4.1.11'))).not.toThrow();
  });

  it('throws on the observed 1.6.1-under-^4.1.11 mismatch, naming both versions', () => {
    const dir = fixture('^4.1.11', '1.6.1');
    expect(() => assertPinnedVitest(dir)).toThrow(/executing on vitest 1\.6\.1/);
    expect(() => assertPinnedVitest(dir)).toThrow(/pins \^4\.1\.11/);
  });

  it('points at `npm ci`, so the message is actionable on its own', () => {
    expect(() => assertPinnedVitest(fixture('^4.1.11', '1.6.1'))).toThrow(/npm ci/);
  });

  it('throws when the package declares no vitest at all', () => {
    expect(() => assertPinnedVitest(fixture(null, '4.1.11'))).toThrow(/declares no/);
  });

  it('throws when vitest does not resolve from the package', () => {
    expect(() => assertPinnedVitest(fixture('^4.1.11', null))).toThrow(/does not resolve/);
  });

  it('stays silent on an unmodellable range rather than failing the build', () => {
    expect(() => assertPinnedVitest(fixture('^4.1.11 || ^5.0.0', '1.6.1'))).not.toThrow();
  });
});

describe('wiring — the guard is attached to every package that ships a vitest config', () => {
  // Read off the filesystem rather than written down. A hardcoded ['api', 'web']
  // would still pass on the day someone adds packages/worker with an unguarded
  // config — the inventory is the thing under test, so it has to be discovered.
  const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PACKAGES_DIR, e.name, 'vitest.config.ts')))
    .map((e) => e.name)
    .sort();

  it('found the workspaces that run vitest', () => {
    // Guards the discovery itself: a glob that silently matched nothing would make
    // every `it.each` below vacuous rather than failing.
    expect(packages.length).toBeGreaterThanOrEqual(2);
    expect(packages).toContain('api');
    expect(packages).toContain('web');
  });

  it.each(packages)('packages/%s wires globalSetup to its wrapper', (name) => {
    const config = readFileSync(join(PACKAGES_DIR, name, 'vitest.config.ts'), 'utf8');
    expect(config).toMatch(/globalSetup:\s*\['\.\/vitest\.globalSetup\.mjs'\]/);
  });

  it.each(packages)('packages/%s wrapper delegates to the shared guard', (name) => {
    const wrapper = readFileSync(join(PACKAGES_DIR, name, 'vitest.globalSetup.mjs'), 'utf8');
    expect(wrapper).toMatch(/assertPinnedVitest/);
    expect(wrapper).toMatch(/scripts\/vitest-version-guard\.mjs/);
    // It must export `setup` — vitest ignores a globalSetup module that does not.
    expect(wrapper).toMatch(/export function setup\s*\(/);
  });

  it.each(packages)('packages/%s pins a vitest version to check against', (name) => {
    const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, name, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>;
    };
    expect(manifest.devDependencies?.vitest).toBeDefined();
  });
});
