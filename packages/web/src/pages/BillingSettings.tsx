import { useSearchParams } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { useOpenBillingPortal, useStartCheckout, useSubscription } from '../hooks/useBilling';
import type { SubscriptionStatus } from '../services/api/billingService';

const breadcrumbTrail = [
  { label: 'Dashboard', href: '/', icon: '🏠' },
  { label: 'Settings', href: '/settings' },
  { label: 'Billing & Plan' },
];

/** Human label for each Stripe lifecycle state; unknown values fall back to a title-cased token. */
function statusLabel(status: SubscriptionStatus | null): string {
  switch (status) {
    case 'trialing':
      return 'Trial';
    case 'active':
      return 'Active';
    case 'past_due':
      return 'Past due';
    case 'paused':
      return 'Paused';
    case 'canceled':
      return 'Canceled';
    case null:
    case undefined:
      return 'No subscription';
    default:
      return String(status).replace(/_/g, ' ');
  }
}

/** Tailwind classes for the status badge, keyed to the design system's semantic colors. */
function statusBadgeClasses(status: SubscriptionStatus | null): string {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'bg-success-100 text-success-800';
    case 'past_due':
      return 'bg-warning-100 text-warning-800';
    case 'paused':
      return 'bg-neutral-200 text-neutral-700';
    case 'canceled':
      return 'bg-error-100 text-error-800';
    default:
      return 'bg-neutral-100 text-neutral-600';
  }
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

/**
 * Billing & Plan settings (WIC-2645, parent WIC-2570) — Stripe test mode.
 *
 * Mounted at `/settings/billing`, which is also where the Stripe Checkout success URL
 * and the Customer Portal return URL land (`routes/billing.ts`). Reads the plan state
 * from `GET /api/billing/subscription` and offers the Free → Pro upgrade and the
 * manage-subscription (portal) flows, each a redirect to a hosted Stripe page.
 *
 * The `<h1>` renders above every early return, so the route opens at a single level-1
 * heading on the loading, error and loaded branches alike (route heading-outline rule).
 */
export function BillingSettings() {
  const [searchParams] = useSearchParams();
  const checkoutResult = searchParams.get('checkout');

  const { data, isLoading, error } = useSubscription();
  const startCheckout = useStartCheckout();
  const openPortal = useOpenBillingPortal();

  const isPro = data?.tier === 'pro';
  const periodEnd = formatDate(data?.currentPeriodEnd ?? null);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-neutral-900">Billing &amp; Plan</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Manage your Careerpin subscription, upgrade, or change your plan.
        </p>
      </div>

      {checkoutResult === 'success' && (
        <div role="status" className="mb-6 rounded-md bg-success-50 p-4">
          <p className="text-sm text-success-800">
            Your subscription is set up. It may take a moment to appear below.
          </p>
        </div>
      )}
      {checkoutResult === 'cancelled' && (
        <div role="status" className="mb-6 rounded-md bg-neutral-100 p-4">
          <p className="text-sm text-neutral-700">
            Checkout was cancelled. Your plan has not changed.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-neutral-900">Current plan</h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-8" aria-label="Loading plan">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent"></div>
          </div>
        ) : error ? (
          <p className="text-sm text-error-800">
            We couldn&apos;t load your plan. Please refresh and try again.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold text-neutral-900">
                {isPro ? 'Pro' : 'Free'}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClasses(
                  data?.status ?? null
                )}`}
              >
                {statusLabel(data?.status ?? null)}
              </span>
            </div>

            {periodEnd && (
              <p className="mt-3 text-sm text-neutral-600">
                {data?.cancelAtPeriodEnd
                  ? `Your plan ends on ${periodEnd}.`
                  : `Current period ends on ${periodEnd}.`}
              </p>
            )}
            {data?.status === 'past_due' && (
              <p className="mt-3 text-sm text-warning-800">
                Your last payment did not go through. Update your payment method to keep Pro.
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              {!isPro && (
                <button
                  type="button"
                  onClick={() => startCheckout.mutate()}
                  disabled={startCheckout.isPending}
                  className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-base hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {startCheckout.isPending ? 'Redirecting…' : 'Upgrade to Pro'}
                </button>
              )}

              {data?.hasStripeCustomer && (
                <button
                  type="button"
                  onClick={() => openPortal.mutate()}
                  disabled={openPortal.isPending}
                  className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-base hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {openPortal.isPending ? 'Opening…' : 'Manage subscription'}
                </button>
              )}
            </div>

            {(startCheckout.isError || openPortal.isError) && (
              <p role="alert" className="mt-3 text-sm text-error-700">
                Something went wrong starting that flow. Please try again.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
