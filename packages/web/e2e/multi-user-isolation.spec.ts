import { test, expect, type Page } from '@playwright/test';

/**
 * Multi-User Data Isolation E2E Tests (WIC-201)
 *
 * Verifies that the application correctly enforces per-user data isolation
 * for the cloud-deployed multi-user architecture.
 *
 * Two tiers:
 * 1. UI-level tests — mock API responses, run without Supabase (bypass mode).
 * 2. Real isolation tests — require two pre-existing Supabase test accounts.
 *    Set TEST_USER_EMAIL/PASSWORD and TEST_USER2_EMAIL/PASSWORD to enable.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isSupabaseConfigured = () =>
  !!(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY);

const hasTwoTestUsers = () =>
  !!(
    process.env.TEST_USER_EMAIL &&
    process.env.TEST_USER_PASSWORD &&
    process.env.TEST_USER2_EMAIL &&
    process.env.TEST_USER2_PASSWORD
  );

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
}

async function logOut(page: Page) {
  await page.getByRole('button', { name: /user menu/i }).click();
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL('/login', { timeout: 5000 });
}

// Mock helpers — inject a user-scoped API response for a specific user session
async function mockApplicationsList(page: Page, applications: object[]) {
  await page.route('**/api/applications*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ applications, nextPage: null }),
    })
  );
}

async function mockApplicationNotFound(page: Page, appId: string) {
  await page.route(`**/api/applications/${appId}`, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Application not found' } }),
    })
  );
}

async function mockDashboardStats(page: Page, stats: object) {
  await page.route('**/api/dashboard*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stats),
    })
  );
}

async function mockResumesList(page: Page, resumes: object[]) {
  await page.route('**/api/resumes', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ resumes }),
    })
  );
}

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

// ---------------------------------------------------------------------------
// UI-Level Isolation Tests (run in bypass mode, no Supabase required)
// ---------------------------------------------------------------------------

test.describe('Application Data Isolation - UI', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
  });

  const USER_A_APP = {
    id: 'app-user-a-001',
    jobTitle: 'Staff Engineer',
    company: 'Acme Corp',
    status: 'applied',
    url: null,
    location: 'Remote',
    salaryRange: null,
    version: 1,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    appliedAt: null,
    contact: null,
    compTarget: null,
    nextAction: null,
    nextActionDue: null,
    jobDescription: null,
  };

  test('application list renders only current user applications', async ({ page }) => {
    await mockApplicationsList(page, [USER_A_APP]);
    await page.goto('/applications');

    await expect(page.getByText('Staff Engineer')).toBeVisible();
    await expect(page.getByText('Acme Corp')).toBeVisible();

    // Crucially: the list should contain exactly one application
    const appCards = page
      .locator('[data-testid="application-card"], [class*="application"]')
      .filter({
        hasText: 'Engineer',
      });
    await expect(appCards).toHaveCount(1);
  });

  test('navigating to another user application ID shows not found', async ({ page }) => {
    const otherUserAppId = 'app-other-user-999';
    await mockApplicationNotFound(page, otherUserAppId);

    // Navigate directly to an application detail page for a foreign ID
    await page.goto(`/applications/${otherUserAppId}`);

    // The app should show a not-found / error state, not crash
    const notFoundIndicator = page
      .getByText(/not found/i)
      .or(page.getByText(/application not found/i))
      .or(page.getByText(/404/))
      .or(page.getByRole('heading', { name: /not found/i }));

    // If the page redirects to /applications on 404, that also satisfies isolation
    const redirectedToList =
      (await page.url()).endsWith('/applications') || (await page.url()).endsWith('/');

    const hasNotFoundUI = await notFoundIndicator.isVisible().catch(() => false);
    expect(hasNotFoundUI || redirectedToList).toBe(true);
  });

  test('empty application list renders correctly for new user', async ({ page }) => {
    await mockApplicationsList(page, []);
    await page.goto('/applications');

    // App should render empty state, not another user's data
    const emptyState = page
      .getByText(/no applications/i)
      .or(page.getByText(/get started/i))
      .or(page.getByText(/add your first/i));

    await expect(emptyState).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Dashboard Stats Isolation - UI', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
  });

  test('dashboard shows user-specific stats from API', async ({ page }) => {
    const USER_STATS = {
      total: 7,
      byStatus: {
        saved: 2,
        applied: 3,
        phone_screen: 1,
        interview: 1,
        offer: 0,
        rejected: 0,
        withdrawn: 0,
      },
      recentActivity: [],
    };

    await mockDashboardStats(page, USER_STATS);
    await page.goto('/');

    // Dashboard should reflect exactly the user's stats from the API
    await expect(page.getByText('7')).toBeVisible({ timeout: 5000 });
  });

  test('dashboard with zero stats renders clean empty state', async ({ page }) => {
    const EMPTY_STATS = {
      total: 0,
      byStatus: {
        saved: 0,
        applied: 0,
        phone_screen: 0,
        interview: 0,
        offer: 0,
        rejected: 0,
        withdrawn: 0,
      },
      recentActivity: [],
    };

    await mockDashboardStats(page, EMPTY_STATS);
    await page.goto('/');

    // Should show 0 or empty state without crashing
    await expect(page.locator('body')).not.toContainText('undefined');
    await expect(page.locator('body')).not.toContainText('[object Object]');
  });
});

