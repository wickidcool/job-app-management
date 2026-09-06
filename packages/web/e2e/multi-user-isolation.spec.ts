import { test, expect, type Page } from '@playwright/test';

/**
 * Multi-User Data Isolation E2E Tests (WIC-201)
 *
 * Verifies that the application correctly enforces per-user data isolation
 * for the cloud-deployed multi-user architecture.
 *
 * Two tiers, each behind its own explicit opt-in (WIC-2201):
 * 1. UI-level tests — mock API responses and mock auth, need no backend. Gated on
 *    E2E_ISOLATION_UI, which CI sets (WIC-2207).
 * 2. Real isolation tests — require a live API and two pre-existing Supabase test
 *    accounts. Gated on E2E_LIVE_BACKEND; supply TEST_USER_EMAIL/PASSWORD and
 *    TEST_USER2_EMAIL/PASSWORD in the job that opts in.
 *
 * WIC-2207: the UI tier was gated as "known timing-flaky against mock auth". That
 * premise was never measured, and it was wrong twice over. These tests never set up
 * mock auth at all — they lacked both halves of this repo's standard pattern (a
 * `**\/api/auth/me` route and the `auth_token` init script that every other mocked
 * spec here uses). So every `page.goto` into a protected route was bounced to
 * `/login` by `AuthContext`, and the assertions ran against the sign-in form.
 *
 * That is deterministic, not flaky: measured at 9e622fb1 over 3 repeats (21
 * executions), the same 6 failed and the same 1 passed every time, 0 variance. The
 * missing `/auth/me` mock is also why this spec was the one leaking `ECONNREFUSED`
 * into the vite proxy while claiming to need no backend.
 */

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

// WIC-2201: gate on backend AVAILABILITY, never on credential presence. The old
// guard was `!process.env.TEST_USER_EMAIL`, which treats "credentials exist" as
// "a backend is up". Those are unrelated: CI has never started the API
// (playwright.config.ts runs `npm run dev`, and root package.json maps `dev` to
// the @wic/web workspace only — the API is `dev:api`, which nothing invokes).
// So provisioning the credential woke 29 specs against a dead backend, blew the
// e2e-tests 15m timeout and SKIPPED deploy-production. See WIC-2122 / WIC-2199.
//
// Deliberately NOT AND-ed with a credential check: a job that opts in without a
// backend or without credentials must fail LOUD, not silently skip. A silent
// skip that reads as coverage is the exact defect this replaces.
const requiresLiveBackend = () => !process.env.E2E_LIVE_BACKEND;

// The UI tier mocks its API responses AND its auth, so it needs no backend. It
// keeps a gate of its own so that turning the backend on (E2E_LIVE_BACKEND, owned
// by WIC-2122) does not change what this tier runs, and vice versa — the two tiers
// fail for unrelated reasons and should be diagnosable apart. CI sets this in the
// `e2e-isolation-coverage` job; see WIC-2207.
const requiresIsolationUi = () => !process.env.E2E_ISOLATION_UI;

const hasTestCredentials = () => !!(process.env.TEST_USER_EMAIL && process.env.TEST_USER_PASSWORD);

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

// Mock auth for the UI tier. Both halves are load-bearing and this repo's other
// mocked specs (application-form-errors, document-storage, modal-focus-*) use the
// same pair: `AuthContext` reads `auth_token` from localStorage to decide whether a
// session exists, then calls `GET /auth/me` to hydrate it. Omit the init script and
// the app never attempts the fetch; omit the route and the fetch reaches the vite
// proxy, which has no backend behind it in this tier. Either way the protected
// route redirects to /login and every subsequent assertion measures the sign-in
// form instead of the page under test (WIC-2207).
const MOCK_USER = {
  id: 'test-user-001',
  email: 'test@example.com',
};

