import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Column, Param, SQL, StringChunk, Table, eq, getTableName, is } from 'drizzle-orm';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client.js';
import { shouldShowOnboarding } from '../src/services/onboarding.service.js';
import { onboardingStatus, resumes } from '../src/db/schema.js';
import type { OnboardingStatus } from '../src/db/schema.js';

const USER_ID = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

const STARTED_AT = new Date('2026-08-26T00:00:00.000Z');

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
    startedAt: STARTED_AT,
    completedAt: null,
    createdAt: new Date('2026-08-26T00:00:00.000Z'),
    updatedAt: new Date('2026-08-26T00:00:00.000Z'),
    version: 1,
    ...overrides,
  } as OnboardingStatus;
}

/** A resume/application existence probe returns an id and nothing else. */
const SOME_ROW = [{ id: '01HXWORK0000000000000001' }];

/** The tables shouldShowOnboarding is allowed to read. */
type StubbedTable = 'onboarding_status' | 'resumes' | 'applications';

/** A captured `where` argument, rendered into something a test can assert on. */
type Predicate = { sql: string; params: unknown[] };

/** One read the service actually issued, in issue order. */
type Read = { table: StubbedTable; where: Predicate | null };

/**
 * Render a drizzle condition to `column op ?` text plus the bound values.
 *
 * Conditions are opaque SQL objects, so the only way to assert a predicate was
 * built — and built over the right columns — is to walk the chunk tree. Params
 * are pulled out rather than inlined so a test can compare a Date or an id by
 * value instead of by its string form.
 */
function describePredicate(condition: unknown): Predicate {
  const params: unknown[] = [];
  const render = (node: unknown): string => {
    if (is(node, StringChunk)) return node.value.join('');
    if (is(node, Column)) return `${getTableName(node.table)}.${node.name}`;
    if (is(node, Param)) {
      params.push(node.value);
      return '?';
    }
    if (is(node, SQL)) return node.queryChunks.map(render).join('');
    return String(node);
  };
  return { sql: render(condition), params };
}

/**
 * Stub the `select().from().where().limit()` chain, keyed by the table read.
 *
 * A queued result belongs to the table it was declared for, not to a call
 * position, so a read of the wrong table can never silently draw another
 * table's row (WIC-1371). Declaring a table with `[]` says "this read is
 * expected and finds nothing"; leaving it out says "this read must not happen
 * at all" and throws if it does.
 *
 * Every read is recorded in `reads` with its `where` argument, so a test can
 * assert both the sequence of tables consulted and the predicate each was
 * probed with. That second half is what makes the WIC-1370 `started_at` bound
 * visible at all: the double resolves whatever the table was declared with
 * regardless of predicate, so no count of reads can tell a bounded probe from
 * an unbounded one. A read that reaches `.limit()` without a `.where()` is
 * recorded with `where: null` rather than crashing, so a missing predicate
 * shows up as a failed assertion instead of a TypeError.
 */
function stubDb(tables: Partial<Record<StubbedTable, readonly unknown[]>>) {
  const reads: Read[] = [];

  const select = vi.fn(() => ({
    from: vi.fn((table: Table) => {
      const name = getTableName(table) as StubbedTable;
      if (!(name in tables)) {
        throw new Error(
          `stubDb: unexpected read of "${name}". This test declared ` +
            `[${Object.keys(tables).join(', ')}]. If the read is intended, declare ` +
            `"${name}" with an explicit result; if it is not, the service is reading ` +
            `the wrong table.`
        );
      }
      const rows = tables[name] ?? [];
      const record = (where: Predicate | null) => {
        reads.push({ table: name, where });
        return rows;
      };
      return {
        where: vi.fn((condition: unknown) => ({
          limit: vi.fn(async (_count?: number) =>
            record(condition == null ? null : describePredicate(condition))
          ),
        })),
        limit: vi.fn(async (_count?: number) => record(null)),
      };
    }),
  }));

  vi.mocked(getDb).mockReturnValue({ select } as unknown as ReturnType<typeof getDb>);
  return { select, reads };
}

