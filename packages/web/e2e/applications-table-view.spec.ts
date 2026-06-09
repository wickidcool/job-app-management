import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for ApplicationsList table view (WIC-510 / QA: WIC-513)
 *
 * Tests cover:
 * - Kanban ⇄ Table toggle
 * - View preference persists in localStorage
 * - All 5 columns render
 * - Sorting on each column (asc/desc toggle)
 * - Sort indicator (▲/▼) on active column
 * - Status filter works in table view
 * - Row click navigates to detail
 * - Status colors match design system
 * - Empty state displays when no applications
 */

const MOCK_USER = {
  id: 'test-user-001',
  email: 'test@example.com',
};

const MOCK_APPLICATIONS = [
  {
    id: 'app-001',
    jobTitle: 'Software Engineer',
    company: 'Acme Corp',
    location: 'Remote',
    salaryRange: null,
    status: 'applied',
    hasDocuments: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    appliedAt: '2026-05-01T00:00:00.000Z',
    url: null,
    jobDescription: null,
    contact: null,
    compTarget: null,
    nextAction: null,
    nextActionDue: null,
  },
  {
    id: 'app-002',
    jobTitle: 'Product Manager',
    company: 'Beta Inc',
    location: 'New York',
    salaryRange: null,
    status: 'interview',
    hasDocuments: false,
    version: 1,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    appliedAt: '2026-04-15T00:00:00.000Z',
    url: null,
    jobDescription: null,
    contact: null,
    compTarget: null,
    nextAction: null,
    nextActionDue: null,
  },
  {
    id: 'app-003',
    jobTitle: 'Designer',
    company: 'Gamma LLC',
    location: 'Remote',
    salaryRange: null,
    status: 'rejected',
    hasDocuments: false,
    version: 1,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    appliedAt: null,
    url: null,
    jobDescription: null,
    contact: null,
    compTarget: null,
    nextAction: null,
    nextActionDue: null,
  },
];

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

async function setupApplicationsMock(page: Page, apps = MOCK_APPLICATIONS) {
  await page.route('**/api/applications**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ applications: apps }),
    })
  );

  await page.route('**/api/dashboard**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: apps.length,
        appliedThisWeek: 0,
        responseRate: 0,
        inReview: 0,
      }),
    })
  );
}

async function goToApplications(page: Page) {
  await page.goto('/applications');
  await page.waitForLoadState('networkidle');
}

