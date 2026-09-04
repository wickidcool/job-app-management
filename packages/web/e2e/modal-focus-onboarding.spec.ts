import { test, expect, type Page } from '@playwright/test';

/**
 * Modal focus management E2E — `OnboardingModal` and its two nested confirms (WIC-1925).
 *
 * `docs/design/MODAL_FOCUS_MANAGEMENT_SPEC.md` §10 listed four dialogs that consume
 * `useDialogFocusRestore` with no E2E focus coverage at all. This is the first of them,
 * and the spec names it as the one to do first: it instantiates the hook **three** times
 * (§5) — `outerFocusRestore`, `dismissFocusRestore`, `resumeSkipFocusRestore` — the only
 * dialog in the app that does. "They all share a hook" is therefore weakest here, because
 * three instances is three chances for one of them to be wired up wrong.
 *
 * The parity target is `modal-focus.spec.ts`. Two of its assertions do not transfer
 * verbatim, and are deliberately *not* faked:
 *
 *  - **Restore focus to the trigger** is meaningless for the outer panel. It is mounted by
 *    `App.tsx` and opens on `shouldShow`, not from a control, so there is no trigger to
 *    restore to and `useDialogFocusRestore` correctly declines to invent one (it rejects
 *    `document.body` as a capture). Asserting focus "returns" somewhere here would be a
 *    tautology. The two *nested* confirms do have real triggers, and they get the full
 *    assertion.
 *  - **Escape closes the dialog** is false for the outer panel by design: `onOpenChange`
 *    routes Escape through the same confirm gate as the ✕. That behaviour is pinned below
 *    rather than asserted away.
 *
 * Runs entirely on mocked API responses; no backend required.
 */

const MOCK_USER = { id: 'test-user-001', email: 'test@example.com' };

const ONBOARDING_BASE = {
  id: 'onboarding-001',
  userId: MOCK_USER.id,
  currentStep: 'welcome',
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

const ONBOARDING_AT_RESUME = { ...ONBOARDING_BASE, currentStep: 'resume_upload' };

/**
 * The route pattern is a regex, not the `**\/api\/**` glob used by the older specs.
 * That glob also matches Vite's own module request for `/src/services/api/index.ts`
 * and answers it with JSON, which fails the module's MIME check and leaves the page
 * blank — a failure that looks exactly like "the dialog never opened".
 */
async function setupOnboarding(page: Page, status: object = ONBOARDING_BASE) {
  await page.route(/\/api\/(?!.*\.tsx?$)/, (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    if (url.includes('/auth/me')) return json({ user: MOCK_USER });
    // Visibility is the server's answer, not derived from the status row (WIC-1359).
    if (url.includes('should-show')) return json({ shouldShow: true });
    if (url.includes('/onboarding/status')) return json(status);
    if (url.includes('/onboarding/')) return json({ ...status, version: 2 });
    if (url.includes('/personal-info')) {
      return json({
        personalInfo: { id: 'pi-default', firstName: '', lastName: '', email: '', version: 1 },
        isComplete: false,
        completionPercentage: 0,
      });
    }
    return json({ applications: [], resumes: [], projects: [], exports: [] });
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** True when focus is inside the *innermost* open dialog. */
async function focusIsInsideTopDialog(page: Page) {
  return page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    const top = dialogs[dialogs.length - 1];
    const el = document.activeElement;
    return !!(el && top && top.contains(el));
  });
}

test.describe('OnboardingModal — the outer panel', () => {
  test('announces itself as a dialog named by the current step heading', async ({ page }) => {
    await setupOnboarding(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The name and description are the step's own heading and blurb rendered by
    // `OnboardingStep`, wired via aria-labelledby/-describedby rather than a
    // `Dialog.Title`, because they change per step.
    await expect(dialog).toHaveAccessibleName('Welcome to Your Job Application Manager');
    await expect(dialog).toHaveAccessibleDescription(/.+/);
  });

  test('moves focus into the dialog on open', async ({ page }) => {
    await setupOnboarding(page);

    // Focus must be inside the panel, and on a real control rather than the
    // container itself — the container is what Radix falls back to when nothing
    // inside is focusable, which would still satisfy a naive `contains` check.
    expect(await focusIsInsideTopDialog(page)).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
  });

  test('traps Tab inside the dialog — the dashboard behind is never reachable', async ({
    page,
  }) => {
    await setupOnboarding(page);

    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(
        await focusIsInsideTopDialog(page),
        `focus escaped the dialog after ${i + 1} Tab press(es)`
      ).toBe(true);
    }

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(
        await focusIsInsideTopDialog(page),
        `focus escaped backwards after ${i + 1} Shift+Tab press(es)`
      ).toBe(true);
    }
  });

  test('locks background scroll while open', async ({ page }) => {
    await setupOnboarding(page);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  });

  test('hides the page behind the dialog from the screen-reader virtual cursor', async ({
    page,
  }) => {
    await setupOnboarding(page);

    // The app renders into #root and Radix portals the dialog to a body-level
    // sibling, so #root is the background container that must be hidden.
    const background = page.locator('#root');
    await expect(background).toHaveAttribute('aria-hidden', 'true');
    // Sanity-check the dialog is outside the hidden subtree, or the assertion
    // above would be hiding the dialog from the user too.
    expect(await background.locator('[role="dialog"]').count()).toBe(0);

    // `aria-hidden` exempts [aria-live] elements and <script>, and exempting a node
    // keeps its whole ancestor chain — so the assertion above is only valid on a page
    // that renders neither inside #root. Measured here, as `modal-focus-projects.spec.ts`
    // does for /projects: if either count becomes non-zero this assertion silently
    // stops meaning anything, so it is checked rather than assumed.
    expect(
      await page.evaluate(() => document.querySelectorAll('#root [aria-live], #root script').length)
    ).toBe(0);
  });

  test('Escape opens the save-and-exit confirm rather than discarding progress', async ({
    page,
  }) => {
    await setupOnboarding(page);

    // `onOpenChange` routes Escape through `handleClose`, the same gate as the ✕.
    // Escape must not silently drop the user out of onboarding.
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: 'Save progress and exit?' })).toBeVisible();

    // ...and the onboarding panel is still mounted behind it — the point of the test is
    // that Escape opened the confirm instead of dropping the user out of onboarding.
    //
    // Assert that by locating the panel directly rather than by its `dialog` role.
    // WIC-1868 sets `aria-hidden` on the panel for exactly as long as a nested confirm
    // is open (§11 of MODAL_FOCUS_MANAGEMENT_SPEC.md), so it is deliberately *not* in
    // the accessibility tree here and a role query cannot see it. Querying by role
    // would therefore be asserting the opposite of what this file asserts at the
    // bottom — that a nested confirm leaves exactly one dialog exposed — and the two
    // cannot both hold. Mounted, not exposed, is the correct reading.
    const panel = page.locator('[aria-labelledby="onboarding-title"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
  });
});

