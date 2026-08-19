import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/env.js';

/**
 * Transport + response hardening for the app host (WIC-1011).
 *
 * `app.careerpin.app` is a Workers custom domain, so the zone-level "Always Use HTTPS"
 * redirect that covers the apex and www does not reach it — the Worker is invoked
 * directly on port 80. These two middlewares close that on every request the Worker
 * actually sees (`/api/*`, `/health`, SPA deep links).
 *
 * Requests that the static-asset router answers before the Worker runs (`/`,
 * `/assets/*`, `/favicon.svg`) never reach this code — those are covered by
 * `packages/web/public/_headers`, which the asset router applies at the edge.
 */

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  // 1 year. `preload` is intentionally omitted until the cleartext 301 is verified in
  // prod — preloading an unverified host is not reversible on a useful timescale.
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  // Clickjacking only. A full CSP needs an audit of the Supabase/PostHog/R2 origins the
  // SPA talks to, so it is deliberately scoped to `frame-ancestors` here.
  ['Content-Security-Policy', "frame-ancestors 'none'"],
];

// Loopback dev (`npm run dev:api`, `wrangler dev`, vitest) is plain HTTP by design.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/**
 * Resolve the scheme the *client* used. Cloudflare sets `cf-visitor` at the edge;
 * `x-forwarded-proto` covers proxied Node deployments. The request URL is the last
 * resort because a Worker does not always see the original scheme there.
 */
function clientScheme(c: Parameters<MiddlewareHandler<AppEnv>>[0]): string | null {
  const cfVisitor = c.req.header('cf-visitor');
  if (cfVisitor) {
    const match = /"scheme"\s*:\s*"(https?)"/i.exec(cfVisitor);
    if (match) return match[1].toLowerCase();
  }

  const forwarded = c.req.header('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]!.trim().toLowerCase();

  try {
    return new URL(c.req.url).protocol.replace(':', '').toLowerCase();
  } catch {
    return null;
  }
}

/** 301/308 any cleartext request to the HTTPS equivalent of the same URL. */
export function httpsRedirect(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const url = new URL(c.req.url);
    if (LOCAL_HOSTNAMES.has(url.hostname)) return next();
    if (clientScheme(c) !== 'http') return next();

    // Built by hand rather than mutating `url.protocol` so the scheme is unconditional:
    // a `Location` that is still cleartext is the one failure mode this middleware
    // cannot have. `hostname` (not `host`) drops the port, so an explicit `:80` does not
    // survive into an `https://…:80` target that no listener answers.
    const target = `https://${url.hostname}${url.pathname}${url.search}`;

    // 301 is cacheable and is what browsers/curl expect for a scheme upgrade, but it
    // rewrites the method to GET — anything with a body gets 308 so the retry is intact.
    const method = c.req.method.toUpperCase();
    const status = method === 'GET' || method === 'HEAD' ? 301 : 308;
    return c.redirect(target, status);
  };
}

/** Attach the standard security headers to every Worker-generated response. */
export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();

    const res = c.res;
    if (!res) return;

    try {
      for (const [name, value] of SECURITY_HEADERS) {
        if (!res.headers.has(name)) res.headers.set(name, value);
      }
    } catch {
      // Responses that came out of `fetch()` — notably the ASSETS binding used for the
      // SPA shell — have immutable headers, so rebuild rather than drop the hardening.
      const headers = new Headers(res.headers);
      for (const [name, value] of SECURITY_HEADERS) {
        if (!headers.has(name)) headers.set(name, value);
      }
      c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
  };
}
