import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the personal information feature (WIC-247)
 *
 * API contract (WIC-251):
 *   GET /api/personal-info   → { personalInfo: PersonalInfo, isComplete: boolean, completionPercentage: number }
 *   PATCH /api/personal-info → { personalInfo: PersonalInfo, isComplete: boolean, completionPercentage: number }
 *   Validation errors        → 400 { error: { code: "INVALID_EMAIL" | "INVALID_URL", ... } }
 *
 * Fields: firstName, lastName, email, phone, addressLine1, addressLine2, city, state,
 *         postalCode, country, linkedinUrl, githubUrl, portfolioUrl, websiteUrl,
 *         professionalSummary, headline
 *
 * Covers:
 *  - Personal info step in the onboarding flow
 *  - Personal info form in Settings
 *  - All fields rendered and editable
 *  - Field validation: invalid URLs, invalid email
 *  - Save / update (PATCH) functionality
 *  - Pre-populated data (returning user)
 *  - Auth guard on the settings route
 *
 * All tests use mock auth and route-intercepted API calls — no backend required.
 * Locators use id-OR-name fallbacks so they stay robust across React Hook Form
 * binding choices.
 *
 * Navigation pattern: page.goto() is called inside beforeEach (not individual tests),
 * matching the working job-fit-analysis.spec.ts pattern. The beforeEach also waits
 * for the expected initial page state so tests start with the UI ready.
 */

// ─── Shared mock data ─────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 'test-user-001',
  email: 'test@example.com',
};

/** GET returns default empty record when no data exists yet. */
const MOCK_PERSONAL_INFO_NULL = {
  personalInfo: {
    id: 'pi-default',
    firstName: '',
    lastName: '',
    email: '',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    version: 1,
  },
  isComplete: false,
  completionPercentage: 0,
};

/** Populated record returned after at least one save. */
const MOCK_PERSONAL_INFO_POPULATED = {
  personalInfo: {
    id: 'pi-001',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: '+1 (555) 123-4567',
    addressLine1: '123 Main St',
    addressLine2: 'Apt 4B',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94102',
    country: 'USA',
    linkedinUrl: 'https://linkedin.com/in/janedoe',
    githubUrl: 'https://github.com/janedoe',
    portfolioUrl: 'https://janedoe.dev',
    websiteUrl: 'https://janedoe.com',
    professionalSummary: 'Experienced software engineer with 8+ years...',
    headline: 'Senior Software Engineer',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    version: 1,
  },
  isComplete: true,
  completionPercentage: 90,
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

type OnboardingFixture = typeof ONBOARDING_AT_PERSONAL_INFO;

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Match a request by its **pathname**, never by a URL glob (WIC-2124).
 *
 * ⛔ Do not go back to `page.route('**\/api/dashboard*', …)`. Playwright's `*` does
 * not cross `/`, but it happily matches the rest of a filename — so that glob also
 * intercepts the Vite dev server's request for `/src/services/api/dashboardService.ts`
 * and answers the module with `application/json`. `services/api/index.ts` then fails
 * to import, the barrel throws, and **the whole SPA renders a blank page** with no
 * error surfaced to the test. That is the entire "e2e test infrastructure issue
 * causing component render failures" this file sat skipped behind for four months:
 * every block here calls `setupDashboardMocks`, so all 17 specs failed from one glob.
 *
 * The same trap is wider in `setupFallbackApiMocks` below — `**\/api/**` intercepts
 * six source modules. A pathname predicate cannot reach `/src/...` at all.
 */
const apiPath =
  (path: string) =>
  (url: URL): boolean =>
    url.pathname === `/api${path}`;

/** Matches any `/api/*` request — the safe form of the `**\/api/**` glob. */
const anyApiPath = (url: URL): boolean => url.pathname.startsWith('/api/');

async function setupMockAuth(page: Page) {
  await page.route(apiPath('/auth/me'), (route) =>
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

async function setupOnboardingMocks(page: Page, onboardingStatus: OnboardingFixture) {
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  await page.route(apiPath('/users/me/onboarding/status'), (route) =>
    route.fulfill(json(onboardingStatus))
  );
  await page.route(apiPath('/users/me/onboarding/progress'), (route) =>
    route.fulfill(json({ ...onboardingStatus, version: 2 }))
  );
  await page.route(apiPath('/users/me/onboarding/complete'), (route) =>
    route.fulfill(json(ONBOARDING_COMPLETED))
  );

  // `should-show` is not optional (WIC-1359). `OnboardingContext.loadOnboarding`
  // awaits `Promise.all([getStatus(), shouldShow()])`, so leaving this unmocked
  // rejects the pair, the catch sets `showOnboarding` to false, and the modal
  // these tests assert on never mounts — a second, independent cause of the same
  // blank-screen symptom. Derived from the fixture so it stays consistent with
  // the status row rather than being pinned twice.
  await page.route(apiPath('/users/me/onboarding/should-show'), (route) =>
    route.fulfill(json({ shouldShow: onboardingStatus.currentStep !== 'completed' }))
  );
}

type PersonalInfoFixture = typeof MOCK_PERSONAL_INFO_NULL | typeof MOCK_PERSONAL_INFO_POPULATED;

async function setupPersonalInfoMocks(
  page: Page,
  getFixture: PersonalInfoFixture,
  { saveSuccess = true }: { saveSuccess?: boolean } = {}
) {
  await page.route(apiPath('/personal-info'), async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(getFixture),
      });
    }

    if (method === 'PATCH') {
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
      const base = getFixture.personalInfo;
      const updated = {
        ...base,
        ...body,
        updatedAt: new Date().toISOString(),
        version: base.version + 1,
      };

      // Calculate completion
      const requiredFilled = [updated.firstName, updated.lastName, updated.email].filter(
        Boolean
      ).length;
      const isComplete = requiredFilled === 3;
      const completionPercentage = Math.round((requiredFilled / 3) * 100);

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          personalInfo: updated,
          isComplete,
          completionPercentage,
        }),
      });
    }

    return route.fallback();
  });
}

