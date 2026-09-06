import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Six suites build a real database in `beforeAll` via `createMigratedDb()` —
    // PGlite boot plus every migration in src/db/migrations. That is genuinely slow
    // work, and its cost is dominated by contention: vitest sizes the fork pool from
    // the host, so on a 2-core CI runner these hooks are competing with the other 80+
    // files for CPU.
    //
    // vitest 4 enforces the 10s default `hookTimeout` on them where 1.6 did not, which
    // is the only behavioural break the 1.6 -> 4 migration produced in this package
    // (WIC-2137). It is a reporting change, not a slowdown: under 1.6 these same files
    // took 13.3s (application-interview-date) and 14.3s (application-link) end-to-end
    // and passed. Which file trips it varies run to run — three different files failed
    // across three runs, and each passes in isolation — confirming contention rather
    // than a bug in any one suite.
    //
    // 30s gives ~3x headroom over the observed ~11s overrun. Same reasoning as the
    // timeouts in packages/web/vitest.config.ts (WIC-1889), sized higher because
    // migrating a database costs more than rendering a component.
    testTimeout: 15_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/db/migrate.ts'],
    },
  },
});
