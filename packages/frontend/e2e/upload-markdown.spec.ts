import { test, expect } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('upload markdown file appears in file list', async ({ page }) => {
  await page.goto('/');
  // Create a temp markdown file to upload
  const tmpPath = join(tmpdir(), 'e2e-test-project.md');
  writeFileSync(tmpPath, '# E2E Test Project\n\nThis is a test project.');
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(tmpPath);
  await page.getByRole('button', { name: /upload/i }).click();
  await expect(page.getByText('e2e-test-project')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/upload-markdown.png' });
});

test('clicking project file shows content in editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('e2e-test-project')).toBeVisible({ timeout: 5000 });
  await page.getByText('e2e-test-project').click();
  await expect(page.getByText('E2E Test Project')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/view-project.png' });
});
