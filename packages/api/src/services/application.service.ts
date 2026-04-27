import { eq, and, ilike, inArray, desc, asc, or, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDb } from '../db/client.js';
import { applications, statusHistory } from '../db/schema.js';
import { enqueueChange } from './change-queue.service.js';
import {
  ApplicationDTO,
  StatusHistoryDTO,
  CreateApplicationInput,
  UpdateApplicationInput,
  UpdateStatusInput,
  ListApplicationsParams,
  NotFoundError,
  VersionConflictError,
  InvalidTransitionError,
  ApplicationStatus,
} from '../types/index.js';
import { isValidTransition, getValidNextStatuses } from './status.service.js';
import type { Application, StatusHistoryEntry } from '../db/schema.js';

function toDTO(app: Application): ApplicationDTO {
  return {
    id: app.id,
    jobTitle: app.jobTitle,
    company: app.company,
    url: app.url,
    location: app.location,
    salaryRange: app.salaryRange,
    status: app.status as ApplicationStatus,
    coverLetterId: app.coverLetterId,
    resumeVersionId: app.resumeVersionId,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    appliedAt: app.appliedAt?.toISOString() ?? null,
    version: app.version,
  };
}

function historyToDTO(h: StatusHistoryEntry): StatusHistoryDTO {
  return {
    fromStatus: h.fromStatus as ApplicationStatus | null,
    toStatus: h.toStatus as ApplicationStatus,
    changedAt: h.changedAt.toISOString(),
    note: h.note,
  };
}

export async function createApplication(
  input: CreateApplicationInput
): Promise<{ application: ApplicationDTO }> {
  const db = getDb();
  const id = ulid();
  const now = new Date();
  const status = (input.status ?? 'saved') as ApplicationStatus;

  return db.transaction(async (tx) => {
    const [app] = await tx
      .insert(applications)
      .values({
        id,
        jobTitle: input.jobTitle,
        company: input.company,
        url: input.url ?? null,
        location: input.location ?? null,
        salaryRange: input.salaryRange ?? null,
        status,
        coverLetterId: input.coverLetterId ?? null,
        resumeVersionId: input.resumeVersionId ?? null,
        appliedAt: status === 'applied' ? now : null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      })
      .returning();

    await tx.insert(statusHistory).values({
      id: ulid(),
      applicationId: id,
      fromStatus: null,
      toStatus: status,
      changedAt: now,
    });

    enqueueChange('application', id, 'created');
    return { application: toDTO(app) };
  });
}

export async function getApplication(
  id: string
): Promise<{ application: ApplicationDTO; statusHistory: StatusHistoryDTO[] }> {
  const db = getDb();

  const [app] = await db.select().from(applications).where(eq(applications.id, id));
  if (!app) throw new NotFoundError('Application');

  const history = await db
    .select()
    .from(statusHistory)
    .where(eq(statusHistory.applicationId, id))
    .orderBy(asc(statusHistory.changedAt));

  return {
    application: toDTO(app),
    statusHistory: history.map(historyToDTO),
  };
}

