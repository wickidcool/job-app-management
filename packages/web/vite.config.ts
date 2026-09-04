import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Restricts the dev server to serving files from `packages/` — `'..'` is
      // resolved against this config's root, which is `packages/web`.
      //
      // This narrows rather than widens, which is the opposite of what the
      // familiar monorepo `allow: ['..']` idiom does elsewhere and the reason it
      // is spelled out here (WIC-1980). `server.fs.allow` REPLACES Vite's default
      // instead of adding to it, and that default is `searchForWorkspaceRoot()` —
      // the nearest ancestor with a `workspaces` field, i.e. the repo root. So
      // deleting these three lines does not restore a neutral setting, it hands
      // the dev server the whole repository, `.dev.vars` and `supabase/` included.
      //
      // Nothing measured requires `packages/` specifically rather than the
      // tighter `['.']`. In particular this does NOT gate vitest: narrowing to
      // `['.']` leaves `upload-limit-drift.test.ts` — which `?raw`-imports across
      // into `packages/api` — green at 17/17, because vitest loads modules through
      // the module runner rather than the dev server's file-serving path.
      // Tightening further is a real option, just a separate change from
      // ratifying what already shipped.
      //
      // Dev-server only — `server.*` is absent from `vite build` output, so this
      // has no effect on anything shipped. Pinned by `src/test/viteFsAllow.test.ts`.
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
