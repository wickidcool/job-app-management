import { describe, expect, it } from 'vitest';

import { APIError } from './apiClient';
import {
  isUpgradeRequiredError,
  upgradeErrorDetails,
  upgradePromptContent,
} from './billingService';

/**
 * WIC-2655 — the predicate and copy helper that drive the gated-feature upgrade
 * affordance (UpgradePrompt) across the five generate flows.
 *
 * `isUpgradeRequiredError` is pinned to the WIC-2644 contract: an `APIError` at HTTP
 * 402 carrying one of the two entitlement codes. These assertions guard the two
 * failure directions that matter — it must fire on the real rejections, and it must
 * NOT swallow an ordinary failure that merely happens to mention a quota.
 */
describe('isUpgradeRequiredError (WIC-2655)', () => {
  it('is true for the Pro-gate rejection (UPGRADE_REQUIRED @ 402)', () => {
    const err = new APIError('UPGRADE_REQUIRED', 'Cover letters are a Pro feature.', 402, {
      feature: 'cover_letter',
      requiredTier: 'pro',
    });
    expect(isUpgradeRequiredError(err)).toBe(true);
  });

  it('is true for the quota rejection (VARIANT_QUOTA_EXCEEDED @ 402)', () => {
    const err = new APIError('VARIANT_QUOTA_EXCEEDED', 'Monthly limit reached.', 402, {
      feature: 'resume_variant_generation',
      requiredTier: 'pro',
      limit: 3,
      used: 3,
      period: '2026-10',
    });
    expect(isUpgradeRequiredError(err)).toBe(true);
  });

  it('is false for a non-APIError value', () => {
    expect(isUpgradeRequiredError(new Error('UPGRADE_REQUIRED'))).toBe(false);
    expect(isUpgradeRequiredError(null)).toBe(false);
    expect(isUpgradeRequiredError({ status: 402, code: 'UPGRADE_REQUIRED' })).toBe(false);
  });

  it('is false for a 402 carrying an unknown code — the pin, not the old regex', () => {
    // The old predicate matched any 402; the contract is now the explicit two codes.
    expect(isUpgradeRequiredError(new APIError('PAYMENT_FAILED', 'nope', 402))).toBe(false);
  });

  it('is false for the right code at the wrong status — status is the gate', () => {
    // A 400 that merely spells "QUOTA" must not be mistaken for an entitlement gate.
    expect(isUpgradeRequiredError(new APIError('QUOTA_SOMETHING', 'bad input', 400))).toBe(false);
    expect(isUpgradeRequiredError(new APIError('UPGRADE_REQUIRED', 'x', 400))).toBe(false);
  });
});

describe('upgradeErrorDetails (WIC-2655)', () => {
  it('returns the typed entitlement payload', () => {
    const err = new APIError('VARIANT_QUOTA_EXCEEDED', 'x', 402, {
      limit: 3,
      used: 3,
      period: '2026-10',
    });
    expect(upgradeErrorDetails(err)).toMatchObject({ limit: 3, used: 3, period: '2026-10' });
  });

  it('returns an empty object when details are absent', () => {
    expect(upgradeErrorDetails(new APIError('UPGRADE_REQUIRED', 'x', 402))).toEqual({});
  });
});

describe('upgradePromptContent (WIC-2655)', () => {
  it('spells out used/limit/period for the quota case', () => {
    const err = new APIError('VARIANT_QUOTA_EXCEEDED', 'server message', 402, {
      limit: 3,
      used: 3,
      period: '2026-10',
    });
    const { title, message } = upgradePromptContent(err);
    expect(title).toBe('Monthly limit reached');
    expect(message).toContain('3 of 3');
    expect(message).toContain('2026-10');
    expect(message).toContain('Upgrade to Pro');
  });

  it('reuses the server message for the Pro-gate case', () => {
    const err = new APIError('UPGRADE_REQUIRED', 'AI job-fit analysis is a Pro feature.', 402, {
      feature: 'ai_job_fit',
      requiredTier: 'pro',
    });
    const { title, message } = upgradePromptContent(err);
    expect(title).toBe('Upgrade to Pro to continue');
    expect(message).toBe('AI job-fit analysis is a Pro feature.');
  });
});
