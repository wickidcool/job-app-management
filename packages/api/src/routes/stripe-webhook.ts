import { Hono } from 'hono';
import type { AppEnv } from '../types/env.js';
import { AppError } from '../types/index.js';
import { getConfig } from '../config.js';
import { constructWebhookEvent } from '../services/stripe.service.js';
import { handleStripeEvent } from '../services/subscription.service.js';

/**
 * Stripe webhook (WIC-2643, parent WIC-2570) — Stripe **test mode** only.
 *
 * This route is deliberately NOT part of the JWT-guarded `/api` sub-app. It
 * declares its full path (`/api/stripe/webhook`) and is mounted on the top-level
 * app *before* `app.route('/api', api)`, so — exactly like `/api/health` — it
 * wins the match and `authMiddleware` never runs on it. The request is
 * authenticated by its `Stripe-Signature` header instead of a Supabase JWT.
 *
 * It reads the body with `c.req.text()` (the raw received bytes): HMAC
 * verification is over the exact payload, and a `JSON.parse`/reserialize would
 * change whitespace and break the signature. This is what "mounted before JSON
 * body parsing" means in a Hono app, which has no global body parser — the
 * handler simply never calls `c.req.json()` before verifying.
 */
export const stripeWebhookRoutes = new Hono<AppEnv>().post('/api/stripe/webhook', async (c) => {
  const signingSecret = c.env?.STRIPE_WEBHOOK_SECRET ?? getConfig().stripeWebhookSecret;
  if (!signingSecret) {
    throw new AppError('BILLING_NOT_CONFIGURED', 'Billing is not configured', undefined, 503);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature');

  // Throws StripeSignatureError (400) on a missing/malformed/stale/mismatched
  // signature — the AC's "reject bad/missing signatures" path.
  const event = await constructWebhookEvent(rawBody, signature, signingSecret);

  const handled = await handleStripeEvent(event);

  // Always 200 so Stripe stops retrying a delivered event. `handled` reports
  // whether a row was written (an irrelevant or unattributable event is a
  // deliberate no-op, not a failure).
  return c.json({ received: true, handled }, 200);
});
