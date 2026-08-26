import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQLWrapper } from 'drizzle-orm';

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
 *
 * `whereSql()` renders every captured `where` predicate to real SQL, in issue order.
 * The double resolves whatever the queue says regardless of predicate, so row counts
 * cannot tell a scoped probe from an unscoped one — only the rendered clause can.
 */
function stubDb(...results: (OnboardingStatus[] | { id: string }[])[]) {
  const limit = vi.fn();
  for (const rows of results) {
    limit.mockResolvedValueOnce(rows);
  }
  limit.mockResolvedValue([]);

  const clauses: SQLWrapper[] = [];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((clause: SQLWrapper) => {
        clauses.push(clause);
        return { limit };
      }),
    })),
  }));
  vi.mocked(getDb).mockReturnValue({ select } as unknown as ReturnType<typeof getDb>);

  const dialect = new PgDialect();
  const whereSql = () => clauses.map((clause) => dialect.sqlToQuery(clause.getSQL()));
  return { select, whereSql };
}

// WIC-1364's `stubEstablishedUser()` is subsumed by the variadic stubDb above:
// `stubDb([], SOME_ROW)` is the same established-user double (empty status read,
// then a history probe that hits), and stubDb can also express the shapes AC-10
// has to *not* fire on. Its trip-wire role is now served by the real assertions
// below rather than by an `it.fails`.

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
  // onboarding, unconditionally. The subtlety is that "has a resume" is also true of
  // a genuine new user halfway through the flow — the flow's step 3 is what created
  // it — so the probes cannot be unconditional too.
  //
  // The discriminator is time, not engagement (WIC-1370). For a user who has driven
  // the flow at least one step, only work created *before* their status row could
  // have come from somewhere other than the flow, so the probes are bounded by
  // `startedAt`. For a user the flow has never moved — no row, or the pristine
  // `welcome` row GET /status auto-creates on page load — there is no flow output to
  // exclude, so the probes are unbounded.
  //
  // The db double resolves rows regardless of predicate, so row-count assertions
  // alone cannot see that bound. `whereSql` renders the actual clause; the two
  // "scopes ... by startedAt" tests below are what pin the fix.

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

  it('AC-10 for an established user whose row shows one "Get Started" click', async () => {
    // WIC-1370: the modal WIC-1359 put in front of this user is a thing they can
    // click. One click POSTs currentStep, and if engagement alone short-circuited to
    // "show", they would get onboarding over a populated dashboard forever.
    stubDb([statusRow({ currentStep: 'personal_info' })], SOME_ROW);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
  });

  it('AC-10 for an established user who clicked "Skip for now" once', async () => {
    // Same cohort, the other button: handleSkipPersonalInfo POSTs a skip flag.
    stubDb([statusRow({ personalInfoStepSkipped: true })], SOME_ROW);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
  });

  it('AC-10 does not eject a new user who has just uploaded their first resume', async () => {
    // Mid-flow at resume_upload with nothing predating the status row: the resume the
    // flow itself just created is excluded by the startedAt bound, so this user stays
    // in the step that created it.
    const { select } = stubDb([statusRow({ currentStep: 'resume_upload' })], [], []);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
    expect(select).toHaveBeenCalledTimes(3);
  });

  it('AC-10 does not eject a user still on welcome who has skipped a step', async () => {
    // Skipping is engagement: the flow is in progress even though currentStep has not
    // moved off welcome yet, and this user has no work predating their status row.
    const { select } = stubDb([statusRow({ resumeStepSkipped: true })], [], []);
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
    expect(select).toHaveBeenCalledTimes(3);
  });

  it('reads the status row scoped to the calling user', async () => {
    // The probe assertions below skip past this first clause, and no row-count test can
    // see it either — the double returns the queued status row whichever user_id the
    // clause names. Left unpinned, a status read scoped to the wrong user is invisible.
    const { whereSql } = stubDb([statusRow()], [], []);
    await shouldShowOnboarding(USER_ID);

    const [statusRead] = whereSql();
    expect(statusRead.sql).toBe('"onboarding_status"."user_id" = $1');
    expect(statusRead.params).toEqual([USER_ID]);
  });

  it('scopes the probes by startedAt for a user who has engaged with the flow', async () => {
    // The row-count tests above pass with or without the bound, because the double
    // resolves rows whatever the predicate says. This one reads the rendered SQL.
    const startedAt = new Date('2026-08-26T00:00:00.000Z');
    const { whereSql } = stubDb([statusRow({ currentStep: 'resume_upload', startedAt })], [], []);
    await shouldShowOnboarding(USER_ID);

    const [, resumeProbe, applicationProbe] = whereSql();
    expect(resumeProbe.sql).toBe('("resumes"."user_id" = $1 and "resumes"."uploaded_at" < $2)');
    expect(resumeProbe.params).toEqual([USER_ID, startedAt.toISOString()]);
    expect(applicationProbe.sql).toBe(
      '("applications"."user_id" = $1 and "applications"."created_at" < $2)'
    );
    expect(applicationProbe.params).toEqual([USER_ID, startedAt.toISOString()]);
  });

  it('leaves the probes unbounded for a user the flow has never moved', async () => {
    // Deliberately NOT scoped: a new user who dismissed at welcome and then created an
    // application by hand must not be dragged back into onboarding by a startedAt bound
    // that excludes their own work.
    const { whereSql } = stubDb([statusRow()], [], []);
    await shouldShowOnboarding(USER_ID);

    const [, resumeProbe, applicationProbe] = whereSql();
    expect(resumeProbe.sql).toBe('"resumes"."user_id" = $1');
    expect(resumeProbe.params).toEqual([USER_ID]);
    expect(applicationProbe.sql).toBe('"applications"."user_id" = $1');
    expect(applicationProbe.params).toEqual([USER_ID]);
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
