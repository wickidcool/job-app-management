import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Unit/component tests for @wic/web. These run in jsdom with no dev server, no API
// and no database — deliberately unlike `test:e2e`, which boots Vite against a live
// backend (see playwright.config.ts at the repo root).
//
// `e2e/` is excluded: those specs import from @playwright/test and would otherwise be
// collected here, since vitest's default `include` also matches `*.spec.ts`.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
      // WIC-2209. Refuse to run on a vitest other than the one pinned in
      // package.json. This package happened to have a correct install when the
      // defect was found in packages/api, but the cause was a missing package-level
      // install falling back to a hoisted copy — nothing about that is specific to
      // the api workspace, so both are guarded.
      globalSetup: ['./vitest.globalSetup.mjs'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      restoreMocks: true,
      // These are jsdom component tests driven by `@testing-library/user-event`, and
      // their wall-clock cost is dominated by event-loop turnaround, not by CPU work:
      // every user-event call awaits a zero-delay `setTimeout` (user-event's default is
      // `delay: 0`, which is a number, so it schedules a real macrotask rather than
      // skipping the wait the way `delay: null` does).
      //
      // That makes them latency-sensitive rather than slow. On an unloaded box the
      // slowest test here takes ~3.0s; when the fork pool is oversubscribed the same
      // test lands at 5-6.4s and trips the 5000ms default. Vitest sizes the pool from
      // the host, so a 2-core CI runner is already oversubscribed relative to this
      // 4-core box — the default left roughly 1.6x headroom, which is not enough.
      //
      // 15s restores ~5x headroom over the observed idle worst case. It is deliberately
      // a timeout change and not `userEvent.setup({ delay: null })`: dropping the delay
      // was measured at only ~16% off total test time (39.8s -> 33.3s across the five
      // heaviest files), which does not cover the 3-5x slowdown contention causes, and
      // it also removes a flush these tests currently rely on. See WIC-1889.
      testTimeout: 15_000,
      hookTimeout: 15_000,
    },
  })
);
