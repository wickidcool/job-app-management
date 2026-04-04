import { defineConfig } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'on',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `AI_PROVIDER=stub STORAGE_DIR=/tmp/e2e-data tsx ${join(__dirname, '../backend/src/index.ts')}`,
      port: 3001,
      reuseExistingServer: !process.env['CI'],
      timeout: 15000,
    },
    {
      command: 'vite --port 5173',
      port: 5173,
      reuseExistingServer: !process.env['CI'],
      timeout: 15000,
    },
  ],
});
