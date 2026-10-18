import { eq, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDb } from '../db/client.js';
import { subscriptions, type Subscription, type SubscriptionStatus } from '../db/schema.js';
import { planTierForStatus } from './entitlement.service.js';
import type { StripeEvent } from './stripe.service.js';

/**
 * The write side of the Careerpin subscriptions table (WIC-2643, parent
 * WIC-2570). The Stripe webhook is the **single writer** of this table; the app
 * only ever reads it (`getEntitlement`). Everything here is keyed by `user_id`
 * (UNIQUE), upserted, and advances the optimistic-lock `version` column on every
 * write.
 */

/**
 * Map a Stripe subscription `status` string onto our closed `subscription_status`
 * enum. Stripe has a wider set than we store; the extras collapse to the nearest
 * **non-pro** state so an unrecognised or in-between status can never accidentally
 * grant Pro:
 *   - `unpaid`, `incomplete` → `past_due` (recoverable, not entitled)
 *   - `incomplete_expired` → `canceled` (terminal)
 *   - anything unknown → `past_due` (fail safe: non-pro)
 */
export function mapStripeSubscriptionStatus(raw: unknown): SubscriptionStatus {
  switch (raw) {
    case 'trialing':
    case 'active':
    case 'past_due':
    case 'paused':
    case 'canceled':
      return raw;
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'past_due';
  }
}

/**
 * A single subscription change to upsert. `status` is always authoritative;
 * every other field is optional, and a field left `undefined` is **preserved**
 * on an existing row rather than overwritten — so a partial event (e.g. an
 * invoice event that knows the status but not the period end) never clobbers
 * data a richer event already stored.
 */
export interface SubscriptionChange {
  userId: string;
  status: SubscriptionStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

/**
 * Upsert the subscription row for a user.
 *
 * Keyed by the UNIQUE `user_id`, so Postgres serialises concurrent webhook
 * deliveries for the same user at the row level and the upsert is atomic. On
 * conflict we advance `version` (`version + 1`) and `updated_at`, matching the
 * repo's optimistic-lock convention — here it is a monotonic write counter rather
 * than a caller-supplied compare-and-set, because the webhook is the only writer
 * and Stripe events carry no version of ours to compare against.
 *
 * Ordering caveat (documented, not handled): Stripe does not guarantee event
 * order, so this is last-write-wins on `status`. The user-visible entitlement is
 * unaffected by minor status churn because `plan_tier` is derived from `status`
 * via {@link planTierForStatus} and both `trialing`/`active` map to `pro`.
 */
export async function upsertSubscription(change: SubscriptionChange): Promise<Subscription> {
  const db = getDb();
  const planTier = planTierForStatus(change.status);

  // The update set always advances status/plan_tier/version/updated_at. Identity
  // and period fields are included only when the event provided them, so an
  // `undefined` leaves the stored value intact.
  const updateSet: Record<string, unknown> = {
    status: change.status,
    planTier,
    version: sql`${subscriptions.version} + 1`,
    updatedAt: new Date(),
  };
  if (change.stripeCustomerId != null) updateSet.stripeCustomerId = change.stripeCustomerId;
  if (change.stripeSubscriptionId != null) {
    updateSet.stripeSubscriptionId = change.stripeSubscriptionId;
  }
  if (change.currentPeriodEnd !== undefined) updateSet.currentPeriodEnd = change.currentPeriodEnd;
  if (change.cancelAtPeriodEnd !== undefined)
    updateSet.cancelAtPeriodEnd = change.cancelAtPeriodEnd;

  const [row] = await db
    .insert(subscriptions)
    .values({
      id: ulid(),
      userId: change.userId,
      stripeCustomerId: change.stripeCustomerId ?? null,
      stripeSubscriptionId: change.stripeSubscriptionId ?? null,
      status: change.status,
      planTier,
      currentPeriodEnd: change.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: change.cancelAtPeriodEnd ?? false,
      version: 1,
    })
    .onConflictDoUpdate({ target: subscriptions.userId, set: updateSet })
    .returning();

  return row;
}

/** Read a user's subscription row, or `null` when they have none. */
export async function getSubscriptionByUser(userId: string): Promise<Subscription | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Reverse-map a Stripe customer id to the user who owns it, using the mapping a
 * prior `checkout.session.completed` / `customer.subscription.*` event stored.
 * Invoice events carry a `customer` but not our `userId`, so this is how they
 * find their owner. Returns `null` when no row references the customer yet.
 */
export async function getUserIdByStripeCustomerId(customerId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);
  return row?.userId ?? null;
}