/** The predicate every per-user read of `table` must carry. */
function scopedToUser(table: StubbedTable): Predicate {
  return { sql: `${table}.user_id = ?`, params: [USER_ID] };
}

/**
 * The same per-user predicate, additionally bounded in time (WIC-1370).
 *
 * The timestamp column differs per table — `resumes` stamps `uploaded_at`,
 * `applications` stamps `created_at` — so it is spelled out by the caller
 * rather than derived, which also makes a probe that bounded the wrong column
 * fail loudly.
 */
function scopedToUserBefore(table: StubbedTable, column: string, before: Date): Predicate {
  return {
    sql: `(${table}.user_id = ? and ${table}.${column} < ?)`,
    params: [USER_ID, before],
  };
}

describe('shouldShowOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-1: true for a brand new user — no onboarding record and no history', async () => {
    // No status row, no resumes, no applications: the only shape that still shows it.
    const { reads } = stubDb({ onboarding_status: [], resumes: [], applications: [] });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
    // Every read is scoped to this user, and each probe hits its own table.
    expect(reads).toEqual([
      { table: 'onboarding_status', where: scopedToUser('onboarding_status') },
      { table: 'resumes', where: scopedToUser('resumes') },
      { table: 'applications', where: scopedToUser('applications') },
    ]);
  });

  it('E-1: true for a user who abandoned mid-flow', async () => {
    // Mid-flow is engaged, so the probes do run (WIC-1370) — bounded by startedAt,
    // and this user has nothing predating their status row.
    stubDb({
      onboarding_status: [statusRow({ currentStep: 'resume_upload', version: 4 })],
      resumes: [],
      applications: [],
    });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
  });

  it('AC-11: false once completedAt is stamped', async () => {
    stubDb({
      onboarding_status: [
        statusRow({
          currentStep: 'first_application',
          completedAt: new Date('2026-08-26T02:00:00Z'),
        }),
      ],
    });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
  });

  it('AC-11: false when currentStep is completed even if completedAt was never written', async () => {
    stubDb({ onboarding_status: [statusRow({ currentStep: 'completed', completedAt: null })] });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
  });

  it('AC-11: false for a skipped-through user who reached completed', async () => {
    stubDb({
      onboarding_status: [
        statusRow({
          currentStep: 'completed',
          resumeStepSkipped: true,
          applicationStepSkipped: true,
          completedAt: new Date('2026-08-26T02:00:00Z'),
        }),
      ],
    });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
  });

  // ── AC-10: returning-user bypass (WIC-1359) ────────────────────────────────
  //
  // AC-10 requires that a user with >=1 resume or >=1 application is never shown
  // onboarding, unconditionally. The subtlety is that "has a resume" is also true of
  // a genuine new user halfway through the flow — the flow's step 3 is what created
  // it — so the probes cannot be unconditional either.
  //
  // The discriminator is time, not engagement (WIC-1370). For a user who has driven
  // the flow at least one step, only work created *before* their status row could
  // have come from somewhere other than the flow, so the probes are bounded by
  // `startedAt`. For a user the flow has never moved — no row, or the pristine
  // `welcome` row GET /status auto-creates on page load — there is no flow output to
  // exclude, so the probes are unbounded.
  //
  // The double resolves a declared table's rows regardless of predicate, so the read
  // sequences below cannot see that bound on their own. The two "scopes/leaves the
  // probes" tests assert the rendered `where` directly; they are what pin the fix.

  it('AC-10: an established user with a resume and no onboarding row is not shown it', async () => {
    // No onboarding row — the shape of every user who predates the feature.
    // `applications` is undeclared on purpose: the resume hit must short-circuit it.
    const { reads } = stubDb({ onboarding_status: [], resumes: SOME_ROW });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
    expect(reads.map((r) => r.table)).toEqual(['onboarding_status', 'resumes']);
    expect(reads[1].where).toEqual(scopedToUser('resumes'));
  });

  it('AC-10: applications alone are enough, with no resume on file', async () => {
    // Status row empty, resume probe empty, application probe hits.
    const { reads } = stubDb({ onboarding_status: [], resumes: [], applications: SOME_ROW });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
    expect(reads.map((r) => r.table)).toEqual(['onboarding_status', 'resumes', 'applications']);
    expect(reads[2].where).toEqual(scopedToUser('applications'));
  });

  it('AC-10: the auto-created welcome row does not by itself mean "show it"', async () => {
    // The cohort users actually hit: an established user loads the app, GET /status
    // auto-initializes a pristine welcome row for them, and before WIC-1359 that row
    // alone opened the modal over their populated dashboard.
    const { reads } = stubDb({ onboarding_status: [statusRow()], resumes: SOME_ROW });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
    expect(reads.map((r) => r.table)).toEqual(['onboarding_status', 'resumes']);
  });

  it('AC-10 for an established user whose row shows one "Get Started" click', async () => {
    // WIC-1370: the modal WIC-1359 put in front of this user is a thing they can
    // click. One click POSTs currentStep, and if engagement alone short-circuited to
    // "show", they would get onboarding over a populated dashboard forever. The
    // resume that answers here is older than the status row, so the bound keeps it.
    const { reads } = stubDb({
      onboarding_status: [statusRow({ currentStep: 'personal_info' })],
      resumes: SOME_ROW,
    });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
    expect(reads.map((r) => r.table)).toEqual(['onboarding_status', 'resumes']);
    expect(reads[1].where).toEqual(scopedToUserBefore('resumes', 'uploaded_at', STARTED_AT));
  });

  it('AC-10 for an established user who clicked "Skip for now" once', async () => {
    // Same cohort, the other button: handleSkipPersonalInfo POSTs a skip flag.
    const { reads } = stubDb({
      onboarding_status: [statusRow({ personalInfoStepSkipped: true })],
      resumes: SOME_ROW,
    });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
    expect(reads.map((r) => r.table)).toEqual(['onboarding_status', 'resumes']);
    expect(reads[1].where).toEqual(scopedToUserBefore('resumes', 'uploaded_at', STARTED_AT));
  });

  it('AC-10 does not eject a new user who has just uploaded their first resume', async () => {
    // Mid-flow at resume_upload with nothing predating the status row: the resume the
    // flow itself just created falls outside the startedAt bound, so both probes come
    // back empty and this user stays in the step that created it.
    const { reads } = stubDb({
      onboarding_status: [statusRow({ currentStep: 'resume_upload' })],
      resumes: [],
      applications: [],
    });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
    expect(reads.map((r) => r.table)).toEqual(['onboarding_status', 'resumes', 'applications']);
  });

  it('AC-10 does not eject a user still on welcome who has skipped a step', async () => {
    // Skipping is engagement: the flow is in progress even though currentStep has not
    // moved off welcome yet, and this user has no work predating their status row.
    const { reads } = stubDb({
      onboarding_status: [statusRow({ resumeStepSkipped: true })],
      resumes: [],
      applications: [],
    });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
    expect(reads.map((r) => r.table)).toEqual(['onboarding_status', 'resumes', 'applications']);
  });

  it('reads the status row scoped to the calling user', async () => {
    // The probe assertions below skip past this first clause, and no row-count test can
    // see it either — the double returns the queued status row whichever user_id the
    // clause names. Left unpinned, a status read scoped to the wrong user is invisible.
    const { reads } = stubDb({ onboarding_status: [statusRow()], resumes: [], applications: [] });
    await shouldShowOnboarding(USER_ID);

    expect(reads[0]).toEqual({
      table: 'onboarding_status',
      where: scopedToUser('onboarding_status'),
    });
  });

  it('scopes the probes by startedAt for a user who has engaged with the flow', async () => {
    // The read-sequence tests above pass with or without the bound, because the double
    // resolves a declared table's rows whatever the predicate says. This one reads the
    // predicate. A distinct startedAt proves the bound comes from the status row
    // rather than from a constant that happens to match the fixture.
    const startedAt = new Date('2026-08-26T01:23:45.000Z');
    const { reads } = stubDb({
      onboarding_status: [statusRow({ currentStep: 'resume_upload', startedAt })],
      resumes: [],
      applications: [],
    });
    await shouldShowOnboarding(USER_ID);

    expect(reads).toEqual([
      { table: 'onboarding_status', where: scopedToUser('onboarding_status') },
      { table: 'resumes', where: scopedToUserBefore('resumes', 'uploaded_at', startedAt) },
      {
        table: 'applications',
        where: scopedToUserBefore('applications', 'created_at', startedAt),
      },
    ]);
  });

  it('leaves the probes unbounded for a user the flow has never moved', async () => {
    // Deliberately NOT scoped: a new user who dismissed at welcome and then created an
    // application by hand must not be dragged back into onboarding by a startedAt bound
    // that excludes their own work. The pristine row carries a startedAt all the same,
    // so "no bound" here is a choice the service makes, not an absent value.
    const { reads } = stubDb({ onboarding_status: [statusRow()], resumes: [], applications: [] });
    await shouldShowOnboarding(USER_ID);

    expect(reads).toEqual([
      { table: 'onboarding_status', where: scopedToUser('onboarding_status') },
      { table: 'resumes', where: scopedToUser('resumes') },
      { table: 'applications', where: scopedToUser('applications') },
    ]);
  });

  it('reads history only when the status row cannot answer on its own', async () => {
    // Completed: the status read answers alone — the cheapest and most common call.
    const completed = stubDb({
      onboarding_status: [statusRow({ currentStep: 'completed' })],
    });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
    expect(completed.reads.map((r) => r.table)).toEqual(['onboarding_status']);

    // Never seen in the flow: status row, then resume probe, then application probe.
    const unseen = stubDb({ onboarding_status: [], resumes: [], applications: [] });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(true);
    expect(unseen.reads.map((r) => r.table)).toEqual([
      'onboarding_status',
      'resumes',
      'applications',
    ]);

    // A resume short-circuits the application probe.
    const hasResume = stubDb({ onboarding_status: [], resumes: SOME_ROW });
    await expect(shouldShowOnboarding(USER_ID)).resolves.toBe(false);
    expect(hasResume.reads.map((r) => r.table)).toEqual(['onboarding_status', 'resumes']);
  });

  // ── Guards on the harness itself (WIC-1371) ────────────────────────────────
  //
  // The previous stub bound a queued result to call *position*, so a read of the
  // wrong table drew whatever row was next in line and the suite stayed green.
  // These three tests pin the properties that make the AC-10 assertions above
  // mean what they say, so the harness cannot quietly regress to positional.

  it('harness: a read of an undeclared table throws instead of drawing another row', () => {
    const { select } = stubDb({ onboarding_status: [] });
    expect(() => select().from(resumes)).toThrow(/unexpected read of "resumes"/);
  });

  it('harness: results follow the table, not the call order', async () => {
    // Declared out of issue order, and the status row declared empty. If results
    // were positional, the first read would draw SOME_ROW.
    const { select, reads } = stubDb({ resumes: SOME_ROW, onboarding_status: [] });
    await expect(
      select().from(onboardingStatus).where(eq(onboardingStatus.userId, USER_ID)).limit(1)
    ).resolves.toEqual([]);
    await expect(
      select().from(resumes).where(eq(resumes.userId, USER_ID)).limit(1)
    ).resolves.toEqual(SOME_ROW);
    expect(reads.map((r) => r.table)).toEqual(['onboarding_status', 'resumes']);
  });

  it('harness: a read issued without a WHERE is recorded as unscoped', async () => {
    const { select, reads } = stubDb({ resumes: SOME_ROW });
    await select().from(resumes).limit(1);
    expect(reads).toEqual([{ table: 'resumes', where: null }]);
  });
});
