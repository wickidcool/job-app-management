import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

/**
 * WIC-2189 — query-parameter contract for the `interview_date` range filter.
 *
 * The companion file proves the SQL. This one proves the validation boundary in
 * front of it, which is where the UTC-midnight hazard the create/update schemas
 * document at `routes/applications.ts:54-57` arrives through a query string: a
 * date-only bound parses happily as a `Date` and silently means UTC midnight, so
 * the schema has to reject it rather than the service having to guess.
 */

vi.mock('../src/services/application.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/application.service.js')>()),
  listApplications: vi.fn(),
}));

import * as appService from '../src/services/application.service.js';

describe('WIC-2189 — GET /api/applications interview-date query params', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    vi.mocked(appService.listApplications).mockResolvedValue({
      applications: [],
      totalCount: 0,
    });
  });

  const get = (qs: string) => app.request(`/api/applications${qs}`, { method: 'GET' });

  it('passes well-formed offset-bearing bounds through to the service', async () => {
    const res = await get(
      '?interviewDateFrom=2026-09-01T00%3A00%3A00.000Z&interviewDateTo=2026-09-30T23%3A59%3A59.000Z'
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(appService.listApplications).mock.calls[0][0]).toMatchObject({
      interviewDateFrom: '2026-09-01T00:00:00.000Z',
      interviewDateTo: '2026-09-30T23:59:59.000Z',
    });
  });

  it('accepts a non-UTC offset, preserving the instant the caller meant', async () => {
    const res = await get('?interviewDateFrom=2026-09-01T09%3A00%3A00%2B02%3A00');

    expect(res.status).toBe(200);
    expect(vi.mocked(appService.listApplications).mock.calls[0][0]).toMatchObject({
      interviewDateFrom: '2026-09-01T09:00:00+02:00',
    });
  });

  it('rejects a date-only bound — the UTC-midnight hazard, arriving via the query string', async () => {
    // `2026-09-01` would be accepted by `new Date(...)` and read as UTC
    // midnight, quietly shifting the window a day for callers west of
    // Greenwich. The regex `nextActionDue` uses would have admitted it; the
    // `datetime({ offset: true })` contract is what makes this a 400.
    const res = await get('?interviewDateFrom=2026-09-01');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(appService.listApplications).not.toHaveBeenCalled();
  });

  it('rejects a datetime with no offset at all', async () => {
    const res = await get('?interviewDateTo=2026-09-01T12%3A00%3A00');

    expect(res.status).toBe(400);
    expect(appService.listApplications).not.toHaveBeenCalled();
  });

  it('rejects an inverted range loudly rather than returning a silent empty page', async () => {
    // Left to the database this is a well-formed query that matches nothing,
    // which the caller cannot tell apart from "no interviews scheduled".
    const res = await get(
      '?interviewDateFrom=2026-09-30T00%3A00%3A00.000Z&interviewDateTo=2026-09-01T00%3A00%3A00.000Z'
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(appService.listApplications).not.toHaveBeenCalled();
  });

  it('accepts an equal from/to pair — the degenerate range is a valid point query', async () => {
    const at = '2026-09-15T13%3A30%3A00.000Z';
    const res = await get(`?interviewDateFrom=${at}&interviewDateTo=${at}`);

    expect(res.status).toBe(200);
  });

  it('treats an empty bound as absent, matching the sibling fields', async () => {
    // `?interviewDateFrom=` is what an unfilled form control serialises to.
    const res = await get('?interviewDateFrom=&interviewDateTo=');

    expect(res.status).toBe(200);
    const params = vi.mocked(appService.listApplications).mock.calls[0][0];
    expect(params.interviewDateFrom).toBeUndefined();
    expect(params.interviewDateTo).toBeUndefined();
  });

  it('accepts sortBy=interviewDate and forwards it', async () => {
    const res = await get('?sortBy=interviewDate&sortOrder=desc');

    expect(res.status).toBe(200);
    expect(vi.mocked(appService.listApplications).mock.calls[0][0]).toMatchObject({
      sortBy: 'interviewDate',
      sortOrder: 'desc',
    });
  });

  it('still rejects a sortBy outside the enum', async () => {
    // Guards the enum widening: adding a member must not turn the field into a
    // free-text passthrough.
    const res = await get('?sortBy=interview_date');

    expect(res.status).toBe(400);
    expect(appService.listApplications).not.toHaveBeenCalled();
  });

  it('leaves the pre-existing query contract intact', async () => {
    const res = await get('?status=interview&company=Acme&search=eng&limit=10&sortBy=company');

    expect(res.status).toBe(200);
    expect(vi.mocked(appService.listApplications).mock.calls[0][0]).toMatchObject({
      status: 'interview',
      company: 'Acme',
      search: 'eng',
      limit: 10,
      sortBy: 'company',
    });
  });
});
