import { test, expect, type Page } from '@playwright/test';

/**
 * Modal focus management E2E — `QuickReferenceExport` (WIC-1925).
 *
 * One of the four dialogs `docs/design/MODAL_FOCUS_MANAGEMENT_SPEC.md` §10 listed as
 * consuming `useDialogFocusRestore` with no E2E focus coverage. Parity target is
 * `modal-focus.spec.ts`.
 *
 * This one has a real, stable trigger — the "Export Quick Reference" button in the prep
 * page header — which survives the dialog opening and closing, so the full trigger-restore
 * assertion applies, on both the Escape and the Cancel path.
 *
 * Runs entirely on mocked API responses; no backend required.
 */

const MOCK_USER = { id: 'test-user-001', email: 'test@example.com' };

const APPLICATION = {
  id: 'app-001',
  company: 'Acme Corp',
  jobTitle: 'Staff Engineer',
  status: 'interview',
  interviewDate: '2026-02-01T15:00:00.000Z',
};

/**
 * `relevanceScorePct >= 80` is what puts a story in `topStories` (InterviewPrepPage),
 * so the score here is load-bearing on the dialog rendering any story content at all.
 */
const PREP_RESPONSE = {
  interviewPrep: {
    id: 'prep-001',
    applicationId: 'app-001',
    interviewType: 'behavioral',
    timeAvailable: 'standard',
    focusAreas: ['leadership'],
    completeness: 80,
    stories: [
      {
        id: 'story-1',
        starEntryId: 'Led the migration of the billing service',
        themes: ['leadership'],
        relevanceScorePct: 92,
        oneMinVersion: 'Cut p99 latency by 40% across the billing path.',
        confidenceLevel: 'high',
        isFavorite: true,
        personalNotes: '',
        displayOrder: 1,
      },
    ],
    questions: [
      {
        id: 'q-1',
        text: 'Tell me about a time you led a migration.',
        category: 'behavioral',
        linkedStoryId: 'story-1',
      },
    ],
    gapMitigations: [
      {
        id: 'gap-1',
        skill: 'Kubernetes',
        selectedStrategy: 'growth_mindset',
        strategies: {
          acknowledgePivot: { script: 'I moved into this from a platform role.' },
          growthMindset: { script: 'I have been ramping up on it deliberately.' },
          adjacentExperience: { script: 'I ran the equivalent on ECS.' },
        },
      },
    ],
    practiceLog: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
  },
  application: APPLICATION,
};

async function setupInterviewPrep(page: Page) {
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
    if (url.includes('interview-prep')) return json(PREP_RESPONSE);
    return json({ applications: [], resumes: [], projects: [], exports: [] });
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
  });

  await page.goto('/applications/app-001/prep', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /Export Quick Reference/i })).toBeVisible();
}

/** Focus the header trigger and open the dialog with the keyboard only. */
async function openExportDialogByKeyboard(page: Page) {
  const trigger = page.getByRole('button', { name: /Export Quick Reference/i });
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

test.describe('QuickReferenceExport — focus management', () => {
  test('announces itself as a dialog with an accessible name', async ({ page }) => {
    await setupInterviewPrep(page);
    await openExportDialogByKeyboard(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName('Quick Reference Card');
  });

  test('moves focus into the dialog on open', async ({ page }) => {
    await setupInterviewPrep(page);
    await openExportDialogByKeyboard(page);

    expect(await focusIsInsideDialog(page)).toBe(true);
  });

  test('traps Tab inside the dialog — the prep page behind is never reachable', async ({
    page,
  }) => {
    await setupInterviewPrep(page);
    await openExportDialogByKeyboard(page);

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

  test('Escape closes the dialog and restores focus to the trigger', async ({ page }) => {
    await setupInterviewPrep(page);
    const trigger = await openExportDialogByKeyboard(page);

    // An export must never be a side effect of dismissing the dialog.
    let exportCalled = false;
    await page.route('**/quick-reference**', (route) => {
      exportCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toBeHidden();
    expect(exportCalled).toBe(false);
    await expect(trigger).toBeFocused();
  });

  test('Cancel closes the dialog and restores focus to the trigger', async ({ page }) => {
    await setupInterviewPrep(page);
    const trigger = await openExportDialogByKeyboard(page);

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('the header ✕ closes the dialog and restores focus to the trigger', async ({ page }) => {
    await setupInterviewPrep(page);
    const trigger = await openExportDialogByKeyboard(page);

    // Third dismissal affordance, and the only one routed through `Dialog.Close`
    // rather than the parent's `onClose` — so it exercises a different code path
    // to the Cancel button above, not the same one twice.
    await page.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('locks background scroll while open and releases it on close', async ({ page }) => {
    await setupInterviewPrep(page);

    const bodyOverflow = () => page.evaluate(() => getComputedStyle(document.body).overflow);

    const before = await bodyOverflow();
    await openExportDialogByKeyboard(page);
    expect(await bodyOverflow()).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await bodyOverflow()).toBe(before);
  });

  test('hides the page behind the dialog from the screen-reader virtual cursor', async ({
    page,
  }) => {
    await setupInterviewPrep(page);
    await openExportDialogByKeyboard(page);

    const background = page.locator('#root');
    await expect(background).toHaveAttribute('aria-hidden', 'true');
    // The dialog must be outside the hidden subtree, or this would hide it from
    // the user too.
    expect(await background.locator('[role="dialog"]').count()).toBe(0);
    // Radix's `aria-hidden` exempts [aria-live] and <script> and keeps their whole
    // ancestor chain unhidden, so the assertion above is only meaningful while this
    // page renders neither inside #root. Measured, not assumed.
    expect(
      await page.evaluate(() => document.querySelectorAll('#root [aria-live], #root script').length)
    ).toBe(0);

    // ...and the page comes back once the dialog closes.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(background).not.toHaveAttribute('aria-hidden', 'true');
  });

  test('the trigger survives a close, so the dialog can be reopened from the keyboard', async ({
    page,
  }) => {
    await setupInterviewPrep(page);
    const trigger = await openExportDialogByKeyboard(page);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // Focus is already back on the trigger, so Enter alone must reopen it. This is
    // the user-visible payoff of the restore: without it the user is on <body> and
    // has to Tab back through the page to reach the control they just used.
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveAccessibleName('Quick Reference Card');
  });
});
