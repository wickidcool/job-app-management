import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  // Seed projects with known keywords
  await request.post('http://localhost:3001/api/v1/projects', { data: { name: 'Index Test Alpha', content: 'Built with TypeScript and React.' } });
  await request.post('http://localhost:3001/api/v1/projects', { data: { name: 'Index Test Beta', content: 'Used Docker and Kubernetes for deployment.' } });
  await request.post('http://localhost:3001/api/v1/index/regenerate');
});

test('index page shows keyword content', async ({ page }) => {
  await page.goto('/index');
  await expect(page.getByRole('heading', { name: /Project Index/i }).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/TypeScript/).first()).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/index-view.png' });
});

test('regenerate button updates index', async ({ page }) => {
  await page.goto('/index');
  await page.getByRole('button', { name: /regenerate/i }).click();
  await expect(page.getByRole('heading', { name: /Project Index/i }).first()).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/index-regenerated.png' });
});
