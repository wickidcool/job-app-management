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
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      restoreMocks: true,
    },
  })
);
