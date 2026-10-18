import { AppError } from '../types/index.js';

/**
 * A dependency-free Stripe client for the Careerpin tiered-signup build
 * (WIC-2643, parent WIC-2570), Stripe **test mode** only.
 *
 * Why no `stripe` npm package: the Worker runs on the Cloudflare edge, where the
 * official SDK must be hand-configured with a fetch HTTP client and a SubtleCrypto
 * provider to work at all. Everything this feature needs — three `POST`s to the
 * REST API and one HMAC signature check — is small, so a thin client over
 * `fetch` + Web Crypto is both lighter and trivially unit-testable (a mocked
 * `fetch`, a locally-computed signature) against the real verification path. The
 * same globals (`fetch`, `crypto.subtle`) exist on Workers, on the Node fallback
 * (Node 18+), and under Vitest, so one implementation covers every runtime.
 */

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/**
 * Default clock-skew tolerance for webhook timestamps, in seconds. Matches the
 * Stripe SDK's `DEFAULT_TOLERANCE` (5 minutes): a signed payload older or newer
 * than this is rejected to blunt replay of a captured request.
 */
const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

/** Raised when the Stripe REST API answers non-2xx. 502 — an upstream fault. */
export class StripeApiError extends AppError {
  constructor(message: string, details?: unknown) {
    super('STRIPE_API_ERROR', message, details, 502);
    this.name = 'StripeApiError';
  }
}

/**
 * Raised when a webhook request is unsigned, malformed, stale, or carries a
 * signature that does not verify. 400 — a client (sender) error, and the status
 * the AC asks the webhook to reject bad/missing signatures with. Never 500: a
 * verification failure is never our bug, and a 5xx would make Stripe retry a
 * request that can never succeed.
 */
export class StripeSignatureError extends AppError {
  constructor(message: string) {
    super('STRIPE_SIGNATURE_INVALID', message, undefined, 400);
    this.name = 'StripeSignatureError';
  }
}

/**
 * Encode a nested params object into `application/x-www-form-urlencoded`, which
 * is the only body format the Stripe API accepts. Nested objects/arrays use
 * Stripe's bracket convention: `a[b]=1`, `a[0][b]=1`. `undefined`/`null` values
 * are dropped so optional fields can be passed through conditionally.
 */
function encodeForm(params: Record<string, unknown>): string {
  const out = new URLSearchParams();

  const walk = (prefix: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(`${prefix}[${k}]`, v);
      }
    } else {
      out.append(prefix, String(value));
    }
  };

  for (const [key, value] of Object.entries(params)) walk(key, value);
  return out.toString();
}

async function stripePost(
  secretKey: string,
  path: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeForm(params),
  });

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  if (!res.ok) {
    const stripeError = (body?.error ?? {}) as { message?: string; type?: string };
    throw new StripeApiError(stripeError.message ?? `Stripe request failed (${res.status})`, {
      status: res.status,
      type: stripeError.type,
    });
  }

  return body ?? {};
}

export interface CheckoutSessionInput {
  secretKey: string;
  priceId: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
  /** Reuse an existing Stripe customer when the user already has one. */
  customerId?: string | null;
  /** Prefill the email when creating a new customer (ignored if `customerId` is set). */
  customerEmail?: string | null;
  trialPeriodDays: number;
}

/**
 * Create a `mode: subscription` Checkout Session and return its hosted-page URL.
 *
 * `payment_method_collection: 'if_required'` means no card is collected for the
 * trial. `client_reference_id` and `metadata.userId` carry our user id into the
 * session; `subscription_data.metadata.userId` carries it onto the subscription
 * object too, so every later `customer.subscription.*` webhook can resolve the
 * owner without a customer-id lookup.
 */
export async function createCheckoutSession(input: CheckoutSessionInput): Promise<string> {
  const params: Record<string, unknown> = {
    mode: 'subscription',
    line_items: [{ price: input.priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: input.trialPeriodDays,
      metadata: { userId: input.userId },
    },
    payment_method_collection: 'if_required',
    client_reference_id: input.userId,
    metadata: { userId: input.userId },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };

  // Stripe rejects `customer` and `customer_email` together, so prefer the known
  // customer and fall back to the email prefill only when we have no customer yet.
  if (input.customerId) {
    params.customer = input.customerId;
  } else if (input.customerEmail) {
    params.customer_email = input.customerEmail;
  }

  const session = await stripePost(input.secretKey, '/checkout/sessions', params);
  const url = session.url;
  if (typeof url !== 'string') {
    throw new StripeApiError('Stripe did not return a Checkout Session URL');
  }
  return url;
}

export interface PortalSessionInput {
  secretKey: string;
  customerId: string;
  returnUrl: string;
}

/** Create a Customer Portal session and return its hosted-page URL. */
export async function createPortalSession(input: PortalSessionInput): Promise<string> {
  const session = await stripePost(input.secretKey, '/billing_portal/sessions', {
    customer: input.customerId,
    return_url: input.returnUrl,
  });
  const url = session.url;
  if (typeof url !== 'string') {
    throw new StripeApiError('Stripe did not return a Customer Portal URL');
  }
  return url;
}

// ── Webhook signature verification ───────────────────────────────────────────

/** A verified Stripe event. `data.object` stays opaque; handlers narrow it. */
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

/**
 * Constant-time equality for two equal-length hex strings. A plain `===` leaks
 * how many leading bytes matched through its early return; folding every char
 * difference into one accumulator removes that timing signal from the compare.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Parse a `Stripe-Signature` header (`t=…,v1=…,v1=…`) into its parts. */
function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1') signatures.push(value);
  }
  return { timestamp, signatures };
}

/**
 * Verify a webhook's `Stripe-Signature` and return the parsed event.
 *
 * Reproduces Stripe's scheme: the signed payload is `${t}.${rawBody}`, HMAC'd
 * with the endpoint's signing secret; the header's `t` must be within
 * `toleranceSeconds` of now, and at least one `v1` entry must match. `rawBody`
 * must be the **exact** bytes received — parse-and-reserialize changes
 * whitespace and breaks the signature, which is why the route reads `c.req.text()`
 * and this never touches `JSON.parse` before verifying.
 *
 * Throws {@link StripeSignatureError} (400) on any failure: missing/blank header,
 * malformed header, a timestamp outside tolerance, or no matching signature.
 */
export async function constructWebhookEvent(
  rawBody: string,
  signatureHeader: string | undefined | null,
  signingSecret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = DEFAULT_SIGNATURE_TOLERANCE_SECONDS
): Promise<StripeEvent> {
  if (!signatureHeader) {
    throw new StripeSignatureError('Missing Stripe-Signature header');
  }

  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new StripeSignatureError('Malformed Stripe-Signature header');
  }

  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new StripeSignatureError('Stripe-Signature timestamp outside tolerance');
  }

  const expected = await hmacSha256Hex(signingSecret, `${timestamp}.${rawBody}`);
  const matches = signatures.some((sig) => timingSafeEqualHex(sig, expected));
  if (!matches) {
    throw new StripeSignatureError('Stripe-Signature does not match payload');
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new StripeSignatureError('Webhook payload is not valid JSON');
  }

  const e = event as Partial<StripeEvent>;
  if (!e || typeof e.type !== 'string' || typeof e.data !== 'object' || e.data === null) {
    throw new StripeSignatureError('Webhook payload is not a Stripe event');
  }
  return e as StripeEvent;
}
