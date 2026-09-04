import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isHyperdriveTimeout,
  isSubrequestExhaustion,
  HYPERDRIVE_TIMEOUT_MSG,
  SUBREQUEST_LIMIT_MSG,
} from '../src/db/hyperdrive.js';

/**
 * The production error, verbatim from `wrangler tail jobtrail` during a live
 * failing request. Reproducible unauthenticated at GET /health, which reports
 * it as the `db` field of a 503.
 */
const PROD_ERROR =
  'Too many subrequests by single Worker invocation. To configure this limit, ' +
  'refer to https://developers.cloudflare.com/workers/wrangler/configuration/#limits';

vi.mock('../src/services/application.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/application.service.js')>()),
  createApplication: vi.fn(),
  getApplication: vi.fn(),
  listApplications: vi.fn(),
  updateApplication: vi.fn(),
  deleteApplication: vi.fn(),
  updateApplicationStatus: vi.fn(),
}));
vi.mock('../src/services/dashboard.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/dashboard.service.js')>()),
  getDashboardStats: vi.fn(),
}));

import * as appService from '../src/services/application.service.js';

describe('subrequest exhaustion classifier', () => {
  it('recognises the error Cloudflare actually raises', () => {
    expect(isSubrequestExhaustion(new Error(PROD_ERROR))).toBe(true);
  });

  it('does not confuse it with the retryable Hyperdrive timeout', () => {
    expect(isSubrequestExhaustion(new Error(HYPERDRIVE_TIMEOUT_MSG))).toBe(false);
    expect(isHyperdriveTimeout(new Error(PROD_ERROR))).toBe(false);
  });

  it('ignores ordinary application errors and non-Errors', () => {
    expect(isSubrequestExhaustion(new Error('relation "users" does not exist'))).toBe(false);
    expect(isSubrequestExhaustion(SUBREQUEST_LIMIT_MSG)).toBe(false);
    expect(isSubrequestExhaustion(undefined)).toBe(false);
  });
});

/**
 * End-to-end through the real app: a DB-backed route fails to connect, and the
 * question is what the caller is told. Before this change `app.onError` absorbed
 * the exhaustion into `INTERNAL_ERROR` 500, which is why every endpoint returned
 * an indistinguishable 500 while the actual fault was availability.
 */
describe('worker fetch handler under subrequest exhaustion', () => {
  let worker: { fetch: (r: Request, e: never, c: never) => Promise<Response> };

  const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

  beforeEach(async () => {
    vi.clearAllMocks();
    worker = (await import('../src/worker.js')).default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function get(path = '/api/applications') {
    return worker.fetch(new Request(`https://jobtrail.example${path}`), {} as never, CTX);
  }

  it('answers 503 rather than an opaque 500', async () => {
    vi.mocked(appService.listApplications).mockRejectedValue(new Error(PROD_ERROR));

    const res = await get();

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.error.code).not.toBe('INTERNAL_ERROR');
    expect(body.error.message).toMatch(/connection budget/);
  });

  it('sets a Retry-After that reflects an exhausted budget, not a blip', async () => {
    vi.mocked(appService.listApplications).mockRejectedValue(new Error(PROD_ERROR));

    expect((await get()).headers.get('Retry-After')).toBe('5');
  });

  it('does not retry — the budget does not refill mid-invocation', async () => {
    vi.mocked(appService.listApplications).mockRejectedValue(new Error(PROD_ERROR));

    await get();

    expect(appService.listApplications).toHaveBeenCalledTimes(1);
  });

  it('still retries a Hyperdrive timeout, which is transient', async () => {
    vi.mocked(appService.listApplications).mockRejectedValue(new Error(HYPERDRIVE_TIMEOUT_MSG));

    const res = await get();

    expect(appService.listApplications).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('1');
  });

  it('leaves ordinary route failures reported as 500', async () => {
    vi.mocked(appService.listApplications).mockRejectedValue(new Error('column does not exist'));

    const res = await get();

    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR');
    expect(appService.listApplications).toHaveBeenCalledTimes(1);
  });
});
