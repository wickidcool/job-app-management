import { and, eq, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDb } from '../db/client.js';
import { variantUsage } from '../db/schema.js';
import { EntitlementError } from '../types/index.js';
import { getEntitlement } from './entitlement.service.js';

/**
 * The entitlement enforcement layer for the Careerpin tiered plans (WIC-2644,
 * parent WIC-2570). It sits between the routes and the feature services: a route
 * resolves its owner, asks the relevant guard here whether the plan covers the
 * action, and only then calls the service. Keeping it in one module is what lets
 * route tests mock the *gate* (pro-bypass) without reaching for the DB, while the
 * feature services stay unaware of billing.
 *
 * Every decision reads live entitlement through `getEntitlement(userId)` — there
 * are no hardcoded user lists and nothing is cached across requests (AC: "gating
 * reads entitlement per request").
 */

/**
 * Free-plan allowance of resume-variant *generations* per calendar month, from
 * the live pricing page (`packages/marketing/pricing.html`: "3 variant
 * generations per month"). Pro is unlimited and never consults the counter.
 */
export const FREE_MONTHLY_VARIANT_QUOTA = 3;

/**
 * Human labels for the Pro-only features, keyed by the stable `feature` code that
 * also travels in the error `details` so the frontend can branch per feature.
 */
const PRO_FEATURE_LABELS: Record<string, string> = {
  ai_job_fit: 'AI job-fit analysis',
  cover_letter: 'Cover letter generation',
  outreach_message: 'Outreach message generation',
  interview_prep: 'Interview prep notes',
};

/**
 * The UTC calendar-month key (`YYYY-MM`) a usage row is bucketed under.
 *
 * UTC, not local: the quota must reset on the same instant for every user
 * regardless of where the Worker edge node ran, and the stored `period` must be
 * stable across requests. `getUTCMonth()` is 0-based, hence the `+ 1`.
 */
export function currentUsagePeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Reject a Free user reaching a Pro-only feature; a Pro user passes silently.
 *
 * `feature` is the stable code (a key of {@link PRO_FEATURE_LABELS}); it is echoed
 * in `details.feature` so the upgrade CTA can name the capability that was gated.
 */
export async function assertProEntitlement(userId: string, feature: string): Promise<void> {
  const tier = await getEntitlement(userId);
  if (tier === 'pro') return;

  const label = PRO_FEATURE_LABELS[feature] ?? 'This feature';
  throw new EntitlementError(
    'UPGRADE_REQUIRED',
    `${label} is a Pro feature. Upgrade to continue.`,
    {
      feature,
      requiredTier: 'pro',
    }
  );
}

/**
 * Current-month variant-generation count for a user (0 when no row exists yet).
 */
async function getVariantUsageCount(userId: string, period: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: variantUsage.count })
    .from(variantUsage)
    .where(and(eq(variantUsage.userId, userId), eq(variantUsage.period, period)))
    .limit(1);
  return row?.count ?? 0;
}

/**
 * Reject a Free user who has already used this month's variant-generation quota;
 * a Pro user passes without even reading the counter.
 *
 * Called *before* generation so no variant is created when the request is denied.
 * The read-then-generate-then-record sequence is not transactional across the
 * three; a rare concurrent burst could let one extra generation through, which is
 * an acceptable over-grant for a soft plan quota and never under-grants.
 */
export async function assertVariantQuotaAvailable(userId: string): Promise<void> {
  const tier = await getEntitlement(userId);
  if (tier === 'pro') return;

  const period = currentUsagePeriod();
  const used = await getVariantUsageCount(userId, period);
  if (used >= FREE_MONTHLY_VARIANT_QUOTA) {
    throw new EntitlementError(
      'VARIANT_QUOTA_EXCEEDED',
      `Free plan is limited to ${FREE_MONTHLY_VARIANT_QUOTA} resume variant generations per month. Upgrade to Pro for unlimited generations.`,
      {
        feature: 'resume_variant_generation',
        requiredTier: 'pro',
        limit: FREE_MONTHLY_VARIANT_QUOTA,
        used,
        period,
      }
    );
  }
}

/**
 * Record one successful variant generation against the user's current-month
 * counter, creating the month's row on first use and incrementing it thereafter.
 *
 * Counted for every tier so the row is a truthful "generations this month" figure
 * (and a Pro→Free downgrade mid-month lands on the real count rather than zero).
 * The increment is a single atomic upsert on the `(user_id, period)` unique index,
 * so concurrent generations cannot lose a count.
 */
export async function recordVariantGeneration(userId: string): Promise<void> {
  const db = getDb();
  const period = currentUsagePeriod();
  await db
    .insert(variantUsage)
    .values({ id: ulid(), userId, period, count: 1 })
    .onConflictDoUpdate({
      target: [variantUsage.userId, variantUsage.period],
      set: { count: sql`${variantUsage.count} + 1`, updatedAt: sql`now()` },
    });
}
