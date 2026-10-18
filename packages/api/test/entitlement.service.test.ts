import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Param, SQL, is } from 'drizzle-orm';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client.js';
import { getEntitlement } from '../src/services/entitlement.service.js';
import type { SubscriptionStatus } from '../src/db/schema.js';

const USER_ID = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

/**
 * Stub the `select().from().where().limit()` chain `getEntitlement` issues, and
 * resolve `.limit()` with the single row the subscription lookup would return
 * (or `[]` for "no subscription row"). Also records the predicate so the test can
 * assert the query is scoped to the requested user.
 */
function stubDb(rows: readonly unknown[]) {
  const where = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  vi.mocked(getDb).mockReturnValue({ select } as never);
  return { select, from, where };
}

/** A subscription row as `getEntitlement` selects it (status only). */
const rowWith = (status: SubscriptionStatus) => [{ status }];

describe('getEntitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a 'trialing' subscription to 'pro'", async () => {
    stubDb(rowWith('trialing'));
    await expect(getEntitlement(USER_ID)).resolves.toBe('pro');
  });

  it("maps an 'active' subscription to 'pro'", async () => {
    stubDb(rowWith('active'));
    await expect(getEntitlement(USER_ID)).resolves.toBe('pro');
  });

  it("maps a 'past_due' subscription to 'free'", async () => {
    stubDb(rowWith('past_due'));
    await expect(getEntitlement(USER_ID)).resolves.toBe('free');
  });

  it("maps a 'paused' subscription to 'free'", async () => {
    stubDb(rowWith('paused'));
    await expect(getEntitlement(USER_ID)).resolves.toBe('free');
  });

  it("maps a 'canceled' subscription to 'free'", async () => {
    stubDb(rowWith('canceled'));
    await expect(getEntitlement(USER_ID)).resolves.toBe('free');
  });

  it("maps an absent subscription row to 'free'", async () => {
    stubDb([]);
    await expect(getEntitlement(USER_ID)).resolves.toBe('free');
  });

  it('scopes the lookup to the requested user', async () => {
    const { where } = stubDb([]);
    await getEntitlement(USER_ID);
    // The predicate is an opaque drizzle SQL object; walk its chunks for the bound
    // param rather than string-matching it, so the assertion survives formatting.
    const condition = where.mock.calls[0][0];
    const params: unknown[] = [];
    const collect = (node: unknown): void => {
      if (is(node, Param)) params.push(node.value);
      else if (is(node, SQL)) node.queryChunks.forEach(collect);
    };
    collect(condition);
    expect(params).toContain(USER_ID);
  });
});
