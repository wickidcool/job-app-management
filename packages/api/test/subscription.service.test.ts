/**
 * WIC-2643 — the Stripe webhook's write side, exercised against a **real
 * migrated Postgres** (PGlite, the project's own migrations including
 * `0027_subscriptions.sql`) rather than a mocked drizzle chain. The upsert, the
 * `version` increment, the status→plan_tier derivation, the partial-event
 * preserve semantics, and the customer-id reverse lookup are all behaviours of
 * the SQL, so only a real database proves them.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createMigratedDb } from './helpers/pglite-db.js';
import type { StripeEvent } from '../src/services/stripe.service.js';

const harness: { db: Awaited<ReturnType<typeof createMigratedDb>>['db'] } = { db: null as never };

vi.mock('../src/db/client.js', () => ({ getDb: () => harness.db }));

import {
  handleStripeEvent,
  upsertSubscription,
  getSubscriptionByUser,
  getUserIdByStripeCustomerId,
  mapStripeSubscriptionStatus,
} from '../src/services/subscription.service.js';
import { getEntitlement } from '../src/services/entitlement.service.js';

const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const CUSTOMER = 'cus_test_123';
const SUBSCRIPTION = 'sub_test_123';

let client: Awaited<ReturnType<typeof createMigratedDb>>['client'];

beforeAll(async () => {
  const made = await createMigratedDb();
  client = made.client;
  harness.db = made.db;
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await harness.db.execute(sql`DELETE FROM subscriptions`);
  await harness.db.execute(
    sql`INSERT INTO auth.users (id) VALUES (${USER}) ON CONFLICT DO NOTHING`
  );
});

function event(type: string, object: Record<string, unknown>): StripeEvent {
  return { id: `evt_${type}`, type, data: { object } };
}

describe('mapStripeSubscriptionStatus', () => {
  it('passes through the five stored statuses', () => {
    for (const s of ['trialing', 'active', 'past_due', 'paused', 'canceled'] as const) {
      expect(mapStripeSubscriptionStatus(s)).toBe(s);
    }
  });

  it('collapses unpaid/incomplete to past_due and incomplete_expired to canceled', () => {
    expect(mapStripeSubscriptionStatus('unpaid')).toBe('past_due');
    expect(mapStripeSubscriptionStatus('incomplete')).toBe('past_due');
    expect(mapStripeSubscriptionStatus('incomplete_expired')).toBe('canceled');
  });

  it('fails safe (non-pro) on an unknown status', () => {
    expect(mapStripeSubscriptionStatus('something_new')).toBe('past_due');
    expect(mapStripeSubscriptionStatus(undefined)).toBe('past_due');
  });
});

describe('upsertSubscription', () => {
  it('inserts a new row at version 1 with plan_tier derived from status', async () => {
    const row = await upsertSubscription({ userId: USER, status: 'trialing' });
    expect(row.version).toBe(1);
    expect(row.planTier).toBe('pro');
    expect(await getEntitlement(USER)).toBe('pro');
  });

  it('advances version on every subsequent write for the same user', async () => {
    await upsertSubscription({ userId: USER, status: 'trialing' });
    const second = await upsertSubscription({ userId: USER, status: 'active' });
    expect(second.version).toBe(2);
    const third = await upsertSubscription({ userId: USER, status: 'past_due' });
    expect(third.version).toBe(3);
    expect(third.planTier).toBe('free');
  });

  it('preserves fields a later partial event omits', async () => {
    const periodEnd = new Date('2027-01-01T00:00:00Z');
    await upsertSubscription({
      userId: USER,
      status: 'active',
      stripeCustomerId: CUSTOMER,
      stripeSubscriptionId: SUBSCRIPTION,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: true,
    });
    // A later event that only knows the status must not wipe customer/period/cancel.
    await upsertSubscription({ userId: USER, status: 'past_due' });
    const row = await getSubscriptionByUser(USER);
    expect(row?.status).toBe('past_due');
    expect(row?.stripeCustomerId).toBe(CUSTOMER);
    expect(row?.stripeSubscriptionId).toBe(SUBSCRIPTION);
    expect(row?.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString());
    expect(row?.cancelAtPeriodEnd).toBe(true);
  });
});

describe('getUserIdByStripeCustomerId', () => {
  it('reverse-maps a stored customer id to its user', async () => {
    await upsertSubscription({ userId: USER, status: 'trialing', stripeCustomerId: CUSTOMER });
    expect(await getUserIdByStripeCustomerId(CUSTOMER)).toBe(USER);
    expect(await getUserIdByStripeCustomerId('cus_unknown')).toBeNull();
  });
});

describe('handleStripeEvent', () => {
  it('checkout.session.completed records the mapping as trialing/pro', async () => {
    const handled = await handleStripeEvent(
      event('checkout.session.completed', {
        client_reference_id: USER,
        customer: CUSTOMER,
        subscription: SUBSCRIPTION,
      })
    );
    expect(handled).toBe(true);
    const row = await getSubscriptionByUser(USER);
    expect(row?.status).toBe('trialing');
    expect(row?.stripeCustomerId).toBe(CUSTOMER);
    expect(row?.stripeSubscriptionId).toBe(SUBSCRIPTION);
    expect(await getEntitlement(USER)).toBe('pro');
  });

  it('customer.subscription.updated resolves the user from subscription metadata', async () => {
    await handleStripeEvent(
      event('customer.subscription.updated', {
        id: SUBSCRIPTION,
        customer: CUSTOMER,
        status: 'active',
        current_period_end: 1800000000,
        cancel_at_period_end: false,
        metadata: { userId: USER },
      })
    );
    const row = await getSubscriptionByUser(USER);
    expect(row?.status).toBe('active');
    expect(row?.planTier).toBe('pro');
    expect(row?.currentPeriodEnd).toBeInstanceOf(Date);
  });

  it('customer.subscription.deleted forces canceled/free regardless of object status', async () => {
    await upsertSubscription({ userId: USER, status: 'active', stripeCustomerId: CUSTOMER });
    await handleStripeEvent(
      event('customer.subscription.deleted', {
        id: SUBSCRIPTION,
        customer: CUSTOMER,
        status: 'active', // Stripe can report active on the deleted object; we override.
        metadata: { userId: USER },
      })
    );
    const row = await getSubscriptionByUser(USER);
    expect(row?.status).toBe('canceled');
    expect(await getEntitlement(USER)).toBe('free');
  });

  it('invoice.payment_failed resolves the user by the stored customer mapping → past_due', async () => {
    // Seed the customer mapping first (invoice events carry no userId).
    await upsertSubscription({ userId: USER, status: 'active', stripeCustomerId: CUSTOMER });
    const handled = await handleStripeEvent(
      event('invoice.payment_failed', { customer: CUSTOMER, subscription: SUBSCRIPTION })
    );
    expect(handled).toBe(true);
    const row = await getSubscriptionByUser(USER);
    expect(row?.status).toBe('past_due');
    expect(await getEntitlement(USER)).toBe('free');
  });

  it('invoice.paid resolves by customer mapping → active/pro', async () => {
    await upsertSubscription({ userId: USER, status: 'past_due', stripeCustomerId: CUSTOMER });
    await handleStripeEvent(event('invoice.paid', { customer: CUSTOMER }));
    const row = await getSubscriptionByUser(USER);
    expect(row?.status).toBe('active');
    expect(await getEntitlement(USER)).toBe('pro');
  });

  it('is a no-op for an unhandled event type', async () => {
    const handled = await handleStripeEvent(event('customer.created', { id: CUSTOMER }));
    expect(handled).toBe(false);
    expect(await getSubscriptionByUser(USER)).toBeNull();
  });

  it('is a no-op for an unattributable event (no userId, no known customer)', async () => {
    const handled = await handleStripeEvent(event('invoice.paid', { customer: 'cus_never_seen' }));
    expect(handled).toBe(false);
    expect(await getSubscriptionByUser(USER)).toBeNull();
  });
});
