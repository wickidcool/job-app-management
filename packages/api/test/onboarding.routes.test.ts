import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { buildApp } from '../src/app.js';
import { _resetConfig } from '../src/config.js';
import { _resetJwksCache } from '../src/middleware/auth.js';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

vi.mock('../src/services/onboarding.service.js', () => ({
  getOnboardingStatus: vi.fn(),
  initializeOnboardingStatus: vi.fn(),
  updateOnboardingProgress: vi.fn(),
  completeOnboarding: vi.fn(),
  shouldShowOnboarding: vi.fn(),
}));

import * as onboardingService from '../src/services/onboarding.service.js';
import { NotFoundError, VersionConflictError } from '../src/types/index.js';
import type { OnboardingStatus } from '../src/db/schema.js';

const TEST_JWT_SECRET = 'super-secret-jwt-key-for-testing-only-32-chars!!';
const USER_ID = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

async function bearer(sub = USER_ID) {
  const token = await new SignJWT({ sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
  return { authorization: `Bearer ${token}` };
}

/**
 * A pristine, freshly-initialized onboarding row — what AC-1 hands a brand new user.
 * The enum ships five steps (welcome, personal_info, resume_upload, first_application,
 * completed); `personal_info` arrived in migration 0015 after WIC-238 was accepted, so
 * these tests track the shipped enum rather than the four steps in the plan document.
 */
function freshStatus(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    id: '01HXONBOARD00000000000001',
    userId: USER_ID,
    currentStep: 'welcome',
    personalInfoStepCompleted: false,
    personalInfoStepSkipped: false,
    resumeStepCompleted: false,
    resumeStepSkipped: false,
    applicationStepCompleted: false,
    applicationStepSkipped: false,
    startedAt: new Date('2026-08-26T00:00:00.000Z'),
    completedAt: null,
    createdAt: new Date('2026-08-26T00:00:00.000Z'),
    updatedAt: new Date('2026-08-26T00:00:00.000Z'),
    version: 1,
    ...overrides,
  } as OnboardingStatus;
}

describe('Onboarding Routes', () => {
  const originalEnv = process.env;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
    delete process.env.SUPABASE_URL;
    _resetConfig();
    _resetJwksCache();
    vi.clearAllMocks();
    app = buildApp();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfig();
    _resetJwksCache();
  });

  // ── GET /api/users/me/onboarding/status ────────────────────────────────────

  describe('GET /api/users/me/onboarding/status', () => {
    it('AC-1: auto-initializes a welcome-step record for a user who has none', async () => {
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(null);
      vi.mocked(onboardingService.initializeOnboardingStatus).mockResolvedValue(freshStatus());

      const res = await app.request('/api/users/me/onboarding/status', {
        method: 'GET',
        headers: await bearer(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.currentStep).toBe('welcome');
      expect(body.completedAt).toBeNull();
      expect(onboardingService.initializeOnboardingStatus).toHaveBeenCalledWith(USER_ID);
    });

    it('returns the existing record without re-initializing', async () => {
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(
        freshStatus({ currentStep: 'resume_upload', version: 3 })
      );

      const res = await app.request('/api/users/me/onboarding/status', {
        method: 'GET',
        headers: await bearer(),
      });

      expect(res.status).toBe(200);
      expect((await res.json()).currentStep).toBe('resume_upload');
      expect(onboardingService.initializeOnboardingStatus).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the caller in the JWT, not a client-supplied id', async () => {
      const otherUser = '11111111-2222-3333-4444-555555555555';
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(freshStatus());

      const res = await app.request('/api/users/me/onboarding/status', {
        method: 'GET',
        headers: await bearer(otherUser),
      });

      expect(res.status).toBe(200);
      expect(onboardingService.getOnboardingStatus).toHaveBeenCalledWith(otherUser);
    });

    it('returns 401 without a bearer token', async () => {
      const res = await app.request('/api/users/me/onboarding/status', { method: 'GET' });
      expect(res.status).toBe(401);
      expect(onboardingService.getOnboardingStatus).not.toHaveBeenCalled();
    });

    it('returns 401 when auth is unconfigured and the request has no user identity', async () => {
      // Local-dev bypass: authMiddleware waves the request through with userId=null.
      // Onboarding is per-user, so the route must still refuse rather than operate
      // on an anonymous null user.
      delete process.env.SUPABASE_JWT_SECRET;
      _resetConfig();
      const bypassApp = buildApp();

      const res = await bypassApp.request('/api/users/me/onboarding/status', { method: 'GET' });

      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHORIZED');
      expect(onboardingService.getOnboardingStatus).not.toHaveBeenCalled();
    });
  });

  // ── POST /api/users/me/onboarding/progress ─────────────────────────────────

  describe('POST /api/users/me/onboarding/progress', () => {
    it('AC-5: resume skip sets resumeStepSkipped, never resumeStepCompleted', async () => {
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(
        freshStatus({ currentStep: 'resume_upload' })
      );
      vi.mocked(onboardingService.updateOnboardingProgress).mockResolvedValue(
        freshStatus({ currentStep: 'first_application', resumeStepSkipped: true, version: 2 })
      );

      const res = await app.request('/api/users/me/onboarding/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await bearer()) },
        body: JSON.stringify({ resumeStepSkipped: true, currentStep: 'first_application' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resumeStepSkipped).toBe(true);
      expect(body.resumeStepCompleted).toBe(false);
      expect(onboardingService.updateOnboardingProgress).toHaveBeenCalledWith(USER_ID, {
        resumeStepSkipped: true,
        currentStep: 'first_application',
      });
      // The skip must not be silently upgraded into a completion.
      const [, forwarded] = vi.mocked(onboardingService.updateOnboardingProgress).mock.calls[0];
      expect(forwarded).not.toHaveProperty('resumeStepCompleted');
    });

    it('AC-8: first-application skip sets applicationStepSkipped, never applicationStepCompleted', async () => {
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(
        freshStatus({ currentStep: 'first_application' })
      );
      vi.mocked(onboardingService.updateOnboardingProgress).mockResolvedValue(
        freshStatus({
          currentStep: 'completed',
          applicationStepSkipped: true,
          completedAt: new Date('2026-08-26T01:00:00.000Z'),
          version: 2,
        })
      );

      const res = await app.request('/api/users/me/onboarding/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await bearer()) },
        body: JSON.stringify({ applicationStepSkipped: true, currentStep: 'completed' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.applicationStepSkipped).toBe(true);
      expect(body.applicationStepCompleted).toBe(false);
      expect(body.currentStep).toBe('completed');
      const [, forwarded] = vi.mocked(onboardingService.updateOnboardingProgress).mock.calls[0];
      expect(forwarded).not.toHaveProperty('applicationStepCompleted');
    });

    it('records a completed step distinctly from a skipped one', async () => {
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(freshStatus());
      vi.mocked(onboardingService.updateOnboardingProgress).mockResolvedValue(
        freshStatus({ currentStep: 'resume_upload', personalInfoStepCompleted: true, version: 2 })
      );

      const res = await app.request('/api/users/me/onboarding/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await bearer()) },
        body: JSON.stringify({ personalInfoStepCompleted: true, currentStep: 'resume_upload' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.personalInfoStepCompleted).toBe(true);
      expect(body.personalInfoStepSkipped).toBe(false);
    });

    it('E-1: a mid-flow user resumes at the persisted currentStep', async () => {
      // Session abandoned during resume_upload; the record survives and the next
      // status read hands the client back the step it left off at.
      const abandoned = freshStatus({ currentStep: 'resume_upload', version: 4 });
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(abandoned);

      const res = await app.request('/api/users/me/onboarding/status', {
        method: 'GET',
        headers: await bearer(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.currentStep).toBe('resume_upload');
      expect(body.completedAt).toBeNull();
      // Resuming must not reset progress by re-initializing a welcome-step row.
      expect(onboardingService.initializeOnboardingStatus).not.toHaveBeenCalled();
    });

    it('initializes the record first when progress arrives before any status read', async () => {
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(null);
      vi.mocked(onboardingService.initializeOnboardingStatus).mockResolvedValue(freshStatus());
      vi.mocked(onboardingService.updateOnboardingProgress).mockResolvedValue(
        freshStatus({ currentStep: 'personal_info', version: 2 })
      );

      const res = await app.request('/api/users/me/onboarding/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await bearer()) },
        body: JSON.stringify({ currentStep: 'personal_info' }),
      });

      expect(res.status).toBe(200);
      expect(onboardingService.initializeOnboardingStatus).toHaveBeenCalledWith(USER_ID);
      expect(onboardingService.updateOnboardingProgress).toHaveBeenCalled();
    });

    it('accepts every step in the shipped enum', async () => {
      const steps = [
        'welcome',
        'personal_info',
        'resume_upload',
        'first_application',
        'completed',
      ] as const;

      for (const step of steps) {
        vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(freshStatus());
        vi.mocked(onboardingService.updateOnboardingProgress).mockResolvedValue(
          freshStatus({ currentStep: step, version: 2 })
        );

        const res = await app.request('/api/users/me/onboarding/progress', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await bearer()) },
          body: JSON.stringify({ currentStep: step }),
        });

        expect(res.status, `step ${step} should be accepted`).toBe(200);
        expect((await res.json()).currentStep).toBe(step);
      }
    });

    it('returns 400 for a step outside the enum', async () => {
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(freshStatus());

      const res = await app.request('/api/users/me/onboarding/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await bearer()) },
        body: JSON.stringify({ currentStep: 'not_a_step' }),
      });

      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
      expect(onboardingService.updateOnboardingProgress).not.toHaveBeenCalled();
    });

    it('returns 400 for a non-boolean step flag', async () => {
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(freshStatus());

      const res = await app.request('/api/users/me/onboarding/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await bearer()) },
        body: JSON.stringify({ resumeStepSkipped: 'yes' }),
      });

      expect(res.status).toBe(400);
      expect(onboardingService.updateOnboardingProgress).not.toHaveBeenCalled();
    });

    it('returns 409 when a concurrent write bumps the version', async () => {
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(freshStatus());
      vi.mocked(onboardingService.updateOnboardingProgress).mockRejectedValue(
        new VersionConflictError()
      );

      const res = await app.request('/api/users/me/onboarding/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await bearer()) },
        body: JSON.stringify({ currentStep: 'resume_upload' }),
      });

      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe('VERSION_CONFLICT');
    });

    it('returns 401 without a bearer token', async () => {
      const res = await app.request('/api/users/me/onboarding/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentStep: 'welcome' }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/users/me/onboarding/complete ─────────────────────────────────

  describe('POST /api/users/me/onboarding/complete', () => {
    it('AC-11: completing stamps completedAt and the completed step', async () => {
      const completedAt = new Date('2026-08-26T02:00:00.000Z');
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(
        freshStatus({ currentStep: 'first_application' })
      );
      vi.mocked(onboardingService.completeOnboarding).mockResolvedValue(
        freshStatus({ currentStep: 'completed', completedAt, version: 5 })
      );

      const res = await app.request('/api/users/me/onboarding/complete', {
        method: 'POST',
        headers: await bearer(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.currentStep).toBe('completed');
      expect(body.completedAt).toBe(completedAt.toISOString());
      expect(onboardingService.completeOnboarding).toHaveBeenCalledWith(USER_ID);
    });

    it('AC-11: a completed user is not re-shown onboarding', async () => {
      // Once complete has landed, should-show must stay false — this is the
      // re-entry guard the flow depends on.
      vi.mocked(onboardingService.shouldShowOnboarding).mockResolvedValue(false);

      const res = await app.request('/api/users/me/onboarding/should-show', {
        method: 'GET',
        headers: await bearer(),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ shouldShow: false });
    });

    it('AC-11: completing twice is idempotent rather than an error', async () => {
      const completedAt = new Date('2026-08-26T02:00:00.000Z');
      const done = freshStatus({ currentStep: 'completed', completedAt, version: 5 });
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(done);
      vi.mocked(onboardingService.completeOnboarding).mockResolvedValue({ ...done, version: 6 });

      const res = await app.request('/api/users/me/onboarding/complete', {
        method: 'POST',
        headers: await bearer(),
      });

      expect(res.status).toBe(200);
      expect((await res.json()).currentStep).toBe('completed');
    });

    it('returns 404 when the record vanishes between the check and the write', async () => {
      vi.mocked(onboardingService.getOnboardingStatus).mockResolvedValue(freshStatus());
      vi.mocked(onboardingService.completeOnboarding).mockRejectedValue(
        new NotFoundError('Onboarding status not found. Initialize first.')
      );

      const res = await app.request('/api/users/me/onboarding/complete', {
        method: 'POST',
        headers: await bearer(),
      });

      expect(res.status).toBe(404);
    });

    it('returns 401 without a bearer token', async () => {
      const res = await app.request('/api/users/me/onboarding/complete', { method: 'POST' });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/users/me/onboarding/should-show ───────────────────────────────

  describe('GET /api/users/me/onboarding/should-show', () => {
    it('AC-1: true for a user with no onboarding record', async () => {
      vi.mocked(onboardingService.shouldShowOnboarding).mockResolvedValue(true);

      const res = await app.request('/api/users/me/onboarding/should-show', {
        method: 'GET',
        headers: await bearer(),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ shouldShow: true });
      expect(onboardingService.shouldShowOnboarding).toHaveBeenCalledWith(USER_ID);
    });

    it('E-1: true for a user who abandoned mid-flow', async () => {
      vi.mocked(onboardingService.shouldShowOnboarding).mockResolvedValue(true);

      const res = await app.request('/api/users/me/onboarding/should-show', {
        method: 'GET',
        headers: await bearer(),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ shouldShow: true });
    });

    it('answers with a bare boolean envelope, never the whole status row', async () => {
      vi.mocked(onboardingService.shouldShowOnboarding).mockResolvedValue(false);

      const res = await app.request('/api/users/me/onboarding/should-show', {
        method: 'GET',
        headers: await bearer(),
      });

      expect(Object.keys(await res.json())).toEqual(['shouldShow']);
    });

    it('returns 401 without a bearer token', async () => {
      const res = await app.request('/api/users/me/onboarding/should-show', { method: 'GET' });
      expect(res.status).toBe(401);
    });
  });
});
