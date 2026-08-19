import { test, expect, type Page } from '@playwright/test';

/**
 * Modal focus management E2E — the `ProjectsList` create-project dialog (WIC-1141, PR 2).
 *
 * Exercises `useDialogFocusRestore`, the shared fix for Radix's modal `Dialog.Content`
 * restoring focus only to a `Dialog.Trigger`. Every dialog in this app is controlled by
 * an `isOpen`-style prop with its trigger in the parent, so no trigger is rendered and
 * focus would otherwise fall to `<body>` on close.
 *
 * This dialog is the interesting one of the five: it autofocuses its own Project Name
 * input, so it uses `autoFocusOnOpen: false` and must still restore the trigger.
 *
 * Runs entirely on mocked API responses; no backend required.
 *
 * Note on the background-hiding test: do NOT assert `#root[aria-hidden=true]`. Radix hides
 * the background via the `aria-hidden` package, which deliberately exempts `[aria-live]`
 * elements and `<script>` (dist L131-133) — and exempting a node keeps its whole ancestor
 * chain. `EmptyState` carries `aria-live="polite"`, so on any page rendering it `#root`,
 * `main` and the empty state itself stay unhidden by design. Assert on the trigger's
 * reachability instead, which is the actual requirement.
 */

const MOCK_USER = {
  id: 'test-user-001',
  email: 'test@example.com',
};

async function setupProjectsList(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: MOCK_USER }),
    })
  );

  await page.route('**/api/projects*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [] }),
    })
  );

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
  });

  await page.goto('/projects');
  await expect(page.getByRole('button', { name: 'Create Project', exact: true })).toBeVisible();
}

/** Focus the "Create Project" trigger and open the dialog with the keyboard only. */
async function openCreateDialogByKeyboard(page: Page) {
  const trigger = page.getByRole('button', { name: 'Create Project', exact: true });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  return trigger;
}

test.describe('ProjectsList — create project dialog', () => {
  test('announces itself as a dialog with an accessible name', async ({ page }) => {
    await setupProjectsList(page);
    await openCreateDialogByKeyboard(page);

    await expect(page.getByRole('dialog')).toHaveAccessibleName('Create New Project');
  });

  test('honours the input autoFocus instead of grabbing the first tabbable element', async ({
    page,
  }) => {
    await setupProjectsList(page);
    await openCreateDialogByKeyboard(page);

    // `autoFocusOnOpen: false` exists precisely so Radix does not steal this.
    await expect(page.getByPlaceholder('e.g., Acme Corp')).toBeFocused();
  });

  test('traps Tab inside the dialog', async ({ page }) => {
    await setupProjectsList(page);
    await openCreateDialogByKeyboard(page);

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const el = document.activeElement;
        const dlg = document.querySelector('[role="dialog"]');
        return !!(el && dlg && dlg.contains(el));
      });
      expect(inside, `focus escaped the dialog after ${i + 1} Tab press(es)`).toBe(true);
    }
  });

  test('Escape closes the dialog and restores focus to the trigger', async ({ page }) => {
    await setupProjectsList(page);
    const trigger = await openCreateDialogByKeyboard(page);

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Cancel closes the dialog and restores focus to the trigger', async ({ page }) => {
    await setupProjectsList(page);
    const trigger = await openCreateDialogByKeyboard(page);

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('every dismissal path clears the draft, not just the Cancel button', async ({ page }) => {
    await setupProjectsList(page);
    await openCreateDialogByKeyboard(page);

    // Escape previously bypassed the button's inline reset, stranding the draft.
    await page.getByPlaceholder('e.g., Acme Corp').fill('Discarded Corp');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await openCreateDialogByKeyboard(page);
    await expect(page.getByPlaceholder('e.g., Acme Corp')).toHaveValue('');
  });

  test('locks background scroll while open', async ({ page }) => {
    await setupProjectsList(page);
    await openCreateDialogByKeyboard(page);

    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
  });

  test('hides the page behind it from the screen-reader virtual cursor', async ({ page }) => {
    await setupProjectsList(page);

    // Role queries respect `aria-hidden`, so a count of 0 is the assertion that
    // matters: the trigger is no longer reachable by the virtual cursor.
    const trigger = page.getByRole('button', { name: 'Create Project', exact: true });
    await expect(trigger).toHaveCount(1);

    await openCreateDialogByKeyboard(page);
    await expect(trigger).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);

    // The dialog is portalled to <body>, so it is never inside the hidden subtree.
    expect(await page.locator('#root [role="dialog"]').count()).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toHaveCount(1);
  });
});
