// WIC-1818 AC-5a, at the HTTP boundary.
//
// The service-level suite (`job-fit-analysis-id.validation.test.ts`) proves the
// five entry points throw. This one proves the throw reaches the client as a
// 422 with a readable code, which is a separate claim and not implied by the
// first: `app.onError` renders `AppError` by casting `err.statusCode` to a
// union that does not list 422 (`app.ts:184`). The cast is a compile-time
// assertion only — nothing coerces the value at runtime — but "the code says it
// is fine" is exactly the kind of reasoning this repo has been burned by, so it
// is asserted rather than argued.
//
// The route is driven for real. `generateSchema` in `routes/cover-letters.ts`
// is `.strict()` with no `.refine`, so the body below passes route validation
// and the rejection has to come from the service — which is the point of the
// reproduction in the card.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Only the DB client is stubbed, and only so an unexpected fallthrough fails
// loudly instead of reaching a real connection. The cover-letter service itself
// is deliberately NOT mocked: mocking it is what makes the existing
// `cover-letter.routes.test.ts` blind to service-level guards.
vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { buildApp } from '../src/app.js';
import { getDb } from '../src/db/client.js';

const HOST = 'http://localhost';

describe('WIC-1818 AC-5a — POST /api/cover-letters/generate returns 422 for an unresolvable id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects the card reproduction with 422 JOB_FIT_ANALYSIS_NOT_FOUND', async () => {
    const res = await buildApp().request(`${HOST}/api/cover-letters/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Verbatim from the card: an id, one STAR entry, and nothing else. No job
      // description, no target company, no target role.
      body: JSON.stringify({ jobFitAnalysisId: 'x', selectedStarEntryIds: ['01HZ_BUL_MINE'] }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('JOB_FIT_ANALYSIS_NOT_FOUND');

    // Not a 400 from Zod and not a 500 from an unhandled throw — the two ways
    // this could pass the status check for the wrong reason.
    expect(body.error?.message).not.toMatch(/invalid|expected/i);

    // Rejected before the request touched the database at all.
    expect(getDb).not.toHaveBeenCalled();
  });

  it('does not disclose whether the analysis exists or belongs to someone else', async () => {
    // AC-5b resolves by `(id, userId)`. A message that distinguished "no such
    // analysis" from "not yours" would be an existence oracle over other users'
    // analyses, so the wording is pinned now, while there is only one case.
    const res = await buildApp().request(`${HOST}/api/cover-letters/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobFitAnalysisId: 'x', selectedStarEntryIds: ['01HZ_BUL_MINE'] }),
    });

    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe('Job fit analysis not found');
    expect(body.error?.message).not.toMatch(/another user|not yours|belongs to|forbidden/i);
  });
});
