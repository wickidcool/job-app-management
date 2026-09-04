import { test, expect, type Page } from '@playwright/test';

/**
 * Modal focus management E2E — `DiffReviewModal` (WIC-1925).
 *
 * One of the four dialogs `docs/design/MODAL_FOCUS_MANAGEMENT_SPEC.md` §10 listed as
 * consuming `useDialogFocusRestore` with no E2E focus coverage. Parity target is
 * `modal-focus.spec.ts`.
 *
 * Trigger shape worth knowing before you edit this: the click handler is on the diff
 * *card* (`CatalogBrowseView`, `onClick={() => handleDiffClick(diff)}`), and the visible
 * "Review Changes" button inside it carries no handler of its own — the click bubbles.
 * The card is a plain `<div>` with no `tabIndex`, so the button is the only focusable
 * thing in it and therefore the element the hook captures as the trigger. That is what
 * makes the keyboard path below (focus the button, press Enter) both the realistic user
 * journey and the one that exercises the restore.
 *
 * Runs entirely on mocked API responses; no backend required.
 */

const MOCK_USER = { id: 'test-user-001', email: 'test@example.com' };

/**
 * `data` is required, not decorative: `ChangeListItem` renders a `create` change with
 * `Object.entries(change.data)`, which throws on an undefined value and blanks the page.
 */
const DIFF = {
  id: 'diff-001',
  sourceType: 'resume' as const,
  sourceId: 'resume-001',
  createdAt: '2026-01-01T00:00:00.000Z',
  summary: {
    summary: 'Found 2 new companies and 1 updated tag.',
    newCount: 2,
    updatedCount: 1,
    deletedCount: 0,
    pendingReviewCount: 0,
  },
  changes: [
    {
      id: 'chg-1',
      entity: 'company',
      action: 'create' as const,
      data: { name: 'Acme Corp', industry: 'Fintech' },
      sourceId: 'resume-001',
      sourceName: 'senior-engineer-resume.pdf',
      selected: false,
    },
  ],
  pendingReviews: [],
};

async function setupCatalogWithDiff(page: Page) {
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
    if (url.includes('/catalog/diffs')) return json({ diffs: [DIFF] });
    // The other catalog tabs are queried on mount; an undefined body makes TanStack
    // Query throw ("Query data cannot be undefined") rather than render an empty tab.
    if (url.includes('/catalog/')) return json({ items: [], nextCursor: undefined });
    return json({ applications: [], resumes: [], projects: [], exports: [] });
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
  });

  await page.goto('/catalog', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Review Changes' })).toBeVisible();
}

/** Focus the Review Changes trigger and open the dialog with the keyboard only. */
async function openDiffDialogByKeyboard(page: Page) {
  const trigger = page.getByRole('button', { name: 'Review Changes' });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  return trigger;
}

async function focusIsInsideDialog(page: Page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const el = document.activeElement;
    return !!(el && dlg && dlg.contains(el) && el !== dlg);
  });
}

test.describe('DiffReviewModal — focus management', () => {
  test('announces itself as a dialog with an accessible name', async ({ page }) => {
    await setupCatalogWithDiff(page);
    await openDiffDialogByKeyboard(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName('Catalog Change Review');
  });

  test('moves focus into the dialog on open', async ({ page }) => {
    await setupCatalogWithDiff(page);
    await openDiffDialogByKeyboard(page);

    expect(await focusIsInsideDialog(page)).toBe(true);
  });

  test('traps Tab inside the dialog — the catalog behind is never reachable', async ({ page }) => {
    await setupCatalogWithDiff(page);
    await openDiffDialogByKeyboard(page);

    for (let i = 0; i < 12; i++) {
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

  test('Escape closes the dialog, applies nothing, and restores focus to the trigger', async ({
    page,
  }) => {
    await setupCatalogWithDiff(page);
    const trigger = await openDiffDialogByKeyboard(page);

    // Dismissing a change review must never be a silent accept.
    let applyCalled = false;
    await page.route('**/catalog/diffs/*/apply', (route) => {
      applyCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, appliedCount: 0 }),
      });
    });

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toBeHidden();
    expect(applyCalled).toBe(false);
    await expect(trigger).toBeFocused();
  });

  test('Cancel closes the dialog and restores focus to the trigger', async ({ page }) => {
    await setupCatalogWithDiff(page);
    const trigger = await openDiffDialogByKeyboard(page);

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('the header ✕ closes the dialog and restores focus to the trigger', async ({ page }) => {
    await setupCatalogWithDiff(page);
    const trigger = await openDiffDialogByKeyboard(page);

    await page.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('locks background scroll while open and releases it on close', async ({ page }) => {
    await setupCatalogWithDiff(page);

    const bodyOverflow = () => page.evaluate(() => getComputedStyle(document.body).overflow);

    const before = await bodyOverflow();
    await openDiffDialogByKeyboard(page);
    expect(await bodyOverflow()).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await bodyOverflow()).toBe(before);
  });

  test('hides the page behind the dialog from the screen-reader virtual cursor', async ({
    page,
  }) => {
    await setupCatalogWithDiff(page);
    await openDiffDialogByKeyboard(page);

    const background = page.locator('#root');
    await expect(background).toHaveAttribute('aria-hidden', 'true');
    expect(await background.locator('[role="dialog"]').count()).toBe(0);
    // Radix's `aria-hidden` exempts [aria-live] and <script> and keeps their whole
    // ancestor chain unhidden, so the assertion above is only meaningful while this
    // page renders neither inside #root. Measured, not assumed.
    expect(
      await page.evaluate(() => document.querySelectorAll('#root [aria-live], #root script').length)
    ).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(background).not.toHaveAttribute('aria-hidden', 'true');
  });

  test('the trigger survives a close, so the dialog can be reopened from the keyboard', async ({
    page,
  }) => {
    await setupCatalogWithDiff(page);
    const trigger = await openDiffDialogByKeyboard(page);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveAccessibleName('Catalog Change Review');
  });
});
