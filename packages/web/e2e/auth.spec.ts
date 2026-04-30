import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 *
 * These tests verify the authentication flow with Supabase.
 * To run these tests with authentication enabled:
 * 1. Start Supabase local: `supabase start`
 * 2. Get JWT secret: `supabase status`
 * 3. Set environment variables in packages/api/.env and packages/web/.env
 * 4. Run tests: `npm run test:e2e`
 *
 * Without Supabase configured, the app runs in bypass mode (no auth required).
 */

test.describe('Authentication - UI Components', () => {
  test('should redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/');

    // Should be redirected to /login
    await expect(page).toHaveURL('/login');

    // Should see the login form
    await expect(page.getByRole('heading', { name: /job application manager/i })).toBeVisible();
    await expect(page.getByText(/sign in to manage your job applications/i)).toBeVisible();
  });

  test('should display Supabase Auth UI on login page', async ({ page }) => {
    await page.goto('/login');

    // Supabase Auth UI should be present with email input
    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
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
  // Helper to check if Supabase is configured
  const isSupabaseConfigured = () => {
    return process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY;
  };

  test.skip(!isSupabaseConfigured(), 'Supabase auth flow requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');

  test('should allow sign up with email', async ({ page }) => {
    await page.goto('/login');

    const testEmail = `test-${Date.now()}@example.com`;
    const testPassword = 'TestPassword123!';

    // Fill in sign up form
    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: /sign up/i }).click();

    // Should show email confirmation message or redirect to app
    // Exact behavior depends on Supabase email confirmation settings
    await page.waitForTimeout(2000);
  });

  test('should allow sign in with credentials', async ({ page, context }) => {
    // This test requires a pre-existing test user in Supabase
    const testEmail = process.env.TEST_USER_EMAIL || 'test@example.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

    await page.goto('/login');

    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL('/', { timeout: 5000 });

    // Should show authenticated UI
    await expect(page.getByText(testEmail)).toBeVisible();
  });

  test('should display user email in navigation when authenticated', async ({ page, context }) => {
    // Create an authenticated session
    const testEmail = process.env.TEST_USER_EMAIL || 'test@example.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

    await page.goto('/login');
    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL('/');

    // User email should appear in top navigation
    await expect(page.getByText(testEmail)).toBeVisible();

    // User dropdown should be accessible
    await page.getByRole('button', { name: /user menu/i }).click();
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  });

  test('should logout and redirect to login', async ({ page }) => {
    const testEmail = process.env.TEST_USER_EMAIL || 'test@example.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

    // Sign in first
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL('/');

    // Click sign out
    await page.getByRole('button', { name: /user menu/i }).click();
    await page.getByRole('button', { name: /sign out/i }).click();

    // Should redirect to login
    await expect(page).toHaveURL('/login');

    // Should not be able to access protected routes
    await page.goto('/applications');
    await expect(page).toHaveURL('/login');
  });

  test('should include auth token in API requests', async ({ page }) => {
    const testEmail = process.env.TEST_USER_EMAIL || 'test@example.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

    // Intercept API requests to verify Authorization header
    const requests: any[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) {
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

    // Wait for dashboard API calls
    await page.waitForTimeout(1000);

    // Verify at least one API request included Authorization header
    const authenticatedRequest = requests.find((req) => req.headers.authorization);
    expect(authenticatedRequest).toBeDefined();
    expect(authenticatedRequest?.headers.authorization).toMatch(/^Bearer .+/);
  });
});
