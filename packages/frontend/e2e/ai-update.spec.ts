import { test, expect } from '@playwright/test';

test('AI update dialog updates editor content', async ({ page }) => {
  // Seed a project
  await page.request.post('http://localhost:3001/api/v1/projects', {
    data: { name: 'AI Test Project', content: '# AI Test Project\n\nOriginal content.' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'ai-test-project', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: /ask ai/i }).click();
  await page.getByPlaceholder(/instruction/i).fill('Add a summary paragraph');
  await page.getByRole('button', { name: /submit/i }).click();
  // AI stub response contains [AI STUB]
  await expect(page.locator('.cm-content')).toContainText('[AI STUB]', { timeout: 10000 });
  await page.screenshot({ path: 'e2e-screenshots/ai-update.png' });
});
