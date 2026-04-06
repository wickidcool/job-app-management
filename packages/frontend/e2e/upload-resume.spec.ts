import { test, expect } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('upload plain-text resume shows parsed sections', async ({ page }) => {
  await page.goto('/upload');
  const fixturePath = join(__dirname, '../../backend/test/fixtures/sample-resume.txt');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(fixturePath);
  await page.getByRole('button', { name: /parse|upload/i }).click();
  await expect(page.getByText(/experience/i)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'e2e-screenshots/upload-resume.png' });
});

test('add section as project navigates to projects page', async ({ page }) => {
  await page.goto('/upload');
  const fixturePath = join(__dirname, '../../backend/test/fixtures/sample-resume.txt');
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.getByRole('button', { name: /parse|upload/i }).click();
  await expect(page.getByText(/acme/i)).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /add as project/i }).first().click();
  await expect(page).toHaveURL('/', { timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/add-section-as-project.png' });
});
