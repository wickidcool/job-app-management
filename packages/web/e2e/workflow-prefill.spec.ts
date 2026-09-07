import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Workflow Pre-fill E2E Tests
 *
 * These tests verify that workflow pages (Job Fit Analysis, Resume Variants,
 * Cover Letters) correctly pre-fill forms when an appId is provided.
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

const MOCK_APP_ID = 'mock-app-id-12345';

const MOCK_APPLICATION = {
  id: MOCK_APP_ID,
  jobTitle: 'Senior Software Engineer',
  company: 'Acme Corp',
  jobDescription:
    'We are looking for a Senior Software Engineer with 5+ years of TypeScript experience. Requirements include React, Node.js, PostgreSQL, and strong system design skills. Position is fully remote.',
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
};

const MOCK_STAR_ENTRY = {
  id: 'star-entry-1',
  rawText:
    'Led migration from monolith to microservices using event-driven architecture, reducing deployment time by 60%',
  company: 'Previous Corp',
  role: 'Senior Engineer',
  impactCategory: 'technical_leadership',
  dateRange: '2024',
  tags: ['typescript', 'microservices'],
};

async function mockApplicationApi(page: Page, appId = MOCK_APP_ID, httpStatus = 200) {
  await page.route(`**/api/applications/${appId}`, (route) =>
    route.fulfill({
      status: httpStatus,
      contentType: 'application/json',
      body:
        httpStatus === 404
          ? JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Application not found' } })
          : JSON.stringify({ application: MOCK_APPLICATION }),
    })
  );
}

/**
 * Settle the four WorkflowChecklist artefact queries as "none exist".
 *
 * ⚠️ Load-bearing since WIC-2227, and the reason it had to be added at all: the
 * `ApplicationDetail - header changes` block below mocked only `/api/auth/me` and
 * `/api/applications/:id`, so the four artefact endpoints hit no backend in CI and their
 * queries **failed**. Before WIC-2227 a failed query reached the checklist as `'absent'` —
 * indistinguishable from "we looked and there is none" — so the "create this artefact"
 * links rendered and those tests passed.
 *
 * **They were green because of the defect.** They asserted that the app offers to write a
 * cover letter in a scenario where it never learned whether one already exists, which is
 * exactly the duplicate-creation harm WIC-1630 and WIC-2227 exist to prevent. With the fix
 * those rows are `'unknown'` and render inert, so the links are correctly absent and the
 * assertions had nothing left to find.
 *
 * Mocking the endpoints empty restores the state in which those links ARE legitimate — the
 * one the tests actually mean to assert — rather than relaxing the assertions to fit.
 *
 * Verified load-bearing: removing the call site below turns both tests red again.
 *
 * Anchored `RegExp`s, not globs: a pattern loose enough to match `/api/cover-letters` can
 * also match the dev server's own module URLs under `/src/services/api/`, which fulfils a
 * module script with JSON and leaves the app unmounted and the body empty (WIC-2207).
 */
async function mockArtefactApis(page: Page) {
  const empty = (body: object) => (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(/\/api\/cover-letters(\?.*)?$/, empty({ coverLetters: [] }));
  await page.route(/\/api\/resume-variants(\?.*)?$/, empty({ variants: [] }));
  await page.route(/\/api\/catalog\/job-fit\/analyses(\?.*)?$/, empty({ analyses: [] }));
  // The service maps this endpoint's 404 to `null`, which IS its settled-absent value.
  await page.route(/\/api\/applications\/[^/]+\/interview-prep(\?.*)?$/, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No interview prep' } }),
    })
  );
}

async function mockStarEntriesApi(page: Page) {
  await page.route('**/api/star-entries', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [MOCK_STAR_ENTRY] }),
    })
  );
}

