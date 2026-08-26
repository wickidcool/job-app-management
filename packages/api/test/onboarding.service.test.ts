import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client.js';
import { shouldShowOnboarding } from '../src/services/onboarding.service.js';
import type { OnboardingStatus } from '../src/db/schema.js';

const USER_ID = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

function statusRow(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
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

/** A resume/application existence probe returns an id and nothing else. */
const SOME_ROW = [{ id: '01HXWORK0000000000000001' }];

/**
 * Stub the `select().from().where().limit()` chain, one queued result per call.
 *
 * Every read shouldShowOnboarding issues has that same shape — the status row first,
 * then the two AC-10 existence probes (resumes, then applications) — so a single
 * FIFO queue covers them in issue order. Calls past the end of the queue resolve
 * empty, which keeps a test that only cares about the status row to one argument.
 */
function stubDb(...results: (OnboardingStatus[] | { id: string }[])[]) {
  const limit = vi.fn();
  for (const rows of results) {
    limit.mockResolvedValueOnce(rows);
  }
  limit.mockResolvedValue([]);

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit })),
    })),
  }));
  vi.mocked(getDb).mockReturnValue({ select } as unknown as ReturnType<typeof getDb>);
  return { select };
}

describe('shouldShowOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-1: true for a brand new user — no onboarding record and no history', async () => {
    // No status row, no resumes, no applications: the only shape that still shows it.
    stubDb([], [], []);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
  });

  it('E-1: true for a user who abandoned mid-flow', async () => {
    stubDb([statusRow({ currentStep: 'resume_upload', version: 4 })]);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
  });

  it('AC-11: false once completedAt is stamped', async () => {
    stubDb([
      statusRow({
        currentStep: 'first_application',
        completedAt: new Date('2026-08-26T02:00:00Z'),
      }),
    ]);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
  });

  it('AC-11: false when currentStep is completed even if completedAt was never written', async () => {
    stubDb([statusRow({ currentStep: 'completed', completedAt: null })]);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
  });

  it('AC-11: false for a skipped-through user who reached completed', async () => {
    stubDb([
      statusRow({
        currentStep: 'completed',
        resumeStepSkipped: true,
        applicationStepSkipped: true,
        completedAt: new Date('2026-08-26T02:00:00Z'),
      }),
    ]);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
  });

  // ── AC-10: returning-user bypass (WIC-1359) ────────────────────────────────
  //
  // AC-10 requires that a user with >=1 resume or >=1 application is never shown
  // onboarding. The subtlety is that "has a resume" is also true of a genuine new
  // user halfway through the flow — the flow is what created it — so the bypass is
  // scoped to users who have never engaged with onboarding: no status row, or the
  // pristine `welcome` row that GET /status auto-creates on first page load. The
  // mid-flow tests below are the guard on that scoping.

  it('AC-10: an established user with a resume and no onboarding row is not shown it', async () => {
    // No onboarding row — the shape of every user who predates the feature.
    stubDb([], SOME_ROW);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
  });

  it('AC-10: applications alone are enough, with no resume on file', async () => {
    // Status row empty, resume probe empty, application probe hits.
    stubDb([], [], SOME_ROW);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
  });

  it('AC-10: the auto-created welcome row does not by itself mean "show it"', async () => {
    // The cohort users actually hit: an established user loads the app, GET /status
    // auto-initializes a pristine welcome row for them, and before WIC-1359 that row
    // alone opened the modal over their populated dashboard.
    stubDb([statusRow()], SOME_ROW);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
  });

  it('AC-10 does not eject a new user who has just uploaded their first resume', async () => {
    // Mid-flow at resume_upload with a resume on file. Reading history here would
    // close the modal on the user in the middle of the step that created the row.
    const { select } = stubDb([statusRow({ currentStep: 'resume_upload' })], SOME_ROW);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('AC-10 does not eject a user still on welcome who has skipped a step', async () => {
    // Skipping is engagement: the flow is in progress even though currentStep has
    // not moved off welcome yet, so history must not be consulted.
    const { select } = stubDb([statusRow({ resumeStepSkipped: true })], SOME_ROW);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('reads history only when the status row cannot answer on its own', async () => {
    // Completed: one select, no probes — the cheapest and most common call.
    const completed = stubDb([statusRow({ currentStep: 'completed' })], SOME_ROW);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
    expect(completed.select).toHaveBeenCalledTimes(1);

    // Never seen in the flow: status row, then resume probe, then application probe.
    const unseen = stubDb([], [], []);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
    expect(unseen.select).toHaveBeenCalledTimes(3);

    // A resume short-circuits the application probe.
    const hasResume = stubDb([], SOME_ROW);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
    expect(hasResume.select).toHaveBeenCalledTimes(2);
  });
});
