import { eq, and, lt } from 'drizzle-orm';
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
 *
 * `createdBefore` scopes the probes in time. Onboarding step 3 *is* the resume
 * upload, so "has a resume" cannot on its own mean "returning user" — for a row
 * the flow has already been driven through, only work that predates the status
 * row could have come from somewhere other than the flow. Pass `null` to ask the
 * unscoped question, which is the right one when the flow has produced nothing.
 */
async function hasExistingWork(userId: string, createdBefore: Date | null): Promise<boolean> {
  const db = getDb();

  const [resume] = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(
      createdBefore
        ? and(eq(resumes.userId, userId), lt(resumes.uploadedAt, createdBefore))
        : eq(resumes.userId, userId)
    )
    .limit(1);
  if (resume) {
    return true;
  }

  const [application] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(
      createdBefore
        ? and(eq(applications.userId, userId), lt(applications.createdAt, createdBefore))
        : eq(applications.userId, userId)
    )
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

  // Mid-flow: the user has driven the flow at least one step. Work created *after*
  // their status row is the flow's own output, so probing it unscoped would eject
  // them from their own onboarding the moment step 3 uploaded a first resume. But
  // engagement is not consent either — an established user who got the modal over
  // their populated dashboard and clicked "Get Started" or "Skip for now" once is
  // still the AC-10 cohort. Work that predates the status row cannot have come from
  // the flow, so it is what separates the two.
  if (status && hasEngagedWithOnboarding(status)) {
    return !(await hasExistingWork(userId, status.startedAt));
  }

  // No row, or a pristine auto-created one — we have never seen this user in the
  // flow. WIC-238 AC-10: a user who already has a resume or an application is a
  // returning user, and onboarding is not for them. Unscoped on purpose: scoping
  // here would re-show onboarding to a new user who dismissed at `welcome` and then
  // created an application by hand.
  return !(await hasExistingWork(userId, null));
}
