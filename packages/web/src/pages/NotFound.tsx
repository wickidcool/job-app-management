import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

/**
 * NotFound Page
 *
 * Catch-all for in-app paths that match no route. Without this the router
 * renders `null` and the user gets app chrome wrapped around an empty
 * `<main>` — indistinguishable from a page that is still loading.
 *
 * Shows the path that was not found so a typo can be told apart from a
 * broken link, and offers a way back rather than a dead end.
 */
export function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the heading so screen-reader and keyboard users are told
  // the navigation landed somewhere unexpected instead of silently staying put.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const canGoBack = window.history.length > 1;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 text-6xl opacity-50" aria-hidden="true">
          🧭
        </div>

        <p className="text-body-sm font-semibold uppercase tracking-wide text-neutral-500">
          Error 404
        </p>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 text-3xl font-bold text-neutral-900 focus:outline-none"
        >
          We couldn't find that page
        </h1>

        <p className="mt-3 max-w-md text-body text-neutral-600">
          The link may be out of date, or the address may have a typo. Nothing you tracked has been
          lost — it's just not at this address.
        </p>

        <p className="mt-6 w-full max-w-md break-all rounded-lg border border-neutral-200 bg-neutral-100 px-4 py-3 text-body-sm text-neutral-700">
          <span className="font-medium text-neutral-500">Requested path: </span>
          <code>{location.pathname}</code>
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-6 py-3
                     font-medium text-white transition-colors duration-200
                     hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500
                     focus:ring-offset-2"
          >
            Go to dashboard
          </Link>

          {canGoBack && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center justify-center rounded-lg border border-neutral-300
                       bg-white px-6 py-3 font-medium text-neutral-700 transition-colors duration-200
                       hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-primary-500
                       focus:ring-offset-2"
            >
              Go back
            </button>
          )}
        </div>

        {/* Keyboard hint only — hidden on touch layouts where there is no shortcut. */}
        <p className="mt-8 hidden text-body-sm text-neutral-500 sm:block">
          Looking for something specific? Press{' '}
          <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-700">
            Ctrl+K
          </kbd>{' '}
          (
          <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-700">
            ⌘K
          </kbd>{' '}
          on Mac) to search.
        </p>
      </div>
    </div>
  );
}
