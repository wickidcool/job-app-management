import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types/env.js';
import { AppError } from '../types/index.js';
import * as onboardingService from '../services/onboarding.service.js';

const progressSchema = z
  .object({
    currentStep: z
      .enum(['welcome', 'personal_info', 'resume_upload', 'first_application', 'completed'])
      .optional(),
    personalInfoStepCompleted: z.boolean().optional(),
    personalInfoStepSkipped: z.boolean().optional(),
    resumeStepCompleted: z.boolean().optional(),
    resumeStepSkipped: z.boolean().optional(),
    applicationStepCompleted: z.boolean().optional(),
    applicationStepSkipped: z.boolean().optional(),
  })
  // WIC-1382 (D-5): a step is done, or skipped, or neither — never both. The service
  // clears the counterpart whenever one flag is set, so a *sequence* of patches can no
  // longer land both true. A single patch naming both as `true` is a different thing:
  // it is contradictory on its face, and the honest answer is 400 rather than a silent
  // precedence rule the caller never asked for.
  .superRefine((patch, ctx) => {
    for (const [completed, skipped] of onboardingService.ONBOARDING_STEP_FLAG_PAIRS) {
      if (patch[completed] === true && patch[skipped] === true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [skipped],
          message: `A step cannot be both completed and skipped: ${completed} and ${skipped} were both true.`,
        });
      }
    }
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

    let status = await onboardingService.getOnboardingStatus(userId);

    // Auto-initialize if not exists
    if (!status) {
      status = await onboardingService.initializeOnboardingStatus(userId);
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

    // Ensure onboarding status exists
    let existing = await onboardingService.getOnboardingStatus(userId);
    if (!existing) {
      existing = await onboardingService.initializeOnboardingStatus(userId);
    }

    const updated = await onboardingService.updateOnboardingProgress(userId, parsed.data);

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

    // Ensure onboarding status exists
    let existing = await onboardingService.getOnboardingStatus(userId);
    if (!existing) {
      existing = await onboardingService.initializeOnboardingStatus(userId);
    }

    const completed = await onboardingService.completeOnboarding(userId);

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

    const shouldShow = await onboardingService.shouldShowOnboarding(userId);

    return c.json({ shouldShow }, 200);
  });
