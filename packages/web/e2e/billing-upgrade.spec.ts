import { test, expect, type Page } from '@playwright/test';

/**
 * Billing upgrade happy path E2E (WIC-2646, parent WIC-2570) — Stripe test-mode flow.
 *
 * AC (WIC-2646 deliverable 3): a Free user clicks Upgrade → Stripe Checkout →
 * the webhook marks the subscription `trialing`/`active` → the app reflects Pro
 * entitlement.
 *
 * Determinism (the overriding AC): "deterministic — no reliance on live Stripe."
 * So this spec follows the repo's established E2E convention (see
 * `job-fit-analysis.spec.ts`): mock auth + `page.route` interception, no real
 * backend and no network to Stripe. Each seam of the real flow is still exercised
 * against the real frontend code:
 *
 *   1. `GET  /api/billing/subscription` — the read model the page renders from.
 *      Served Free first, then flipped to Pro to stand in for the webhook write.
 *   2. `POST /api/billing/checkout-session` — clicking "Upgrade to Pro" calls this
 *      (`useStartCheckout`). The real handler returns a hosted Stripe URL and the
 *      hook does `window.location.assign(url)`. We return the app's OWN success
 *      return URL (`/settings/billing?checkout=success`, the exact shape
 *      `routes/billing.ts` builds) so the browser lands back on the page exactly
 *      as it would after completing the real hosted Checkout — without leaving the
 *      origin for Stripe.
 *   3. The webhook: simulated by flipping the mocked subscription to `trialing`
 *      when the checkout session is created, so the post-return refetch reads Pro.
 *
 * The live end-to-end with a real test card / trial-no-card path and the Stripe
 * CLI (`stripe listen` / `stripe trigger`) is the human-only pre-go-live smoke
 * documented in `docs/STRIPE_INTEGRATION.md` (WIC-2642) — it needs minted test
 * keys an agent cannot provision and is non-deterministic, so it is deliberately
 * NOT part of this CI suite.
 */

const MOCK_USER = {
  id: 'test-user-001',
  email: 'test@example.com',
};

/** `GET /api/billing/subscription` read model for a brand-new Free user (no row yet). */
const FREE_SUBSCRIPTION = {
  tier: 'free',
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  hasStripeCustomer: false,
};

/** The same read model after the webhook has marked the subscription trialing (→ Pro). */
const PRO_TRIALING_SUBSCRIPTION = {
  tier: 'pro',
  status: 'trialing',
  currentPeriodEnd: '2099-01-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  hasStripeCustomer: true,
};

async function setupMockAuth(page: Page) {
  await page.route('**/api/auth/me', (route) =>
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

test.describe('Billing — Free → Pro upgrade (test mode)', () => {
  // The subscription read model is mutable so a single registered route can model
  // the webhook writing the row mid-flow. Reset per test.
  let subscription: Record<string, unknown> = { ...FREE_SUBSCRIPTION };

  test.beforeEach(async ({ page }) => {
    subscription = { ...FREE_SUBSCRIPTION };
    await setupMockAuth(page);

    await page.route('**/api/billing/subscription', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(subscription),
      })
    );
  });

  test('a Free user upgrades and the app reflects Pro entitlement', async ({ page }) => {
    // Clicking "Upgrade to Pro" POSTs here. Stand in for both the Checkout Session
    // creation AND the webhook: flip the read model to trialing/Pro, then hand back
    // the app's own success-return URL so the browser comes back to the page.
    await page.route('**/api/billing/checkout-session', (route) => {
      subscription = { ...PRO_TRIALING_SUBSCRIPTION };
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: '/settings/billing?checkout=success' }),
      });
    });

    await page.goto('/settings/billing');

    // Starting state: Free, with the upgrade affordance and no manage/portal button.
    await expect(page.getByRole('heading', { level: 1, name: 'Billing & Plan' })).toBeVisible();
    await expect(page.getByText('Free', { exact: true })).toBeVisible();
    const upgradeButton = page.getByRole('button', { name: 'Upgrade to Pro' });
    await expect(upgradeButton).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manage subscription' })).toHaveCount(0);

    // Upgrade → checkout-session → redirect back to the success URL (full navigation).
    await upgradeButton.click();

    // After returning from "Checkout": success banner + Pro entitlement reflected.
    await expect(page).toHaveURL(/\/settings\/billing\?checkout=success/);
    await expect(
      page.getByRole('status').filter({ hasText: 'subscription is set up' })
    ).toBeVisible();
    await expect(page.getByText('Pro', { exact: true })).toBeVisible();
    await expect(page.getByText('Trial', { exact: true })).toBeVisible();

    // The upgrade affordance is gone; the portal affordance appears (hasStripeCustomer).
    await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Manage subscription' })).toBeVisible();
  });

  test('a cancelled checkout leaves the user on Free', async ({ page }) => {
    // The cancel path: the session is created but the user abandons Checkout, so the
    // webhook never fires and the read model stays Free. Return the cancel URL.
    await page.route('**/api/billing/checkout-session', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: '/settings/billing?checkout=cancelled' }),
      })
    );

    await page.goto('/settings/billing');
    await page.getByRole('button', { name: 'Upgrade to Pro' }).click();

    await expect(page).toHaveURL(/\/settings\/billing\?checkout=cancelled/);
    await expect(
      page.getByRole('status').filter({ hasText: 'Checkout was cancelled' })
    ).toBeVisible();
    // Still Free, still offering the upgrade.
    await expect(page.getByText('Free', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
  });
});
