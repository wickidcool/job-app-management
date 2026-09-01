import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useReportRouteUnmatched } from '../contexts/RouteMatchContext';
import { useCommandPalette } from '../contexts/CommandPaletteContext';
import { NOT_FOUND_COPY as COPY } from './NotFound.copy';

/** Longest path we will render before eliding the middle. */
const MAX_PATH_CHARS = 120;

function elidePath(path: string): string {
  if (path.length <= MAX_PATH_CHARS) return path;
  const head = Math.ceil((MAX_PATH_CHARS - 1) / 2);
  const tail = Math.floor((MAX_PATH_CHARS - 1) / 2);
  return `${path.slice(0, head)}…${path.slice(path.length - tail)}`;
}

/**
 * NotFound Page
 *
 * Catch-all for in-app paths that match no route. Without this the router
 * renders `null` and the user gets app chrome wrapped around an empty
 * `<main>` — indistinguishable from a page that is still loading.
 *
 * Shows the path that was not found so a typo can be told apart from a
 * broken link, and offers one unambiguous way out.
 */
export function NotFound() {
  const location = useLocation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { openPalette } = useCommandPalette();

  // Tell the navigation chrome that this path matched nothing, so it stops marking
  // a tab (and an `aria-current="page"`) as the page you are on while this page
  // says the page was not found. The router is the only thing that knows.
  useReportRouteUnmatched();

  // Move focus to the heading so screen-reader and keyboard users are told
  // the navigation landed somewhere unexpected instead of silently staying put.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        {/*
          Deliberately an inline SVG rather than the emoji-as-illustration used
          by `EmptyState`. Emoji are rendered by the host OS: they vary between
          platforms and are simply absent on some, which is a poor trade on the
          one screen a user reaches when something has already gone wrong.
          Matches the outline-icon style already used in TopNavigation.
        */}
        <svg
          className="mb-5 h-14 w-14 text-neutral-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z"
          />
        </svg>

        <p className="text-body-sm font-semibold uppercase tracking-wide text-neutral-600">
          {COPY.eyebrow}
        </p>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 text-3xl font-bold text-neutral-900 focus:outline-none"
        >
          {COPY.heading}
        </h1>

        <p className="mt-3 max-w-md text-body text-neutral-600">{COPY.body}</p>

        {/*
          Exactly one *primary* action, and no `navigate(-1)`: §2.1 (decided in
          WIC-1105) objected to a back affordance because the dominant arrival is a
          click on a stale link elsewhere, so "back" returns the user to the page
          holding it — a loop. That objection is about reversing the navigation, and
          it still stands.

          The search button is not that. It moves the user forward, and it exists
          because the keyboard hint below is `sm:`-only by necessity — there is no
          Ctrl+K on a phone — which left touch users with a single affordance on the
          one screen where "I know the company, the URL is just stale" is the common
          case (WIC-1053). Secondary styling keeps the primary action dominant.
        */}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-6 py-3
                     font-medium text-white transition-colors duration-200
                     hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500
                     focus:ring-offset-2"
          >
            {COPY.primaryAction}
          </Link>

          <button
            type="button"
            onClick={openPalette}
            className="inline-flex items-center justify-center rounded-lg border border-neutral-300
                     bg-white px-6 py-3 font-medium text-neutral-700 transition-colors duration-200
                     hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-primary-500
                     focus:ring-offset-2"
          >
            {COPY.searchAction}
          </button>
        </div>

        {/*
          The same control as the button above, by keyboard. Hidden on touch layouts,
          where the shortcut does not exist and printing it would be a dead
          instruction — which is exactly why the button has to render at every
          breakpoint rather than only below `sm`.
        */}
        <p className="mt-8 hidden text-body-sm text-neutral-600 sm:block">
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

        {/*
          Kept, but demoted below the actions: this is the one element that lets
          a user tell "I typed this wrong" from "this app is broken", which is
          exactly the signal the old blank page destroyed. It is diagnostic
          rather than directive, so it should not sit in the path to the buttons.
        */}
        <p className="mt-8 max-w-md text-caption text-neutral-600">
          <span>{COPY.pathLabel} </span>
          <code className="break-all font-mono text-neutral-700" title={location.pathname}>
            {elidePath(location.pathname)}
          </code>
        </p>
      </div>
    </div>
  );
}
