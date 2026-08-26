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

export interface OnboardingProgressUpdate {
  currentStep?: OnboardingStep;
  personalInfoStepCompleted?: boolean;
  personalInfoStepSkipped?: boolean;
  resumeStepCompleted?: boolean;
  resumeStepSkipped?: boolean;
  applicationStepCompleted?: boolean;
  applicationStepSkipped?: boolean;
}

/** Every boolean key of a progress patch — i.e. every key except `currentStep`. */
type OnboardingStepFlag = {
  [K in keyof OnboardingProgressUpdate]-?: boolean extends OnboardingProgressUpdate[K] ? K : never;
}[keyof OnboardingProgressUpdate];

/**
 * The three completed/skipped flag pairs. Each pair is mutually exclusive: a step
 * is done, or skipped, or neither — never both.
 */
export const ONBOARDING_STEP_FLAG_PAIRS = [
  ['personalInfoStepCompleted', 'personalInfoStepSkipped'],
  ['resumeStepCompleted', 'resumeStepSkipped'],
  ['applicationStepCompleted', 'applicationStepSkipped'],
] as const satisfies ReadonlyArray<readonly [OnboardingStepFlag, OnboardingStepFlag]>;

// Exhaustiveness guard. `satisfies` above only checks that every name listed IS a
// flag; it stays silent when a *new* flag is added to OnboardingProgressUpdate and
// not paired here — which is the drift that would quietly reopen this defect for the
// new step. This line fails to compile in that case, and in the reverse case where a
// pair is deleted from the list but its flags survive on the interface (both measured).
// tsc reports it as `Type 'boolean' is not assignable to type '["unpaired onboarding
// step flag:", UnpairedStepFlag]'` — it does not expand the offending name, so hover
// `UnpairedStepFlag` (or run `tsc --noErrorTruncation`) to see which flag is unpaired.
type UnpairedStepFlag = Exclude<
  OnboardingStepFlag,
  (typeof ONBOARDING_STEP_FLAG_PAIRS)[number][number]
>;
type _AllStepFlagsArePaired = [UnpairedStepFlag] extends [never]
  ? true
  : ['unpaired onboarding step flag:', UnpairedStepFlag];
const _allStepFlagsArePaired: _AllStepFlagsArePaired = true;
void _allStepFlagsArePaired;

/**
 * WIC-1382 (D-5): setting either member of a pair to `true` clears the other.
 *
 * Callers used to send half the pair — `{personalInfoStepCompleted: true}` with no
 * `personalInfoStepSkipped: false` — and this function spread the patch verbatim, so
 * *skip Personal Info -> Next -> Back -> fill the form -> submit* left both booleans
 * true. Six booleans exist here precisely to tell "done" from "skipped" from "not yet
 * reached"; once both can be true the model degrades to a single "touched" bit and
 * Skip Rate by Step (a WIC-238 success metric) stops being countable.
 *
 * Normalising here rather than only in the web client covers every caller, including
 * ones that predate the client fix and any that come later.
 */
export function normalizeStepFlagPairs(
  updates: OnboardingProgressUpdate
): OnboardingProgressUpdate {
  const normalized: OnboardingProgressUpdate = { ...updates };

  for (const [completed, skipped] of ONBOARDING_STEP_FLAG_PAIRS) {
    // Order matters: a patch naming both as `true` is contradictory, and resolves to
    // completed-wins (you did the work). HTTP callers never reach that case —
    // progressSchema rejects it with a 400 rather than guessing — but a direct service
    // caller still gets one defined state instead of a row that satisfies neither flag.
    if (normalized[completed] === true) {
      normalized[skipped] = false;
    } else if (normalized[skipped] === true) {
      normalized[completed] = false;
    }
  }

  return normalized;
}

/**
 * Update onboarding progress
 */
export async function updateOnboardingProgress(
  userId: string,
  updates: OnboardingProgressUpdate
): Promise<OnboardingStatus> {
  const db = getDb();
  const existing = await getOnboardingStatus(userId);
  if (!existing) {
    throw new NotFoundError('Onboarding status not found. Initialize first.');
  }

  const result = await db
    .update(onboardingStatus)
    .set({
      ...normalizeStepFlagPairs(updates),
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
