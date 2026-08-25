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

/**
 * Confirm-path focus and announcement (WIC-1181)
 *
 * The suite above only ever asserts focus on *cancel*-shaped exits, where the
 * trigger survives. On the confirm path it does not: the trigger is the per-row
 * `🗑️ Delete` button, and the delete it confirms is what removes the row. So
 * restoring focus to the captured trigger cannot be enough — either the restore
 * lands and the refetch then unmounts the focused node, or the node is already
 * gone when the restore runs. Both orderings end on `<body>`, which is the exact
 * failure WIC-1141 exists to prevent, on its highest-severity path.
 *
 * These need a resume list that actually shrinks, so they use their own mocks
 * rather than the fixed single-resume `setupResumeManager` above.
 */
const MOCK_RESUMES = [
  {
    id: 'resume-mock-001',
    fileName: 'senior-engineer-resume.pdf',
    fileSize: 12345,
    mimeType: 'application/pdf',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
  },
  {
    id: 'resume-mock-002',
    fileName: 'staff-engineer-resume.docx',
    fileSize: 23456,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    uploadedAt: '2026-01-02T00:00:00.000Z',
    version: 1,
  },
];

/**
 * Serves a resume list that a DELETE genuinely removes from, so the refetch that
 * follows a confirm really does unmount the trigger row.
 */
async function setupShrinkingResumeList(page: Page, count: 1 | 2) {
  const remaining = MOCK_RESUMES.slice(0, count);

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
      body: JSON.stringify({ resumes: remaining }),
    })
  );

  await page.route('**/api/resumes/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const index = remaining.findIndex((resume) => resume.id === id);
    if (index !== -1) remaining.splice(index, 1);
    return route.fulfill({ status: 204, body: '' });
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
  });

  await page.goto('/resumes');
  await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(count);
}

test.describe('ConfirmationModal — confirm path (WIC-1181)', () => {
  test('a successful delete moves focus to the resume list, not <body>', async ({ page }) => {
    await setupShrinkingResumeList(page, 2);

    const trigger = page.getByRole('button', { name: /delete/i }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // The row really went away — otherwise the trigger survives and this proves
    // nothing about the case the ticket describes.
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(1);

    // Focus must be somewhere useful. `toBeFocused` retries, which covers both
    // orderings: the restore-then-unmount race resolves via the fallback watch a
    // tick later, and the already-detached ordering resolves immediately.
    await expect(page.getByRole('region', { name: 'Resumes' })).toBeFocused();
  });

  test('deleting the last resume lands focus on the region that now holds the empty state', async ({
    page,
  }) => {
    await setupShrinkingResumeList(page, 1);

    const trigger = page.getByRole('button', { name: /delete/i }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Nothing in the list branch survives this — the whole container is replaced
    // by the empty state, so no ordering could have preserved the trigger.
    await expect(page.getByRole('button', { name: 'Upload Your First Resume' })).toBeVisible();

    const region = page.getByRole('region', { name: 'Resumes' });
    await expect(region).toBeFocused();
    // ...and the empty state is inside it, so the user is reading the right thing.
    await expect(region.getByRole('button', { name: 'Upload Your First Resume' })).toBeVisible();
  });

  test('announces the deletion in a live region that wraps no control', async ({ page }) => {
    await setupShrinkingResumeList(page, 2);

    // The live region has to exist and be empty *before* the delete: assistive tech
    // only announces changes to a region already in the accessibility tree.
    // Scoped to a direct child of <body>: the announcer is portalled out of #root
    // (see below), and `EmptyState` still carries its own aria-live until WIC-1155
    // lands, so an unscoped locator would be measuring two different things.
    const announcer = page.locator('body > [aria-live="polite"]');
    await expect(announcer).toHaveCount(1);
    await expect(announcer).toHaveText('');

    await page
      .getByRole('button', { name: /delete/i })
      .first()
      .focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await expect(announcer).toHaveText(/senior-engineer-resume\.pdf.*deleted/i);

    // WIC-1155: `aria-hidden` exempts [aria-live] elements and their ancestors from
    // the background-hiding a modal applies, so a live region containing a control
    // leaves that control reachable behind every dialog. This one must stay a leaf.
    expect(
      await announcer.evaluate(
        (el) => el.querySelectorAll('a, button, input, select, textarea, [tabindex]').length
      )
    ).toBe(0);

    // ...and because that exemption covers the whole ancestor chain, the announcer
    // has to live outside #root. Rendered in place it would keep #root itself
    // unhidden behind every dialog — measured, it does exactly that.
    expect(await announcer.evaluate((el) => !!el.closest('#root'))).toBe(false);
  });

  test('cancelling still restores the trigger — the fallback does not hijack the safe path', async ({
    page,
  }) => {
    await setupShrinkingResumeList(page, 2);

    const trigger = page.getByRole('button', { name: /delete/i }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // Nothing was deleted, so the trigger is still there and is still the right
    // target. The fallback is for a destroyed trigger only.
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(2);
    await expect(trigger).toBeFocused();
    await expect(page.locator('body > [aria-live="polite"]')).toHaveText('');
  });
});
