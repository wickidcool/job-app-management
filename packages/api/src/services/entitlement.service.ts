import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { subscriptions, type PlanTier, type SubscriptionStatus } from '../db/schema.js';

/**
 * Subscription statuses that grant the paid ("pro") entitlement.
 *
 * `trialing` and `active` are the two Stripe lifecycle states in which the user
 * has a live, paid-for plan — a trial is a paid tier the user has not yet been
 * charged for, and both must unlock pro features. `past_due`, `paused` and
 * `canceled` all mean the paid plan is not currently in force, so they fall back
 * to free. Expressed as a typed set so adding a new `SubscriptionStatus` to the
 * schema forces a conscious decision here rather than silently defaulting to free.
 */
const PRO_STATUSES = new Set<SubscriptionStatus>(['trialing', 'active']);

/**
 * The entitlement band a given subscription `status` grants.
 *
 * Returns `'pro'` iff `status` is in {@link PRO_STATUSES}; otherwise `'free'`.
 * Exported so the Stripe webhook writer (`subscription.service.ts`) derives the
 * stored `plan_tier` column from the same rule `getEntitlement` reads it back
 * with — the two must never disagree, so there is exactly one place that maps
 * lifecycle status to tier.
 */
export function planTierForStatus(status: SubscriptionStatus): PlanTier {
  return PRO_STATUSES.has(status) ? 'pro' : 'free';
}

/**
 * Resolve the entitlement band for a user.
 *
 * Returns `'pro'` iff a `subscriptions` row exists for the user whose `status` is
 * one of {@link PRO_STATUSES}; otherwise `'free'` — including when the user has no
 * subscription row at all. `user_id` is UNIQUE, so at most one row is ever read.
 *
 * Reads the per-request db via `getDb()` (AsyncLocalStorage), the stateless-Worker
 * convention every other service follows — no module-level connection.
 */
export async function getEntitlement(userId: string): Promise<PlanTier> {
  const db = getDb();

  const [row] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  return row ? planTierForStatus(row.status) : 'free';
}
