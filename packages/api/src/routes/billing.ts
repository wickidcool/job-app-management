import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../types/env.js';
import { AppError } from '../types/index.js';
import { getConfig } from '../config.js';
import { createCheckoutSession, createPortalSession } from '../services/stripe.service.js';
import { getSubscriptionByUser } from '../services/subscription.service.js';

/**
 * Billing routes (WIC-2643, parent WIC-2570) — Stripe **test mode** only.
 *
 * Both endpoints are mounted inside the JWT-guarded `/api` sub-app, so a valid
 * Supabase token is required and the caller's id comes from `c.get('userId')`.
 * The Stripe webhook is the opposite — signature-authenticated and mounted
 * outside this guard (see `routes/stripe-webhook.ts`).
 */

const TRIAL_PERIOD_DAYS = 14;

/** The user's id, guaranteed non-empty behind `authMiddleware`. */
function requireUserId(c: Context<AppEnv>): string {
  const userId = c.get('userId');
  if (!userId) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', undefined, 401);
  }
  return userId;
}

/**
 * Resolve the Stripe secret key from the request env (edge binding) with a
 * `getConfig()` fallback (Node/`process.env`), the repo's standard dual-read.
 * Throws 503 when billing is not configured so the frontend can degrade rather
 * than see a 500.
 */
function requireStripeSecretKey(c: Context<AppEnv>): string {
  const key = c.env?.STRIPE_SECRET_KEY ?? getConfig().stripeSecretKey;
  if (!key) {
    throw new AppError('BILLING_NOT_CONFIGURED', 'Billing is not configured', undefined, 503);
  }
  return key;
}

export const billingRoutes = new Hono<AppEnv>()
  /**
   * POST /api/billing/checkout-session
   * Create a Stripe Checkout Session (subscription, 14-day trial, no card for
   * the trial) and return its hosted-page URL.
   */
  .post('/billing/checkout-session', async (c) => {
    const userId = requireUserId(c);
    const secretKey = requireStripeSecretKey(c);
    const priceId = c.env?.STRIPE_PRICE_PRO ?? getConfig().stripePricePro;
    if (!priceId) {
      throw new AppError('BILLING_NOT_CONFIGURED', 'Billing is not configured', undefined, 503);
    }

    // Reuse the user's existing Stripe customer when we already have one, so a
    // returning user is not duplicated in Stripe.
    const existing = await getSubscriptionByUser(userId);
    const origin = new URL(c.req.url).origin;

    const url = await createCheckoutSession({
      secretKey,
      priceId,
      userId,
      customerId: existing?.stripeCustomerId ?? null,
      customerEmail: c.get('userEmail') ?? null,
      trialPeriodDays: TRIAL_PERIOD_DAYS,
      successUrl: `${origin}/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/pricing?checkout=cancelled`,
    });

    return c.json({ url }, 200);
  })

  /**
   * POST /api/billing/portal-session
   * Create a Stripe Customer Portal session for the user's stored customer and
   * return its hosted-page URL. Backs the pricing page's "pause anytime /
   * manage / cancel" promise.
   */
  .post('/billing/portal-session', async (c) => {
    const userId = requireUserId(c);
    const secretKey = requireStripeSecretKey(c);

    const existing = await getSubscriptionByUser(userId);
    if (!existing?.stripeCustomerId) {
      throw new AppError(
        'NO_BILLING_CUSTOMER',
        'No Stripe customer exists for this user yet. Start a subscription first.',
        undefined,
        409
      );
    }

    const origin = new URL(c.req.url).origin;
    const url = await createPortalSession({
      secretKey,
      customerId: existing.stripeCustomerId,
      returnUrl: `${origin}/settings/billing`,
    });

    return c.json({ url }, 200);
  });
