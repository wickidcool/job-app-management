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
 * Note on the background-hiding test: it asserts the trigger's reachability *and*
 * `#root[aria-hidden="true"]`. The redundancy is deliberate, not a workaround — the two
 * catch different failures. Role queries prove the requirement (nothing behind the modal
 * is reachable by the virtual cursor). `#root[aria-hidden]` proves the mechanism, and it
 * is the only one of the two that catches a stray in-page `[aria-live]` node: that leaves
 * `#root` unhidden while every *sibling* subtree still hides correctly, so the header
 * trigger disappears from the a11y tree exactly as it should and reachability stays green.
 * That silent shape is the WIC-1155 failure class, and `docs/design/ACCESSIBILITY.md`'s
 * keyboard checklist asks for this assertion specifically against an **empty-list** state —
 * which is what `setupProjectsList` builds.
 *
 * The mechanism, since it constrains where this assertion is valid: Radix hides the
 * background via the `aria-hidden` package, which deliberately exempts `[aria-live]`
 * elements and `<script>` (`dist/es2015/index.js` L131-133), and exempting a node keeps its
 * whole ancestor chain. So `#root[aria-hidden]` only holds on a page that renders no
 * in-page live region. Measured on `/projects` at this commit: 0 `[aria-live]` and 0
 * `<script>` inside `#root`, dialog open or closed. `EmptyState` used to carry
 * `aria-live="polite"` and did suppress the attribute app-wide; WIC-1155 (`6435d79`)
 * removed it, and `EmptyState.tsx:71-74` now carries a comment explaining why it must not
 * come back.
 *
 * Two traps if you extend this: assert on `#root`, not on `<main>` — `main` is hidden by
 * being *inside* the hidden subtree and never gets an `aria-hidden` attribute of its own,
 * so asserting on it fails in both worlds. And if a component-local live region is ever
 * added to this page the `#root` assertion will go red; per ACCESSIBILITY.md that is the
 * signal to assert on the specific background subtree instead, not a flake to retry.
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

/**
 * First-run variant: the list starts empty (so `EmptyState` renders its
 * "Create Your First Project" trigger) and turns non-empty after a successful
 * POST, which unmounts that trigger mid-close. That is the WIC-1181 failure
 * class, and it is invisible to every dismissal-path test below because those
 * all drive the header button, which never unmounts.
 */
async function setupFirstRunProjectsList(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: MOCK_USER }),
    })
  );

  const created = {
    id: 'project-001',
    name: 'Acme Corp',
    slug: 'acme-corp',
    description: null,
    fileCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
  };

  // Stateful: GET is empty until the POST lands, then the refetch that
  // `useCreateProject`'s `invalidateQueries` kicks off returns the new project.
  let projects: Array<typeof created> = [];

  await page.route('**/api/projects*', (route) => {
    if (route.request().method() === 'POST') {
      projects = [created];
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects }),
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
  });

  await page.goto('/projects');
  await expect(page.getByRole('button', { name: 'Create Your First Project' })).toBeVisible();
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

    const root = page.locator('#root');
    await expect(root).not.toHaveAttribute('aria-hidden', 'true');

    await openCreateDialogByKeyboard(page);
    await expect(trigger).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);

    // The mechanism behind those two counts, and the half that reachability cannot see:
    // an in-page [aria-live] node exempts its whole ancestor chain, so #root would stay
    // unhidden while the sibling subtree holding `trigger` hid correctly anyway. See the
    // file header; this is the WIC-1155 failure class and ACCESSIBILITY.md asks for it.
    await expect(root).toHaveAttribute('aria-hidden', 'true');

    // The dialog is portalled to <body>, so it is never inside the hidden subtree.
    expect(await page.locator('#root [role="dialog"]').count()).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toHaveCount(1);
    await expect(root).not.toHaveAttribute('aria-hidden', 'true');
  });

  test('create-success keeps focus on the page when the trigger unmounts', async ({ page }) => {
    await setupFirstRunProjectsList(page);

    const emptyStateTrigger = page.getByRole('button', { name: 'Create Your First Project' });
    await emptyStateTrigger.focus();
    await expect(emptyStateTrigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByPlaceholder('e.g., Acme Corp').fill('Acme Corp');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    // The list is no longer empty, so the trigger that opened this dialog is
    // gone from the document.
    await expect(emptyStateTrigger).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Acme Corp/ })).toBeVisible();

    // The actual regression: focus stranded on `<body>` leaves a keyboard user
    // at the top of the document with no announcement of what just happened.
    const landedOnBody = await page.evaluate(
      () => document.activeElement === document.body || document.activeElement === null
    );
    expect(landedOnBody, 'focus fell to <body> after a successful create').toBe(false);

    // It should land on the surviving control for the same action.
    await expect(page.getByRole('button', { name: 'Create Project', exact: true })).toBeFocused();
  });

  test('create-success restores the header trigger, which survives the re-render', async ({
    page,
  }) => {
    await setupFirstRunProjectsList(page);
    const trigger = await openCreateDialogByKeyboard(page);

    await page.getByPlaceholder('e.g., Acme Corp').fill('Acme Corp');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    // Still mounted, so this is the ordinary restore path rather than the
    // fallback — it must not regress while fixing the unmount case.
    await expect(trigger).toBeFocused();
  });
});