test.describe('OnboardingModal — the nested dismiss confirm', () => {
  /** Opens the confirm from the ✕ with the keyboard only, and returns the trigger. */
  async function openDismissConfirm(page: Page) {
    const trigger = page.getByRole('button', { name: 'Close onboarding' });
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Save progress and exit?' })).toBeVisible();
    return trigger;
  }

  test('announces itself as a dialog and names what will happen', async ({ page }) => {
    await setupOnboarding(page);
    await openDismissConfirm(page);

    const confirm = page.getByRole('dialog', { name: 'Save progress and exit?' });
    await expect(confirm).toHaveAccessibleDescription(/progress will be saved/i);
  });

  test('moves focus into the confirm, defaulting to the non-committal action', async ({ page }) => {
    await setupOnboarding(page);
    await openDismissConfirm(page);

    expect(await focusIsInsideTopDialog(page)).toBe(true);
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });

  test('traps Tab inside the confirm — the panel behind it is not tabbable', async ({ page }) => {
    await setupOnboarding(page);
    await openDismissConfirm(page);

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(
        await focusIsInsideTopDialog(page),
        `focus escaped the confirm after ${i + 1} Tab press(es)`
      ).toBe(true);
    }
  });

  test('Escape closes the confirm and restores focus to the ✕ that opened it', async ({ page }) => {
    await setupOnboarding(page);
    const trigger = await openDismissConfirm(page);

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: 'Save progress and exit?' })).toBeHidden();
    // Escape is a cancel: onboarding stays open...
    await expect(
      page.getByRole('dialog', { name: 'Welcome to Your Job Application Manager' })
    ).toBeVisible();
    // ...and focus comes back to the control that opened the confirm, not to <body>.
    // This is the assertion `useDialogFocusRestore`'s second instance exists for: the
    // ✕ is *inside* another dialog, so the hook's `focusin` capture deliberately skips
    // it and only `onOpenAutoFocus` can have recorded it.
    await expect(trigger).toBeFocused();
  });

  test('Cancel closes the confirm and restores focus to the ✕ that opened it', async ({ page }) => {
    await setupOnboarding(page);
    const trigger = await openDismissConfirm(page);

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog', { name: 'Save progress and exit?' })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('locks background scroll while the confirm is open, and keeps it locked after', async ({
    page,
  }) => {
    await setupOnboarding(page);
    await openDismissConfirm(page);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Save progress and exit?' })).toBeHidden();
    // The outer panel is still open, so the lock must NOT be released here — a naive
    // "release on close" would unlock the page behind a dialog that is still up.
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  });
});