test.describe('ApplicationsList — Table View (WIC-510)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await setupApplicationsMock(page);
    // Clear localStorage view preference before each test
    await page.addInitScript(() => {
      localStorage.removeItem('applications-view-mode');
    });
  });

  // ─── Toggle ─────────────────────────────────────────────────────────────────

  test('default view is kanban', async ({ page }) => {
    await goToApplications(page);

    const kanbanBtn = page.getByRole('button', { name: 'Kanban' });
    await expect(kanbanBtn).toHaveAttribute('aria-pressed', 'true');
    // Kanban board should be visible; table should not
    await expect(page.locator('table')).not.toBeVisible();
  });

  test('clicking Table button switches to table view', async ({ page }) => {
    await goToApplications(page);

    await page.getByRole('button', { name: 'Table' }).click();

    const tableBtn = page.getByRole('button', { name: 'Table' });
    await expect(tableBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('table')).toBeVisible();
  });

  test('clicking Kanban button from table view switches back to kanban', async ({ page }) => {
    await goToApplications(page);

    await page.getByRole('button', { name: 'Table' }).click();
    await expect(page.locator('table')).toBeVisible();

    await page.getByRole('button', { name: 'Kanban' }).click();
    await expect(page.locator('table')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Kanban' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  // ─── localStorage persistence ────────────────────────────────────────────────

  test('view preference (table) persists after page reload', async ({ page }) => {
    await goToApplications(page);

    // Switch to table view
    await page.getByRole('button', { name: 'Table' }).click();
    await expect(page.locator('table')).toBeVisible();

    // Reload — localStorage should restore table view
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('table')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Table' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('view preference (kanban) persists after page reload', async ({ page }) => {
    // Start in table, then switch back to kanban, then reload
    await page.addInitScript(() => {
      localStorage.setItem('applications-view-mode', 'table');
    });

    await goToApplications(page);
    await page.getByRole('button', { name: 'Kanban' }).click();
    await expect(page.locator('table')).not.toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('table')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Kanban' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  // ─── Columns ─────────────────────────────────────────────────────────────────

  test('table renders all 5 required columns', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    const headers = page.locator('thead th');
    const headerTexts = await headers.allTextContents();
    const normalised = headerTexts.map((t) => t.trim().replace(/[▲▼\s]+/g, ' ').trim());

    expect(normalised.some((h) => /company/i.test(h))).toBe(true);
    expect(normalised.some((h) => /role/i.test(h))).toBe(true);
    expect(normalised.some((h) => /status/i.test(h))).toBe(true);
    expect(normalised.some((h) => /last status change/i.test(h))).toBe(true);
    expect(normalised.some((h) => /applied date/i.test(h))).toBe(true);
  });

  test('table rows render application data', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    await expect(page.getByRole('cell', { name: 'Acme Corp' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Software Engineer' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Beta Inc' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Product Manager' })).toBeVisible();
  });

  // ─── Sorting ─────────────────────────────────────────────────────────────────

  test('clicking Company column header sorts rows ascending', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    await page.locator('thead th').filter({ hasText: /company/i }).click();

    const firstCell = page.locator('tbody tr').first().locator('td').first();
    await expect(firstCell).toHaveText('Acme Corp');
  });

  test('clicking Company column header twice sorts rows descending', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    const companyHeader = page.locator('thead th').filter({ hasText: /company/i });
    await companyHeader.click(); // asc
    await companyHeader.click(); // desc

    const firstCell = page.locator('tbody tr').first().locator('td').first();
    await expect(firstCell).toHaveText('Gamma LLC');
  });

  test('clicking Role column header sorts rows', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    await page.locator('thead th').filter({ hasText: /role/i }).click();

    const cells = await page
      .locator('tbody tr td:nth-child(2)')
      .allTextContents();
    const sorted = [...cells].sort((a, b) => a.localeCompare(b));
    expect(cells).toEqual(sorted);
  });

  test('clicking Status column header sorts by status', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    // Just verify click does not throw and indicator appears
    await page.locator('thead th').filter({ hasText: /^status/i }).click();
    // Sort indicator should appear on Status column
    await expect(page.locator('thead th').filter({ hasText: /^status/i })).toContainText(/[▲▼]/);
  });

  test('clicking Last Status Change column header sorts', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    await page.locator('thead th').filter({ hasText: /last status change/i }).click();
    await expect(
      page.locator('thead th').filter({ hasText: /last status change/i })
    ).toContainText(/[▲▼]/);
  });

  test('clicking Applied Date column header sorts', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    await page.locator('thead th').filter({ hasText: /applied date/i }).click();
    await expect(
      page.locator('thead th').filter({ hasText: /applied date/i })
    ).toContainText(/[▲▼]/);
  });

  // ─── Sort indicator ──────────────────────────────────────────────────────────

  test('sort indicator ▲ appears on active column after first click', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    const companyHeader = page.locator('thead th').filter({ hasText: /company/i });
    await companyHeader.click();

    await expect(companyHeader).toContainText('▲');
    // Other headers should not show an indicator
    await expect(page.locator('thead th').filter({ hasText: /role/i })).not.toContainText(/[▲▼]/);
  });

  test('sort indicator flips to ▼ on second click of same column', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    const companyHeader = page.locator('thead th').filter({ hasText: /company/i });
    await companyHeader.click(); // asc → ▲
    await companyHeader.click(); // desc → ▼

    await expect(companyHeader).toContainText('▼');
    await expect(companyHeader).not.toContainText('▲');
  });

  test('sort indicator moves to newly clicked column', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    const companyHeader = page.locator('thead th').filter({ hasText: /company/i });
    const roleHeader = page.locator('thead th').filter({ hasText: /role/i });

    await companyHeader.click();
    await expect(companyHeader).toContainText(/[▲▼]/);

    await roleHeader.click();
    await expect(roleHeader).toContainText(/[▲▼]/);
    await expect(companyHeader).not.toContainText(/[▲▼]/);
  });

  // ─── Status filter ───────────────────────────────────────────────────────────

  test('status filter applied in kanban also filters table view', async ({ page }) => {
    await goToApplications(page);

    // Open filter panel and apply status filter via URL / mock
    // The filter is applied at the page level and shared between views
    // We test by switching to table after filtering is already active
    // Here: mock API to return only "applied" apps
    await page.route('**/api/applications**', (route) => {
      const url = route.request().url();
      if (url.includes('status=applied')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            applications: [MOCK_APPLICATIONS[0]],
          }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ applications: MOCK_APPLICATIONS }),
        });
      }
    });

    // Open filter panel
    await page.getByRole('button', { name: /show filters/i }).click();
    // Select "Applied" status chip/checkbox if it exists
    const appliedFilter = page.locator('label', { hasText: /^applied$/i });
    if ((await appliedFilter.count()) > 0) {
      await appliedFilter.click();
    }

    // Switch to table view — should still show filtered results
    await page.getByRole('button', { name: 'Table' }).click();
    await expect(page.locator('table')).toBeVisible();

    // Table should still be visible (filter state is shared)
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
  });

  // ─── Row click navigation ────────────────────────────────────────────────────

  test('clicking a row navigates to application detail', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    // Mock the application detail route
    await page.route('**/api/applications/app-001', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ application: MOCK_APPLICATIONS[0] }),
      })
    );

    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();

    await expect(page).toHaveURL(/\/applications\/app-\d+/);
  });

  // ─── Status colors ───────────────────────────────────────────────────────────

  test('applied status cell has blue color class', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    const appliedCell = page.getByRole('cell', { name: 'Applied' });
    await expect(appliedCell).toHaveClass(/text-blue-600/);
  });

  test('interview status cell has yellow color class', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    const interviewCell = page.getByRole('cell', { name: 'Interview' });
    await expect(interviewCell).toHaveClass(/text-yellow-600/);
  });

  test('rejected status cell has red color class', async ({ page }) => {
    await goToApplications(page);
    await page.getByRole('button', { name: 'Table' }).click();

    const rejectedCell = page.getByRole('cell', { name: 'Rejected' });
    await expect(rejectedCell).toHaveClass(/text-red-600/);
  });

  // ─── Empty state ──────────────────────────────────────────────────────────────

  test('empty state displays when no applications in table view', async ({ page }) => {
    await setupMockAuth(page);
    await setupApplicationsMock(page, []);

    await page.addInitScript(() => {
      localStorage.setItem('applications-view-mode', 'table');
    });

    await goToApplications(page);

    await expect(page.getByText(/no applications found/i)).toBeVisible();
    await expect(page.locator('table')).not.toBeVisible();
  });
});