async function setupDashboardMocks(page: Page) {
  await page.route(apiPath('/dashboard'), (route) =>
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
  await page.route(apiPath('/applications'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ applications: [], nextPage: null }),
    })
  );
  await page.route(apiPath('/resumes'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ resumes: [] }),
    })
  );
}

/** Returns a locator that matches a field by id OR name attribute. */
function field(page: Page, fieldName: string) {
  return page.locator(
    `input[id="${fieldName}"], input[name="${fieldName}"], textarea[id="${fieldName}"], textarea[name="${fieldName}"]`
  );
}

/** Catches unmocked API requests and returns empty responses */
async function setupFallbackApiMocks(page: Page) {
  await page.route(anyApiPath, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  );
}

/**
 * Records every `PATCH /api/personal-info` the page issues from this point on.
 *
 * Call it *before* the interaction; the returned array is appended to as requests
 * fire. Pair with `expectNoSave` — asserting "the save did not happen" is the
 * durable half of a validation test, because it holds whichever layer does the
 * rejecting.
 */
function capturePersonalInfoPatches(page: Page): Array<Record<string, unknown>> {
  const patches: Array<Record<string, unknown>> = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === '/api/personal-info' && req.method() === 'PATCH') {
      patches.push((req.postDataJSON() as Record<string, unknown>) ?? {});
    }
  });
  return patches;
}

/**
 * Asserts the field is reported invalid to the user.
 *
 * ⚠️ These tests used to assert the *Zod* message (`Must be a valid URL`,
 * `Must be a valid email address`). Those strings are **unreachable** for these
 * particular fields, and no amount of waiting produces them: `PersonalInfoForm`
 * renders the URL/email inputs as `type="url"` / `type="email"` on a form with no
 * `noValidate`, so the browser's own constraint validation fails the field and
 * **the submit event never fires**. React Hook Form is therefore never invoked and
 * its `<p>` never mounts. Verified directly — with `not-a-url` in a `type="url"`
 * input, the form's `submit` handler runs 0 times.
 *
 * So we assert the layer that actually rejects. `validity.valid === false` is true
 * under the current native-validation behaviour and stays true if the form later
 * adopts `noValidate` plus `aria-invalid`, because RHF sets neither — hence the
 * `aria-invalid` arm as well. Whether the Zod messages *should* be the ones users
 * see is a product question, filed separately rather than decided here (WIC-2124).
 */
async function expectFieldRejected(page: Page, fieldName: string) {
  const locator = field(page, fieldName);
  await expect(locator).toBeVisible();
  await expect
    .poll(
      () =>
        locator.evaluate(
          (el) =>
            !(el as HTMLInputElement).validity.valid ||
            el.getAttribute('aria-invalid') === 'true' ||
            // the Zod `<p>`, if the form ever stops relying on native validation
            el.parentElement?.querySelector('p.text-error-600') !== null
        ),
      { timeout: 3_000, message: `expected ${fieldName} to be reported invalid` }
    )
    .toBe(true);
}