test.describe('JobFitAnalysis - workflow pre-fill', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
  });

  test('pre-fills job description textarea when appId is provided', async ({ page }) => {
    await mockApplicationApi(page);
    await page.goto(`/job-fit-analysis?appId=${MOCK_APP_ID}`);

    const textarea = page.locator('#jobDescriptionText');
    await expect(textarea).toHaveValue(MOCK_APPLICATION.jobDescription, { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Analyze Fit →' })).toBeEnabled();
  });

  test('renders with empty form when no appId is provided', async ({ page }) => {
    await page.goto('/job-fit-analysis');

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis' })).toBeVisible();
    await expect(page.locator('#jobDescriptionText')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Analyze Fit →' })).toBeDisabled();
  });

  test('renders empty form without crash when appId resolves to 404', async ({ page }) => {
    await mockApplicationApi(page, 'invalid-id', 404);
    await page.goto('/job-fit-analysis?appId=invalid-id');

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('#jobDescriptionText')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Analyze Fit →' })).toBeDisabled();
  });
});

test.describe('ResumeVariantNew - workflow pre-fill', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
  });

  test('pre-fills company, role, and job description when appId is provided', async ({ page }) => {
    await mockApplicationApi(page);
    await page.goto(`/resume-variants/new?appId=${MOCK_APP_ID}`);

    await expect(page.locator('#targetCompany')).toHaveValue(MOCK_APPLICATION.company, {
      timeout: 10000,
    });
    await expect(page.locator('#targetRole')).toHaveValue(MOCK_APPLICATION.jobTitle, {
      timeout: 10000,
    });
    await expect(page.locator('#jobDescriptionText')).toHaveValue(MOCK_APPLICATION.jobDescription, {
      timeout: 10000,
    });
  });

  test('renders with empty form when no appId is provided', async ({ page }) => {
    await page.goto('/resume-variants/new');

    await expect(page.getByRole('heading', { name: 'Generate Resume Variant' })).toBeVisible();
    await expect(page.locator('#targetCompany')).toHaveValue('');
    await expect(page.locator('#targetRole')).toHaveValue('');
    await expect(page.locator('#jobDescriptionText')).toHaveValue('');
  });

  test('renders empty form without crash when appId resolves to 404', async ({ page }) => {
    await mockApplicationApi(page, 'invalid-id', 404);
    await page.goto('/resume-variants/new?appId=invalid-id');

    await expect(page.getByRole('heading', { name: 'Generate Resume Variant' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('#targetCompany')).toHaveValue('');
    await expect(page.locator('#targetRole')).toHaveValue('');
  });
});

test.describe('CoverLetterNew - workflow pre-fill', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await mockStarEntriesApi(page);
  });

  test('pre-fills company, role, and job description when appId is provided', async ({ page }) => {
    await mockApplicationApi(page);
    await page.goto(`/cover-letters/new?appId=${MOCK_APP_ID}`);

    await expect(page.getByPlaceholder('TechCorp Inc.')).toHaveValue(MOCK_APPLICATION.company, {
      timeout: 10000,
    });
    await expect(page.getByPlaceholder('Senior Full Stack Engineer')).toHaveValue(
      MOCK_APPLICATION.jobTitle,
      { timeout: 10000 }
    );
    await expect(page.getByPlaceholder('Paste the full job description here...')).toHaveValue(
      MOCK_APPLICATION.jobDescription,
      { timeout: 10000 }
    );
  });

  test('renders with empty form when no appId is provided', async ({ page }) => {
    await page.goto('/cover-letters/new');

    await expect(page.getByPlaceholder('TechCorp Inc.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('TechCorp Inc.')).toHaveValue('');
    await expect(page.getByPlaceholder('Senior Full Stack Engineer')).toHaveValue('');
  });

  test('renders empty form without crash when appId resolves to 404', async ({ page }) => {
    await mockApplicationApi(page, 'invalid-id', 404);
    await page.goto('/cover-letters/new?appId=invalid-id');

    await expect(page.getByPlaceholder('TechCorp Inc.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('TechCorp Inc.')).toHaveValue('');
  });

  test('shows empty catalog state when no STAR entries exist', async ({ page }) => {
    await page.route('**/api/star-entries', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: [] }),
      })
    );

    await page.goto('/cover-letters/new');

    await expect(page.getByText('No STAR entries found')).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText('Upload a resume to extract your achievements first.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload Resume' })).toBeVisible();
  });
});

test.describe('ApplicationDetail - header changes', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await mockApplicationApi(page);
    // Without this the four artefact queries fail and every checklist row is `'unknown'`,
    // so the step links these tests assert on are correctly absent. See `mockArtefactApis`.
    await mockArtefactApis(page);
  });

  test('header has Edit and Delete buttons but no "Generate Cover Letter" button', async ({
    page,
  }) => {
    await page.goto(`/applications/${MOCK_APP_ID}`);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });

    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(page.getByRole('button', { name: /generate cover letter/i })).not.toBeVisible();
  });

  test('WorkflowChecklist shows Cover Letter as a workflow step link', async ({ page }) => {
    await page.goto(`/applications/${MOCK_APP_ID}`);

    await expect(page.getByRole('heading', { name: 'Application Workflow' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('link', { name: 'Cover Letter' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cover Letter' })).toHaveAttribute(
      'href',
      `/cover-letters/new?appId=${MOCK_APP_ID}`
    );
  });

  test('WorkflowChecklist links to workflow pages with correct appId', async ({ page }) => {
    await page.goto(`/applications/${MOCK_APP_ID}`);

    await expect(page.getByRole('heading', { name: 'Application Workflow' })).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByRole('link', { name: 'Job Fit Analysis' })).toHaveAttribute(
      'href',
      `/job-fit-analysis?appId=${MOCK_APP_ID}`
    );
    await expect(page.getByRole('link', { name: 'Tailored Resume' })).toHaveAttribute(
      'href',
      `/resume-variants/new?appId=${MOCK_APP_ID}`
    );
  });
});
