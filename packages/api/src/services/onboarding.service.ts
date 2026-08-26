import { eq, and } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDb } from '../db/client.js';
import {
  applications,
  onboardingStatus,
  resumes,
  type OnboardingStatus,
  type OnboardingStep,
} from '../db/schema.js';
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
    personalInfoStepCompleted?: boolean;
    personalInfoStepSkipped?: boolean;
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
 * Has the user actually engaged with the onboarding flow, or is this row just the
 * one `GET /users/me/onboarding/status` auto-creates on first page load?
 *
 * A pristine row — still on `welcome`, with nothing completed or skipped — carries no
 * user intent and must not be read as "mid-onboarding". Every established user who
 * opened the app before WIC-1359 shipped has exactly that row, auto-created for them.
 */
function hasEngagedWithOnboarding(status: OnboardingStatus): boolean {
  return (
    status.currentStep !== 'welcome' ||
    status.personalInfoStepCompleted ||
    status.personalInfoStepSkipped ||
    status.resumeStepCompleted ||
    status.resumeStepSkipped ||
    status.applicationStepCompleted ||
    status.applicationStepSkipped
  );
}

/**
 * Does the user already have the work onboarding exists to bootstrap?
 *
 * Existence probes rather than counts: we only need "any", and the resume probe
 * short-circuits the second round trip in the common case.
 */
async function hasExistingWork(userId: string): Promise<boolean> {
  const db = getDb();

  const [resume] = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(eq(resumes.userId, userId))
    .limit(1);
  if (resume) {
    return true;
  }

  const [application] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.userId, userId))
    .limit(1);
  return application !== undefined;
}

/**
 * Check if user needs onboarding (first-time user detection)
 */
export async function shouldShowOnboarding(userId: string): Promise<boolean> {
  const status = await getOnboardingStatus(userId);

  // If already completed, don't show onboarding
  if (status && (status.completedAt !== null || status.currentStep === 'completed')) {
    return false;
  }

  // Mid-flow: the user is working through the steps right now. Their resume and
  // application history is a *product* of the flow, so the AC-10 check below would
  // eject them from their own onboarding the moment they uploaded a first resume.
  if (status && hasEngagedWithOnboarding(status)) {
    return true;
  }

  // No row, or a pristine auto-created one — we have never seen this user in the
  // flow. WIC-238 AC-10: a user who already has a resume or an application is a
  // returning user, and onboarding is not for them.
  return !(await hasExistingWork(userId));
}