/** Asserts the rejected submit produced no write. */
async function expectNoSave(page: Page, patches: Array<Record<string, unknown>>) {
  // Give a would-be PATCH time to leave the page, so this cannot pass vacuously
  // by racing ahead of the request it is meant to rule out.
  await page.waitForTimeout(500);
  expect(patches).toEqual([]);
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
    await page.goto('/', { waitUntil: 'networkidle' });
  });

  test('onboarding modal shows a personal information step', async ({ page }) => {
    // Step 2 title is "Tell Us About Yourself" (OnboardingModal STEP_LABELS: 'Personal Info')
    await expect(page.getByRole('heading', { name: /tell us about yourself/i })).toBeVisible();
  });

  test('all personal info fields are rendered', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).toBeVisible();

    for (const name of [
      'firstName',
      'lastName',
      'email',
      'phone',
      'linkedinUrl',
      'githubUrl',
      'headline',
    ]) {
      await expect(field(page, name)).toBeVisible();
    }
  });

  test('all text fields start empty for a new user', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).toBeVisible();

    // Wait for form to render before checking values
    await expect(field(page, 'firstName')).toBeVisible({ timeout: 5_000 });
    await expect(field(page, 'firstName')).toHaveValue('');
    await expect(field(page, 'lastName')).toHaveValue('');
    await expect(field(page, 'email')).toHaveValue('');
    await expect(field(page, 'linkedinUrl')).toHaveValue('');
    await expect(field(page, 'githubUrl')).toHaveValue('');
  });

  test('filling fields and clicking next advances the onboarding step', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).toBeVisible();

    // Wait for form to render
    await expect(field(page, 'firstName')).toBeVisible({ timeout: 5_000 });
    await field(page, 'firstName').fill('Jane');
    await field(page, 'lastName').fill('Doe');
    await field(page, 'email').fill('jane@example.com');
    await field(page, 'phone').fill('+1 (555) 123-4567');
    await field(page, 'linkedinUrl').fill('https://linkedin.com/in/janedoe');
    await field(page, 'githubUrl').fill('https://github.com/janedoe');
    await field(page, 'headline').fill('Senior Software Engineer');

    await page.getByRole('button', { name: /next|continue|save/i }).click();

    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test('skip button advances past the personal information step', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).toBeVisible();

    await page.getByRole('button', { name: /skip/i }).click();

    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test('back button returns to the previous onboarding step', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).toBeVisible();

    const backButton = page.getByRole('button', { name: /back/i });
    if (await backButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await backButton.click();
      await expect(
        page.getByRole('heading', { name: /personal information|tell us about yourself/i })
      ).not.toBeVisible({ timeout: 3_000 });
    } else {
      test.skip();
    }
  });

  test('a non-URL in a URL field is rejected and no save is issued', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).toBeVisible();

    const patches = capturePersonalInfoPatches(page);

    // Wait for form to render, then fill required fields
    await expect(field(page, 'firstName')).toBeVisible({ timeout: 5_000 });
    await field(page, 'firstName').fill('Test');
    await field(page, 'lastName').fill('User');
    await field(page, 'email').fill('test@example.com');

    await field(page, 'linkedinUrl').fill('not-a-valid-url');
    await field(page, 'githubUrl').fill('not-a-valid-url');
    await page.getByRole('button', { name: /next|continue|save/i }).click();

    await expectFieldRejected(page, 'linkedinUrl');
    await expectFieldRejected(page, 'githubUrl');
    await expectNoSave(page, patches);
  });

  test('an invalid email address is rejected and no save is issued', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).toBeVisible();

    const patches = capturePersonalInfoPatches(page);

    // Wait for form to render
    await expect(field(page, 'firstName')).toBeVisible({ timeout: 5_000 });
    await field(page, 'firstName').fill('Test');
    await field(page, 'lastName').fill('User');
    await field(page, 'email').fill('not-an-email');
    await page.getByRole('button', { name: /next|continue|save/i }).click();

    await expectFieldRejected(page, 'email');
    await expectNoSave(page, patches);
  });
});

// ─── Onboarding — pre-populated data ─────────────────────────────────────────

