import { eq, and, inArray, notInArray, lte, lt, gte, asc, desc, isNotNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { applications, statusHistory } from '../db/schema.js';
import type {
  ApplicationStatus,
  ActiveStatus,
  FitTier,
  PipelineReportResponse,
  NeedsActionReportResponse,
  NeedsActionApplication,
  StaleReportResponse,
  StaleApplication,
  ClosedLoopReportResponse,
  ClosedLoopApplication,
  ByFitTierReportResponse,
  FitTierApplication,
  PipelineParams,
  NeedsActionParams,
  StaleParams,
  ClosedLoopParams,
  FitTierParams,
} from '../types/index.js';

const ACTIVE_STATUSES: ActiveStatus[] = ['saved', 'applied', 'phone_screen', 'interview'];
const TERMINAL_STATUSES: ApplicationStatus[] = ['offer', 'rejected', 'withdrawn'];
const PIPELINE_STATUS_ORDER: ActiveStatus[] = ['saved', 'applied', 'phone_screen', 'interview'];
const FIT_TIER_ORDER: FitTier[] = ['strong_fit', 'moderate_fit', 'weak_fit', 'not_analyzed'];

function decodeCursor(cursor: string): number {
  try {
    return parseInt(Buffer.from(cursor, 'base64url').toString('utf-8'), 10);
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

export async function getPipelineReport(
  params: PipelineParams = {},
  userId?: string
): Promise<PipelineReportResponse> {
  const db = getDb();

  const sortOrder = params.sortOrder === 'asc' ? asc : desc;
  let orderBy;
  switch (params.sortBy) {
    case 'createdAt':
      orderBy = sortOrder(applications.createdAt);
      break;
    case 'company':
      orderBy = sortOrder(applications.company);
      break;
    default:
      orderBy = sortOrder(applications.updatedAt);
  }

  const whereClause = userId
    ? and(inArray(applications.status, ACTIVE_STATUSES), eq(applications.userId, userId))
    : inArray(applications.status, ACTIVE_STATUSES);

  const rows = await db
    .select({
      id: applications.id,
      jobTitle: applications.jobTitle,
      company: applications.company,
      location: applications.location,
      nextAction: applications.nextAction,
      nextActionDue: applications.nextActionDue,
      status: applications.status,
      updatedAt: applications.updatedAt,
      createdAt: applications.createdAt,
    })
    .from(applications)
    .where(whereClause)
    .orderBy(orderBy);

  const groups = PIPELINE_STATUS_ORDER.map((status) => {
    const appsForStatus = rows
      .filter((r) => r.status === status)
      .map((r) => ({
        id: r.id,
        jobTitle: r.jobTitle,
        company: r.company,
        location: r.location,
        nextAction: r.nextAction,
        nextActionDue: r.nextActionDue,
        updatedAt: r.updatedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      }));
    return { status, count: appsForStatus.length, applications: appsForStatus };
  });

  const byStatus = Object.fromEntries(
    groups.map((g) => [g.status, g.count])
  ) as Partial<Record<ActiveStatus, number>>;

  return {
    groups,
    totals: {
      active: rows.length,
      byStatus,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function getNeedsActionReport(
  params: NeedsActionParams = {},
  userId?: string
): Promise<NeedsActionReportResponse> {
  const db = getDb();
  const days = Math.min(Math.max(params.days ?? 7, 1), 365);
  const includeOverdue = params.includeOverdue !== false;
  const limit = Math.min(params.limit ?? 50, 100);
  const offset = params.cursor ? decodeCursor(params.cursor) : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + days);

  const todayStr = today.toISOString().split('T')[0];
  const thresholdStr = threshold.toISOString().split('T')[0];

  const conditions = [
    isNotNull(applications.nextActionDue),
    isNotNull(applications.nextAction),
    notInArray(applications.status, TERMINAL_STATUSES),
    ...(userId ? [eq(applications.userId, userId)] : []),
  ];

  if (includeOverdue) {
    // All apps where nextActionDue <= threshold
    conditions.push(lte(applications.nextActionDue, thresholdStr));
  } else {
    // Only upcoming: today <= nextActionDue <= threshold
    conditions.push(gte(applications.nextActionDue, todayStr));
    conditions.push(lte(applications.nextActionDue, thresholdStr));
  }

  const rows = await db
    .select()
    .from(applications)
    .where(and(...conditions))
    .orderBy(asc(applications.nextActionDue))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const todayMs = today.getTime();
  const appsWithUrgency: NeedsActionApplication[] = page.map((r) => {
    const dueDate = new Date(r.nextActionDue!);
    const diffDays = Math.floor((dueDate.getTime() - todayMs) / (1000 * 60 * 60 * 24));
    let urgency: 'overdue' | 'due_soon' | 'upcoming';
    if (diffDays < 0) urgency = 'overdue';
    else if (diffDays <= 3) urgency = 'due_soon';
    else urgency = 'upcoming';

    return {
      id: r.id,
      jobTitle: r.jobTitle,
      company: r.company,
      status: r.status as ApplicationStatus,
      nextAction: r.nextAction!,
      nextActionDue: r.nextActionDue!,
      daysUntilDue: diffDays,
      urgency,
      contact: r.contact,
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  // Sort: overdue first (most overdue), then upcoming by date
  appsWithUrgency.sort((a, b) => {
    if (a.urgency === 'overdue' && b.urgency !== 'overdue') return -1;
    if (a.urgency !== 'overdue' && b.urgency === 'overdue') return 1;
    return a.daysUntilDue - b.daysUntilDue;
  });

  const overdue = appsWithUrgency.filter((a) => a.urgency === 'overdue').length;
  const dueSoon = appsWithUrgency.filter((a) => a.urgency === 'due_soon').length;
  const upcoming = appsWithUrgency.filter((a) => a.urgency === 'upcoming').length;

  return {
    applications: appsWithUrgency,
    summary: { overdue, dueSoon, upcoming, total: appsWithUrgency.length },
    nextCursor: hasMore ? encodeCursor(offset + limit) : undefined,
    generatedAt: new Date().toISOString(),
  };
}

export async function getStaleReport(params: StaleParams = {}, userId?: string): Promise<StaleReportResponse> {
  const db = getDb();
  const staleDays = Math.min(Math.max(params.days ?? 14, 1), 365);
  const limit = Math.min(params.limit ?? 50, 100);
  const offset = params.cursor ? decodeCursor(params.cursor) : 0;

  const VALID_STATUSES: ApplicationStatus[] = [
    'saved',
    'applied',
    'phone_screen',
    'interview',
    'offer',
    'rejected',
    'withdrawn',
  ];

  let staleStatuses: ApplicationStatus[];
  if (params.status) {
    staleStatuses = params.status
      .split(',')
      .map((s) => s.trim() as ApplicationStatus)
      .filter((s) => VALID_STATUSES.includes(s));
  } else {
    staleStatuses = ['applied', 'phone_screen'];
  }

  const threshold = new Date();
  threshold.setDate(threshold.getDate() - staleDays);

  const rows = await db
    .select()
    .from(applications)
    .where(
      and(
        inArray(applications.status, staleStatuses),
        lt(applications.updatedAt, threshold),
        ...(userId ? [eq(applications.userId, userId)] : [])
      )
    )
    .orderBy(asc(applications.updatedAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const now = Date.now();

  // Get last status change times from status_history for each app
  const appIds = page.map((r) => r.id);
  const historyMap = new Map<string, string>();

  if (appIds.length > 0) {
    const lastChanges = await db
      .select({
        applicationId: statusHistory.applicationId,
        changedAt: statusHistory.changedAt,
      })
      .from(statusHistory)
      .where(inArray(statusHistory.applicationId, appIds))
      .orderBy(desc(statusHistory.changedAt));

    for (const h of lastChanges) {
      if (!historyMap.has(h.applicationId)) {
        historyMap.set(h.applicationId, h.changedAt.toISOString());
      }
    }
  }

  const staleApps: StaleApplication[] = page.map((r) => {
    const daysSinceUpdate = Math.floor((now - r.updatedAt.getTime()) / (1000 * 60 * 60 * 24));
    return {
      id: r.id,
      jobTitle: r.jobTitle,
      company: r.company,
      status: r.status as ApplicationStatus,
      daysSinceUpdate,
      lastStatusChange: historyMap.get(r.id) ?? r.createdAt.toISOString(),
      contact: r.contact,
      url: r.url,
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  const byStatus: Partial<Record<ApplicationStatus, number>> = {};
  for (const app of staleApps) {
    byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;
  }

  const averageDaysStale =
    staleApps.length > 0
      ? Math.round(
          staleApps.reduce((sum, a) => sum + a.daysSinceUpdate, 0) / staleApps.length
        )
      : 0;

  return {
    applications: staleApps,
    summary: { total: staleApps.length, byStatus, averageDaysStale },
    nextCursor: hasMore ? encodeCursor(offset + limit) : undefined,
    generatedAt: new Date().toISOString(),
  };
}

export async function getClosedLoopReport(
  params: ClosedLoopParams = {},
  userId?: string
): Promise<ClosedLoopReportResponse> {
  const db = getDb();
  const limit = Math.min(params.limit ?? 50, 100);
  const offset = params.cursor ? decodeCursor(params.cursor) : 0;

  const VALID_TERMINAL: Array<'offer' | 'rejected' | 'withdrawn'> = [
    'offer',
    'rejected',
    'withdrawn',
  ];

  let terminalStatuses: Array<'offer' | 'rejected' | 'withdrawn'>;
  if (params.status) {
    terminalStatuses = params.status
      .split(',')
      .map((s) => s.trim() as 'offer' | 'rejected' | 'withdrawn')
      .filter((s) => VALID_TERMINAL.includes(s));
  } else {
    terminalStatuses = VALID_TERMINAL;
  }

  const conditions = [
    inArray(applications.status, terminalStatuses),
    ...(userId ? [eq(applications.userId, userId)] : []),
  ];

  if (params.period && params.period !== 'all') {
    const daysMap: Record<string, number> = { '30d': 30, '60d': 60, '90d': 90 };
    const days = daysMap[params.period];
    if (days) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      conditions.push(gte(applications.updatedAt, since));
    }
  }

  const rows = await db
    .select()
    .from(applications)
    .where(and(...conditions))
    .orderBy(desc(applications.updatedAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const appIds = page.map((r) => r.id);

  // Get the terminal-status history entries to determine closedAt and previousStatus
  const closedAtMap = new Map<string, { closedAt: string; previousStatus?: ApplicationStatus }>();

  if (appIds.length > 0) {
    // Get all history for these apps, ordered chronologically
    const allHistory = await db
      .select()
      .from(statusHistory)
      .where(inArray(statusHistory.applicationId, appIds))
      .orderBy(asc(statusHistory.changedAt));

    // Group by applicationId to find the last entry (terminal) and the one before it
    const byApp = new Map<string, typeof allHistory>();
    for (const h of allHistory) {
      if (!byApp.has(h.applicationId)) byApp.set(h.applicationId, []);
      byApp.get(h.applicationId)!.push(h);
    }

    for (const [appId, history] of byApp.entries()) {
      const last = history[history.length - 1];
      const secondToLast = history[history.length - 2];
      closedAtMap.set(appId, {
        closedAt: last.changedAt.toISOString(),
        previousStatus: secondToLast
          ? (secondToLast.toStatus as ApplicationStatus)
          : undefined,
      });
    }
  }

  const closedApps: ClosedLoopApplication[] = page.map((r) => {
    const closedInfo = closedAtMap.get(r.id);
    const closedAt = closedInfo?.closedAt ?? r.updatedAt.toISOString();
    const daysInPipeline = Math.floor(
      (new Date(closedAt).getTime() - r.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    return {
      id: r.id,
      jobTitle: r.jobTitle,
      company: r.company,
      status: r.status as 'offer' | 'rejected' | 'withdrawn',
      closedAt,
      previousStatus: closedInfo?.previousStatus ?? null,
      daysInPipeline,
      salaryRange: r.salaryRange,
      compTarget: r.compTarget,
    };
  });

  const offers = closedApps.filter((a) => a.status === 'offer').length;
  const rejections = closedApps.filter((a) => a.status === 'rejected').length;
  const withdrawn = closedApps.filter((a) => a.status === 'withdrawn').length;
  const averageTimeToClose =
    closedApps.length > 0
      ? Math.round(closedApps.reduce((s, a) => s + a.daysInPipeline, 0) / closedApps.length)
      : 0;

  // Compute rejectionsByStage from previous statuses of rejected apps
  const rejectedApps = closedApps.filter((a) => a.status === 'rejected');
  const stageCounts = new Map<ApplicationStatus, number>();
  for (const app of rejectedApps) {
    if (app.previousStatus) {
      stageCounts.set(app.previousStatus, (stageCounts.get(app.previousStatus) ?? 0) + 1);
    }
  }
  const rejectionsByStage = Array.from(stageCounts.entries()).map(([stage, count]) => ({
    stage,
    count,
    percentage: rejections > 0 ? Math.round((count / rejections) * 100) : 0,
  }));

  return {
    applications: closedApps,
    summary: {
      total: closedApps.length,
      offers,
      rejections,
      withdrawn,
      rejectionsByStage,
      averageTimeToClose,
    },
    nextCursor: hasMore ? encodeCursor(offset + limit) : undefined,
    generatedAt: new Date().toISOString(),
  };
}

export async function getByFitTierReport(
  params: FitTierParams = {},
  userId?: string
): Promise<ByFitTierReportResponse> {
  const db = getDb();

  const sortOrder = params.sortOrder === 'asc' ? asc : desc;
  let orderBy;
  switch (params.sortBy) {
    case 'createdAt':
      orderBy = sortOrder(applications.createdAt);
      break;
    default:
      orderBy = sortOrder(applications.updatedAt);
  }

  const conditions = [];
  if (!params.includeTerminal) {
    conditions.push(notInArray(applications.status, TERMINAL_STATUSES));
  }
  if (userId) {
    conditions.push(eq(applications.userId, userId));
  }

  const rows = await db
    .select({
      id: applications.id,
      jobTitle: applications.jobTitle,
      company: applications.company,
      status: applications.status,
      updatedAt: applications.updatedAt,
    })
    .from(applications)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(orderBy);

  // UC-3 integration not yet implemented — all apps are 'not_analyzed'
  const allApps: FitTierApplication[] = rows.map((r) => ({
    id: r.id,
    jobTitle: r.jobTitle,
    company: r.company,
    status: r.status as ApplicationStatus,
    fitTier: 'not_analyzed' as FitTier,
    updatedAt: r.updatedAt.toISOString(),
  }));

  const groups = FIT_TIER_ORDER.map((tier) => {
    const appsForTier = allApps.filter((a) => a.fitTier === tier);
    return { tier, count: appsForTier.length, applications: appsForTier };
  });

  const byTier = Object.fromEntries(
    groups.map((g) => [g.tier, g.count])
  ) as Partial<Record<FitTier, number>>;

  return {
    groups,
    summary: {
      total: allApps.length,
      analyzed: 0,
      notAnalyzed: allApps.length,
      byTier,
    },
    generatedAt: new Date().toISOString(),
  };
}
