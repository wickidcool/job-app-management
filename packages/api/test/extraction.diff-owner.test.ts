/**
 * WIC-1604 AC-3 — `processCatalogChange` must not write an ownerless
 * `catalog_diffs` row.
 *
 * Why refusing is right, rather than writing the row and letting the new NOT
 * NULL constraint reject it: the row was never reachable in the first place.
 * `listDiffs`, `getDiff` and `applyDiff` all scope with
 * `eq(catalogDiffs.userId, caller)`, and NULL equals nothing, so the user whose
 * upload produced the diff could never see it. The only reader that could is one
 * passing no `userId` at all — which applies no owner predicate whatsoever, i.e.
 * the fail-open path WIC-1638 is closing. So this is not "a row we would like to
 * keep, blocked by a constraint"; it is a row with no reader.
 *
 * **Every ownerless assertion here is paired with an owned one on the same
 * fixture.** "No insert happened" passes vacuously whenever the fixture produces
 * no changes at all — an early `return` on `changes.length === 0` would satisfy
 * it just as well as the guard under test. The owned counterpart proves the
 * fixture really does reach the write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client.js';
import { processCatalogChange } from '../src/services/extraction.service.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

const APP_ROW = {
  id: 'app1',
  company: 'Acme Corp',
  status: 'applied',
  jobTitle: 'Engineer',
  location: null,
};

/**
 * The first two reads on the application path are the `applications` row and
 * the `company_catalog` lookup for its company; the later sections (tech stack,
 * job-fit, themes) read too, and are served the empty set so they contribute no
 * changes. Reads are queued positionally and each node is both awaitable and
 * chainable, because the service awaits some `.from()` calls directly and others
 * only after `.where()`.
 */
function stubDb(reads: unknown[][]) {
  const inserted: unknown[] = [];
  let i = 0;
  const node = () => {
    const rows = reads[i++] ?? [];
    const self: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(res, rej),
    };
    for (const m of ['where', 'limit', 'orderBy', 'groupBy']) self[m] = () => self;
    return self;
  };
  const db = {
    select: () => ({ from: () => node() }),
    insert: () => ({
      values: (v: unknown) => {
        inserted.push(v);
        return Promise.resolve();
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<void>) => cb(db),
  };
  vi.mocked(getDb).mockReturnValue(db as never);
  return inserted;
}

const event = (userId?: string) => ({
  sourceType: 'application' as const,
  sourceId: 'app1',
  changeType: 'updated' as const,
  metadata: { rawText: 'Engineer at Acme Corp', ...(userId ? { userId } : {}) },
});

describe('WIC-1604 AC-3 — an ownerless catalog diff is not written', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes an owned diff row — the positive control', async () => {
    const inserted = stubDb([[APP_ROW], []]);

    await processCatalogChange(event(CALLER));

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ userId: CALLER, triggerId: 'app1' });
  });

  it('writes nothing at all when the event carries no owner', async () => {
    const inserted = stubDb([[APP_ROW], []]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await processCatalogChange(event(undefined));

    expect(inserted).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no owner'));
    warn.mockRestore();
  });

  it('never lets a null owner reach the row it used to launder', async () => {
    const inserted = stubDb([[APP_ROW], []]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await processCatalogChange(event(undefined));

    // The specific regression: `userId: userId ?? null`.
    expect(inserted.some((r) => (r as { userId?: unknown }).userId === null)).toBe(false);
  });
});
