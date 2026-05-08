import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the personal information feature (WIC-247)
 *
 * API contract (WIC-251):
 *   GET /api/personal-info  → { personalInfo: PersonalInfo | null }
 *   PUT /api/personal-info  → { personalInfo: PersonalInfo }
 *   Validation errors       → 400 { error: { code: "VALIDATION_ERROR", ... } }
 *
 * Fields: fullName, email, linkedinUrl, githubUrl, homeAddress,
 *         phoneNumber, projectsWebsite, publishingPlatforms (string[])
 *
 * Covers:
 *  - Personal info step in the onboarding flow
 *  - Personal info form in Settings → Profile
 *  - All fields rendered and editable
 *  - Field validation: invalid URLs, invalid email
 *  - Save / update (PUT) functionality
 *  - Pre-populated data (returning user)
 *  - Auth guard on the settings route
 *
 * All tests use mock auth and route-intercepted API calls — no backend required.
 * Locators use id-OR-name fallbacks so they stay robust across React Hook Form
 * binding choices. Adjust once the concrete component (WIC-252) is merged.
 */

// ─── Shared mock data ─────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 'test-user-001',
  email: 'test@example.com',
};

/** GET returns null when no record exists yet. */
const MOCK_PERSONAL_INFO_NULL = { personalInfo: null };

/** Populated record returned after at least one save. */
const MOCK_PERSONAL_INFO_POPULATED = {
  personalInfo: {
    id: 'pi-001',
    userId: MOCK_USER.id,
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    linkedinUrl: 'https://linkedin.com/in/janedoe',
    githubUrl: 'https://github.com/janedoe',
    homeAddress: '123 Main St, San Francisco, CA 94102',
    phoneNumber: '+1 (555) 123-4567',
    projectsWebsite: 'https://janedoe.dev',
    publishingPlatforms: ['https://janedoe.substack.com'],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    version: 1,
  },
};

const ONBOARDING_AT_PERSONAL_INFO = {
  id: 'onboarding-001',
  userId: MOCK_USER.id,
  currentStep: 'personal_info',
  resumeStepCompleted: false,
  resumeStepSkipped: false,
  personalInfoStepCompleted: false,
  personalInfoStepSkipped: false,
  applicationStepCompleted: false,
  applicationStepSkipped: false,
  startedAt: '2026-05-01T00:00:00.000Z',
  completedAt: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  version: 1,
};

const ONBOARDING_COMPLETED = {
  ...ONBOARDING_AT_PERSONAL_INFO,
  currentStep: 'completed',
  completedAt: '2026-05-01T12:00:00.000Z',
  personalInfoStepCompleted: true,
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

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

async function setupOnboardingMocks(page: Page, onboardingStatus: object) {
  await page.route('**/api/users/me/onboarding/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(onboardingStatus),
    })
  );
  await page.route('**/api/users/me/onboarding/progress', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...onboardingStatus, version: 2 }),
    })
  );
  await page.route('**/api/users/me/onboarding/complete', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ONBOARDING_COMPLETED),
    })
  );
}

type PersonalInfoFixture =
  | typeof MOCK_PERSONAL_INFO_NULL
  | typeof MOCK_PERSONAL_INFO_POPULATED;

async function setupPersonalInfoMocks(
  page: Page,
  getFixture: PersonalInfoFixture,
  { saveSuccess = true }: { saveSuccess?: boolean } = {}
) {
  await page.route('**/api/personal-info', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(getFixture),
      });
    }

    if (method === 'PUT') {
      if (!saveSuccess) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to save personal information' },
          }),
        });
      }
      const body = (route.request().postDataJSON() as Record<string, unknown>) ?? {};
      const base =
        getFixture.personalInfo ??
        ({
          id: 'pi-new',
          userId: MOCK_USER.id,
          fullName: null,
          email: null,
          linkedinUrl: null,
          githubUrl: null,
          homeAddress: null,
          phoneNumber: null,
          projectsWebsite: null,
          publishingPlatforms: [],
          createdAt: new Date().toISOString(),
          version: 1,
        } as NonNullable<typeof MOCK_PERSONAL_INFO_POPULATED.personalInfo>);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          personalInfo: {
            ...base,
            ...body,
            updatedAt: new Date().toISOString(),
            version: base.version + 1,
          },
        }),
      });
    }

    return route.fallback();
  });
}

async function setupDashboardMocks(page: Page) {
  await page.route('**/api/dashboard*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    })
  );
  await page.route('**/api/applications*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ applications: [], nextPage: null }),
    })
  );
}

/** Returns a locator that matches a field by id OR name attribute. */
function field(page: Page, fieldName: string) {
  return page.locator(
    `input[id="${fieldName}"], input[name="${fieldName}"], textarea[id="${fieldName}"], textarea[name="${fieldName}"]`
  );
}

/** Clicks the profile trigger if it's behind a card/link in Settings. */
async function openProfileFormIfNeeded(page: Page) {
  const trigger = page.locator(
    'a:has-text("Profile"), button:has-text("Profile"), [data-testid="profile-card"]'
  );
  if (await trigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await trigger.click();
  }
}

