import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/env.js';

/**
 * Transport + response hardening for the app host (WIC-1011).
 *
 * Cleartext delivery of `app.careerpin.app` is closed at the zone: `Always Use HTTPS`
 * was enabled on the `careerpin.app` zone under WIC-1014, so the edge answers `:80` with
 * a `301` before the Worker is invoked. `httpsRedirect()` is the defence-in-depth layer
 * behind it — it keeps the guarantee if the zone setting is ever toggled off, and covers
 * any non-zone route (workers.dev, a proxied Node deployment) that the setting misses.
 *
 * Requests that the static-asset router answers before the Worker runs (`/`,
 * `/assets/*`, `/favicon.svg`) never reach this code — those are covered by
 * `packages/web/public/_headers`, which the asset router applies at the edge, and by the
 * zone redirect above. Note that HSTS emitted over cleartext is ignored by browsers
 * (RFC 6797 §8.1), which is exactly why the zone-level `301` was required.
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
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

// Suffixes that can only name a development/internal host, never a public one.
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.home.arpa'];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Hostnames that must never be upgraded to HTTPS, because nothing is listening on :443
 * there and the redirect would simply break the request (WIC-1013 follow-up 1):
 * loopback, RFC1918 / link-local literals, `*.local`-style dev suffixes, and dotless
 * names — a bare `api` or `web` is a container/service name, not a routable host.
 */
function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(host)) return true;
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  const v4 = IPV4.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10) literals.
  const v6 = host.replace(/^\[|\]$/g, '');
  if (/^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6)) return true;

  // Dotless => not a public DNS name (container/service name, `.` search-domain host).
  return !host.includes('.');
}

/** `x-forwarded-proto` is only honoured behind a proxy the operator has opted into. */
function trustsProxyProto(c: Parameters<MiddlewareHandler<AppEnv>>[0]): boolean {
  const raw =
    (c.env?.TRUST_PROXY_PROTO as string | undefined) ?? process.env.TRUST_PROXY_PROTO ?? '';
  return raw.toLowerCase() === 'true' || raw === '1';
}

/**
 * Resolve the scheme the *client* used. Cloudflare sets `cf-visitor` at the edge, which
 * is the only source that is authoritative here. `x-forwarded-proto` is client-settable
 * unless a trusted proxy overwrites it — an attacker-supplied `x-forwarded-proto: https`
 * on a cleartext request would otherwise suppress the redirect — so it is opt-in via
 * `TRUST_PROXY_PROTO` (WIC-1013 follow-up 2). The request URL is the last resort because
 * a Worker does not always see the original scheme there.
 */
function clientScheme(c: Parameters<MiddlewareHandler<AppEnv>>[0]): string | null {
  const cfVisitor = c.req.header('cf-visitor');
  if (cfVisitor) {
    const match = /"scheme"\s*:\s*"(https?)"/i.exec(cfVisitor);
    if (match) return match[1].toLowerCase();
  }

  if (trustsProxyProto(c)) {
    const forwarded = c.req.header('x-forwarded-proto');
    if (forwarded) return forwarded.split(',')[0]!.trim().toLowerCase();
  }

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
    if (isPrivateHostname(url.hostname)) return next();
    if (clientScheme(c) !== 'http') return next();

    // Built by hand rather than mutating `url.protocol`. The WHATWG setter does handle
    // `http:` -> `https:` (it is only a no-op across the special/non-special boundary),
    // but building the string makes the scheme unconditional and independent of URL
    // parser behaviour — a `Location` that is still cleartext is the one failure mode
    // this middleware cannot have. `hostname` (not `host`) drops the port, so an
    // explicit `:80` does not survive into an `https://…:80` target nothing answers.
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
