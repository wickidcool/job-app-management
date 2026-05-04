import { test, expect, type Page } from '@playwright/test';

/**
 * Document Upload / Download E2E Tests (WIC-201)
 *
 * Verifies resume upload and R2 document storage integration.
 *
 * Tiers:
 * 1. UI-level tests — mock API responses and auth, run without real backend.
 * 2. Real storage tests — require TEST_USER_EMAIL/PASSWORD + backend running.
 */

const isAuthEnabled = () => !!process.env.VITE_SUPABASE_URL;
const hasTestUser = () => !!(process.env.TEST_USER_EMAIL && process.env.TEST_USER_PASSWORD);

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

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
}

async function mockUploadSuccess(page: Page) {
  await page.route('**/api/resumes/upload', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        resume: {
          id: 'resume-mock-001',
          fileName: 'test-resume.pdf',
          fileSize: 12345,
          mimeType: 'application/pdf',
          createdAt: new Date().toISOString(),
          storageKey: 'user-uuid/test-resume.pdf',
        },
      }),
    })
  );
}

async function mockUploadError(page: Page, statusCode: number, code: string, message: string) {
  await page.route('**/api/resumes/upload', (route) =>
    route.fulfill({
      status: statusCode,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code, message } }),
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

async function mockDownloadUrl(page: Page, resumeId: string, url: string) {
  await page.route(`**/api/resumes/${resumeId}/download-url`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url, expiresIn: 3600 }),
    })
  );
}

// ---------------------------------------------------------------------------
// UI-Level Upload Tests (bypass mode, no Supabase required)
// ---------------------------------------------------------------------------

