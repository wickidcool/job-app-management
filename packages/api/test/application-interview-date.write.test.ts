import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createMigratedDb } from './helpers/pglite-db.js';

/**
 * WIC-2188 — the write path for `applications.interview_date`, end to end.
 *
 * The web card that owns this change (the form control, `ApplicationForm.tsx`) carries an
 * acceptance criterion it cannot itself test:
 *
 * > **Predicted, not measured — verify with a test rather than trusting this:** the update
 * > service uses `if ('interviewDate' in input)`, and the route's
 * > `.transform(v => v === '' ? undefined : v)` leaves the *key present* with value
 * > `undefined`, so `''` should land as `null` and clear the column.
 *
 * That prediction is a claim about **zod's key-retention semantics**, not about the form. It
 * holds only if a `.optional()` field whose transform returns `undefined` still appears in
 * the parsed object when the input carried the key — a detail with no type-level consequence
 * whatsoever, since `{ interviewDate: undefined }` and `{}` have the same TypeScript type.
 * `tsc` cannot see the difference, `application.routes.test.ts` mocks the service away before
 * the `in` check runs, and `application-interview-date.test.ts` (WIC-2023) only ever inserts.
 * So nothing in the repo measured it, and the fix if it were false would be in the *web*
 * layer — send an explicit `null` — which is exactly the kind of decision that must not be
 * made from a guess.
 *
 * These run through the real route, the real schema, the real service and a real Postgres
 * (PGlite with the project's migrations replayed), because every layer in that chain is load
 * bearing for the one question. A stub of any of them would be modelling the answer.
 *
 * Result: the prediction is **correct**. `''` clears the column. The `null`-sending workaround
 * is not needed, and the "leave it alone" case below is what stops that from being a
 * coincidence — an implementation that wrote `NULL` on every PATCH would satisfy the clear
 * case and fail that one.
 */

const harness = vi.hoisted(() => ({ db: null as any }));

vi.mock('../src/db/client.js', () => ({
  getDb: () => harness.db,
}));

import { buildAuthedApp, resetAuthEnv, TEST_USER_ID } from './helpers/authed-app.js';
import type { AuthedApp } from './helpers/authed-app.js';

const APP_ID = 'APPWIC2188000000000000001';
const SCHEDULED = '2026-09-10T18:30:00.000Z';
const RESCHEDULED = '2026-09-12T09:00:00.000Z';

let client: Awaited<ReturnType<typeof createMigratedDb>>['client'];
let app: AuthedApp;

/** The stored instant, read straight out of the column. `undefined` when the row is absent. */
async function storedInterviewDate(): Promise<string | null | undefined> {
  const rows = await client.query<{ interview_date: string | null }>(
    `SELECT interview_date FROM applications WHERE id = '${APP_ID}'`
  );
  if (rows.rows.length === 0) return undefined;
  const value = rows.rows[0].interview_date;
  return value === null ? null : new Date(value).toISOString();
}

