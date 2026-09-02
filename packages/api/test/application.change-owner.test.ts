import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));
vi.mock('../src/services/change-queue.service.js', () => ({
  enqueueChange: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from '../src/db/client.js';
import { enqueueChange } from '../src/services/change-queue.service.js';
import { createApplication } from '../src/services/application.service.js';

/**
 * WIC-1617, write-side half. `processCatalogChange` reads the owner off
 * `event.metadata.userId`; `resume.service.ts` and `catalog.service.ts` both
 * enqueue that shape, but `application.service.ts` passed no metadata at all —
 * even though `userId` was in scope one line above, where it is written into
 * `status_history`.
 *
 * So every application-triggered extraction ran ownerless, for authenticated
 * callers too. After migration 0017 made `user_id` NOT NULL on the five tables
 * `applyChangeToDb` writes, that meant the auto-apply transaction aborted on a
 * `23502` — which `flush()` swallows into a console.error. The catalog silently
 * stopped ingesting from applications altogether.
 *
 * This is the propagation half; extraction.owner.test.ts covers what
 * `processCatalogChange` does once the owner is (or is not) there.
 */

const OWNER = '11111111-2222-3333-4444-555555555555';

function stubDb() {
  const row = {
    id: 'app-1',
    userId: OWNER,
    jobTitle: 'Engineer',
    company: 'Acme',
    status: 'saved',
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  };
  const tx = {
    insert: () => ({
      values: () =>
        Object.assign(Promise.resolve([row]), { returning: () => Promise.resolve([row]) }),
    }),
  };
  const db = { transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx) };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
}

beforeEach(() => {
  vi.clearAllMocks();
  stubDb();
});

describe('application.service hands the owner to the change queue (WIC-1617)', () => {
  it('passes metadata.userId when creating', async () => {
    await createApplication({ jobTitle: 'Engineer', company: 'Acme' } as any, OWNER);

    expect(enqueueChange).toHaveBeenCalledTimes(1);
    const [sourceType, , changeType, metadata] = vi.mocked(enqueueChange).mock.calls[0];
    expect(sourceType).toBe('application');
    expect(changeType).toBe('created');
    // The bug was a missing 4th argument, so assert on the owner itself rather
    // than on `toHaveBeenCalled()` — which passed against the broken call.
    expect(metadata).toEqual({ userId: OWNER });
  });

  it('passes an explicit null rather than omitting metadata when unauthenticated', async () => {
    await createApplication({ jobTitle: 'Engineer', company: 'Acme' } as any, undefined);

    const metadata = vi.mocked(enqueueChange).mock.calls[0][3];
    // `undefined` metadata is what shipped and is indistinguishable, downstream,
    // from "this event has no owner field" — processCatalogChange must be able
    // to tell the two apart, so the key is always present.
    expect(metadata).toEqual({ userId: null });
  });
});