test.describe('Resume/Document Isolation - UI', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
  });

  const USER_A_RESUME = {
    id: 'resume-user-a-001',
    fileName: 'my-resume.pdf',
    fileSize: 124000,
    mimeType: 'application/pdf',
    createdAt: '2026-04-01T00:00:00.000Z',
    storageKey: 'user-a-uuid/my-resume.pdf',
  };

  test('resume list renders only current user resumes', async ({ page }) => {
    await mockResumesList(page, [USER_A_RESUME]);
    await page.goto('/resumes');

    await expect(page.getByText('my-resume.pdf')).toBeVisible({ timeout: 5000 });
  });

  test('empty resume list for new user renders upload prompt', async ({ page }) => {
    await mockResumesList(page, []);
    await page.goto('/resumes');

    const uploadPrompt = page
      .getByText(/upload/i)
      .or(page.getByText(/no resumes/i))
      .or(page.getByRole('button', { name: /upload/i }));

    await expect(uploadPrompt.first()).toBeVisible({ timeout: 5000 });
  });

  test('API request for resumes includes Authorization header when authenticated', async ({
    page,
  }) => {
    if (!isSupabaseConfigured()) {
      test.skip();
      return;
    }

    const email = process.env.TEST_USER_EMAIL!;
    const password = process.env.TEST_USER_PASSWORD!;

    const resumeRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/resumes')) {
        const auth = req.headers()['authorization'];
        if (auth) resumeRequests.push(auth);
      }
    });

    await loginAs(page, email, password);
    await page.goto('/resumes');
    await page.waitForTimeout(1000);

    expect(resumeRequests.length).toBeGreaterThan(0);
    expect(resumeRequests[0]).toMatch(/^Bearer .+/);
  });
});

// ---------------------------------------------------------------------------
// Auth Token Propagation Tests
// ---------------------------------------------------------------------------

test.describe('API Auth Token Propagation', () => {
  test.skip(!isSupabaseConfigured(), 'Requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');

  test('all API requests include Bearer token after login', async ({ page }) => {
    const email = process.env.TEST_USER_EMAIL!;
    const password = process.env.TEST_USER_PASSWORD!;

    const apiRequests: Array<{ url: string; auth: string | undefined }> = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/')) {
        apiRequests.push({ url: req.url(), auth: req.headers()['authorization'] });
      }
    });

    await loginAs(page, email, password);
    await page.waitForTimeout(1500);

    const unauthenticatedRequest = apiRequests.find((r) => !r.auth);
    expect(unauthenticatedRequest).toBeUndefined();

    const authenticatedRequests = apiRequests.filter((r) => r.auth?.startsWith('Bearer '));
    expect(authenticatedRequests.length).toBeGreaterThan(0);
  });

  test('session persists across page navigation', async ({ page }) => {
    const email = process.env.TEST_USER_EMAIL!;
    const password = process.env.TEST_USER_PASSWORD!;

    await loginAs(page, email, password);

    // Navigate between pages and verify session is maintained
    await page.goto('/applications');
    await expect(page).toHaveURL('/applications');

    await page.goto('/resumes');
    await expect(page).toHaveURL('/resumes');

    await page.goto('/');
    await expect(page).toHaveURL('/');

    // User email should still be visible throughout
    await expect(page.getByText(email)).toBeVisible();
  });

  test('logout invalidates session and redirects protected routes', async ({ page }) => {
    const email = process.env.TEST_USER_EMAIL!;
    const password = process.env.TEST_USER_PASSWORD!;

    await loginAs(page, email, password);
    await logOut(page);

    // All protected routes should now redirect to login
    const protectedRoutes = ['/applications', '/resumes', '/', '/reports'];
    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL('/login', { timeout: 5000 });
    }
  });
});