function patch(body: Record<string, unknown>) {
  return app.request(`/api/applications/${APP_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  ({ client, db: harness.db } = await createMigratedDb());
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  app = await buildAuthedApp();
  await client.exec(`DELETE FROM status_history; DELETE FROM applications;`);
  await client.query(
    `INSERT INTO applications (id, user_id, job_title, company, status, interview_date, version)
     VALUES ('${APP_ID}', '${TEST_USER_ID}', 'Staff Engineer', 'Acme', 'interview',
             '${SCHEDULED}', 1)`
  );
});

afterEach(() => {
  resetAuthEnv();
});

describe('PATCH /api/applications/:id — interviewDate (WIC-2188)', () => {
  it('precondition: the fixture row really does carry an instant', async () => {
    // Positive control for every "it changed to X" assertion below. Without it, a seed that
    // silently failed would leave the column NULL and the clear case would pass vacuously.
    expect(await storedInterviewDate()).toBe(SCHEDULED);
  });

  it('CLEARS the column when the caller sends `""`', async () => {
    // The clause the card flagged as predicted-not-measured. This is the measurement.
    const res = await patch({ interviewDate: '', version: 1 });

    expect(res.status).toBe(200);
    expect((await res.json()).application.interviewDate).toBeNull();
    expect(await storedInterviewDate()).toBeNull();
  });

  it('LEAVES the column alone when the key is absent', async () => {
    // The control that gives the case above its meaning: `''` clearing is only evidence of
    // key-retention if omitting the key does *not* clear. A service that wrote NULL on every
    // update would pass the clear case and fail here.
    const res = await patch({ jobTitle: 'Principal Engineer', version: 1 });

    expect(res.status).toBe(200);
    expect(await storedInterviewDate()).toBe(SCHEDULED);
  });

  it('reschedules to a new instant', async () => {
    const res = await patch({ interviewDate: RESCHEDULED, version: 1 });

    expect(res.status).toBe(200);
    expect((await res.json()).application.interviewDate).toBe(RESCHEDULED);
    expect(await storedInterviewDate()).toBe(RESCHEDULED);
  });

  it('REJECTS a date-only string, and does not touch the stored instant', async () => {
    // `2026-09-10` is what `<input type="date">` emits and what the sibling `nextActionDue`
    // field legitimately sends. Accepting it here would store UTC midnight — a whole day out
    // for a user west of Greenwich — so the 400 is the feature, not an inconvenience.
    const res = await patch({ interviewDate: '2026-09-10', version: 1 });

    expect(res.status).toBe(400);
    expect(await storedInterviewDate()).toBe(SCHEDULED);
  });

  it('REJECTS the raw `datetime-local` value, which carries no offset', async () => {
    // The second wrong-but-plausible payload: `<input type="datetime-local">` emits exactly
    // this, and shipping it unconverted is the other obvious implementation of the web half.
    const res = await patch({ interviewDate: '2026-09-10T14:30', version: 1 });

    expect(res.status).toBe(400);
    expect(await storedInterviewDate()).toBe(SCHEDULED);
  });

  it('accepts a numeric offset, not only `Z`', async () => {
    // `datetime({ offset: true })` widens zod's default rather than replacing it, so both
    // spellings of the same instant are legal. Pinned because the web layer emits `Z` and a
    // future rule tightened to `Z`-only would pass every other test in this file.
    const res = await patch({ interviewDate: '2026-09-10T14:30:00-04:00', version: 1 });

    expect(res.status).toBe(200);
    expect(await storedInterviewDate()).toBe(SCHEDULED);
  });
});

describe('POST /api/applications — interviewDate (WIC-2188)', () => {
  it('persists an instant supplied at create time', async () => {
    const res = await app.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobTitle: 'Staff Engineer',
        company: 'Beta',
        status: 'interview',
        interviewDate: RESCHEDULED,
      }),
    });

    expect(res.status).toBe(201);
    const { application } = await res.json();
    expect(application.interviewDate).toBe(RESCHEDULED);

    const rows = await client.query<{ interview_date: string }>(
      `SELECT interview_date FROM applications WHERE id = '${application.id}'`
    );
    expect(new Date(rows.rows[0].interview_date).toISOString()).toBe(RESCHEDULED);
  });

  it('stores NULL when the field is sent empty', async () => {
    const res = await app.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobTitle: 'Staff Engineer',
        company: 'Gamma',
        status: 'saved',
        interviewDate: '',
      }),
    });

    expect(res.status).toBe(201);
    expect((await res.json()).application.interviewDate).toBeNull();
  });

  it('REJECTS a date-only string at create time too', async () => {
    const res = await app.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobTitle: 'Staff Engineer',
        company: 'Delta',
        status: 'saved',
        interviewDate: '2026-09-10',
      }),
    });

    expect(res.status).toBe(400);
  });
});
