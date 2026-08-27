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

/**
 * Stub the single `select().from().where().limit()` chain that
 * getOnboardingStatus issues, and count how many selects the service makes.
 */
function stubDb(rows: OnboardingStatus[]) {
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
  vi.mocked(getDb).mockReturnValue({ select } as unknown as ReturnType<typeof getDb>);
  return { select };
}

/**
 * A db double for the *established user* AC-10 describes: the onboarding_status
 * read comes back empty, but every subsequent table read — the resume /
 * application history AC-10 requires the service to consult — returns a row.
 * Today the service issues only the first read, so the later rows are never
 * consumed and the it.fails below stays red-by-design; once AC-10 is
 * implemented they are consumed and it flips.
 */
function stubEstablishedUser() {
  const limit = vi
    .fn()
    .mockResolvedValueOnce([]) // onboarding_status: no row
    .mockResolvedValue([{ id: '01HXRESUME0000000000000001' }]); // resumes / applications
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ limit }),
    }),
  });
  vi.mocked(getDb).mockReturnValue({ select } as unknown as ReturnType<typeof getDb>);
  return { select };
}

describe('shouldShowOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-1: true for a user with no onboarding record at all', async () => {
    stubDb([]);
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

  // ── AC-10: returning-user bypass ───────────────────────────────────────────
  //
  // KNOWN GAP (WIC-1359). AC-10 requires that a user with >=1 resume or >=1
  // application never sees onboarding, regardless of whether an onboarding row
  // exists. shouldShowOnboarding reads only the onboarding_status table, so an
  // established user who predates the feature — and therefore has no row — is
  // told to show the flow. The two tests below pin both halves of that: the
  // first is the behaviour AC-10 asks for and currently does not hold; the
  // second is a sentinel on the actual cause (the service never looks at
  // resume or application history).
  //
  // Which of the two is the guaranteed trip-wire, precisely: the **sentinel**
  // is, for any fix shape — consulting resume/application history at all means
  // more than one select. The `it.fails` flips for the natural
  // `select…where…limit` fix shape, which is what stubEstablishedUser doubles.
  // A fix built on a count aggregate with no `.limit()` would instead run off
  // the end of the stubbed chain and fail by a different route. Either way the
  // suite goes red on a fix; only the sentinel is red for a guaranteed reason.

  it.fails(
    'AC-10: an established user with resumes/applications must NOT be shown onboarding',
    async () => {
      // No onboarding row, but resume/application history exists — the shape of
      // every established user who predates the feature.
      stubEstablishedUser();
      await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
    }
  );

  it('AC-10 sentinel: shouldShowOnboarding consults only onboarding_status', async () => {
    // One select == one table read (onboarding_status). If someone implements
    // AC-10 by adding resume/application count queries, this count changes and
    // this test fails — the guaranteed signal that the gap above is closed.
    // Update it together with the it.fails above.
    const { select } = stubDb([]);
    await shouldShowOnboarding(USER_ID);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
