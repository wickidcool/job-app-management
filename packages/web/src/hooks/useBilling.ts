import { useMutation, useQuery } from '@tanstack/react-query';
import { billingService } from '../services/api';
import type { SubscriptionStatusResponse } from '../services/api/billingService';

/**
 * Billing hooks (WIC-2645).
 *
 * `useSubscription` reads the current plan state. `useStartCheckout` and
 * `useOpenBillingPortal` each create a hosted Stripe session and then redirect the
 * whole browser to the returned URL — so their `mutationFn` resolves to `void` and
 * navigation happens as a side effect, which is why they are mutations (an action),
 * not queries.
 */
export const billingKeys = {
  all: ['billing'] as const,
  subscription: () => [...billingKeys.all, 'subscription'] as const,
};

/** Fetch the user's current plan state. */
export function useSubscription() {
  return useQuery<SubscriptionStatusResponse>({
    queryKey: billingKeys.subscription(),
    queryFn: () => billingService.getSubscription(),
  });
}

/**
 * Redirect the browser to a hosted Stripe URL. Extracted so both flows share one
 * navigation, and so it is the single place a test can stub. `assign` (not
 * `href =`) keeps the current page in history, so the browser Back button returns
 * the user here rather than skipping past the app.
 */
function redirectTo(url: string): void {
  window.location.assign(url);
}

/** Start the Free → Pro Checkout flow and redirect to Stripe Checkout. */
export function useStartCheckout() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await billingService.createCheckoutSession();
      redirectTo(url);
    },
  });
}

/** Open the Stripe Customer Portal (manage / cancel / pause) and redirect to it. */
export function useOpenBillingPortal() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await billingService.createPortalSession();
      redirectTo(url);
    },
  });
}