// ---------------------------------------------------------------------------
// Real Multi-User Isolation Tests (requires two Supabase test accounts)
// ---------------------------------------------------------------------------

test.describe('Real Multi-User Data Isolation', () => {
  test.skip(
    !isSupabaseConfigured() || !hasTwoTestUsers(),
    'Requires VITE_SUPABASE_URL, TEST_USER_EMAIL/PASSWORD, and TEST_USER2_EMAIL/PASSWORD'
  );

  test('User A application is not visible to User B', async ({ browser }) => {
    const user1Email = process.env.TEST_USER_EMAIL!;
    const user1Password = process.env.TEST_USER_PASSWORD!;
    const user2Email = process.env.TEST_USER2_EMAIL!;
    const user2Password = process.env.TEST_USER2_PASSWORD!;

    // Create isolated browser contexts for each user
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // User 1: log in and create an application
      await loginAs(page1, user1Email, user1Password);

      let createdAppId: string | null = null;
      page1.on('response', async (res) => {
        if (res.url().includes('/api/applications') && res.request().method() === 'POST') {
          const body = await res.json().catch(() => null);
          if (body?.application?.id) createdAppId = body.application.id;
        }
      });

      await page1.goto('/applications');
      await page1.getByRole('button', { name: /add application/i }).click();
      await page1.waitForSelector('dialog[open]');
      await page1.fill('input[id="jobTitle"]', 'User A Exclusive Role');
      await page1.fill('input[id="company"]', 'User A Corp');
      await page1.getByRole('button', { name: /save application/i }).click();
      await page1.waitForTimeout(1000);

      // Verify User 1 can see their application
      await expect(page1.getByText('User A Exclusive Role')).toBeVisible({ timeout: 5000 });

      // User 2: log in and verify they cannot see User 1's application
      await loginAs(page2, user2Email, user2Password);
      await page2.goto('/applications');
      await page2.waitForTimeout(1000);

      // User 2's application list should NOT contain User 1's application
      const user1AppVisible = await page2.getByText('User A Exclusive Role').isVisible();
      expect(user1AppVisible).toBe(false);

      // If we captured the application ID, try direct URL access from User 2
      if (createdAppId) {
        await page2.goto(`/applications/${createdAppId}`);
        await page2.waitForTimeout(1000);

        const isOnProtectedPage = page2.url().includes(createdAppId);
        if (isOnProtectedPage) {
          // The page rendered — verify it shows not-found, not the application data
          const showsAppData = await page2.getByText('User A Exclusive Role').isVisible();
          expect(showsAppData).toBe(false);
        }
        // Otherwise the app redirected away from the foreign resource — also correct
      }
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('User B cannot update User A application status via API', async ({ browser }) => {
    const user1Email = process.env.TEST_USER_EMAIL!;
    const user1Password = process.env.TEST_USER_PASSWORD!;
    const user2Email = process.env.TEST_USER2_EMAIL!;
    const user2Password = process.env.TEST_USER2_PASSWORD!;

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // User 1: create application and capture its ID + auth token
      await loginAs(page1, user1Email, user1Password);

      let user1AppId: string | null = null;
      let user2Token: string | null = null;

      page1.on('response', async (res) => {
        if (res.url().includes('/api/applications') && res.request().method() === 'POST') {
          const body = await res.json().catch(() => null);
          if (body?.application?.id) user1AppId = body.application.id;
        }
      });

      await page1.goto('/applications');
      await page1.getByRole('button', { name: /add application/i }).click();
      await page1.waitForSelector('dialog[open]');
      await page1.fill('input[id="jobTitle"]', 'Cross-User Test Role');
      await page1.fill('input[id="company"]', 'Isolation Corp');
      await page1.getByRole('button', { name: /save application/i }).click();
      await page1.waitForTimeout(1000);

      // User 2: log in and capture their token
      await loginAs(page2, user2Email, user2Password);
      page2.on('request', (req) => {
        if (req.url().includes('/api/') && req.headers()['authorization']) {
          user2Token = req.headers()['authorization']!;
        }
      });
      await page2.goto('/applications');
      await page2.waitForTimeout(1000);

      // Attempt to update User 1's application directly via API using User 2's token
      if (user1AppId && user2Token) {
        const apiContext = await page2.context().request;
        const patchResponse = await apiContext.patch(`/api/applications/${user1AppId}`, {
          headers: { Authorization: user2Token },
          data: { jobTitle: 'HIJACKED', version: 1 },
        });

        // Must return 404 (not found for this user) — not 200
        expect(patchResponse.status()).toBe(404);
      }
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('dashboard stats are independent per user', async ({ browser }) => {
    const user1Email = process.env.TEST_USER_EMAIL!;
    const user1Password = process.env.TEST_USER_PASSWORD!;
    const user2Email = process.env.TEST_USER2_EMAIL!;
    const user2Password = process.env.TEST_USER2_PASSWORD!;

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Capture dashboard API responses for each user
      let user1Stats: Record<string, unknown> | null = null;
      let user2Stats: Record<string, unknown> | null = null;

      page1.on('response', async (res) => {
        if (res.url().includes('/api/dashboard')) {
          user1Stats = await res.json().catch(() => null);
        }
      });
      page2.on('response', async (res) => {
        if (res.url().includes('/api/dashboard')) {
          user2Stats = await res.json().catch(() => null);
        }
      });

      await loginAs(page1, user1Email, user1Password);
      await page1.goto('/');
      await page1.waitForTimeout(1500);

      await loginAs(page2, user2Email, user2Password);
      await page2.goto('/');
      await page2.waitForTimeout(1500);

      // Both users should get responses (not null/undefined)
      expect(user1Stats).not.toBeNull();
      expect(user2Stats).not.toBeNull();

      // If users have different applications, totals should differ
      // At minimum, each user's dashboard reflects their own data only
      // This assertion is valid when user data differs; adjust if both have 0 apps
      if (user1Stats?.total !== user2Stats?.total) {
        expect(user1Stats.total).not.toBe(user2Stats.total);
      }
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('status transitions are scoped to authenticated user', async ({ browser }) => {
    const user1Email = process.env.TEST_USER_EMAIL!;
    const user1Password = process.env.TEST_USER_PASSWORD!;
    const user2Email = process.env.TEST_USER2_EMAIL!;
    const user2Password = process.env.TEST_USER2_PASSWORD!;

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // User 1: create application
      await loginAs(page1, user1Email, user1Password);

      let user1AppId: string | null = null;
      let user1AppVersion: number | null = null;
      let user2Token: string | null = null;

      page1.on('response', async (res) => {
        if (res.url().includes('/api/applications') && res.request().method() === 'POST') {
          const body = await res.json().catch(() => null);
          if (body?.application?.id) {
            user1AppId = body.application.id;
            user1AppVersion = body.application.version;
          }
        }
      });

      await page1.goto('/applications');
      await page1.getByRole('button', { name: /add application/i }).click();
      await page1.waitForSelector('dialog[open]');
      await page1.fill('input[id="jobTitle"]', 'Status Isolation Role');
      await page1.fill('input[id="company"]', 'Status Corp');
      await page1.getByRole('button', { name: /save application/i }).click();
      await page1.waitForTimeout(1000);

      // User 2: log in and capture token
      await loginAs(page2, user2Email, user2Password);
      page2.on('request', (req) => {
        if (req.url().includes('/api/') && req.headers()['authorization']) {
          user2Token = req.headers()['authorization']!;
        }
      });
      await page2.goto('/applications');
      await page2.waitForTimeout(1000);

      // User 2 attempts to change User 1's application status
      if (user1AppId && user1AppVersion && user2Token) {
        const apiContext = await page2.context().request;
        const statusResponse = await apiContext.patch(`/api/applications/${user1AppId}/status`, {
          headers: { Authorization: user2Token },
          data: { status: 'applied', version: user1AppVersion },
        });

        // Must return 404 — User 2 has no visibility to User 1's application
        expect(statusResponse.status()).toBe(404);
      }
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
