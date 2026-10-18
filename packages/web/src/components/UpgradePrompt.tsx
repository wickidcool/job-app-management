import { useStartCheckout } from '../hooks/useBilling';

interface UpgradePromptProps {
  /** Lead line, bold. Defaults to a generic Pro-gate prompt. */
  title?: string;
  /** Explanatory line under the title. */
  message?: string;
  /** Label for the CTA button. */
  ctaLabel?: string;
  className?: string;
}

/**
 * The Free-gate / quota affordance (WIC-2645 item 5).
 *
 * Rendered in place of a raw error when the API rejects a Pro-only action or a Free
 * user exceeds their monthly quota — detect that case with `isUpgradeRequiredError`
 * (`services/api/billingService`) and swap this in. Starts the same Checkout flow as
 * the settings upgrade CTA via `useStartCheckout`.
 *
 * Deliberately renders no heading element: it is mounted inside other pages, each of
 * which already owns its route `<h1>`, so a heading here would risk a level skip or a
 * duplicate. The lead line is a bold `<p>` inside a `role="status"` region instead.
 */
export function UpgradePrompt({
  title = 'Upgrade to Pro to continue',
  message = "You've reached the limits of the Free plan. Upgrade to Pro for unlimited access.",
  ctaLabel = 'Upgrade to Pro',
  className = '',
}: UpgradePromptProps) {
  const checkout = useStartCheckout();

  return (
    <div
      role="status"
      className={`rounded-lg border border-primary-200 bg-primary-50 p-4 ${className}`.trim()}
    >
      <p className="text-sm font-semibold text-primary-900">{title}</p>
      <p className="mt-1 text-sm text-primary-800">{message}</p>

      {checkout.isError && (
        <p role="alert" className="mt-2 text-sm text-error-700">
          Could not start checkout. Please try again.
        </p>
      )}

      <button
        type="button"
        onClick={() => checkout.mutate()}
        disabled={checkout.isPending}
        className="mt-3 inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-base hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {checkout.isPending ? 'Redirecting…' : ctaLabel}
      </button>
    </div>
  );
}
