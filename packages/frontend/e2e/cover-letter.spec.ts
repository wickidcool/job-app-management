import { test, expect } from '@playwright/test';

test('cover letter is generated and non-empty', async ({ page }) => {
  await page.goto('/cover-letter');
  await page.getByRole('textbox').first().fill('We are looking for a TypeScript engineer with React experience.');
  await page.getByRole('button', { name: /generate/i }).click();
  await expect(page.getByText(/\[AI STUB\]/i)).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'e2e-screenshots/cover-letter.png' });
});

test('cover letter copy to clipboard copies text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/cover-letter');
  await page.getByRole('textbox').first().fill('We are looking for a TypeScript engineer with React experience.');
  await page.getByRole('button', { name: /generate/i }).click();
  await expect(page.getByText(/\[AI STUB\]/i)).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /copy/i }).click();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'e2e-screenshots/cover-letter-copy.png' });
});
