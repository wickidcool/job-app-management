import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 *
 * These tests verify the authentication flow with the backend API.
 * To run these tests with authentication enabled:
 * 1. Start the backend with Supabase configured
 * 2. Run tests: `npm run test:e2e`
 *
 * Without Supabase configured on the backend, the app runs in bypass mode (no auth required).
 */

test.describe('Authentication - UI Components', () => {
  test('should redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL('/login');

    // This assertion used to read `getByRole('heading', { level: 1, name: /careerpin/i })`:
    // WIC-1675 AC-3 promoted the login heading from `<h2>` to `<h1>` because `/login` is the
    // one route `ProtectedRoute` does not wrap, but kept its text as the *product* name — so
    // heading navigation still landed on a string that says nothing about what the user is
    // being asked to do. WIC-1099 finishes that: the `<h1>` now names the *screen*, and the
    // product name (`PRODUCT_NAME`, "Careerpin" — WIC-1089) is still on the page, just no
    // longer a heading.
    await expect(page.getByRole('heading', { level: 1, name: /sign in/i })).toBeVisible();
    await expect(page.getByText('Careerpin')).toBeVisible();
    await expect(page.getByRole('heading', { name: /careerpin/i })).toHaveCount(0);
    await expect(page.getByText(/sign in to manage your job applications/i)).toBeVisible();
  });

  test('should display login form on login page', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('should allow switching between login and register modes', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByText(/sign in to manage your job applications/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByText(/create an account/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i }).first()).toBeVisible();

    await page
      .getByRole('button', { name: /sign in/i })
      .last()
      .click();
    await expect(page.getByText(/sign in to manage your job applications/i)).toBeVisible();
  });

  test('should protect all application routes', async ({ page }) => {
    const protectedRoutes = [
      '/',
      '/applications',
      '/applications/new',
      '/resumes',
      '/reports',
      '/settings',
      '/catalog',
      '/job-fit-analysis',
    ];

    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL('/login');
    }
  });
});

test.describe('Authentication - Auth Flow', () => {
  const isAuthConfigured = () => {
    return process.env.SUPABASE_URL && process.env.SUPABASE_JWT_SECRET;
  };

  test.skip(!isAuthConfigured(), 'Auth flow tests require backend Supabase configuration');

  test('should allow sign up with email', async ({ page }) => {
    await page.goto('/login');

    await page.getByRole('button', { name: /create account/i }).click();

    const testEmail = `test-${Date.now()}@example.com`;
    const testPassword = 'TestPassword123!';

    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page
      .getByRole('button', { name: /create account/i })
      .first()
      .click();

    await page.waitForTimeout(2000);
  });

  test('should allow sign in with credentials', async ({ page }) => {
    const testEmail = process.env.TEST_USER_EMAIL || 'test@example.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

    await page.goto('/login');

    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL('/', { timeout: 5000 });
    await expect(page.getByText(testEmail)).toBeVisible();
  });

  test('should display user email in navigation when authenticated', async ({ page }) => {
    const testEmail = process.env.TEST_USER_EMAIL || 'test@example.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

    await page.goto('/login');
    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL('/');

    await expect(page.getByText(testEmail)).toBeVisible();

    await page.getByRole('button', { name: /user menu/i }).click();
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  });

  test('should logout and redirect to login', async ({ page }) => {
    const testEmail = process.env.TEST_USER_EMAIL || 'test@example.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

    await page.goto('/login');
    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: /user menu/i }).click();
    await page.getByRole('button', { name: /sign out/i }).click();

    await expect(page).toHaveURL('/login');

    await page.goto('/applications');
    await expect(page).toHaveURL('/login');
  });

  test('should include auth token in API requests', async ({ page }) => {
    const testEmail = process.env.TEST_USER_EMAIL || 'test@example.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

    const requests: { url: string; headers: Record<string, string> }[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/') && !request.url().includes('/api/auth/')) {
        requests.push({
          url: request.url(),
          headers: request.headers(),
        });
      }
    });

    await page.goto('/login');
    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL('/');

    await page.waitForTimeout(1000);

    const authenticatedRequest = requests.find((req) => req.headers.authorization);
    expect(authenticatedRequest).toBeDefined();
    expect(authenticatedRequest?.headers.authorization).toMatch(/^Bearer .+/);
  });
});
