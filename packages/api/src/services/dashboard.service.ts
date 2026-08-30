import { sql, and, gte, eq, desc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { applications, statusHistory } from '../db/schema.js';
import { DashboardStats, ActivityItem, ApplicationStatus } from '../types/index.js';
import { ALL_STATUSES } from './status.service.js';

export async function getDashboardStats(userId?: string): Promise<{
  stats: DashboardStats;
  recentActivity: ActivityItem[];
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

  // ── Submission-window metrics (WIC-1515) ──────────────────────────────────
  //
  // Both count the *act of applying*, not the application's current state: the
  // predicate is `appliedAt` falling inside the window, and nothing else.
  //
  // These deliberately do NOT filter on `status = 'applied'`. That filter was
  // the original defect: `appliedAt` survives a status change
  // (`application.service.ts` preserves `current.appliedAt`), but the row stops
  // matching the moment the application advances, so moving one of this week's
  // three submissions to `phone_screen` dropped "Applied This Week" from 3 to 2
  // — the metric decremented on the outcome the product exists to produce.
  //
  // Every status is therefore in scope, including the terminal ones. An
  // application that was submitted and then rejected or withdrawn was still
  // submitted, and a count of submissions must say so. Rows that were never
  // submitted are excluded for free: `applied_at` is NULL on them, and
  // `NULL >= $1` is NULL, which SQL does not treat as a match.
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Rolling 7 days, ending now.
  const oneWeekAgo = new Date(now - 7 * DAY_MS);

  const [weekRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(applications)
    .where(and(gte(applications.appliedAt, oneWeekAgo), userFilter));

  // Rolling 30 days, ending now — NOT calendar month-to-date.
  //
  // Computed by subtracting a fixed span rather than with `setMonth(m - 1)`,
  // which overflows on short months and silently varied the window between 28
  // and 31 days depending on the day it was read: on May 31 it produced April
  // 31 -> May 1 (a 30-day window), and on March 31 it produced Feb 31 ->
  // March 3 (a 28-day window). Any surface that renders this must label it
  // "last 30 days"; see docs/architecture/DATA_MODEL.md.
  const thirtyDaysAgo = new Date(now - 30 * DAY_MS);

  const [monthRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(applications)
    .where(and(gte(applications.appliedAt, thirtyDaysAgo), userFilter));

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

  return {
    stats: {
      total,
      byStatus,
      appliedThisWeek: weekRow?.count ?? 0,
      appliedThisMonth: monthRow?.count ?? 0,
      responseRate: Math.round(responseRate * 100) / 100,
    },
    recentActivity,
  };
}