// ─── Onboarding flow ──────────────────────────────────────────────────────────

test.describe('Personal Information — Onboarding flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await setupOnboardingMocks(page, ONBOARDING_AT_PERSONAL_INFO);
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_NULL);
    await setupDashboardMocks(page);
  });

  test('onboarding modal shows a personal information step', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();
  });

  test('all personal info fields are rendered', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();

    for (const name of [
      'fullName',
      'email',
      'phoneNumber',
      'linkedinUrl',
      'githubUrl',
      'homeAddress',
      'projectsWebsite',
    ]) {
      await expect(field(page, name)).toBeVisible();
    }

    // publishingPlatforms renders as at least one URL input or textarea
    const platformInput = page.locator(
      'input[id="publishingPlatforms"], input[name="publishingPlatforms"],' +
        ' input[id^="publishingPlatforms"], input[name^="publishingPlatforms"],' +
        ' textarea[id="publishingPlatforms"], textarea[name="publishingPlatforms"]'
    );
    await expect(platformInput.first()).toBeVisible();
  });

  test('all text fields start empty for a new user', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();

    await expect(field(page, 'fullName')).toHaveValue('');
    await expect(field(page, 'linkedinUrl')).toHaveValue('');
    await expect(field(page, 'githubUrl')).toHaveValue('');
  });

  test('filling fields and clicking next advances the onboarding step', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();

    await field(page, 'fullName').fill('Jane Doe');
    await field(page, 'email').fill('jane@example.com');
    await field(page, 'phoneNumber').fill('+1 (555) 123-4567');
    await field(page, 'linkedinUrl').fill('https://linkedin.com/in/janedoe');
    await field(page, 'githubUrl').fill('https://github.com/janedoe');
    await field(page, 'homeAddress').fill('123 Main St, San Francisco, CA 94102');
    await field(page, 'projectsWebsite').fill('https://janedoe.dev');

    await page.getByRole('button', { name: /next|continue|save/i }).click();

    await expect(
      page.getByRole('heading', { name: /personal information/i })
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test('skip button advances past the personal information step', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();

    await page.getByRole('button', { name: /skip/i }).click();

    await expect(
      page.getByRole('heading', { name: /personal information/i })
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test('back button returns to the previous onboarding step', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();

    const backButton = page.getByRole('button', { name: /back/i });
    if (await backButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await backButton.click();
      await expect(
        page.getByRole('heading', { name: /personal information/i })
      ).not.toBeVisible({ timeout: 3_000 });
    } else {
      test.skip();
    }
  });

  test('URL fields show a validation error for non-URL input', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();

    await field(page, 'linkedinUrl').fill('not-a-valid-url');
    await field(page, 'githubUrl').fill('not-a-valid-url');
    await page.getByRole('button', { name: /next|continue|save/i }).click();

    const linkedinErr = page.locator(
      '#linkedinUrl-error, [data-testid="linkedinUrl-error"], [aria-describedby*="linkedinUrl"]'
    );
    const githubErr = page.locator(
      '#githubUrl-error, [data-testid="githubUrl-error"], [aria-describedby*="githubUrl"]'
    );

    const eitherVisible =
      (await linkedinErr.isVisible({ timeout: 3_000 }).catch(() => false)) ||
      (await githubErr.isVisible({ timeout: 3_000 }).catch(() => false));
    expect(eitherVisible).toBe(true);
  });

  test('publishingPlatforms field rejects a non-URL entry', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();

    // Fill the first platform input with an invalid value
    const platformInput = page.locator(
      'input[id="publishingPlatforms"], input[name="publishingPlatforms"],' +
        ' input[id^="publishingPlatforms"], input[name^="publishingPlatforms"],' +
        ' textarea[id="publishingPlatforms"], textarea[name="publishingPlatforms"]'
    );
    await platformInput.first().fill('not-a-url');
    await page.getByRole('button', { name: /next|continue|save/i }).click();

    const platformErr = page.locator(
      '[id*="publishingPlatforms"][id*="error"], [data-testid*="publishingPlatforms"], [aria-describedby*="publishingPlatforms"]'
    );
    await expect(platformErr.first()).toBeVisible({ timeout: 3_000 });
  });

  test('email field rejects an obviously invalid address', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();

    await field(page, 'email').fill('not-an-email');
    await page.getByRole('button', { name: /next|continue|save/i }).click();

    // Accept browser-native validation or a rendered error element.
    const nativeInvalid = await page.evaluate(() => {
      const el = document.querySelector(
        'input[id="email"], input[name="email"]'
      ) as HTMLInputElement | null;
      return el ? !el.validity.valid : false;
    });

    if (!nativeInvalid) {
      const emailErr = page.locator(
        '#email-error, [data-testid="email-error"], [aria-describedby*="email"]'
      );
      await expect(emailErr).toBeVisible({ timeout: 3_000 });
    }
  });
});

