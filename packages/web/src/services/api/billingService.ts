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
 * Whether an error is a Pro-gate / Free-quota rejection that should surface an
 * upgrade prompt rather than a raw error (WIC-2645 item 5, gating from WIC-2644).
 *
 * WIC-2644 is the backend that produces this and, at time of writing, is still in
 * progress; its own description specifies "a clear, typed error/affordance (e.g.
 * `402`/entitlement error)" without pinning the final `code`. So this matches on the
 * HTTP status (`402 Payment Required`) first, and falls back to a small set of
 * code spellings an entitlement/quota rejection is likely to carry. Narrow enough
 * not to swallow unrelated failures; forward-compatible with WIC-2644's final choice.
 * Revisit once WIC-2644 lands to pin the exact `code`.
 */
export function isUpgradeRequiredError(error: unknown): error is APIError {
  if (!(error instanceof APIError)) return false;
  if (error.status === 402) return true;
  return /ENTITLEMENT|QUOTA|UPGRADE|PLAN_REQUIRED|PRO_REQUIRED|FREE_LIMIT/i.test(error.code);
}
