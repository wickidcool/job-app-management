import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ApplicationRepository } from '../../../src/repository/dynamodb';
import { ok, unauthorized, internalError } from '../../../src/utils/response';
import { ApplicationStatus } from '../../../src/types/entities';
import { ActivityItem, DashboardResponse, DashboardStats } from '../../../src/types/api';

const repo = new ApplicationRepository();

const ALL_STATUSES: ApplicationStatus[] = [
  'saved',
  'applied',
  'phone_screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
];

function getUserId(event: APIGatewayProxyEvent): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  return claims?.['sub'] ?? null;
}

function startOfWeek(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfMonth(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) return unauthorized();

  try {
    const [statsEntity, recentApps] = await Promise.all([
      repo.getStats(userId),
      repo.getRecentActivity(userId, 10),
    ]);

    // Build stats
    const byStatus = Object.fromEntries(
      ALL_STATUSES.map((s) => [s, 0]),
    ) as Record<ApplicationStatus, number>;

    let total = 0;
    let appliedThisWeek = 0;
    let appliedThisMonth = 0;

    if (statsEntity) {
      for (const status of ALL_STATUSES) {
        byStatus[status] = statsEntity.counts[status] ?? 0;
      }
      total = statsEntity.counts['total'] ?? 0;
    }

    // Compute time-based stats from recent apps
    // (for accuracy, recompute from recent 100 apps)
    const { applications: allRecent } = await repo.list(userId, { limit: 100 });

    const weekStart = startOfWeek();
    const monthStart = startOfMonth();

    for (const app of allRecent) {
      if (app.appliedAt) {
        if (app.appliedAt >= weekStart) appliedThisWeek++;
        if (app.appliedAt >= monthStart) appliedThisMonth++;
      }
    }

    // Response rate: (phone_screen + interview + offer + rejected) / applied
    const applied = byStatus['applied'] ?? 0;
    const responded =
      (byStatus['phone_screen'] ?? 0) +
      (byStatus['interview'] ?? 0) +
      (byStatus['offer'] ?? 0) +
      (byStatus['rejected'] ?? 0);
    const responseRate = applied > 0 ? Math.round((responded / applied) * 100) / 100 : 0;

    const stats: DashboardStats = {
      total,
      byStatus,
      appliedThisWeek,
      appliedThisMonth,
      responseRate,
    };

    // Build recent activity from recent apps
    const recentActivity: ActivityItem[] = recentApps.map((app) => ({
      applicationId: app.id,
      jobTitle: app.jobTitle,
      company: app.company,
      action: app.status === 'saved' ? 'created' : 'status_changed',
      toStatus: app.status,
      timestamp: app.updatedAt,
    }));

    const response: DashboardResponse = { stats, recentActivity };
    return ok(response);
  } catch (err) {
    console.error('Unhandled error in DashboardHandler', err);
    return internalError();
  }
}