test.describe('OnboardingModal — the nested resume-skip confirm', () => {
  async function openResumeSkipConfirm(page: Page) {
    const trigger = page.getByRole('button', { name: 'Skip for now' });
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Continue without a resume?' })).toBeVisible();
    return trigger;
  }

  test('announces itself as a dialog and names what is lost', async ({ page }) => {
    await setupOnboarding(page, ONBOARDING_AT_RESUME);
    await openResumeSkipConfirm(page);

    const confirm = page.getByRole('dialog', { name: 'Continue without a resume?' });
    await expect(confirm).toHaveAccessibleDescription(/tailored resume|cover letter|job-fit/i);
  });

  test('moves focus into the confirm, defaulting to the non-committal action', async ({ page }) => {
    await setupOnboarding(page, ONBOARDING_AT_RESUME);
    await openResumeSkipConfirm(page);

    expect(await focusIsInsideTopDialog(page)).toBe(true);
    await expect(page.getByRole('button', { name: 'Go Back' })).toBeFocused();
  });

  test('traps Tab inside the confirm', async ({ page }) => {
    await setupOnboarding(page, ONBOARDING_AT_RESUME);
    await openResumeSkipConfirm(page);

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(
        await focusIsInsideTopDialog(page),
        `focus escaped the confirm after ${i + 1} Tab press(es)`
      ).toBe(true);
    }
  });

  test('Escape closes the confirm and restores focus to the Skip control', async ({ page }) => {
    await setupOnboarding(page, ONBOARDING_AT_RESUME);
    const trigger = await openResumeSkipConfirm(page);

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: 'Continue without a resume?' })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Go Back closes the confirm and restores focus to the Skip control', async ({ page }) => {
    await setupOnboarding(page, ONBOARDING_AT_RESUME);
    const trigger = await openResumeSkipConfirm(page);

    await page.getByRole('button', { name: 'Go Back' }).click();

    await expect(page.getByRole('dialog', { name: 'Continue without a resume?' })).toBeHidden();
    await expect(trigger).toBeFocused();
    // Cancelling must leave the step completely untouched (WIC-1383 D-6): the user is
    // still on the resume step, not advanced past it.
    await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible();
  });
});

/**
 * WIC-1868 — a nested confirm must leave exactly one dialog exposed.
 *
 * `modal-focus.spec.ts`'s background-hiding test asserts that nothing behind the open
 * dialog is reachable by the screen-reader virtual cursor. Applied honestly to a nested
 * confirm, that assertion used to fail: the confirm is portalled to a body-level sibling of
 * the onboarding panel, and Radix does not `aria-hidden` the panel, so two dialogs were
 * exposed at once and the virtual cursor read straight past the confirmation into the form
 * behind.
 *
 * These two were written as honest assertions and pinned `test.fail()` rather than weakened
 * to pass, per WIC-1925's instruction to coordinate with WIC-1868 instead of asserting the
 * bug. That pin was a tripwire in both directions, and **it fired**: WIC-1868 shipped on
 * `main` 2026-09-01 — `aria-hidden={confirmationOpen}` on the panel's own `Dialog.Content`
 * (`OnboardingModal.tsx:309`, and the rule in §11 of `MODAL_FOCUS_MANAGEMENT_SPEC.md`) — so
 * both tests began passing and the pins turned RED, a `test.fail()` that passes being a
 * Playwright failure. The pins were therefore deleted when this branch merged `main` in, and
 * the assertion bodies below are unchanged: they are the same two assertions, now green on
 * their merits rather than pinned against a known defect.
 *
 * Do not re-pin these. If either regresses, the panel has stopped being `aria-hidden` while
 * a confirm is open, which is the WIC-1868 defect returning and is a fix owed in the
 * component, not here.
 */
test.describe('OnboardingModal — a nested confirm leaves exactly one dialog exposed (WIC-1868)', () => {
  test('the dismiss confirm leaves exactly one dialog exposed', async ({ page }) => {
    await setupOnboarding(page);

    await page.getByRole('button', { name: 'Close onboarding' }).click();
    await expect(page.getByRole('dialog', { name: 'Save progress and exit?' })).toBeVisible();

    // Exactly one dialog may be exposed to assistive tech at a time.
    expect(await page.getByRole('dialog').count()).toBe(1);
  });

  test('the resume-skip confirm leaves exactly one dialog exposed', async ({ page }) => {
    await setupOnboarding(page, ONBOARDING_AT_RESUME);

    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByRole('dialog', { name: 'Continue without a resume?' })).toBeVisible();

    expect(await page.getByRole('dialog').count()).toBe(1);
  });
});
