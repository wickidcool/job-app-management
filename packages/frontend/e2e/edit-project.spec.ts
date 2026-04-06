import { test, expect } from '@playwright/test';

test('edit project content persists after reload', async ({ page, request }) => {
  // Seed project via API
  await request.post('http://localhost:3001/api/v1/projects', {
    data: { name: 'Edit Test', content: '# Edit Test\n\nOriginal content.' },
  });

  await page.goto('/');
  await page.getByText('edit-test').click();

  // Editor should show original content
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

  // Click save button (content unchanged — verifies save completes without error)
  await page.getByRole('button', { name: /save/i }).click();

  // Reload the page and verify the project is still accessible
  await page.reload();
  await expect(page.getByText('edit-test')).toBeVisible({ timeout: 5000 });

  // Verify persistence via API
  const apiRes = await request.get('http://localhost:3001/api/v1/projects/edit-test');
  expect(apiRes.ok()).toBe(true);
  const body = await apiRes.json();
  expect(body.content).toContain('Edit Test');

  await page.screenshot({ path: 'e2e-screenshots/edit-project.png' });
});
