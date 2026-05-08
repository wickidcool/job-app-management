import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types/env.js';
import { AppError } from '../types/index.js';
import * as onboardingService from '../services/onboarding.service.js';
import { getDbFromContext } from '../db/context.js';

const progressSchema = z.object({
  currentStep: z.enum(['welcome', 'resume_upload', 'first_application', 'completed']).optional(),
  resumeStepCompleted: z.boolean().optional(),
  resumeStepSkipped: z.boolean().optional(),
  applicationStepCompleted: z.boolean().optional(),
  applicationStepSkipped: z.boolean().optional(),
});

export const onboardingRoutes = new Hono<AppEnv>()
  /**
   * GET /api/users/me/onboarding/status
   * Get current user's onboarding status
   */
  .get('/users/me/onboarding/status', async (c) => {
    const userId = c.get('userId');
    if (!userId) {
      throw new AppError('UNAUTHORIZED', 'Authentication required', undefined, 401);
    }

    const db = getDbFromContext(c);
    let status = await onboardingService.getOnboardingStatus(db, userId);

    // Auto-initialize if not exists
    if (!status) {
      status = await onboardingService.initializeOnboardingStatus(db, userId);
    }

    return c.json(status, 200);
  })

  /**
   * POST /api/users/me/onboarding/progress
   * Update onboarding progress
   */
  .post('/users/me/onboarding/progress', async (c) => {
    const userId = c.get('userId');
    if (!userId) {
      throw new AppError('UNAUTHORIZED', 'Authentication required', undefined, 401);
    }

    const parsed = progressSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid request body', parsed.error.flatten(), 400);
    }

    const db = getDbFromContext(c);

    // Ensure onboarding status exists
    let existing = await onboardingService.getOnboardingStatus(db, userId);
    if (!existing) {
      existing = await onboardingService.initializeOnboardingStatus(db, userId);
    }

    const updated = await onboardingService.updateOnboardingProgress(db, userId, parsed.data);

    return c.json(updated, 200);
  })

  /**
   * POST /api/users/me/onboarding/complete
   * Mark onboarding as completed
   */
  .post('/users/me/onboarding/complete', async (c) => {
    const userId = c.get('userId');
    if (!userId) {
      throw new AppError('UNAUTHORIZED', 'Authentication required', undefined, 401);
    }

    const db = getDbFromContext(c);

    // Ensure onboarding status exists
    let existing = await onboardingService.getOnboardingStatus(db, userId);
    if (!existing) {
      existing = await onboardingService.initializeOnboardingStatus(db, userId);
    }

    const completed = await onboardingService.completeOnboarding(db, userId);

    return c.json(completed, 200);
  })

  /**
   * GET /api/users/me/onboarding/should-show
   * Check if onboarding should be displayed
   */
  .get('/users/me/onboarding/should-show', async (c) => {
    const userId = c.get('userId');
    if (!userId) {
      throw new AppError('UNAUTHORIZED', 'Authentication required', undefined, 401);
    }

    const db = getDbFromContext(c);
    const shouldShow = await onboardingService.shouldShowOnboarding(db, userId);

    return c.json({ shouldShow }, 200);
  });
