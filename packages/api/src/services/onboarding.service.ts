import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { onboardingStatus, type OnboardingStatus, type OnboardingStep } from '../db/schema.js';
import { NotFoundError } from '../types/index.js';

/**
 * Get onboarding status for a user
 */
export async function getOnboardingStatus(
  db: PostgresJsDatabase,
  userId: string
): Promise<OnboardingStatus | null> {
  const result = await db
    .select()
    .from(onboardingStatus)
    .where(eq(onboardingStatus.userId, userId))
    .limit(1);

  return result[0] || null;
}

/**
 * Create or initialize onboarding status for a new user
 */
export async function initializeOnboardingStatus(
  db: PostgresJsDatabase,
  userId: string
): Promise<OnboardingStatus> {
  const existing = await getOnboardingStatus(db, userId);
  if (existing) {
    return existing;
  }

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

  const result = await db.insert(onboardingStatus).values(newStatus).returning();
  return result[0];
}

/**
 * Update onboarding progress
 */
export async function updateOnboardingProgress(
  db: PostgresJsDatabase,
  userId: string,
  updates: {
    currentStep?: OnboardingStep;
    resumeStepCompleted?: boolean;
    resumeStepSkipped?: boolean;
    applicationStepCompleted?: boolean;
    applicationStepSkipped?: boolean;
  }
): Promise<OnboardingStatus> {
  const existing = await getOnboardingStatus(db, userId);
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
    .where(eq(onboardingStatus.id, existing.id))
    .returning();

  if (result.length === 0) {
    throw new NotFoundError('Failed to update onboarding status');
  }

  return result[0];
}

/**
 * Mark onboarding as completed
 */
export async function completeOnboarding(
  db: PostgresJsDatabase,
  userId: string
): Promise<OnboardingStatus> {
  const existing = await getOnboardingStatus(db, userId);
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
    .where(eq(onboardingStatus.id, existing.id))
    .returning();

  if (result.length === 0) {
    throw new NotFoundError('Failed to complete onboarding');
  }

  return result[0];
}

/**
 * Check if user needs onboarding (first-time user detection)
 */
export async function shouldShowOnboarding(
  db: PostgresJsDatabase,
  userId: string
): Promise<boolean> {
  const status = await getOnboardingStatus(db, userId);

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