export async function listApplications(params: ListApplicationsParams): Promise<{
  applications: ApplicationDTO[];
  nextPage?: string;
  totalCount: number;
}> {
  const db = getDb();
  const limit = Math.min(params.limit ?? 50, 100);

  const conditions = [];

  if (params.status) {
    const VALID_STATUSES: ApplicationStatus[] = [
      'saved',
      'applied',
      'phone_screen',
      'interview',
      'offer',
      'rejected',
      'withdrawn',
    ];
    const statuses = params.status
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is ApplicationStatus => VALID_STATUSES.includes(s as ApplicationStatus));
    if (statuses.length === 0) {
      // No valid status values — return empty result
      return { applications: [], totalCount: 0 };
    }
    if (statuses.length === 1) {
      conditions.push(eq(applications.status, statuses[0]));
    } else {
      conditions.push(inArray(applications.status, statuses));
    }
  }

  if (params.company) {
    conditions.push(ilike(applications.company, `%${params.company}%`));
  }

  if (params.search) {
    conditions.push(
      or(
        ilike(applications.jobTitle, `%${params.search}%`),
        ilike(applications.company, `%${params.search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Offset-based pagination: decode page token as offset
  let offset = 0;
  if (params.page) {
    try {
      offset = parseInt(Buffer.from(params.page, 'base64url').toString('utf-8'), 10);
    } catch {
      // Invalid page token — start from beginning
    }
  }

  // Determine sort column and direction
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

  // Count total matching records
  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(applications)
    .where(whereClause);

  const rows = await db
    .select()
    .from(applications)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  let nextPage: string | undefined;
  if (hasMore) {
    nextPage = Buffer.from(String(offset + limit)).toString('base64url');
  }

  return {
    applications: page.map(toDTO),
    nextPage,
    totalCount: count,
  };
}

export async function updateApplication(
  id: string,
  input: UpdateApplicationInput
): Promise<{ application: ApplicationDTO }> {
  const db = getDb();

  // Build update payload (only provided fields)
  const updates: Partial<typeof applications.$inferInsert> = {};
  if (input.jobTitle !== undefined) updates.jobTitle = input.jobTitle;
  if (input.company !== undefined) updates.company = input.company;
  if ('url' in input) updates.url = input.url;
  if ('location' in input) updates.location = input.location;
  if ('salaryRange' in input) updates.salaryRange = input.salaryRange;
  if ('coverLetterId' in input) updates.coverLetterId = input.coverLetterId;
  if ('resumeVersionId' in input) updates.resumeVersionId = input.resumeVersionId;

  const [updated] = await db
    .update(applications)
    .set({ ...updates, updatedAt: new Date(), version: sql`${applications.version} + 1` })
    .where(and(eq(applications.id, id), eq(applications.version, input.version)))
    .returning();

  if (!updated) {
    // Distinguish not found vs version conflict
    const [existing] = await db.select().from(applications).where(eq(applications.id, id));
    if (!existing) throw new NotFoundError('Application');
    throw new VersionConflictError();
  }

  enqueueChange('application', id, 'updated');
  return { application: toDTO(updated) };
}

export async function deleteApplication(id: string): Promise<void> {
  const db = getDb();
  const [deleted] = await db
    .delete(applications)
    .where(eq(applications.id, id))
    .returning({ id: applications.id });

  if (!deleted) throw new NotFoundError('Application');
}

export async function updateApplicationStatus(
  id: string,
  input: UpdateStatusInput
): Promise<{ application: ApplicationDTO; statusHistory: StatusHistoryDTO[] }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    // Lock the row
    const [current] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, id))
      .for('update');

    if (!current) throw new NotFoundError('Application');

    if (current.version !== input.version) throw new VersionConflictError();

    const fromStatus = current.status as ApplicationStatus;
    const toStatus = input.status;

    if (!isValidTransition(fromStatus, toStatus)) {
      throw new InvalidTransitionError(fromStatus, toStatus, getValidNextStatuses(fromStatus));
    }

    const now = new Date();

    const [updated] = await tx
      .update(applications)
      .set({
        status: toStatus,
        appliedAt: toStatus === 'applied' && !current.appliedAt ? now : current.appliedAt,
        version: current.version + 1,
        updatedAt: now,
      })
      .where(eq(applications.id, id))
      .returning();

    await tx.insert(statusHistory).values({
      id: ulid(),
      applicationId: id,
      fromStatus,
      toStatus,
      note: input.note ?? null,
      changedAt: now,
    });

    const history = await tx
      .select()
      .from(statusHistory)
      .where(eq(statusHistory.applicationId, id))
      .orderBy(asc(statusHistory.changedAt));

    return {
      application: toDTO(updated),
      statusHistory: history.map(historyToDTO),
    };
  });
}
