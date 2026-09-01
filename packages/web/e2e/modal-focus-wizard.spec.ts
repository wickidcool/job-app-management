import { test, expect, type Page } from '@playwright/test';

/**
 * Modal focus management E2E — `WizardContainer` (WIC-1925).
 *
 * The last of the four dialogs `docs/design/MODAL_FOCUS_MANAGEMENT_SPEC.md` §10 listed as
 * consuming `useDialogFocusRestore` with no E2E focus coverage. Parity target is
 * `modal-focus.spec.ts`.
 *
 * **The trigger-restore assertion takes a different route here — it is not a ref.**
 * This dialog is itself a *route*: `DialogueCapture` at `/projects/new/dialogue` renders it
 * with `open` hardcoded, so it is opened by navigation rather than by a control, and closing
 * it calls `navigate('/projects')`. Nothing on either page is mounted at the moment Radix
 * restores focus, so `useDialogFocusRestore` — a ref-based mechanism on both its trigger and
 * its `fallbackRef` path — cannot serve this shape and was inert here until WIC-1931. Focus
 * is handed to the destination route *by name* instead (`useRouteFocusHandoff`), and the
 * final `describe` below asserts the whole journey end to end.
 *
 * Alongside it, the assertion that matters on this shape independently of focus: that
 * dismissing really does leave the wizard, i.e. the dismissal is wired to the router at
 * all. That is checked on both the Escape and the ✕ path.
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
 * The full journey: open the wizard from `/projects`, dismiss it, land back on the button.
 *
 * **This block was pinned `test.fail()` when WIC-1925 wrote it, and the pin is gone because
 * WIC-1931 fixed the behaviour, not because the assertion was weakened.** The assertion
 * below is byte-for-byte the one that was failing; only `test.fail()` was deleted.
 *
 * What was wrong, and why the obvious remedy did not apply: the only way into this dialog
 * is `navigate('/projects/new/dialogue?variant=create')` from `ProjectsList`, so the
 * trigger unmounts with the route on the way *in*, and the wizard navigates away again on
 * the way *out*. Whichever element `useDialogFocusRestore` captured was detached by the
 * time `onCloseAutoFocus` ran, `trigger?.isConnected` was false, there was no
 * `fallbackRef`, and it returned without focusing anything — with Radix's own restore
 * already suppressed, focus landed on `<body>`. §5.3 of
 * `docs/design/MODAL_FOCUS_MANAGEMENT_SPEC.md` makes a fallback obligatory for this shape,
 * but a `fallbackRef` cannot discharge it here: every candidate lives on the *other* route
 * and is unmounted at that moment, so the ref would be `null`. The fix is the third option
 * that section's rule allows — an explicit post-navigation focus target
 * (`useRouteFocusHandoff`), carried in `location.state` and claimed by a callback ref on
 * the destination.
 *
 * Two controls keep this honest, both re-run on the fix:
 *
 *  1. **Deletion control.** Dropping the handoff `state` from `DialogueCapture`'s
 *     `onCancel` reds exactly this test and nothing else in the file — the nine tests
 *     above stay green, exactly as they did when the defect was live. That is the
 *     measurement that this block, and only this block, observes the fix.
 *  2. **The one it replaces.** Removing `{...focusRestore}` from `WizardContainer.tsx`
 *     used to cost **zero** tests here while costing four in each of the sweep's other
 *     three dialogs. That is why the spread is gone from that file rather than left as
 *     decoration: it was never doing anything, and its presence is what made this dialog
 *     look covered.
 */
test.describe('WizardContainer — focus returns across the route change', () => {
  test('closing the wizard returns focus to the control that opened it', async ({ page }) => {
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

    // Before WIC-1931 this was `<body>`: the scroll lock and `#root[aria-hidden]` were
    // both released correctly, and this was the one piece of residue left behind — the
    // only one a sighted mouse user would never notice. The button resolved here is a
    // *new instance*, mounted by the destination route, which is precisely why no ref
    // could have restored focus to it.
    await expect(page.getByRole('button', { name: /Add New Project \(Guided\)/i })).toBeFocused();
  });
});
