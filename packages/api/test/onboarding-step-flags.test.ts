import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMiddleware } from 'hono/factory';

// The onboarding routes 401 without a userId, and the real middleware needs a signed
// Supabase JWT. Swapping the middleware for one that pins a fixed userId keeps this
// file about the completed/skipped invariant rather than about auth, which
// auth.test.ts already covers.
vi.mock('../src/middleware/auth.js', () => ({
  authMiddleware: createMiddleware(async (c, next) => {
    c.set('userId', TEST_USER_ID);
    return next();
  }),
  _resetJwksCache: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  getDb: () => stubDb,
  closeDb: vi.fn(),
}));

import { buildApp } from '../src/app.js';
import {
  ONBOARDING_STEP_FLAG_PAIRS,
  normalizeStepFlagPairs,
  updateOnboardingProgress,
} from '../src/services/onboarding.service.js';

const TEST_USER_ID = '01HXTEST000000000000000042';

/** The row `getOnboardingStatus` reads back before every update. */
let storedRow: Record<string, unknown>;
/** Whatever the service last handed to drizzle's `.set()`. */
let lastSetPayload: Record<string, unknown> | null;

function freshRow() {
  return {
    id: '01HXTEST000000000000000001',
    userId: TEST_USER_ID,
    currentStep: 'personal_info',
    personalInfoStepCompleted: false,
    personalInfoStepSkipped: false,
    resumeStepCompleted: false,
    resumeStepSkipped: false,
    applicationStepCompleted: false,
    applicationStepSkipped: false,
    startedAt: new Date(),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  };
}

// Minimal chainable drizzle stub covering exactly the two shapes this service uses:
//   select().from().where().limit()      -> rows
//   update().set().where().returning()   -> rows
// `.set()` applies the patch to storedRow, so a sequence of progress calls behaves
// like the real table: each read sees what the previous write left behind. That is
// what makes the skip-then-complete path in these tests meaningful.
const stubDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([{ ...storedRow }]),
      }),
    }),
  }),
  update: () => ({
    set: (payload: Record<string, unknown>) => {
      lastSetPayload = payload;
      storedRow = { ...storedRow, ...payload };
      return {
        where: () => ({
          returning: () => Promise.resolve([{ ...storedRow }]),
        }),
      };
    },
  }),
};

beforeEach(() => {
  storedRow = freshRow();
  lastSetPayload = null;
});

describe('normalizeStepFlagPairs (WIC-1382 D-5)', () => {
  it.each(ONBOARDING_STEP_FLAG_PAIRS)('clears %s when %s is set', (completed, skipped) => {
    expect(normalizeStepFlagPairs({ [completed]: true })).toMatchObject({
      [completed]: true,
      [skipped]: false,
    });

    expect(normalizeStepFlagPairs({ [skipped]: true })).toMatchObject({
      [completed]: false,
      [skipped]: true,
    });
  });

  it('leaves a patch that sets a flag to false alone — false is not a claim about the pair', () => {
    expect(normalizeStepFlagPairs({ personalInfoStepCompleted: false })).toEqual({
      personalInfoStepCompleted: false,
    });
  });

  it('does not invent flags for pairs the patch never mentions', () => {
    expect(normalizeStepFlagPairs({ resumeStepSkipped: true })).toEqual({
      resumeStepSkipped: true,
      resumeStepCompleted: false,
    });
  });

  it('passes currentStep through untouched', () => {
    expect(normalizeStepFlagPairs({ currentStep: 'resume_upload' }).currentStep).toBe(
      'resume_upload'
    );
  });

  it('resolves a contradictory both-true patch to completed rather than to neither', () => {
    // HTTP callers never get here — progressSchema rejects this with a 400. A direct
    // service caller still ends up in one defined state instead of both flags true.
    expect(
      normalizeStepFlagPairs({
        personalInfoStepCompleted: true,
        personalInfoStepSkipped: true,
      })
    ).toEqual({
      personalInfoStepCompleted: true,
      personalInfoStepSkipped: false,
    });
  });
});

describe('updateOnboardingProgress persists the normalised patch', () => {
  it('writes the cleared counterpart to the row, not just to the return value', async () => {
    await updateOnboardingProgress(TEST_USER_ID, { personalInfoStepSkipped: true });

    expect(lastSetPayload).toMatchObject({
      personalInfoStepSkipped: true,
      personalInfoStepCompleted: false,
    });
  });
});

describe('POST /api/users/me/onboarding/progress', () => {
  const app = buildApp();

  function postProgress(body: Record<string, unknown>) {
    return app.request('/api/users/me/onboarding/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // The exact path the WIC-1382 report names: steps 2 and 3 both render a Back button,
  // so a user can skip Personal Info, go forward, come back, and submit the form. Before
  // this fix the second patch did not clear the first flag and the row ended up asserting
  // the step was both skipped and completed.
  it('leaves exactly one flag true after skip -> back -> submit', async () => {
    const skipped = await postProgress({
      personalInfoStepSkipped: true,
      personalInfoStepCompleted: false,
    });
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toMatchObject({
      personalInfoStepSkipped: true,
      personalInfoStepCompleted: false,
    });

    const completed = await postProgress({ personalInfoStepCompleted: true });
    expect(completed.status).toBe(200);
    const body = await completed.json();

    expect(body.personalInfoStepCompleted).toBe(true);
    expect(body.personalInfoStepSkipped).toBe(false);
  });

  // Same hole in the other direction, which the report calls out on the resume step:
  // handleResumeUploadSuccess cleared its counterpart but handleSkipResume did not, so a
  // successful upload followed by a later skip left both true.
  it('leaves exactly one flag true after complete -> skip on the resume step', async () => {
    await postProgress({ resumeStepCompleted: true });
    const res = await postProgress({ resumeStepSkipped: true });
    const body = await res.json();

    expect(body.resumeStepCompleted).toBe(false);
    expect(body.resumeStepSkipped).toBe(true);
  });

  it.each(ONBOARDING_STEP_FLAG_PAIRS)(
    'rejects a single patch setting both %s and %s',
    async (completed, skipped) => {
      const res = await postProgress({ [completed]: true, [skipped]: true });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(body.error.details)).toContain('cannot be both completed and skipped');
    }
  );

  it('still accepts a patch that sets both flags of a pair to false', async () => {
    const res = await postProgress({
      applicationStepCompleted: false,
      applicationStepSkipped: false,
    });

    expect(res.status).toBe(200);
  });
});
