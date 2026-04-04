import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('http://localhost:3001/api/v1/projects', {
    data: { name: 'TypeScript API', content: 'Built a TypeScript REST API using Node.js and PostgreSQL.' },
  });
  await request.post('http://localhost:3001/api/v1/index/regenerate');
});

test('job match returns score and project list', async ({ page }) => {
  await page.goto('/match');
  await page.getByRole('textbox').fill('Looking for TypeScript Node.js developer with REST API experience');
  await page.getByRole('button', { name: /match/i }).click();
  await expect(page.getByText(/score/i)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/typescript-api/i)).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/job-match.png' });
});
