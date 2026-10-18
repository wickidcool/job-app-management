import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Param, SQL, is } from 'drizzle-orm';

// Mock the two collaborators the gate reaches through: entitlement resolution
// (the plan lookup) and the db client (the monthly usage counter). This keeps the
// suite a pure unit over the gating logic, with no real subscription or usage row.
vi.mock('../src/services/entitlement.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/entitlement.service.js')>()),
  getEntitlement: vi.fn(),
}));
vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getEntitlement } from '../src/services/entitlement.service.js';
import { getDb } from '../src/db/client.js';
import {
  assertProEntitlement,
  assertVariantQuotaAvailable,
  recordVariantGeneration,
  currentUsagePeriod,
  FREE_MONTHLY_VARIANT_QUOTA,
} from '../src/services/entitlement-gate.js';
import { EntitlementError } from '../src/types/index.js';
import type { PlanTier } from '../src/db/schema.js';

const USER_ID = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

const asTier = (tier: PlanTier) => vi.mocked(getEntitlement).mockResolvedValue(tier);

/**
 * Stub the `select().from().where().limit()` chain the quota read issues and
 * resolve `.limit()` with the usage row (or `[]` for "no row this month yet").
 * Returns `where` so a test can assert the predicate was bound to a given period.
 */
function stubUsageCount(rows: readonly unknown[]) {
  const where = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  vi.mocked(getDb).mockReturnValue({ select } as never);
  return { select, where };
}

/** Collect the bound param values out of an opaque drizzle predicate. */
function boundParams(condition: unknown): unknown[] {
  const params: unknown[] = [];
  const collect = (node: unknown): void => {
    if (is(node, Param)) params.push(node.value);
    else if (is(node, SQL)) node.queryChunks.forEach(collect);
  };
  collect(condition);
  return params;
}

describe('currentUsagePeriod', () => {
  it('formats the UTC year and zero-padded month', () => {
    expect(currentUsagePeriod(new Date('2026-03-07T12:00:00Z'))).toBe('2026-03');
    expect(currentUsagePeriod(new Date('2026-11-30T23:59:59Z'))).toBe('2026-11');
  });

  it('buckets by UTC, so an instant late in a month-end day lands in that month', () => {
    // 2026-10-31T23:30-04:00 is 2026-11-01T03:30Z — November by UTC.
    expect(currentUsagePeriod(new Date('2026-10-31T23:30:00-04:00'))).toBe('2026-11');
  });
});

describe('assertProEntitlement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes a Pro user through silently', async () => {
    asTier('pro');
    await expect(assertProEntitlement(USER_ID, 'ai_job_fit')).resolves.toBeUndefined();
  });

  it('rejects a Free user with a 402 UPGRADE_REQUIRED naming the feature', async () => {
    asTier('free');
    const err = await assertProEntitlement(USER_ID, 'cover_letter').catch((e) => e);
    expect(err).toBeInstanceOf(EntitlementError);
    expect(err.statusCode).toBe(402);
    expect(err.code).toBe('UPGRADE_REQUIRED');
    expect(err.details).toMatchObject({ feature: 'cover_letter', requiredTier: 'pro' });
  });
});

describe('assertVariantQuotaAvailable — Free monthly quota boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows the 3rd generation of the month (2 already used)', async () => {
    asTier('free');
    stubUsageCount([{ count: FREE_MONTHLY_VARIANT_QUOTA - 1 }]); // used = 2
    await expect(assertVariantQuotaAvailable(USER_ID)).resolves.toBeUndefined();
  });

  it('blocks the 4th generation of the month (3 already used)', async () => {
    asTier('free');
    stubUsageCount([{ count: FREE_MONTHLY_VARIANT_QUOTA }]); // used = 3
    const err = await assertVariantQuotaAvailable(USER_ID).catch((e) => e);
    expect(err).toBeInstanceOf(EntitlementError);
    expect(err.statusCode).toBe(402);
    expect(err.code).toBe('VARIANT_QUOTA_EXCEEDED');
    expect(err.details).toMatchObject({
      limit: FREE_MONTHLY_VARIANT_QUOTA,
      used: FREE_MONTHLY_VARIANT_QUOTA,
      requiredTier: 'pro',
    });
  });

  it('allows a Free user who has never generated this month (no usage row)', async () => {
    asTier('free');
    stubUsageCount([]); // used = 0
    await expect(assertVariantQuotaAvailable(USER_ID)).resolves.toBeUndefined();
  });

  it('a Pro user is unlimited and never even reads the counter', async () => {
    asTier('pro');
    await expect(assertVariantQuotaAvailable(USER_ID)).resolves.toBeUndefined();
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe('assertVariantQuotaAvailable — the quota resets next month', () => {
  afterEach(() => vi.useRealTimers());

  it('blocks in the month that is full, then allows in the next month', async () => {
    asTier('free');

    // October, full: the stored row for this period is at the limit → blocked.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T10:00:00Z'));
    const oct = stubUsageCount([{ count: FREE_MONTHLY_VARIANT_QUOTA }]);
    await expect(assertVariantQuotaAvailable(USER_ID)).rejects.toBeInstanceOf(EntitlementError);
    expect(boundParams(oct.where.mock.calls[0][0])).toContain('2026-10');

    // November: a new period, whose row does not exist yet → allowed. The read is
    // scoped to the NEW month key, which is what makes the reset automatic.
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    const nov = stubUsageCount([]);
    await expect(assertVariantQuotaAvailable(USER_ID)).resolves.toBeUndefined();
    expect(boundParams(nov.where.mock.calls[0][0])).toContain('2026-11');
  });
});

describe('recordVariantGeneration', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('upserts the current-month counter (insert + onConflictDoUpdate)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T10:00:00Z'));

    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    vi.mocked(getDb).mockReturnValue({ insert } as never);

    await expect(recordVariantGeneration(USER_ID)).resolves.toBeUndefined();

    expect(values).toHaveBeenCalledTimes(1);
    const inserted = values.mock.calls[0][0];
    expect(inserted).toMatchObject({ userId: USER_ID, period: '2026-10', count: 1 });
    expect(typeof inserted.id).toBe('string');
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });
});
