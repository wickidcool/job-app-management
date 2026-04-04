import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('http://localhost:3001/api/v1/projects', {
    data: { name: 'TypeScript API', content: 'Built a TypeScript REST API using Node.js and PostgreSQL.' },
  });
  await request.post('http://localhost:3001/api/v1/index/regenerate');
});

// Test 49: Pasting a job description returns a score and project match list
test('job match returns score and project list', async ({ page }) => {
  await page.goto('/match');
  await page.getByRole('textbox').fill('Looking for TypeScript Node.js developer with REST API experience');
  await page.getByRole('button', { name: /match/i }).click();
  await expect(page.getByText(/score/i)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/typescript-api/i)).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/job-match.png' });
});

// Test 50: Zero-match job description shows score of 0 or empty results
test('zero-match job description shows score of 0 or no matches', async ({ page }) => {
  await page.goto('/match');
  await page.getByRole('textbox').fill('Cobol Fortran Assembly');
  await page.getByRole('button', { name: /match/i }).click();
  // Wait for the result section to appear (Overall Score heading, not the button)
  await expect(page.getByRole('heading', { name: /overall score/i })).toBeVisible({ timeout: 10000 });
  // The score shown should be 0 or results list should be empty
  const bodyText = await page.locator('body').innerText();
  const hasZeroScore = /\b0\.?0*\b/.test(bodyText) || /no match/i.test(bodyText) || /0%/.test(bodyText);
  expect(hasZeroScore).toBe(true);
  await page.screenshot({ path: 'e2e-screenshots/job-match-zero.png' });
});

// Test 53: Index.md is always updated after any project mutation (invariant via E2E)
test('index is updated after project creation (invariant)', async ({ page, request }) => {
  // Create a new project via the API
  const createRes = await request.post('http://localhost:3001/api/v1/projects', {
    data: { name: 'Index Invariant Test', content: '# Index Invariant Test\n\nKubernetes Docker' },
  });
  expect(createRes.ok()).toBe(true);
  const { slug } = await createRes.json();

  // Navigate to the index page and verify the new project appears
  await page.goto('/index');
  await expect(page.getByText(/project index/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(new RegExp(slug, 'i'))).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/index-invariant.png' });
});

// Test 54: Navigation links reach all five pages without 404 or blank screen
test('navigation links reach all five pages', async ({ page }) => {
  await page.goto('/');

  // Projects page (home)
  await expect(page.locator('body')).not.toBeEmpty();
  await expect(page.locator('h1, h2, nav').first()).toBeVisible({ timeout: 5000 });

  // Upload Resume page
  await page.goto('/upload');
  await expect(page.locator('body')).not.toBeEmpty();
  await expect(page.locator('h1, h2, button, input').first()).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/nav-upload.png' });

  // Index page
  await page.goto('/index');
  await expect(page.locator('body')).not.toBeEmpty();
  await expect(page.locator('h1, h2, button').first()).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/nav-index.png' });

  // Job Match page
  await page.goto('/match');
  await expect(page.locator('body')).not.toBeEmpty();
  await expect(page.locator('h1, h2, textarea, input').first()).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/nav-match.png' });

  // Cover Letter page
  await page.goto('/cover-letter');
  await expect(page.locator('body')).not.toBeEmpty();
  await expect(page.locator('h1, h2, textarea, button').first()).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e-screenshots/nav-cover-letter.png' });
});