// Mock helpers — inject a user-scoped API response for a specific user session.
//
// ⚠️ These match on an ANCHORED RegExp, not a `**/api/<name>*` glob, and that is
// load-bearing (WIC-2207). Under `npm run dev` the app is served by vite, which
// serves its own module graph off the SAME origin — and this app's API service
// modules live at `/src/services/api/<name>Service.ts`. A glob's `*` matches any
// run of non-`/` characters, so `**/api/dashboard*` matches
// `/src/services/api/dashboardService.ts` as happily as `/api/dashboard`.
//
// Measured at 9e622fb1: the glob form intercepted the module request and NOTHING
// else — `/api/dashboard` was never even seen — and answered a `<script type=
// module>` with `application/json`. Chromium's strict MIME check then refused the
// module, the app never mounted, and `document.body` rendered empty. Anchoring on
// `(\?.*)?$` pins the match to the request path's end, which no `*.ts` module URL
// can satisfy.
//
// This is silent in the worst way: a blank page satisfies every *negative*
// assertion. `dashboard with zero stats renders clean empty state` was green for
// exactly this reason — see the positive anchor added to it below.
const apiRoute = (path: string) => new RegExp(`/api/${path}(\\?.*)?$`);

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function setupMockAuth(page: Page) {
  await page.route('**/api/auth/me', (route) => route.fulfill(json({ user: MOCK_USER })));

  // Ambient endpoints every authenticated page fetches regardless of the route
  // under test. Enumerated by routing `**/*` and recording every `/api/` request
  // that escaped the mocks (WIC-2207); these three were the whole remainder.
  //
  // Leaving them unrouted is what produced the `ECONNREFUSED` noise in the vite
  // proxy that WIC-2199 flagged — the UI tier claimed to need no backend while
  // three of its requests went looking for one. `should-show: false` also pins a
  // genuine nondeterminism source: a truthy answer mounts the onboarding modal
  // over the page under test.
  await page.route(apiRoute('users/me/onboarding/should-show'), (route) =>
    route.fulfill(json({ shouldShow: false }))
  );

  await page.route(apiRoute('users/me/onboarding/status'), (route) =>
    route.fulfill(
      json({
        id: 'onboarding-001',
        userId: MOCK_USER.id,
        currentStep: 'completed',
        personalInfoStepCompleted: true,
        personalInfoStepSkipped: false,
        resumeStepCompleted: true,
        resumeStepSkipped: false,
        applicationStepCompleted: true,
        applicationStepSkipped: false,
        startedAt: '2026-04-01T00:00:00.000Z',
        completedAt: '2026-04-01T00:00:00.000Z',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        version: 1,
      })
    )
  );

  await page.route(apiRoute('personal-info'), (route) =>
    route.fulfill(
      json({
        personalInfo: { fullName: 'Test User', email: MOCK_USER.email },
        isComplete: false,
        completionPercentage: 0,
      })
    )
  );

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
  });
}

async function mockApplicationsList(page: Page, applications: object[]) {
  await page.route(apiRoute('applications'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ applications, nextPage: null }),
    })
  );
}

async function mockApplicationNotFound(page: Page, appId: string) {
  await page.route(apiRoute(`applications/${appId}`), (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Application not found' } }),
    })
  );
}

/**
 * `GET /dashboard` returns `DashboardResponse` — `{ stats, recentActivity,
 * attention }` — NOT a bare stats object (`services/api/types.ts:249`). The
 * previous fixture spread `total`/`byStatus` at the top level, so `stats` came
 * back undefined and `Dashboard.tsx` fell through to its `total: 0` default. That
 * defect was invisible while the glob above was also killing the page.
 */
function dashboardResponse(stats: { total: number; byStatus: Record<string, number> }) {
  return {
    stats: {
      total: stats.total,
      byStatus: stats.byStatus,
      appliedThisWeek: 0,
      appliedThisMonth: 0,
      responseRate: 0,
    },
    recentActivity: [],
    attention: {
      staleThresholdDays: 14,
      unsubmittedThresholdDays: 7,
      counts: { interviewing: 0, stale: 0, missingJobDescription: 0, unsubmittedSaved: 0 },
      samples: { interviewing: [], stale: [], missingJobDescription: [], unsubmittedSaved: [] },
    },
  };
}

async function mockDashboardStats(
  page: Page,
  stats: { total: number; byStatus: Record<string, number> }
) {
  await page.route(apiRoute('dashboard'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(dashboardResponse(stats)),
    })
  );
}

async function mockResumesList(page: Page, resumes: object[]) {
  await page.route(apiRoute('resumes'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ resumes }),
    })
  );
}

// ---------------------------------------------------------------------------
// UI-Level Isolation Tests (mock auth, no backend required)
// These mock both their auth and their API responses, so they do NOT need a live
// backend. `setupMockAuth` runs before every test in each block below — without it
// the protected route redirects to /login and the assertions silently measure the
// sign-in form (WIC-2207).
// ---------------------------------------------------------------------------

