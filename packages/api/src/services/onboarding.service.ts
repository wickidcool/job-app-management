import { eq, and } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDb } from '../db/client.js';
import { onboardingStatus, type OnboardingStatus, type OnboardingStep } from '../db/schema.js';
import { NotFoundError, VersionConflictError } from '../types/index.js';

/**
 * Get onboarding status for a user
 */
export async function getOnboardingStatus(userId: string): Promise<OnboardingStatus | null> {
  const db = getDb();
  const result = await db
    .select()
    .from(onboardingStatus)
    .where(eq(onboardingStatus.userId, userId))
    .limit(1);

  return result[0] || null;
}

/**
 * Create or initialize onboarding status for a new user.
 * Uses ON CONFLICT DO NOTHING to handle concurrent initialization attempts.
 */
export async function initializeOnboardingStatus(userId: string): Promise<OnboardingStatus> {
  const db = getDb();
  const newStatus: typeof onboardingStatus.$inferInsert = {
    id: ulid(),
    userId,
    currentStep: 'welcome',
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

  const result = await db
    .insert(onboardingStatus)
    .values(newStatus)
    .onConflictDoNothing({ target: onboardingStatus.userId })
    .returning();

  if (result.length > 0) {
    return result[0];
  }

  const existing = await getOnboardingStatus(userId);
  if (!existing) {
    throw new NotFoundError('Failed to initialize onboarding status');
  }
  return existing;
}

/**
 * Update onboarding progress
 */
export async function updateOnboardingProgress(
  userId: string,
  updates: {
    currentStep?: OnboardingStep;
    resumeStepCompleted?: boolean;
    resumeStepSkipped?: boolean;
    applicationStepCompleted?: boolean;
    applicationStepSkipped?: boolean;
  }
): Promise<OnboardingStatus> {
  const db = getDb();
  const existing = await getOnboardingStatus(userId);
  if (!existing) {
    throw new NotFoundError('Onboarding status not found. Initialize first.');
  }

  const result = await db
    .update(onboardingStatus)
    .set({
      ...updates,
      updatedAt: new Date(),
      version: existing.version + 1,
    })
    .where(
      and(eq(onboardingStatus.id, existing.id), eq(onboardingStatus.version, existing.version))
    )
    .returning();

  if (result.length === 0) {
    throw new VersionConflictError();
  }

  return result[0];
}

/**
 * Mark onboarding as completed
 */
export async function completeOnboarding(userId: string): Promise<OnboardingStatus> {
  const db = getDb();
  const existing = await getOnboardingStatus(userId);
  if (!existing) {
    throw new NotFoundError('Onboarding status not found. Initialize first.');
  }

  const result = await db
    .update(onboardingStatus)
    .set({
      currentStep: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
      version: existing.version + 1,
    })
    .where(
      and(eq(onboardingStatus.id, existing.id), eq(onboardingStatus.version, existing.version))
    )
    .returning();

  if (result.length === 0) {
    throw new VersionConflictError();
  }

  return result[0];
}

/**
 * Check if user needs onboarding (first-time user detection)
 */
export async function shouldShowOnboarding(userId: string): Promise<boolean> {
  const status = await getOnboardingStatus(userId);

  // If no onboarding record exists, user needs onboarding
  if (!status) {
    return true;
  }

  // If already completed, don't show onboarding
  if (status.completedAt !== null || status.currentStep === 'completed') {
    return false;
  }

  // User is mid-onboarding, should show it
  return true;
}
