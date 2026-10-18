import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildAuthedApp, resetAuthEnv, type AuthedApp } from './helpers/authed-app.js';

// Mock the gate so a test can make it reject, proving two things the unit suite
// cannot: that the routes actually call the gate, and that a thrown
// EntitlementError is mapped to HTTP 402 by the central error handler. The gate
// throws before the feature service runs, so no service or DB is reached.
vi.mock('../src/services/entitlement-gate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/entitlement-gate.js')>()),
  assertProEntitlement: vi.fn(),
  assertVariantQuotaAvailable: vi.fn(),
  recordVariantGeneration: vi.fn(),
}));

import {
  assertProEntitlement,
  assertVariantQuotaAvailable,
} from '../src/services/entitlement-gate.js';
import { EntitlementError } from '../src/types/index.js';

describe('entitlement gate wiring → HTTP 402', () => {
  let app: AuthedApp;

  beforeEach(async () => {
    app = await buildAuthedApp();
    vi.clearAllMocks();
  });

  afterEach(() => resetAuthEnv());

  it('resume-variants/generate returns 402 VARIANT_QUOTA_EXCEEDED when the quota gate rejects', async () => {
    vi.mocked(assertVariantQuotaAvailable).mockRejectedValueOnce(
      new EntitlementError('VARIANT_QUOTA_EXCEEDED', 'quota reached', {
        requiredTier: 'pro',
        limit: 3,
        used: 3,
      })
    );

    const res = await app.request('/api/resume-variants/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: { code: 'VARIANT_QUOTA_EXCEEDED', details: { requiredTier: 'pro' } },
    });
  });

  it('cover-letters/generate returns 402 UPGRADE_REQUIRED when the Pro gate rejects', async () => {
    vi.mocked(assertProEntitlement).mockRejectedValueOnce(
      new EntitlementError('UPGRADE_REQUIRED', 'Pro only', {
        feature: 'cover_letter',
        requiredTier: 'pro',
      })
    );

    const res = await app.request('/api/cover-letters/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedStarEntryIds: ['01HZ_STAR_1'] }),
    });

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: { code: 'UPGRADE_REQUIRED', details: { feature: 'cover_letter' } },
    });
  });
});