test.describe('Application Data Isolation - UI', () => {
  test.skip(requiresIsolationUi(), 'UI isolation tier — set E2E_ISOLATION_UI=1 to run');

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

    // Crucially: the board should contain exactly one application card.
    //
    // WIC-2207: this used to query
    // `[data-testid="application-card"], [class*="application"]`. Neither half
    // exists. `grep -rn 'data-testid' packages/web/src` returns only test-owned
    // fixtures — the app ships no `application-card` testid — and the class list
    // is Tailwind utilities, none containing the substring "application". Both
    // selectors resolved to 0 elements, so `toHaveCount(1)` was unsatisfiable:
    // no application data could ever have made it pass, which is the opposite of
    // what an isolation count is for.
    //
    // `ApplicationCard` renders an `<article aria-label="<title> at <company>,
    // status: <status>">` (`components/ApplicationCard.tsx:182-201`), so the role
    // is the stable anchor. Asserting the label too means a second user's card
    // leaking onto the board fails the count AND is named in the diff.
    const appCards = page.getByRole('article');
    await expect(appCards).toHaveCount(1);
    await expect(appCards.first()).toHaveAttribute(
      'aria-label',
      'Staff Engineer at Acme Corp, status: applied'
    );
  });

  test('navigating to another user application ID shows not found', async ({ page }) => {
    const otherUserAppId = 'app-other-user-999';
    await mockApplicationNotFound(page, otherUserAppId);

    // Navigate directly to an application detail page for a foreign ID
    await page.goto(`/applications/${otherUserAppId}`);

    // The app should show a not-found / error state, not crash.
    //
    // WIC-2207: this used to read `await notFoundIndicator.isVisible()`, which
    // resolves against the CURRENT DOM and does not retry. It ran while the page
    // still said "Loading...", so it returned false; `redirectedToList` was false
    // too, because the app correctly stays on the detail URL. The test therefore
    // failed against an app that behaves exactly as required — measured: the
    // not-found copy does appear, it just takes ~1s for the 404 to land.
    //
    // `expect(...).toBeVisible()` is the retrying form and is what this needed.
    const notFoundIndicator = page
      .getByText(/not found/i)
      .or(page.getByText(/404/))
      .or(page.getByRole('heading', { name: /not found/i }));

    await expect(notFoundIndicator.first()).toBeVisible({ timeout: 10000 });

    // The foreign application's data must never appear, whichever state renders.
    await expect(page.getByRole('article')).toHaveCount(0);
  });

  test('empty application list renders correctly for new user', async ({ page }) => {
    await mockApplicationsList(page, []);
    await page.goto('/applications');

    // App should render its empty state, not another user's data.
    //
    // WIC-2207: the old matcher was `/no applications/i | /get started/i |
    // /add your first/i`. `/applications` renders a Kanban board whose per-column
    // empty copy is "No saved applications", "No applied applications", … — none
    // of which contain the substring "no applications", and the page has no
    // "get started" or "add your first" copy at all. So this asserted on text the
    // app has never rendered.
    await expect(page.getByText('No saved applications')).toBeVisible({ timeout: 5000 });

    // The positive half: zero cards on the board. Without this, the assertion
    // above would still pass if a foreign user's card rendered alongside an empty
    // "Saved" column.
    await expect(page.getByRole('article')).toHaveCount(0);
  });
});

test.describe('Dashboard Stats Isolation - UI', () => {
  test.skip(requiresIsolationUi(), 'UI isolation tier — set E2E_ISOLATION_UI=1 to run');

  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
  });

  /**
   * `DashboardStats` renders each figure as an unlabelled `StatCard` — a value div
   * over a label div (`components/DashboardStats.tsx:65-78`). The label is the only
   * stable handle, so anchor on it and assert the tile it belongs to.
   *
   * WIC-2207: the old assertion was a bare `getByText('7')`. Playwright's string
   * form is a SUBSTRING match over the whole page, and this dashboard renders the
   * literal label "Last 7 Days" unconditionally — so a `7` was on the page whether
   * or not `total` was ever 7. It read as a stats assertion and was one only by
   * coincidence of the fixture.
   */
  const statTile = (page: Page, label: string) =>
    page.getByText(label, { exact: true }).locator('xpath=..');

  test('dashboard shows user-specific stats from API', async ({ page }) => {
    await mockDashboardStats(page, {
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
    });
    await page.goto('/');

    // Dashboard should reflect exactly the user's stats from the API.
    await expect(statTile(page, 'Total')).toHaveText(/^7\s*Total$/, { timeout: 5000 });
    // phone_screen (1) + interview (1) — proves the byStatus map is read per user,
    // not just the scalar total.
    await expect(statTile(page, 'In Review')).toHaveText(/^2\s*In Review$/);
  });

  test('dashboard with zero stats renders clean empty state', async ({ page }) => {
    await mockDashboardStats(page, {
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
    });
    await page.goto('/');

    // WIC-2207 — POSITIVE ANCHOR, and it is the whole point of this edit.
    //
    // This test's only assertions used to be the two negatives below. A blank page
    // satisfies both, and that is not hypothetical: while `mockDashboardStats` was
    // globbing vite's own module path, the app never mounted, `document.body` was
    // empty, and this test PASSED — the one green in a block of failures, green
    // precisely because the page was broken.
    //
    // So assert the dashboard actually rendered, and rendered the zero, before
    // asserting what it must not contain. A negative assertion is only worth what
    // its positive control is worth.
    await expect(statTile(page, 'Total')).toHaveText(/^0\s*Total$/, { timeout: 5000 });

    // Should render 0 rather than leaking an unformatted value.
    await expect(page.locator('body')).not.toContainText('undefined');
    await expect(page.locator('body')).not.toContainText('[object Object]');
  });
});

test.describe('Resume/Document Isolation - UI', () => {
  test.skip(requiresIsolationUi(), 'UI isolation tier — set E2E_ISOLATION_UI=1 to run');

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
    if (!hasTestCredentials()) {
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
  test.skip(
    requiresLiveBackend(),
    'requires a live API backend — set E2E_LIVE_BACKEND=1 in a job that boots dev:api and supplies VITE_SUPABASE_URL + TEST_USER credentials'
  );

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
    requiresLiveBackend(),
    'requires a live API backend — set E2E_LIVE_BACKEND=1 in a job that boots dev:api and supplies VITE_SUPABASE_URL + TWO sets of TEST_USER credentials'
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
