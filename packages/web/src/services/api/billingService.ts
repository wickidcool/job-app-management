import type { APIClient } from './apiClient';
import { APIError } from './apiClient';

/** Entitlement band, mirroring the API's `plan_tier` enum. */
export type PlanTier = 'free' | 'pro';

/** Stripe subscription lifecycle, mirroring the API's `subscription_status` enum. */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';

/**
 * The billing read model returned by `GET /api/billing/subscription` (WIC-2645,
 * backed by the WIC-2641/2643 subscriptions table). `status` is `null` for a
 * brand-new Free user with no subscription row yet; `hasStripeCustomer` gates the
 * "Manage subscription" affordance because the portal endpoint 409s without one.
 */
export interface SubscriptionStatusResponse {
  tier: PlanTier;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
}

/** Both checkout and portal endpoints return the hosted Stripe URL to redirect to. */
export interface HostedSessionResponse {
  url: string;
}

/**
 * Billing service (WIC-2645) — the client half of the Stripe test-mode flows.
 *
 * The two session endpoints return a hosted Stripe URL; the caller redirects the
 * browser there (a full-page navigation, not a client route). Redirect flows need
 * no client-side Stripe object, so `VITE_STRIPE_PUBLISHABLE_KEY` is deliberately
 * unused here — it is only needed where Stripe Elements mounts, which this app does
 * not do.
 */
export class BillingService {
  private readonly client: APIClient;

  constructor(client: APIClient) {
    this.client = client;
  }

  /** Current plan state for the billing settings page. */
  async getSubscription(): Promise<SubscriptionStatusResponse> {
    return this.client.get<SubscriptionStatusResponse>('/billing/subscription');
  }

  /** Create a Checkout Session and return its hosted URL (Free → Pro upgrade). */
  async createCheckoutSession(): Promise<HostedSessionResponse> {
    return this.client.post<HostedSessionResponse>('/billing/checkout-session');
  }

  /** Create a Customer Portal session and return its hosted URL (manage/cancel/pause). */
  async createPortalSession(): Promise<HostedSessionResponse> {
    return this.client.post<HostedSessionResponse>('/billing/portal-session');
  }
}

export function createBillingService(client: APIClient): BillingService {
  return new BillingService(client);
}

/**
 * The two entitlement-rejection codes the backend raises (WIC-2644,
 * `services/entitlement-gate.ts`), both as HTTP 402 Payment Required:
 *
 *   - `UPGRADE_REQUIRED`       — a Pro-only feature (job-fit, cover letter, outreach,
 *                                interview prep); `details.feature` names which.
 *   - `VARIANT_QUOTA_EXCEEDED` — the Free monthly resume-variant quota is spent;
 *                                `details` adds `{ limit, used, period }`.
 */
export const UPGRADE_REQUIRED_CODES = ['UPGRADE_REQUIRED', 'VARIANT_QUOTA_EXCEEDED'] as const;

/** The shape the entitlement layer puts in `APIError.details` (WIC-2644). */
export interface UpgradeErrorDetails {
  feature?: string;
  requiredTier?: string;
  limit?: number;
  used?: number;
  period?: string;
}

/**
 * Whether an error is a Pro-gate / Free-quota rejection that should surface an
 * upgrade prompt rather than a raw error (WIC-2645 item 5, gating from WIC-2644).
 *
 * WIC-2644 has now landed and pinned the contract, so this is pinned to it: an
 * `APIError` at HTTP `402` carrying one of {@link UPGRADE_REQUIRED_CODES}. Requiring
 * the 402 status keeps it from misfiring on an unrelated code at another status (the
 * forward-compatible regex this used to carry could), and 402 is the app's only
 * entitlement-rejection status.
 */
export function isUpgradeRequiredError(error: unknown): error is APIError {
  if (!(error instanceof APIError)) return false;
  return error.status === 402 && (UPGRADE_REQUIRED_CODES as readonly string[]).includes(error.code);
}

/** Narrow the untyped `APIError.details` to the entitlement payload (WIC-2644). */
export function upgradeErrorDetails(error: APIError): UpgradeErrorDetails {
  const { details } = error;
  return details && typeof details === 'object' ? (details as UpgradeErrorDetails) : {};
}

/**
 * The copy to show in {@link UpgradePrompt} for an upgrade-required error. Centralised
 * here (rather than per-page) so every gated flow renders the same prompt and so the
 * quota-vs-Pro-gate branch is unit-testable without rendering a page.
 *
 * The quota case spells out `used`/`limit`/`period` from `details`; the Pro-gate case
 * reuses the server message, which already names the gated capability.
 */
export function upgradePromptContent(error: APIError): { title: string; message: string } {
  if (error.code === 'VARIANT_QUOTA_EXCEEDED') {
    const { limit, used, period } = upgradeErrorDetails(error);
    const usage =
      typeof limit === 'number'
        ? `You've used ${used ?? limit} of ${limit} free resume variant generations${
            period ? ` this period (${period})` : ' this month'
          }. `
        : '';
    return {
      title: 'Monthly limit reached',
      message: `${usage}Upgrade to Pro for unlimited resume variant generations.`,
    };
  }
  return {
    title: 'Upgrade to Pro to continue',
    message: error.message || 'This feature is part of Careerpin Pro. Upgrade to continue.',
  };
}
