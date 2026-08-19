import { test, expect, type Page } from '@playwright/test';

/**
 * Modal focus management E2E (WIC-1141)
 *
 * `docs/design/ACCESSIBILITY.md` §Modals (L54-62) and §Focus Management Patterns
 * (L223-236) require every dialog to trap focus, close on Escape, move focus in on
 * open, restore focus to the trigger on close, and lock background scroll.
 *
 * These tests cover the destructive-delete gate in `ResumeManager` — the app's only
 * irreversible action — which is the worst case called out in WIC-1141. They are the
 * ACCESSIBILITY.md L486-487 manual checklist, automated.
 *
 * Runs entirely on mocked API responses; no backend required.
 */

const MOCK_USER = {
  id: 'test-user-001',
  email: 'test@example.com',
};

const MOCK_RESUME = {
  id: 'resume-mock-001',
  fileName: 'senior-engineer-resume.pdf',
  fileSize: 12345,
  mimeType: 'application/pdf',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  storageKey: 'user-uuid/senior-engineer-resume.pdf',
};

async function setupResumeManager(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: MOCK_USER }),
    })
  );

  await page.route('**/api/resumes', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ resumes: [MOCK_RESUME] }),
    })
  );

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
  });

  await page.goto('/resumes');
  await expect(page.getByRole('button', { name: /delete/i }).first()).toBeVisible();
}

/** Focus the 🗑️ Delete trigger and open the confirm dialog with the keyboard only. */
async function openDeleteDialogByKeyboard(page: Page) {
  const trigger = page.getByRole('button', { name: /delete/i }).first();
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  return trigger;
}

test.describe('ConfirmationModal — destructive delete gate', () => {
  test('announces itself as a dialog and reads the irreversible-action warning', async ({
    page,
  }) => {
    await setupResumeManager(page);
    await openDeleteDialogByKeyboard(page);

    // A plain <div className="fixed inset-0"> is invisible to assistive tech. The
    // dialog role plus an accessible name is what makes the open announceable.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName('Delete Resume');

    // The warning must be the dialog's accessible description, so it is spoken on
    // open rather than only being visible on screen.
    await expect(dialog).toHaveAccessibleDescription(/this action cannot be undone/i);
  });

  test('moves focus into the dialog on open, defaulting to the non-destructive action', async ({
    page,
  }) => {
    await setupResumeManager(page);
    await openDeleteDialogByKeyboard(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Focus must leave the trigger and land inside the dialog.
    const focusIsInsideDialog = await page.evaluate(() => {
      const el = document.activeElement;
      const dlg = document.querySelector('[role="dialog"]');
      return !!(el && dlg && dlg.contains(el) && el !== dlg);
    });
    expect(focusIsInsideDialog).toBe(true);

    // On a destructive gate the safe action is the correct default target.
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });

  test('traps Tab inside the dialog — page content behind is never reachable', async ({ page }) => {
    await setupResumeManager(page);
    await openDeleteDialogByKeyboard(page);
    await expect(page.getByRole('dialog')).toBeVisible();

    // Cycle well past the dialog's two buttons. Without a trap, Tab walks straight
    // out into the page behind the overlay.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const el = document.activeElement;
        const dlg = document.querySelector('[role="dialog"]');
        return !!(el && dlg && dlg.contains(el));
      });
      expect(inside, `focus escaped the dialog after ${i + 1} Tab press(es)`).toBe(true);
    }

    // Shift+Tab must be trapped too — wrapping backwards off the first element.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Shift+Tab');
      const inside = await page.evaluate(() => {
        const el = document.activeElement;
        const dlg = document.querySelector('[role="dialog"]');
        return !!(el && dlg && dlg.contains(el));
      });
      expect(inside, `focus escaped backwards after ${i + 1} Shift+Tab press(es)`).toBe(true);
    }
  });

  test('Escape closes the dialog, runs the parent cancel, and restores focus to the trigger', async ({
    page,
  }) => {
    await setupResumeManager(page);
    const trigger = await openDeleteDialogByKeyboard(page);
    await expect(page.getByRole('dialog')).toBeVisible();

    let deleteCalled = false;
    await page.route('**/api/resumes/resume-mock-001', (route) => {
      deleteCalled = true;
      return route.fulfill({ status: 204, body: '' });
    });

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toBeHidden();
    // Escape is a cancel, never a confirm — nothing may be deleted.
    expect(deleteCalled).toBe(false);
    await expect(trigger).toBeFocused();
  });

  test('Cancel closes the dialog and restores focus to the trigger', async ({ page }) => {
    await setupResumeManager(page);
    const trigger = await openDeleteDialogByKeyboard(page);

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('cancelling clears the pending resume — reopening names the resume afresh', async ({
    page,
  }) => {
    await setupResumeManager(page);

    // The parent's `resumeToDelete` state must be cleared by Escape, exactly as it
    // is by the Cancel button, or the next open renders against stale state.
    await openDeleteDialogByKeyboard(page);
    await expect(page.getByRole('dialog')).toContainText('senior-engineer-resume.pdf');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await openDeleteDialogByKeyboard(page);
    await expect(page.getByRole('dialog')).toContainText('senior-engineer-resume.pdf');
    await expect(page.getByRole('dialog')).toContainText('This action cannot be undone');
  });

  test('locks background scroll while open and releases it on close', async ({ page }) => {
    await setupResumeManager(page);

    const bodyOverflow = () => page.evaluate(() => getComputedStyle(document.body).overflow);

    const before = await bodyOverflow();
    await openDeleteDialogByKeyboard(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await bodyOverflow()).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await bodyOverflow()).toBe(before);
  });

  test('hides the page behind the dialog from the screen-reader virtual cursor', async ({
    page,
  }) => {
    await setupResumeManager(page);
    await openDeleteDialogByKeyboard(page);
    await expect(page.getByRole('dialog')).toBeVisible();

    // Content outside the dialog must be removed from the accessibility tree,
    // otherwise the virtual cursor reads straight past the confirmation. The app
    // renders into #root and Radix portals the dialog out to a body-level sibling,
    // so #root is the background container that must be hidden.
    const background = page.locator('#root');
    await expect(background).toHaveAttribute('aria-hidden', 'true');
    // Sanity-check the dialog really is outside the hidden subtree, or the
    // assertion above would be hiding the dialog from the user too.
    expect(await background.locator('[role="dialog"]').count()).toBe(0);

    // ...and the page comes back once the dialog closes.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(background).not.toHaveAttribute('aria-hidden', 'true');
  });

  test('confirming still deletes — the a11y fix does not change the happy path', async ({
    page,
  }) => {
    await setupResumeManager(page);
    await openDeleteDialogByKeyboard(page);

    let deleteCalled = false;
    await page.route('**/api/resumes/resume-mock-001', (route) => {
      deleteCalled = true;
      return route.fulfill({ status: 204, body: '' });
    });

    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    expect(deleteCalled).toBe(true);
  });
});
