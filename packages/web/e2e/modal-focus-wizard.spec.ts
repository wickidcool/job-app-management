import { test, expect, type Page } from '@playwright/test';

/**
 * Modal focus management E2E — `WizardContainer` (WIC-1925).
 *
 * The last of the four dialogs `docs/design/MODAL_FOCUS_MANAGEMENT_SPEC.md` §10 listed as
 * consuming `useDialogFocusRestore` with no E2E focus coverage. Parity target is
 * `modal-focus.spec.ts`.
 *
 * **The trigger-restore assertion does not transfer, and is deliberately not faked.**
 * This dialog is a *route*: `DialogueCapture` at `/projects/new/dialogue` renders it with
 * `open` hardcoded, so it is opened by navigation rather than by a control, and closing it
 * calls `navigate('/projects')`. There is no trigger element to restore focus to — the
 * page that would own one is not even mounted — and `useDialogFocusRestore` correctly
 * declines to invent one, since its `focusin` capture rejects `document.body`. Asserting
 * that focus "returns" to something here would be a tautology dressed as coverage.
 *
 * What replaces it is the assertion that actually matters on this shape: that dismissing
 * really does leave the wizard, i.e. the dismissal is wired to the router at all. That is
 * checked on both the Escape and the ✕ path.
 *
 * Runs entirely on mocked API responses; no backend required.
 */

const MOCK_USER = { id: 'test-user-001', email: 'test@example.com' };

async function setupWizard(page: Page) {
  // Regex rather than the `**\/api\/**` glob: that glob also matches Vite's own
  // `/src/services/api/index.ts` module request and answers it with JSON, blanking
  // the page in a way that looks like "the dialog never opened".
  await page.route(/\/api\/(?!.*\.tsx?$)/, (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    if (url.includes('/auth/me')) return json({ user: MOCK_USER });
    // Onboarding must stay shut, or its panel is the dialog every query below finds.
    if (url.includes('should-show')) return json({ shouldShow: false });
    return json({ applications: [], resumes: [], projects: [], exports: [] });
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
  });

  await page.goto('/projects/new/dialogue', { waitUntil: 'networkidle' });
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function focusIsInsideDialog(page: Page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const el = document.activeElement;
    return !!(el && dlg && dlg.contains(el) && el !== dlg);
  });
}

test.describe('WizardContainer — focus management', () => {
  test('announces itself as a dialog with an accessible name', async ({ page }) => {
    await setupWizard(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The name is variant-driven: `create` is the default when no ?variant= is given.
    await expect(dialog).toHaveAccessibleName('New Project');
  });

  test('moves focus into the dialog on open', async ({ page }) => {
    await setupWizard(page);

    // The first step autofocuses its own field. That is the case
    // `useDialogFocusRestore`'s docstring calls out as invisible to
    // `onOpenAutoFocus` — React's `autoFocus` runs in the commit phase, before
    // Radix's passive effect, so `FocusScope` never dispatches the event.
    expect(await focusIsInsideDialog(page)).toBe(true);
  });

  test('traps Tab inside the dialog', async ({ page }) => {
    await setupWizard(page);

    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const el = document.activeElement;
        return !!(el && dlg && dlg.contains(el));
      });
      expect(inside, `focus escaped the dialog after ${i + 1} Tab press(es)`).toBe(true);
    }

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      const inside = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const el = document.activeElement;
        return !!(el && dlg && dlg.contains(el));
      });
      expect(inside, `focus escaped backwards after ${i + 1} Shift+Tab press(es)`).toBe(true);
    }
  });

  test('locks background scroll while open', async ({ page }) => {
    await setupWizard(page);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  });

  test('hides the page behind the dialog from the screen-reader virtual cursor', async ({
    page,
  }) => {
    await setupWizard(page);

    const background = page.locator('#root');
    await expect(background).toHaveAttribute('aria-hidden', 'true');
    // The dialog must be outside the hidden subtree, or this would hide it from
    // the user too.
    expect(await background.locator('[role="dialog"]').count()).toBe(0);
    // Radix's `aria-hidden` exempts [aria-live] and <script> and keeps their whole
    // ancestor chain unhidden, so the assertion above is only meaningful while this
    // route renders neither inside #root. Measured, not assumed.
    expect(
      await page.evaluate(() => document.querySelectorAll('#root [aria-live], #root script').length)
    ).toBe(0);
  });

  test('Escape leaves the wizard route rather than stranding a closed dialog', async ({ page }) => {
    await setupWizard(page);

    await page.keyboard.press('Escape');

    // `onOpenChange(false)` runs `onCancel`, which navigates to /projects. Asserting
    // the URL rather than the dialog's absence is the point: a wizard that "closed"
    // without routing would leave the user on an empty /projects/new/dialogue, which
    // reads as a blank page and is invisible to a `toBeHidden` check.
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('the ✕ leaves the wizard route', async ({ page }) => {
    await setupWizard(page);

    // Routed through `Dialog.Close` rather than the keyboard handler, so this is a
    // genuinely different path to the same outcome, not the same one twice.
    await page.getByRole('button', { name: 'Close wizard' }).click();

    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('background scroll is released once the wizard is gone', async ({ page }) => {
    await setupWizard(page);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/projects$/);

    // The lock must not outlive the dialog — a stuck `overflow: hidden` leaves the
    // whole app unscrollable, and nothing else on /projects would reveal it.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
      .not.toBe('hidden');
  });

  test('the page behind is exposed again once the wizard is gone', async ({ page }) => {
    await setupWizard(page);
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/projects$/);

    // A stuck `aria-hidden` on #root hides the entire app from assistive tech while
    // looking completely normal on screen — the highest-severity residue this dialog
    // can leave, and one no visual check would catch.
    await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', 'true');
  });
});

