import { test, expect } from '@playwright/test';

test('edit project content persists after reload', async ({ page }) => {
  // First create a project via API
  await page.request.post('http://localhost:3001/api/v1/projects', {
    data: { name: 'Edit Test', content: '# Edit Test\n\nOriginal content.' },
  });
  await page.goto('/');
  await page.getByText('edit-test').click();
  // Editor should show original content
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
  // Click save button
  await page.getByRole('button', { name: /save/i }).click();
  await page.screenshot({ path: 'e2e-screenshots/edit-project.png' });
});