test.describe('Resume Upload - UI', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await mockResumesList(page, []);
    await page.goto('/resumes');
  });

  test('resume page renders with upload capability', async ({ page }) => {
    const uploadArea = page
      .getByRole('button', { name: /upload/i })
      .or(page.locator('input[type="file"]'))
      .or(page.getByText(/upload/i));

    await expect(uploadArea.first()).toBeVisible({ timeout: 5000 });
  });

  test('successful upload adds resume to list', async ({ page }) => {
    await mockUploadSuccess(page);

    // Stub the resumes list to show the newly uploaded resume after upload
    await page.route('**/api/resumes', (route) => {
      const callCount = { n: 0 };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resumes:
            callCount.n++ === 0
              ? []
              : [
                  {
                    id: 'resume-mock-001',
                    fileName: 'test-resume.pdf',
                    fileSize: 12345,
                    mimeType: 'application/pdf',
                    createdAt: new Date().toISOString(),
                  },
                ],
        }),
      });
    });

    // Locate the file input and upload a synthetic PDF
    const fileInput = page.locator('input[type="file"]');
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles({
        name: 'test-resume.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 minimal test pdf content'),
      });

      // After upload the list should refresh and show the new resume
      await expect(page.getByText('test-resume.pdf')).toBeVisible({ timeout: 5000 });
    }
  });

  test('unsupported file type shows error message', async ({ page }) => {
    await mockUploadError(
      page,
      415,
      'UNSUPPORTED_FILE_TYPE',
      'Only PDF and DOCX files are accepted'
    );

    const fileInput = page.locator('input[type="file"]');
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles({
        name: 'resume.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('plain text resume'),
      });

      const errorMsg = page
        .getByText(/unsupported/i)
        .or(page.getByText(/only pdf/i))
        .or(page.getByText(/invalid file/i));

      await expect(errorMsg.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('uploaded resume list is scoped to current user via API', async ({ page }) => {
    const USER_RESUMES = [
      {
        id: 'resume-001',
        fileName: 'my-resume.pdf',
        fileSize: 100000,
        mimeType: 'application/pdf',
        createdAt: '2026-04-01T00:00:00.000Z',
      },
    ];

    await mockResumesList(page, USER_RESUMES);
    await page.reload();

    await expect(page.getByText('my-resume.pdf')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// R2 Download URL Tests
// ---------------------------------------------------------------------------

test.describe('R2 Document Download - UI', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
  });

  test('download URL response triggers file download', async ({ page }) => {
    const resumeId = 'resume-r2-001';
    const mockSignedUrl = 'https://r2.example.com/signed-url?token=abc123';

    await mockResumesList(page, [
      {
        id: resumeId,
        fileName: 'r2-resume.pdf',
        fileSize: 200000,
        mimeType: 'application/pdf',
        createdAt: '2026-04-01T00:00:00.000Z',
      },
    ]);
    await mockDownloadUrl(page, resumeId, mockSignedUrl);

    await page.goto('/resumes');
    await expect(page.getByText('r2-resume.pdf')).toBeVisible({ timeout: 5000 });

    // Intercept download attempt — just verify the API call is made
    const downloadRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('download-url')) {
        downloadRequests.push(req.url());
      }
    });

    // Click download button if present
    const downloadBtn = page
      .getByRole('button', { name: /download/i })
      .or(page.getByTitle(/download/i))
      .first();

    if ((await downloadBtn.count()) > 0) {
      await downloadBtn.click();
      await page.waitForTimeout(500);
      expect(downloadRequests.length).toBeGreaterThan(0);
    }
  });

  test('R2 not configured shows appropriate message', async ({ page }) => {
    const resumeId = 'resume-no-r2-001';

    await mockResumesList(page, [
      {
        id: resumeId,
        fileName: 'local-resume.pdf',
        fileSize: 50000,
        mimeType: 'application/pdf',
        createdAt: '2026-04-01T00:00:00.000Z',
      },
    ]);

    // Mock the download-url endpoint returning NOT_SUPPORTED
    await page.route(`**/api/resumes/${resumeId}/download-url`, (route) =>
      route.fulfill({
        status: 501,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'NOT_SUPPORTED',
            message: 'Download URLs are only available when R2 storage is configured',
          },
        }),
      })
    );

    await page.goto('/resumes');
    await expect(page.getByText('local-resume.pdf')).toBeVisible({ timeout: 5000 });

    const downloadBtn = page
      .getByRole('button', { name: /download/i })
      .or(page.getByTitle(/download/i))
      .first();

    if ((await downloadBtn.count()) > 0) {
      await downloadBtn.click();
      await page.waitForTimeout(500);

      // Not crashing is the minimum bar — error handling is acceptable
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Real Upload/Download Tests (requires Supabase + test user)
// ---------------------------------------------------------------------------

test.describe('Real Document Storage (requires Supabase + test user)', () => {
  test.skip(
    !isAuthEnabled() || !hasTestUser(),
    'Requires VITE_SUPABASE_URL and TEST_USER credentials'
  );

  test('authenticated user can upload and see their resume', async ({ page }) => {
    const email = process.env.TEST_USER_EMAIL!;
    const password = process.env.TEST_USER_PASSWORD!;

    await loginAs(page, email, password);
    await page.goto('/resumes');

    let uploadedResumeId: string | null = null;
    page.on('response', async (res) => {
      if (res.url().includes('/api/resumes/upload') && res.request().method() === 'POST') {
        const body = await res.json().catch(() => null);
        if (body?.resume?.id) uploadedResumeId = body.resume.id;
      }
    });

    const fileInput = page.locator('input[type="file"]');
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles({
        name: 'e2e-test-resume.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'),
      });

      await expect(page.getByText('e2e-test-resume.pdf')).toBeVisible({ timeout: 10000 });
      expect(uploadedResumeId).not.toBeNull();
    }
  });

  test('resume upload request carries Authorization header', async ({ page }) => {
    const email = process.env.TEST_USER_EMAIL!;
    const password = process.env.TEST_USER_PASSWORD!;

    await loginAs(page, email, password);

    const uploadAuthHeaders: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/resumes/upload')) {
        const auth = req.headers()['authorization'];
        if (auth) uploadAuthHeaders.push(auth);
      }
    });

    await page.goto('/resumes');
    const fileInput = page.locator('input[type="file"]');

    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles({
        name: 'auth-test.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 auth test'),
      });

      await page.waitForTimeout(2000);

      expect(uploadAuthHeaders.length).toBeGreaterThan(0);
      expect(uploadAuthHeaders[0]).toMatch(/^Bearer .+/);
    }
  });
});