test.describe('Personal Information — Onboarding with existing data', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await setupOnboardingMocks(page, ONBOARDING_AT_PERSONAL_INFO);
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_POPULATED);
    await setupDashboardMocks(page);
    await page.goto('/', { waitUntil: 'networkidle' });
  });

  test('form is pre-filled with existing personal information', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).toBeVisible();

    // Wait for form to render before checking values
    await expect(field(page, 'firstName')).toBeVisible({ timeout: 5_000 });
    await expect(field(page, 'firstName')).toHaveValue('Jane');
    await expect(field(page, 'lastName')).toHaveValue('Doe');
    await expect(field(page, 'email')).toHaveValue('jane@example.com');
    await expect(field(page, 'linkedinUrl')).toHaveValue('https://linkedin.com/in/janedoe');
    await expect(field(page, 'githubUrl')).toHaveValue('https://github.com/janedoe');
    await expect(field(page, 'portfolioUrl')).toHaveValue('https://janedoe.dev');
    await expect(field(page, 'phone')).toHaveValue('+1 (555) 123-4567');
  });

  test('updated data is PATCH to /api/personal-info when the step is saved', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).toBeVisible();

    const firstNameInput = field(page, 'firstName');
    await expect(firstNameInput).toBeVisible({ timeout: 5_000 });
    await firstNameInput.clear();
    await firstNameInput.fill('Janet');

    let capturedBody: Record<string, unknown> | null = null;
    page.on('request', (req) => {
      if (req.url().includes('/api/personal-info') && req.method() === 'PATCH') {
        capturedBody = req.postDataJSON() as Record<string, unknown>;
      }
    });

    await page.getByRole('button', { name: /next|continue|save/i }).click();
    await expect(
      page.getByRole('heading', { name: /personal information|tell us about yourself/i })
    ).not.toBeVisible({ timeout: 5_000 });

    expect(capturedBody).not.toBeNull();
    expect((capturedBody as Record<string, unknown>).firstName).toBe('Janet');
  });
});

// ─── Settings page ────────────────────────────────────────────────────────────

test.describe('Personal Information — Settings page (empty form)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await setupOnboardingMocks(page, ONBOARDING_COMPLETED);
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_NULL);
    await setupDashboardMocks(page);
    await page.goto('/settings', { waitUntil: 'networkidle' });
  });

  test('auth mock works and allows access to protected route', async ({ page }) => {
    await expect(page).not.toHaveURL('/login');
  });

  test('settings page has a Personal Information section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /personal information/i })).toBeVisible();
  });

  test('Personal Information section exposes the form', async ({ page }) => {
    await openProfileFormIfNeeded(page);

    await expect(field(page, 'firstName')).toBeVisible({ timeout: 5_000 });
    await expect(field(page, 'lastName')).toBeVisible({ timeout: 5_000 });
  });

  test('settings form is empty when the user has no saved personal info', async ({ page }) => {
    await openProfileFormIfNeeded(page);

    // Wait for form to render before checking values
    await expect(field(page, 'firstName')).toBeVisible({ timeout: 5_000 });
    await expect(field(page, 'firstName')).toHaveValue('');
    await expect(field(page, 'lastName')).toHaveValue('');
    await expect(field(page, 'linkedinUrl')).toHaveValue('');
    await expect(field(page, 'githubUrl')).toHaveValue('');
  });
});

