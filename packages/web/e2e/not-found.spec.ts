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

    await expect(page.getByRole('heading', { name: /couldn't be found/i })).toBeVisible();
    await expect(page.getByText('404', { exact: true })).toBeVisible();
  });

  test('titles the tab with the same heading the page shows (WIC-1089)', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');

    // Not hand-typed: the apostrophe in "couldn't" is a straight U+0027 and the separator
    // is a real em dash U+2014, and `toHaveTitle(string)` is an exact match — so a title
    // retyped from the design doc's prose (which uses U+2019) fails here. Read from the
    // rendered <h1> instead, which also pins the actual guarantee: title and heading name
    // the same screen. See docs/design/ROUTE_TITLE_CONVENTION.md §0.3 and §7.
    const heading = await page.getByRole('heading', { level: 1 }).textContent();
    await expect(page).toHaveTitle(`${heading} — Careerpin`);
  });

  test('restores a route title after navigating back off the 404 (WIC-1089 AC3)', async ({
    page,
  }) => {
    await page.goto('/reports/stale');
    await expect(page).toHaveTitle('Stale Applications — Careerpin');

    await page.goto('/nope-not-a-route');
    await expect(page).toHaveTitle(/Careerpin$/);
    await expect(page).not.toHaveTitle('Stale Applications — Careerpin');

    // The stale-title defect, in the direction a user actually hits it: back out of the
    // 404 and the tab must name where you landed, not where you just were.
    await page.goBack();
    await expect(page).toHaveTitle('Stale Applications — Careerpin');
  });

  test('names the path that was not found', async ({ page }) => {
    await page.goto('/reports/typo-in-this-link');

    await expect(page.getByText('/reports/typo-in-this-link')).toBeVisible();
  });

  test('keeps the app chrome and offers a way back to the dashboard', async ({ page }) => {
    await page.goto('/nope');

    // The 404 lives inside the app shell, so navigation stays available.
    await expect(page.getByRole('navigation').first()).toBeVisible();

    await page.getByRole('link', { name: /back to dashboard/i }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: /couldn't be found/i })).toBeHidden();
  });

  test('no nav item claims to be the current page (WIC-1053)', async ({ page }) => {
    // `/reports/typo` matched no route, but the nav decides active state with a
    // `startsWith` prefix match, so it used to mark Reports as the page you are on —
    // `aria-current="page"` telling a screen-reader user they are on Reports at the
    // same moment the focused heading tells them the page was not found.
    await page.goto('/reports/typo');

    await expect(page.getByRole('heading', { name: /couldn't be found/i })).toBeVisible();
    await expect(page.locator('[aria-current="page"]')).toHaveCount(0);
  });

  test('a real nested route does still mark its nav item current', async ({ page }) => {
    // Negative control for the test above: suppressing `aria-current` everywhere
    // would pass it just as well, and would be a regression of its own.
    await page.goto('/reports/stale');

    await expect(page.locator('[aria-current="page"]')).not.toHaveCount(0);
  });

  test('offers a visible search affordance, not only the Ctrl+K hint', async ({ page }) => {
    // The hint is `sm:`-only because there is no Ctrl+K on a phone, which left touch
    // users with the dashboard link as their only way out. The button must therefore
    // render at every breakpoint — checked here at a phone viewport.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/nope');

    const searchButton = page.getByRole('button', { name: 'Search applications' });
    await expect(searchButton).toBeVisible();

    await searchButton.click();
    await expect(
      page.getByPlaceholder('Search applications, companies, or statuses...')
    ).toBeVisible();
  });

  test('the Ctrl+K hint still opens the same palette', async ({ page }) => {
    // The palette's state moved out of `App` into a context so the button above could
    // reach it; the keyboard path has to survive that move.
    await page.goto('/nope');

    // `goto` resolves on `load`, but the Ctrl+K listener is registered in
    // `CommandPaletteProvider`'s effect, which runs after React mounts. Unlike a
    // locator action, `keyboard.press` neither auto-waits nor retries, so a press
    // dispatched before that lands on a document with no listener and is simply lost.
    // Waiting on rendered page content is the mount barrier the sibling test above
    // gets incidentally from awaiting its button.
    await expect(page.getByRole('heading', { name: /couldn't be found/i })).toBeVisible();

    await page.keyboard.press('ControlOrMeta+k');

    await expect(
      page.getByPlaceholder('Search applications, companies, or statuses...')
    ).toBeVisible();
  });

  test('does not swallow a real route', async ({ page }) => {
    await page.goto('/applications');

    await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /couldn't be found/i })).toBeHidden();
  });

  test('/dashboard redirects to the dashboard rather than 404ing', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /couldn't be found/i })).toBeHidden();
  });

  test('the /dashboard redirect replaces history instead of stacking onto it', async ({ page }) => {
    await page.goto('/applications');
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/');

    // Without `replace`, going back would land on /dashboard, which would redirect
    // forward to / again — a back button that cannot escape the page it just left.
    await page.goBack();
    await expect(page).toHaveURL('/applications');
  });

  test('unauthenticated unmatched paths still redirect to login', async ({ page }) => {
    // No mock auth: clear the token the shared beforeEach seeded.
    await page.addInitScript(() => localStorage.removeItem('auth_token'));

    await page.goto('/this-route-does-not-exist');

    await expect(page).toHaveURL('/login');
  });
});
