import { describe, it, expect } from 'vitest';
import { shouldScan, isConfigFile } from '../src/secret-scan.js';

/**
 * File-discovery coverage for the secret-scan CLI.
 *
 * `test/secret-scan.test.ts` covers the pure core (`src/lib/secret-scan.ts`)
 * thoroughly — every pattern, the entropy heuristic, the allowlist. But the
 * layer that decides *which files reach that core* had no tests at all, and it
 * was silently dropping the single most likely place for a secret to be
 * committed: the `.env` family.
 *
 * Root cause: `SCANNABLE_EXT` contains `'.env'`, which reads as intent to scan
 * env files, but `path.extname('.env') === ''` and
 * `path.extname('.env.production') === '.production'`. The entry only ever
 * matched a file literally named `foo.env`. A tracked `.env.production` (not
 * covered by `.gitignore`, which only lists `.env`, `.env.local`,
 * `.env.*.local`) carrying a live-shaped key passed CI clean.
 *
 * These assertions are shaped so that reverting either half of the fix goes
 * red: the `.env`-family rows fail if `SCANNABLE_BASENAME` is removed from
 * `shouldScan`, and the entropy rows fail if it is removed from `isConfigFile`.
 */
describe('secret-scan file discovery', () => {
  describe('shouldScan', () => {
    it('scans the .env family — dotfiles have no usable extname', () => {
      // The exact shapes `.gitignore` does NOT cover, so they can be committed.
      expect(shouldScan('.env.production')).toBe(true);
      expect(shouldScan('.env.development')).toBe(true);
      expect(shouldScan('.env.staging')).toBe(true);
      expect(shouldScan('packages/web/.env.production')).toBe(true);
      // And the plain ones, which are only safe while .gitignore holds.
      expect(shouldScan('.env')).toBe(true);
      expect(shouldScan('packages/api/.env')).toBe(true);
    });

    it('scans other credential-bearing dotfiles', () => {
      expect(shouldScan('.envrc')).toBe(true); // direnv: `export TOKEN=…`
      expect(shouldScan('.npmrc')).toBe(true); // `//registry…/:_authToken=…`
      expect(shouldScan('.netrc')).toBe(true);
      expect(shouldScan('.secrets')).toBe(true);
    });

    it('still scans by extension, and still ignores noise', () => {
      expect(shouldScan('packages/web/src/config.ts')).toBe(true);
      expect(shouldScan('wrangler.jsonc')).toBe(true);
      expect(shouldScan('.github/workflows/deploy.yml')).toBe(true);
      expect(shouldScan('foo.env')).toBe(true);

      expect(shouldScan('package-lock.json')).toBe(false);
      expect(shouldScan('node_modules/pkg/index.js')).toBe(false);
      expect(shouldScan('packages/web/dist/assets/index-abc.js')).toBe(false);
      expect(shouldScan('docs/diagram.png')).toBe(false);
    });

    it('does not widen to every dotfile', () => {
      // Config dotfiles with no secret-bearing convention stay out, so the
      // basename rule cannot be "matches /^\\./" by accident.
      expect(shouldScan('.gitignore')).toBe(false);
      expect(shouldScan('.prettierignore')).toBe(false);
      expect(shouldScan('.gitattributes')).toBe(false);
    });
  });

  describe('isConfigFile (generic high-entropy scanning)', () => {
    it('enables entropy on the .env family', () => {
      // Env files are a secret-bearing manifest, same as `.dev.vars`. Without
      // this, an opaque token with no recognised prefix (a Supabase legacy
      // service_role JWT, an OpenAI `sk-proj-…`) rides through an env file.
      expect(isConfigFile('.env.production')).toBe(true);
      expect(isConfigFile('.env')).toBe(true);
      expect(isConfigFile('.npmrc')).toBe(true);
    });

    it('keeps the pre-existing entropy surfaces', () => {
      expect(isConfigFile('wrangler.jsonc')).toBe(true);
      expect(isConfigFile('.github/workflows/deploy.yml')).toBe(true);
      expect(isConfigFile('.dev.vars')).toBe(true);
      expect(isConfigFile('some.toml')).toBe(true);
    });

    it('leaves entropy off for source and prose', () => {
      // Deliberate false-positive tradeoff: source files get named patterns only.
      expect(isConfigFile('packages/web/src/config.ts')).toBe(false);
      expect(isConfigFile('README.md')).toBe(false);
      expect(isConfigFile('package.json')).toBe(false);
    });
  });
});