/**
 * The wizard's `useDialogFocusRestore` is inert, and closing strands focus on `<body>`.
 *
 * Measured two ways while writing this file:
 *
 *  1. **Deletion control.** Removing `{...focusRestore}` from `WizardContainer.tsx`
 *     entirely leaves all nine tests above passing. Every other dialog in this sweep has
 *     a control that goes red — `QuickReferenceExport` and `DiffReviewModal` lose exactly
 *     four tests each, `OnboardingModal` exactly four. This one loses none, because there
 *     is nothing for the hook to do.
 *  2. **The real journey.** `/projects` → "Add New Project (Guided)" → Escape leaves
 *     `document.activeElement === document.body`.
 *
 * The cause is structural, not a wiring mistake. The only way into this dialog is
 * `navigate('/projects/new/dialogue?variant=create')` from `ProjectsList`, so the trigger
 * unmounts with the route on the way in, and the wizard navigates away again on the way
 * out. Whichever element the hook captured is detached by the time `onCloseAutoFocus`
 * runs, `trigger?.isConnected` is false, there is no `fallbackRef`, and it returns without
 * focusing anything. Radix's own restore was already suppressed. Focus lands on `<body>`.
 *
 * That is the WIC-1141 failure class this hook exists to prevent, on a dialog everyone
 * reasonably assumed was covered *because* it consumes the hook — which is exactly the
 * "argument from construction" WIC-1925 was filed to replace with a measurement.
 *
 * Tracked as **WIC-1931**, and listed under `docs/design/MODAL_FOCUS_MANAGEMENT_SPEC.md`
 * §10 `Still open:`. The fix is a `fallbackRef` (or an explicit post-navigation focus
 * target on `/projects`), matching what WIC-1222 did for the `ProjectsList` create path —
 * §5.3 of that spec makes a fallback obligatory for exactly this shape.
 *
 * Marked `test.fail()` so it does not block CI while the fix is owned elsewhere, and so it
 * turns RED the moment the behaviour is fixed, forcing this note to be retired rather than
 * left as a stale accusation. **When WIC-1931 lands, delete the `test.fail()` call; the
 * body below is already the correct assertion.** Do not delete the test.
 */
test.describe('WizardContainer — focus is stranded on <body> after close', () => {
  test('closing the wizard returns focus to the control that opened it', async ({ page }) => {
    test.fail(
      true,
      'The wizard is entered by navigation, so the captured trigger is detached by close time'
    );

    await page.route(/\/api\/(?!.*\.tsx?$)/, (route) => {
      const url = route.request().url();
      const json = (body: unknown) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      if (url.includes('/auth/me')) return json({ user: MOCK_USER });
      if (url.includes('should-show')) return json({ shouldShow: false });
      return json({ applications: [], resumes: [], projects: [], exports: [] });
    });
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
    });

    // The realistic journey, not a direct goto: the trigger has to exist for the
    // question "was focus restored to it?" to mean anything.
    await page.goto('/projects', { waitUntil: 'networkidle' });
    const trigger = page.getByRole('button', { name: /Add New Project \(Guided\)/i });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/projects\/new\/dialogue/);
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/projects$/);

    // Measured today: focus is on <body>. The scroll lock and `#root[aria-hidden]` are
    // both released correctly, so this is the one piece of residue left behind, and the
    // only one a sighted mouse user would never notice.
    await expect(page.getByRole('button', { name: /Add New Project \(Guided\)/i })).toBeFocused();
  });
});