// ─── Onboarding — pre-populated data ─────────────────────────────────────────

test.describe('Personal Information — Onboarding with existing data', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await setupOnboardingMocks(page, ONBOARDING_AT_PERSONAL_INFO);
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_POPULATED);
    await setupDashboardMocks(page);
  });

  test('form is pre-filled with existing personal information', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();

    await expect(field(page, 'fullName')).toHaveValue('Jane Doe', { timeout: 5_000 });
    await expect(field(page, 'email')).toHaveValue('jane@example.com');
    await expect(field(page, 'linkedinUrl')).toHaveValue('https://linkedin.com/in/janedoe');
    await expect(field(page, 'githubUrl')).toHaveValue('https://github.com/janedoe');
    await expect(field(page, 'projectsWebsite')).toHaveValue('https://janedoe.dev');
    await expect(field(page, 'phoneNumber')).toHaveValue('+1 (555) 123-4567');
  });

  test('updated data is PUT to /api/personal-info when the step is saved', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();

    const fullNameInput = field(page, 'fullName');
    await fullNameInput.clear();
    await fullNameInput.fill('Jane Smith');

    let capturedBody: Record<string, unknown> | null = null;
    page.on('request', (req) => {
      if (req.url().includes('/api/personal-info') && req.method() === 'PUT') {
        capturedBody = req.postDataJSON() as Record<string, unknown>;
      }
    });

    await page.getByRole('button', { name: /next|continue|save/i }).click();
    await expect(
      page.getByRole('heading', { name: /personal information/i })
    ).not.toBeVisible({ timeout: 5_000 });

    expect(capturedBody).not.toBeNull();
    expect((capturedBody as Record<string, unknown>).fullName).toBe('Jane Smith');
  });
});

// ─── Settings page ────────────────────────────────────────────────────────────

test.describe('Personal Information — Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await setupOnboardingMocks(page, ONBOARDING_COMPLETED);
    await setupDashboardMocks(page);
  });

  test('settings page has a Profile section', async ({ page }) => {
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_NULL);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
  });

  test('Profile section exposes the personal info form', async ({ page }) => {
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_NULL);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await openProfileFormIfNeeded(page);

    await expect(field(page, 'fullName')).toBeVisible({ timeout: 5_000 });
  });

  test('settings form pre-fills existing personal information', async ({ page }) => {
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_POPULATED);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await openProfileFormIfNeeded(page);

    await expect(field(page, 'fullName')).toHaveValue('Jane Doe', { timeout: 5_000 });
    await expect(field(page, 'email')).toHaveValue('jane@example.com');
    await expect(field(page, 'linkedinUrl')).toHaveValue('https://linkedin.com/in/janedoe');
    await expect(field(page, 'githubUrl')).toHaveValue('https://github.com/janedoe');
    await expect(field(page, 'phoneNumber')).toHaveValue('+1 (555) 123-4567');
  });

  test('saving updated personal information shows success feedback', async ({ page }) => {
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_POPULATED);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await openProfileFormIfNeeded(page);

    const phoneInput = field(page, 'phoneNumber');
    await expect(phoneInput).toBeVisible({ timeout: 5_000 });
    await phoneInput.clear();
    await phoneInput.fill('+1 (555) 999-0000');

    await page.getByRole('button', { name: /save|update/i }).click();

    await expect(page.getByText(/saved|updated|success/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('URL fields show validation error in settings', async ({ page }) => {
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_NULL);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await openProfileFormIfNeeded(page);

    await expect(field(page, 'linkedinUrl')).toBeVisible({ timeout: 5_000 });
    await field(page, 'linkedinUrl').fill('not-a-url');
    await page.getByRole('button', { name: /save|update/i }).click();

    const linkedinErr = page.locator(
      '#linkedinUrl-error, [data-testid="linkedinUrl-error"], [aria-describedby*="linkedinUrl"]'
    );
    await expect(linkedinErr).toBeVisible({ timeout: 3_000 });
    await expect(linkedinErr).toContainText(/url|valid/i);
  });

  test('settings form shows error feedback when the API save fails', async ({ page }) => {
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_NULL, { saveSuccess: false });
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await openProfileFormIfNeeded(page);

    await expect(field(page, 'fullName')).toBeVisible({ timeout: 5_000 });
    await field(page, 'fullName').fill('Test User');
    await page.getByRole('button', { name: /save|update/i }).click();

    await expect(page.getByText(/error|failed|could not/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('settings form is empty when the user has no saved personal info', async ({ page }) => {
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_NULL);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await openProfileFormIfNeeded(page);

    await expect(field(page, 'fullName')).toHaveValue('', { timeout: 5_000 });
    await expect(field(page, 'linkedinUrl')).toHaveValue('');
    await expect(field(page, 'githubUrl')).toHaveValue('');
  });
});

// ─── Auth protection ──────────────────────────────────────────────────────────

test.describe('Personal Information — Auth protection', () => {
  test('unauthenticated user is redirected to /login when accessing settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL('/login', { timeout: 5_000 });
  });
});
