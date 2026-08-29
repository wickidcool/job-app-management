import { sql, and, or, gte, lt, eq, asc, desc, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { applications, statusHistory } from '../db/schema.js';
import {
  DashboardStats,
  ActivityItem,
  ApplicationStatus,
  AttentionApplication,
  DashboardAttention,
} from '../types/index.js';
import { ALL_STATUSES } from './status.service.js';
import { DEFAULT_STALE_THRESHOLD_DAYS, staleWhere } from './stale.js';

// "Stale" is defined once, in `stale.ts`, and this module does not get to hold
// an opinion about it (WIC-1479). The attention card links to `/reports/stale`,
// so the count it shows has to be the number of rows that report renders. This
// module deliberately re-exports nothing under a local alias: an alias is how
// a second name for one threshold becomes a second threshold.

/**
 * Days after which a `saved` application counts as not-yet-submitted.
 *
 * This is emphatically *not* staleness — a saved application was never sent to
 * anyone, so there is nothing to follow up on. It is keyed off `createdAt`, not
 * `updatedAt`. It used to be surfaced as `staleSaved`, which put a second
 * meaning on the word "stale" and is exactly what WIC-1479 AC-N2a forbids.
 */
export const UNSUBMITTED_THRESHOLD_DAYS = 3;

/** Statuses an application can still be acted on from. */
const NON_TERMINAL_STATUSES: ApplicationStatus[] = [
  'saved',
  'applied',
  'phone_screen',
  'interview',
];

const INTERVIEWING_STATUSES: ApplicationStatus[] = ['phone_screen', 'interview'];

/**
 * How many rows each attention category returns for rendering. These bound the
 * *sample lists* only — the counts beside them are always full-table.
 */
const INTERVIEWING_SAMPLE_LIMIT = 5;
const ATTENTION_SAMPLE_LIMIT = 2;

/** Columns needed to render an attention row. Excludes `jobDescription` on purpose. */
const attentionColumns = {
  id: applications.id,
  jobTitle: applications.jobTitle,
  company: applications.company,
  status: applications.status,
  createdAt: applications.createdAt,
  updatedAt: applications.updatedAt,
};

type AttentionRow = {
  id: string;
  jobTitle: string;
  company: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function toAttentionApplication(row: AttentionRow): AttentionApplication {
  return {
    id: row.id,
    jobTitle: row.jobTitle,
    company: row.company,
    status: row.status as ApplicationStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getDashboardStats(userId?: string): Promise<{
  stats: DashboardStats;
  recentActivity: ActivityItem[];
  attention: DashboardAttention;
}> {
  const db = getDb();
  const userFilter = userId ? eq(applications.userId, userId) : undefined;

  // Count by status
  const statusCounts = await db
    .select({
      status: applications.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(applications)
    .where(userFilter)
    .groupBy(applications.status);

  const byStatus: Record<ApplicationStatus, number> = Object.fromEntries(
    ALL_STATUSES.map((s) => [s, 0])
  ) as Record<ApplicationStatus, number>;

  for (const row of statusCounts) {
    byStatus[row.status as ApplicationStatus] = row.count;
  }

  const total = Object.values(byStatus).reduce((sum, c) => sum + c, 0);

  // Applied this week
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const [weekRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(applications)
    .where(
      and(eq(applications.status, 'applied'), gte(applications.appliedAt, oneWeekAgo), userFilter)
    );

  // Applied this month
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  const [monthRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(applications)
    .where(
      and(eq(applications.status, 'applied'), gte(applications.appliedAt, oneMonthAgo), userFilter)
    );

  // Response rate: applications that progressed beyond 'applied'
  const responded = byStatus.phone_screen + byStatus.interview + byStatus.offer + byStatus.rejected;
  const totalApplied =
    byStatus.applied +
    byStatus.phone_screen +
    byStatus.interview +
    byStatus.offer +
    byStatus.rejected;
  const responseRate = totalApplied > 0 ? responded / totalApplied : 0;

  // Recent activity: last 10 status history entries with app info
  const recentRows = await db
    .select({
      applicationId: statusHistory.applicationId,
      jobTitle: applications.jobTitle,
      company: applications.company,
      fromStatus: statusHistory.fromStatus,
      toStatus: statusHistory.toStatus,
      changedAt: statusHistory.changedAt,
    })
    .from(statusHistory)
    .innerJoin(applications, eq(statusHistory.applicationId, applications.id))
    .where(userFilter)
    .orderBy(desc(statusHistory.changedAt))
    .limit(10);

  const recentActivity: ActivityItem[] = recentRows.map((row) => ({
    applicationId: row.applicationId,
    jobTitle: row.jobTitle,
    company: row.company,
    action: row.fromStatus ? 'status_changed' : 'created',
    fromStatus: row.fromStatus as ApplicationStatus | undefined,
    toStatus: row.toStatus as ApplicationStatus,
    timestamp: row.changedAt.toISOString(),
  }));

  // Attention/quick-win aggregates.
  //
  // These deliberately live here rather than on the client. The client only ever
  // holds a page of applications (`GET /api/applications` defaults to 50, ordered
  // by most-recently-updated), so a client-side "which of these are stale?" scan
  // is blind to exactly the rows it exists to surface. Every count below is over
  // the full table, the same way `byStatus` above is.
  const unsubmittedThreshold = new Date();
  unsubmittedThreshold.setDate(unsubmittedThreshold.getDate() - UNSUBMITTED_THRESHOLD_DAYS);

  // The same predicate `/reports/stale` runs, built by the same function. The
  // attention card's count and the report's row count therefore agree by
  // construction — there is no second expression here that could drift out of
  // step with it (WIC-1479 AC-N2b).
  const staleCondition = staleWhere();
  const missingDescriptionCondition = and(
    inArray(applications.status, NON_TERMINAL_STATUSES),
    or(isNull(applications.jobDescription), eq(applications.jobDescription, ''))
  );
  const unsubmittedSavedCondition = and(
    eq(applications.status, 'saved'),
    lt(applications.createdAt, unsubmittedThreshold)
  );
  const interviewingCondition = inArray(applications.status, INTERVIEWING_STATUSES);

  const countMatching = async (condition: ReturnType<typeof and>): Promise<number> => {
    const [row] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(applications)
      .where(and(condition, userFilter));
    return row?.count ?? 0;
  };

  const sampleMatching = async (
    condition: ReturnType<typeof and>,
    orderBy: ReturnType<typeof asc>,
    limit: number
  ): Promise<AttentionApplication[]> => {
    const rows = await db
      .select(attentionColumns)
      .from(applications)
      .where(and(condition, userFilter))
      .orderBy(orderBy)
      .limit(limit);
    return rows.map(toAttentionApplication);
  };

  const [
    staleCount,
    missingDescriptionCount,
    unsubmittedSavedCount,
    interviewingSamples,
    staleSamples,
    missingDescriptionSamples,
    unsubmittedSavedSamples,
  ] = await Promise.all([
    countMatching(staleCondition),
    countMatching(missingDescriptionCondition),
    countMatching(unsubmittedSavedCondition),
    // Most recently touched interviews first — they are the ones being prepped for.
    sampleMatching(interviewingCondition, desc(applications.updatedAt), INTERVIEWING_SAMPLE_LIMIT),
    // Most stale first: the oldest row is the one most in need of a follow-up.
    // Same condition as the count above, so the rows quick-wins lists are always
    // drawn from the population the attention card counted.
    sampleMatching(staleCondition, asc(applications.updatedAt), ATTENTION_SAMPLE_LIMIT),
    sampleMatching(
      missingDescriptionCondition,
      desc(applications.updatedAt),
      ATTENTION_SAMPLE_LIMIT
    ),
    // Longest-saved first.
    sampleMatching(unsubmittedSavedCondition, asc(applications.createdAt), ATTENTION_SAMPLE_LIMIT),
  ]);

  const attention: DashboardAttention = {
    staleThresholdDays: DEFAULT_STALE_THRESHOLD_DAYS,
    unsubmittedThresholdDays: UNSUBMITTED_THRESHOLD_DAYS,
    counts: {
      // Derived from `byStatus` rather than re-queried, so the two can never disagree.
      interviewing: byStatus.phone_screen + byStatus.interview,
      stale: staleCount,
      missingJobDescription: missingDescriptionCount,
      unsubmittedSaved: unsubmittedSavedCount,
    },
    samples: {
      interviewing: interviewingSamples,
      stale: staleSamples,
      missingJobDescription: missingDescriptionSamples,
      unsubmittedSaved: unsubmittedSavedSamples,
    },
  };

  return {
    stats: {
      total,
      byStatus,
      appliedThisWeek: weekRow?.count ?? 0,
      appliedThisMonth: monthRow?.count ?? 0,
      responseRate: Math.round(responseRate * 100) / 100,
    },
    recentActivity,
    attention,
  };
}
