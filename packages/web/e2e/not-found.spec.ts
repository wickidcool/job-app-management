import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the catch-all 404 route (WIC-1036)
 *
 * Before this route existed, an unmatched in-app path rendered the navigation
 * chrome around an empty `<main>` — visually indistinguishable from a page that
 * was still loading. These tests verify that:
 * 1. An authenticated user on an unmatched path gets the NotFound page
 * 2. The page names the path that was not found, and offers a way back
 * 3. Real routes are unaffected by the catch-all
 * 4. An unauthenticated user on an unmatched path still funnels to /login
 *
 * Tests use mock auth to bypass authentication without a real backend.
 */

const MOCK_USER = {
  id: 'test-user-001',
  email: 'test@example.com',
};

async function setupMockAuth(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: MOCK_USER }),
    })
  );

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
  });
}

async function setupBasicMocks(page: Page) {
  await setupMockAuth(page);

  await page.route('**/api/applications*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ applications: [], nextPage: null }),
    })
  );

  await page.route('**/api/resumes/exports*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ exports: [] }),
    })
  );
}

test.describe('NotFound catch-all route', () => {
  test.beforeEach(async ({ page }) => {
    await setupBasicMocks(page);
  });

  test('renders the 404 page for an unmatched in-app path', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');

    await expect(page.getByRole('heading', { name: /couldn't find that page/i })).toBeVisible();
    await expect(page.getByText('Error 404')).toBeVisible();
  });

  test('names the path that was not found', async ({ page }) => {
    await page.goto('/reports/typo-in-this-link');

    await expect(page.getByText('/reports/typo-in-this-link')).toBeVisible();
  });

  test('keeps the app chrome and offers a way back to the dashboard', async ({ page }) => {
    await page.goto('/nope');

    // The 404 lives inside the app shell, so navigation stays available.
    await expect(page.getByRole('navigation').first()).toBeVisible();

    await page.getByRole('link', { name: /go to dashboard/i }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: /couldn't find that page/i })).toBeHidden();
  });

  test('does not swallow a real route', async ({ page }) => {
    await page.goto('/applications');

    await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /couldn't find that page/i })).toBeHidden();
  });

  test('unauthenticated unmatched paths still redirect to login', async ({ page }) => {
    // No mock auth: clear the token the shared beforeEach seeded.
    await page.addInitScript(() => localStorage.removeItem('auth_token'));

    await page.goto('/this-route-does-not-exist');

    await expect(page).toHaveURL('/login');
  });
});
