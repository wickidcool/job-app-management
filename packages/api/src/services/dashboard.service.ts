import { sql, and, gte, eq, desc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { applications, statusHistory } from '../db/schema.js';
import { DashboardStats, ActivityItem, ApplicationStatus } from '../types/index.js';
import { ALL_STATUSES } from './status.service.js';

export async function getDashboardStats(): Promise<{
  stats: DashboardStats;
  recentActivity: ActivityItem[];
}> {
  const db = getDb();

  // Count by status
  const statusCounts = await db
    .select({
      status: applications.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(applications)
    .groupBy(applications.status);

  const byStatus: Record<ApplicationStatus, number> = Object.fromEntries(
    ALL_STATUSES.map((s) => [s, 0]),
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
    .where(and(eq(applications.status, 'applied'), gte(applications.appliedAt, oneWeekAgo)));

  // Applied this month
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  const [monthRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(applications)
    .where(and(eq(applications.status, 'applied'), gte(applications.appliedAt, oneMonthAgo)));

  // Response rate: applications that progressed beyond 'applied'
  const responded =
    byStatus.phone_screen + byStatus.interview + byStatus.offer + byStatus.rejected;
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
