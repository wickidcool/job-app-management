import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  constructWebhookEvent,
  createCheckoutSession,
  createPortalSession,
  StripeSignatureError,
  StripeApiError,
} from '../src/services/stripe.service.js';

const SECRET = 'whsec_test_secret_key';

/** Reproduce Stripe's signed-payload HMAC so the test exercises the real verify. */
function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function header(timestamp: number, signature: string): string {
  return `t=${timestamp},v1=${signature}`;
}

const EVENT_BODY = JSON.stringify({
  id: 'evt_1',
  type: 'customer.subscription.updated',
  data: { object: { id: 'sub_1', status: 'active' } },
});

describe('constructWebhookEvent — signature verification', () => {
  const NOW = 1_700_000_000;

  it('accepts a correctly-signed, fresh payload and returns the parsed event', async () => {
    const h = header(NOW, sign(SECRET, NOW, EVENT_BODY));
    const event = await constructWebhookEvent(EVENT_BODY, h, SECRET, NOW);
    expect(event.type).toBe('customer.subscription.updated');
    expect((event.data.object as { status: string }).status).toBe('active');
  });

  it('accepts when any one of several v1 signatures matches', async () => {
    const good = sign(SECRET, NOW, EVENT_BODY);
    const h = `t=${NOW},v1=deadbeef,v1=${good}`;
    await expect(constructWebhookEvent(EVENT_BODY, h, SECRET, NOW)).resolves.toBeTruthy();
  });

  it('rejects a missing signature header (400)', async () => {
    await expect(constructWebhookEvent(EVENT_BODY, undefined, SECRET, NOW)).rejects.toBeInstanceOf(
      StripeSignatureError
    );
    await expect(constructWebhookEvent(EVENT_BODY, undefined, SECRET, NOW)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects a malformed header with no t or v1', async () => {
    await expect(
      constructWebhookEvent(EVENT_BODY, 'not-a-signature', SECRET, NOW)
    ).rejects.toBeInstanceOf(StripeSignatureError);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const h = header(NOW, sign('whsec_WRONG', NOW, EVENT_BODY));
    await expect(constructWebhookEvent(EVENT_BODY, h, SECRET, NOW)).rejects.toBeInstanceOf(
      StripeSignatureError
    );
  });

  it('rejects a tampered body (signature no longer matches)', async () => {
    const h = header(NOW, sign(SECRET, NOW, EVENT_BODY));
    const tampered = EVENT_BODY.replace('active', 'canceled');
    await expect(constructWebhookEvent(tampered, h, SECRET, NOW)).rejects.toBeInstanceOf(
      StripeSignatureError
    );
  });

  it('rejects a timestamp outside the tolerance window', async () => {
    const old = NOW - 301; // just past the 300s default tolerance
    const h = header(old, sign(SECRET, old, EVENT_BODY));
    await expect(constructWebhookEvent(EVENT_BODY, h, SECRET, NOW)).rejects.toBeInstanceOf(
      StripeSignatureError
    );
  });

  it('accepts a timestamp at the edge of the tolerance window', async () => {
    const edge = NOW - 300;
    const h = header(edge, sign(SECRET, edge, EVENT_BODY));
    await expect(constructWebhookEvent(EVENT_BODY, h, SECRET, NOW)).resolves.toBeTruthy();
  });

  it('rejects a correctly-signed payload that is not valid JSON', async () => {
    const body = 'definitely not json';
    const h = header(NOW, sign(SECRET, NOW, body));
    await expect(constructWebhookEvent(body, h, SECRET, NOW)).rejects.toBeInstanceOf(
      StripeSignatureError
    );
  });
});

describe('Stripe REST client (mocked fetch)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('createCheckoutSession posts a subscription session and returns the URL', async () => {
    const fetchMock = stubFetch(200, { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });

    const url = await createCheckoutSession({
      secretKey: 'sk_test_x',
      priceId: 'price_pro',
      userId: 'user-123',
      customerEmail: 'a@b.test',
      trialPeriodDays: 14,
      successUrl: 'https://app.test/ok',
      cancelUrl: 'https://app.test/cancel',
    });

    expect(url).toBe('https://checkout.stripe.com/c/cs_1');
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://api.stripe.com/v1/checkout/sessions');
    const body = (init as RequestInit).body as string;
    expect(body).toContain('mode=subscription');
    expect(body).toContain(encodeURIComponent('line_items[0][price]') + '=price_pro');
    expect(body).toContain(encodeURIComponent('subscription_data[trial_period_days]') + '=14');
    expect(body).toContain('payment_method_collection=if_required');
    expect(body).toContain('client_reference_id=user-123');
    expect(body).toContain(encodeURIComponent('metadata[userId]') + '=user-123');
    expect(body).toContain(encodeURIComponent('subscription_data[metadata][userId]') + '=user-123');
    // No existing customer → email prefill, and no `customer` field.
    expect(body).toContain('customer_email=' + encodeURIComponent('a@b.test'));
    expect(body).not.toContain('customer=');
  });

  it('createCheckoutSession prefers an existing customer over the email prefill', async () => {
    const fetchMock = stubFetch(200, { url: 'https://checkout.stripe.com/c/cs_2' });
    await createCheckoutSession({
      secretKey: 'sk_test_x',
      priceId: 'price_pro',
      userId: 'user-123',
      customerId: 'cus_existing',
      customerEmail: 'a@b.test',
      trialPeriodDays: 14,
      successUrl: 'https://app.test/ok',
      cancelUrl: 'https://app.test/cancel',
    });
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain('customer=cus_existing');
    expect(body).not.toContain('customer_email=');
  });

  it('createPortalSession posts the customer + return_url and returns the URL', async () => {
    const fetchMock = stubFetch(200, { url: 'https://billing.stripe.com/p/session_1' });
    const url = await createPortalSession({
      secretKey: 'sk_test_x',
      customerId: 'cus_1',
      returnUrl: 'https://app.test/settings/billing',
    });
    expect(url).toBe('https://billing.stripe.com/p/session_1');
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://api.stripe.com/v1/billing_portal/sessions');
    const body = (init as RequestInit).body as string;
    expect(body).toContain('customer=cus_1');
    expect(body).toContain('return_url=' + encodeURIComponent('https://app.test/settings/billing'));
  });

  it('throws StripeApiError (502) when Stripe answers non-2xx', async () => {
    stubFetch(400, { error: { message: 'No such price', type: 'invalid_request_error' } });
    await expect(
      createPortalSession({
        secretKey: 'sk_test_x',
        customerId: 'cus_1',
        returnUrl: 'https://x.test',
      })
    ).rejects.toBeInstanceOf(StripeApiError);
  });
});