// ── Event → change mapping ───────────────────────────────────────────────────

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The userId an event carries, if any. Checkout sessions put it in
 * `client_reference_id` and `metadata.userId`; subscription objects carry it in
 * `metadata.userId` because `createCheckoutSession` sets `subscription_data.metadata`.
 */
function resolveUserId(object: Record<string, unknown>): string | undefined {
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  return asString(object.client_reference_id) ?? asString(metadata.userId);
}

/** Stripe seconds-since-epoch → Date, or null when absent. */
function toDate(seconds: unknown): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

/**
 * Apply a verified Stripe event to the subscriptions table.
 *
 * Handles the five lifecycle events the AC names. An event we do not handle, or
 * one we cannot attribute to a user, is a no-op (returns `false`) rather than an
 * error — Stripe sends many event types to one endpoint, and a 2xx with no write
 * is the correct, non-retrying response to an irrelevant or unattributable event.
 * Returns `true` when a row was written.
 */
export async function handleStripeEvent(event: StripeEvent): Promise<boolean> {
  const object = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      // The session that just completed: record the customer/subscription mapping
      // and the initial trialing status. The authoritative status then arrives via
      // the customer.subscription.* events and corrects this if needed.
      const userId = resolveUserId(object);
      if (!userId) return false;
      await upsertSubscription({
        userId,
        status: 'trialing',
        stripeCustomerId: asString(object.customer) ?? null,
        stripeSubscriptionId: asString(object.subscription) ?? null,
      });
      return true;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const userId = resolveUserId(object);
      if (!userId) return false;
      // `deleted` is authoritative-canceled regardless of the object's own status.
      const status =
        event.type === 'customer.subscription.deleted'
          ? 'canceled'
          : mapStripeSubscriptionStatus(object.status);
      await upsertSubscription({
        userId,
        status,
        stripeCustomerId: asString(object.customer) ?? null,
        stripeSubscriptionId: asString(object.id) ?? null,
        currentPeriodEnd: toDate(object.current_period_end),
        cancelAtPeriodEnd:
          typeof object.cancel_at_period_end === 'boolean'
            ? object.cancel_at_period_end
            : undefined,
      });
      return true;
    }

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      // Invoices rarely carry our userId, so fall back to the stored customer
      // mapping. With neither, the event is unattributable → no-op (a user whose
      // checkout/subscription event has not landed yet; the subscription.* events
      // are the reliable mapping source).
      const customerId = asString(object.customer);
      const userId =
        resolveUserId(object) ??
        (customerId ? ((await getUserIdByStripeCustomerId(customerId)) ?? undefined) : undefined);
      if (!userId) return false;
      // `canceled` is terminal for invoice events (WIC-2649 review note). Stripe
      // does not guarantee event order, so a delayed/retried `invoice.paid` can
      // arrive after `customer.subscription.deleted`; without this guard it would
      // resurrect a canceled subscription back to `pro`. A genuine re-subscribe
      // does NOT come through here — it arrives as `customer.subscription.created`
      // (trialing/active), which is handled above and may legitimately move the
      // row off `canceled`. So this guard is scoped to invoice events only.
      const current = await getSubscriptionByUser(userId);
      if (current?.status === 'canceled') return false;
      // Invoice events carry status indirectly: a paid invoice means the plan is
      // active, a failed payment means past_due. They do not carry period/cancel
      // fields, so those are left undefined and preserved.
      const status: SubscriptionStatus = event.type === 'invoice.paid' ? 'active' : 'past_due';
      await upsertSubscription({
        userId,
        status,
        stripeCustomerId: customerId ?? null,
        stripeSubscriptionId: asString(object.subscription) ?? null,
      });
      return true;
    }

    default:
      return false;
  }
}