test.describe('Personal Information — Settings page (populated form)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await setupOnboardingMocks(page, ONBOARDING_COMPLETED);
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_POPULATED);
    await setupDashboardMocks(page);
    await page.goto('/settings', { waitUntil: 'networkidle' });
  });

  test('settings form pre-fills existing personal information', async ({ page }) => {
    await openProfileFormIfNeeded(page);

    // Wait for form to render before checking values
    await expect(field(page, 'firstName')).toBeVisible({ timeout: 5_000 });
    await expect(field(page, 'firstName')).toHaveValue('Jane');
    await expect(field(page, 'lastName')).toHaveValue('Doe');
    await expect(field(page, 'email')).toHaveValue('jane@example.com');
    await expect(field(page, 'linkedinUrl')).toHaveValue('https://linkedin.com/in/janedoe');
    await expect(field(page, 'githubUrl')).toHaveValue('https://github.com/janedoe');
    await expect(field(page, 'phone')).toHaveValue('+1 (555) 123-4567');
  });

  test('saving updated personal information shows success feedback', async ({ page }) => {
    await openProfileFormIfNeeded(page);

    const phoneInput = field(page, 'phone');
    await expect(phoneInput).toBeVisible({ timeout: 5_000 });
    await phoneInput.clear();
    await phoneInput.fill('+1 (555) 999-0000');

    await page.getByRole('button', { name: /save|update/i }).click();

    await expect(page.getByText(/saved|updated|success/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('a non-URL in the settings URL field is rejected and no save is issued', async ({
    page,
  }) => {
    await openProfileFormIfNeeded(page);
    const patches = capturePersonalInfoPatches(page);

    await expect(field(page, 'linkedinUrl')).toBeVisible({ timeout: 5_000 });
    await field(page, 'linkedinUrl').clear();
    await field(page, 'linkedinUrl').fill('not-a-url');
    await page.getByRole('button', { name: /save changes/i }).click();

    await expectFieldRejected(page, 'linkedinUrl');
    await expectNoSave(page, patches);
  });

  // ⚠️ DOCUMENTS A BUG, does not assert the desired behaviour. See WIC-2126.
  //
  // This is the one case where the Zod message *should* be reachable: an empty
  // `linkedinUrl` passes native validation (the input carries no `required`
  // attribute), so the submit event fires and React Hook Form runs the resolver.
  // `min(1, 'LinkedIn URL is required')` ought to render.
  //
  // It does not. `packages/web` resolves `zod@4.3.6` (nested, and invalid against
  // its own declared `^3.23.8`) against `@hookform/resolvers@3.10.0`, which only
  // understands zod 3's `ZodError`. The resolver rethrows instead of mapping, so
  // `formState.errors` stays empty and the page throws an uncaught `ZodError`:
  // no message, no save, no feedback of any kind. Confirmed in isolation — see
  // WIC-2126 for the four-line repro. Both `zodResolver` call sites are affected.
  //
  // So this pins what genuinely holds today — the invalid value is not saved —
  // and records the gap. When WIC-2126 lands, replace the `expect(...).toHaveCount(0)`
  // below with the commented assertion above it; the rest of the test is already right.
  test('clearing a required field blocks the save (Zod message missing — WIC-2126)', async ({
    page,
  }) => {
    await openProfileFormIfNeeded(page);
    const patches = capturePersonalInfoPatches(page);

    await expect(field(page, 'linkedinUrl')).toBeVisible({ timeout: 5_000 });
    await field(page, 'linkedinUrl').clear();
    // Touch another field so the form is dirty — the submit button is disabled
    // until it is, which would otherwise make this pass for the wrong reason.
    await field(page, 'phone').fill('+1 (555) 222-3333');
    await page.getByRole('button', { name: /save changes/i }).click();

    // WIC-2126 target state:
    // await expect(page.getByText('LinkedIn URL is required').first()).toBeVisible();
    await expect(page.getByText('LinkedIn URL is required')).toHaveCount(0);

    // What does hold: the bad value never reaches the API.
    await expectNoSave(page, patches);
  });
});

test.describe('Personal Information — Settings page (save failure)', () => {
  test.beforeEach(async ({ page }) => {
    await setupFallbackApiMocks(page);
    await setupMockAuth(page);
    await setupOnboardingMocks(page, ONBOARDING_COMPLETED);
    await setupPersonalInfoMocks(page, MOCK_PERSONAL_INFO_NULL, { saveSuccess: false });
    await setupDashboardMocks(page);
    await page.goto('/settings', { waitUntil: 'networkidle' });
  });

  test('settings form does not show success message when the API save fails', async ({ page }) => {
    // BUG: Settings.tsx swallows PATCH mutation errors (console.error only, no UI feedback).
    // This test documents the current (broken) behaviour: on save failure, the success
    // message must NOT appear. A follow-up ticket should add visible error handling.
    await openProfileFormIfNeeded(page);

    await expect(field(page, 'firstName')).toBeVisible({ timeout: 5_000 });
    await field(page, 'firstName').fill('Test');
    await field(page, 'lastName').fill('User');
    await field(page, 'email').fill('test@example.com');
    await page.getByRole('button', { name: /save changes/i }).click();

    // Success message must NOT appear when the save failed
    await expect(page.getByText('Personal information updated successfully')).not.toBeVisible({
      timeout: 3_000,
    });
  });
});

// ─── Auth protection ──────────────────────────────────────────────────────────

test.describe('Personal Information — Auth protection', () => {
  test('unauthenticated user is redirected to /login when accessing settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL('/login', { timeout: 5_000 });
  });
});
