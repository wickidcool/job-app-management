import { eq, and, ilike, inArray, desc, asc, or, sql, gte, lte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDb } from '../db/client.js';
import { encodeCursor, parseCursor, PAGE_NAMES } from '../lib/pagination.js';
import { applications, statusHistory } from '../db/schema.js';
import { enqueueChange } from './change-queue.service.js';
import {
  AppError,
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
    contact: app.contact,
    compTarget: app.compTarget,
    nextAction: app.nextAction,
    nextActionDue: app.nextActionDue,
    // WIC-2023. `interviewDate` is TIMESTAMPTZ, so drizzle hands back a `Date`
    // and it needs the same `.toISOString()` treatment as `appliedAt` above.
    // `nextActionDue` is a `date({ mode: 'string' })` and is already a string --
    // do not copy its passthrough here.
    interviewDate: app.interviewDate?.toISOString() ?? null,
    jobDescription: app.jobDescription,
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
  input: CreateApplicationInput,
  userId?: string
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
        userId: userId ?? null,
        jobTitle: input.jobTitle,
        company: input.company,
        url: input.url ?? null,
        location: input.location ?? null,
        salaryRange: input.salaryRange ?? null,
        status,
        coverLetterId: input.coverLetterId ?? null,
        resumeVersionId: input.resumeVersionId ?? null,
        appliedAt: status === 'applied' ? now : null,
        contact: input.contact ?? null,
        compTarget: input.compTarget ?? null,
        nextAction: input.nextAction ?? null,
        nextActionDue: input.nextActionDue ?? null,
        interviewDate: input.interviewDate ? new Date(input.interviewDate) : null,
        jobDescription: input.jobDescription ?? null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      })
      .returning();

    await tx.insert(statusHistory).values({
      id: ulid(),
      userId: userId ?? null,
      applicationId: id,
      fromStatus: null,
      toStatus: status,
      changedAt: now,
    });

    // Pass the owner. processCatalogChange reads it off event.metadata.userId
    // (the shape resume.service.ts and catalog.service.ts both use) and decides
    // create-vs-update on it. Omitting it here left every application-triggered
    // extraction ownerless, which cost twice over: it fell through to a
    // slug-only company_catalog UPDATE that hit whichever tenant registered the
    // company first, and once migration 0017 made user_id NOT NULL the
    // auto-apply transaction died on a 23502 that flush() swallowed — silently,
    // for authenticated callers too.
    enqueueChange('application', id, 'created', { userId: userId ?? null });
    return { application: toDTO(app) };
  });
}

/**
 * Read one application, plus its status history.
 *
 * `userId` is `string`, not `string | undefined` (ADR-010 D2, WIC-2072). The where clause used to
 * be `userId ? and(eq(applications.id, id), eq(applications.userId, userId)) : eq(applications.id,
 * id)` — the `userId ? and(idTerm, ownerTerm) : idTerm` idiom `resume-variant.service.ts:55` names
 * as the WIC-1482 / WIC-1500 defect. The fallback still *looks* scoped because the id term
 * survives; what it drops is the owner term, turning a caller-supplied `id` into an IDOR read of
 * any tenant's application. A `: undefined` grep does not find this shape — match on the fallback.
 *
 * The `statusHistory` read below is keyed on `applicationId` alone and is safe only because this
 * read threw first, which is why the owner term here is not optional.
 *
 * Deliberately *not* repaired to `isNull(applications.userId)`. `applications.user_id` is nullable
 * (`schema.ts:38`) and the `userId ?? null` insert paths at `:74`/`:98` are live, so an `isNull()`
 * fallback would be a real reading — of somebody else's anonymous rows. Absence is an error here,
 * not a narrower query.
 */
export async function getApplication(
  id: string,
  userId: string
): Promise<{ application: ApplicationDTO; statusHistory: StatusHistoryDTO[] }> {
  // Belt and braces with the required type, per `getOrCreateProjectBySlug` (WIC-2070). Narrowing
  // the type is not the mechanism: `tsc` accepts a reintroduced `userId ?? undefined` at the call
  // site, and the value comes from a JWT `sub` claim that can be absent at runtime.
  if (!userId) {
    throw new AppError('BAD_REQUEST', 'userId is required to read an application', undefined, 400);
  }

  const db = getDb();

  const whereClause = and(eq(applications.id, id), eq(applications.userId, userId));

  const [app] = await db.select().from(applications).where(whereClause);
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

export async function listApplications(
  params: ListApplicationsParams,
  userId?: string
): Promise<{
  applications: ApplicationDTO[];
  nextPage?: string;
  totalCount: number;
}> {
  const db = getDb();
  const limit = Math.min(params.limit ?? 50, 100);

  const conditions = [];

  if (userId) {
    conditions.push(eq(applications.userId, userId));
  }

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

  // WIC-2189. Inclusive on both ends. The route has already validated these as
  // ISO-8601-with-offset and rejected an inverted range, so `new Date(...)` here
  // cannot produce an `Invalid Date` from a well-formed request.
  //
  // Neither bound needs an explicit `IS NOT NULL` companion: comparing a NULL
  // `interview_date` against either yields NULL, which the WHERE clause drops.
  // Unscheduled applications therefore fall out of a date-window query on their
  // own, which is the intended reading of the filter.
  if (params.interviewDateFrom) {
    conditions.push(gte(applications.interviewDate, new Date(params.interviewDateFrom)));
  }

  if (params.interviewDateTo) {
    conditions.push(lte(applications.interviewDate, new Date(params.interviewDateTo)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const offset = parseCursor(params.page, PAGE_NAMES);

  const sortOrder = params.sortOrder === 'asc' ? asc : desc;
  let orderBy: SQL[];
  switch (params.sortBy) {
    case 'createdAt':
      orderBy = [sortOrder(applications.createdAt)];
      break;
    case 'company':
      orderBy = [sortOrder(applications.company)];
      break;
    case 'interviewDate':
      // WIC-2189 — NULLS LAST is pinned explicitly on *both* directions rather
      // than inherited from Postgres.
      //
      // The default is NULLS LAST for ASC but NULLS FIRST for DESC, so a plain
      // `DESC` would open the list with every application that has no interview
      // scheduled. Most rows are NULL and will stay NULL for a long time, so
      // that default does not merely misplace a few rows — it fills the entire
      // first page with exactly the applications the sort was meant to push
      // aside, and does it only in one of the two directions.
      //
      // `applications.id` is a load-bearing tiebreaker, not decoration. The NULL
      // block is large and every row in it compares equal on the sort key, so
      // its internal order is unspecified. Offset pagination issues one query
      // per page, and Postgres is free to order an equal-ranked block
      // differently between them — which silently drops some rows from the
      // result set and repeats others. A unique trailing key makes the total
      // order deterministic and the paging stable. ULIDs sort by creation time,
      // so the tail reads oldest-first regardless of direction, which is a
      // stable choice rather than a meaningful one.
      orderBy = [
        params.sortOrder === 'asc'
          ? sql`${applications.interviewDate} asc nulls last`
          : sql`${applications.interviewDate} desc nulls last`,
        asc(applications.id),
      ];
      break;
    default:
      orderBy = [sortOrder(applications.updatedAt)];
  }

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(applications)
    .where(whereClause);

  const rows = await db
    .select()
    .from(applications)
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  let nextPage: string | undefined;
  if (hasMore) {
    nextPage = encodeCursor(offset + limit);
  }

  return {
    applications: page.map(toDTO),
    nextPage,
    totalCount: count,
  };
}

/**
 * Update one application, under optimistic locking, for a required owner.
 *
 * `userId` is `string`, not `string | undefined` (ADR-010 D2, WIC-2071). Both where clauses below
 * used to carry an owner ternary of the `userId ? and(idTerm, ownerTerm) : idTerm` shape that
 * `resume-variant.service.ts:55` records as the WIC-1482 / WIC-1500 defect:
 *
 *   const whereClause = userId ? and(baseWhere, eq(applications.userId, userId)) : baseWhere;
 *
 * The fallback reads as scoped — `baseWhere` still pins `(id, version)` — but the term it drops
 * is the *owner*, so an absent owner made this an IDOR **write**: any tenant's application,
 * addressable by id plus a guessable small-integer `version`. The audit does not catch it
 * (`--stats` lists `:271` under "unique/pk-scoped writes", one row at most, and says whether the
 * id was owner-checked upstream is an IDOR question outside that guard), so this is exactly the
 * class a signature has to close.
 *
 * `applications.user_id` is nullable (`schema.ts:38`) and the `userId ?? null` insert paths at
 * `:73`/`:97`/`:345` are live, so this is deliberately *not* repaired to `isNull()` — the
 * fail-closed reading would let an ownerless caller rewrite the anonymous rows. Absence is an
 * error here, not a narrower query.
 */
export async function updateApplication(
  id: string,
  input: UpdateApplicationInput,
  userId: string
): Promise<{ application: ApplicationDTO }> {
  // Belt and braces with the required type, per `getOrCreateProjectBySlug` (WIC-2070). Narrowing
  // the type is not the mechanism: `tsc` accepts a reintroduced `userId ?? undefined` at the call
  // site, and the value comes from a JWT `sub` claim that can be absent at runtime.
  if (!userId) {
    throw new AppError(
      'BAD_REQUEST',
      'userId is required to update an application',
      undefined,
      400
    );
  }

  const db = getDb();

  const updates: Partial<typeof applications.$inferInsert> = {};
  if (input.jobTitle !== undefined) updates.jobTitle = input.jobTitle;
  if (input.company !== undefined) updates.company = input.company;
  if ('url' in input) updates.url = input.url;
  if ('location' in input) updates.location = input.location;
  if ('salaryRange' in input) updates.salaryRange = input.salaryRange;
  if ('coverLetterId' in input) updates.coverLetterId = input.coverLetterId;
  if ('resumeVersionId' in input) updates.resumeVersionId = input.resumeVersionId;
  if ('contact' in input) updates.contact = input.contact;
  if ('compTarget' in input) updates.compTarget = input.compTarget;
  if ('nextAction' in input) updates.nextAction = input.nextAction;
  if ('nextActionDue' in input) updates.nextActionDue = input.nextActionDue;
  // WIC-2023. `in`-keyed like its nullable siblings so an explicit `null` clears
  // the date, but the value needs converting: the column is TIMESTAMPTZ, so
  // drizzle wants a `Date`, not the ISO string the wire carries.
  if ('interviewDate' in input) {
    updates.interviewDate = input.interviewDate ? new Date(input.interviewDate) : null;
  }
  if ('jobDescription' in input) updates.jobDescription = input.jobDescription;

  const whereClause = and(
    eq(applications.id, id),
    eq(applications.version, input.version),
    eq(applications.userId, userId)
  );

  const [updated] = await db
    .update(applications)
    .set({ ...updates, updatedAt: new Date(), version: sql`${applications.version} + 1` })
    .where(whereClause)
    .returning();

  if (!updated) {
    // Owner-scoped too, and that is load-bearing rather than tidiness: this read is what decides
    // 404-vs-409, so an unscoped version of it would answer `VersionConflictError` for another
    // tenant's application — confirming the row exists, which is the distinction the owner term
    // is supposed to erase.
    const existingWhere = and(eq(applications.id, id), eq(applications.userId, userId));
    const [existing] = await db.select().from(applications).where(existingWhere);
    if (!existing) throw new NotFoundError('Application');
    throw new VersionConflictError();
  }

  enqueueChange('application', id, 'updated', { userId });
  return { application: toDTO(updated) };
}

/**
 * Delete one application.
 *
 * `userId` is `string`, not `string | undefined` (ADR-010 D2, WIC-2072). This is the fail-open
 * ternary at its worst: the deleted fallback `: eq(applications.id, id)` dropped the owner term
 * from a **DELETE**, so an absent owner destroyed any tenant's row by caller-supplied id. Not
 * repaired to `isNull()` — on a nullable `user_id` that would delete somebody else's anonymous
 * row instead. Absence is an error, so the branch is deleted rather than inverted.
 */
export async function deleteApplication(id: string, userId: string): Promise<void> {
  // Belt and braces with the required type, per `getOrCreateProjectBySlug` (WIC-2070).
  if (!userId) {
    throw new AppError(
      'BAD_REQUEST',
      'userId is required to delete an application',
      undefined,
      400
    );
  }

  const db = getDb();
  const whereClause = and(eq(applications.id, id), eq(applications.userId, userId));

  const [deleted] = await db
    .delete(applications)
    .where(whereClause)
    .returning({ id: applications.id });

  if (!deleted) throw new NotFoundError('Application');
}

/**
 * Transition one application's status, writing a `status_history` row.
 *
 * `userId` is `string`, not `string | undefined` (ADR-010 D2, WIC-2072). The deleted fallback
 * dropped the owner term from the `SELECT ... FOR UPDATE` that opens the transaction. That row
 * lock is the *only* ownership check on this path — every write below keys on `id` alone and
 * trusts it — so an absent owner did not merely read another tenant's application, it took a row
 * lock on it and then transitioned it. Not repaired to `isNull()`; absence is an error here.
 */
export async function updateApplicationStatus(
  id: string,
  input: UpdateStatusInput,
  userId: string
): Promise<{ application: ApplicationDTO; statusHistory: StatusHistoryDTO[] }> {
  // Belt and braces with the required type, per `getOrCreateProjectBySlug` (WIC-2070).
  if (!userId) {
    throw new AppError(
      'BAD_REQUEST',
      'userId is required to update an application status',
      undefined,
      400
    );
  }

  const db = getDb();

  return db.transaction(async (tx) => {
    const lockWhere = and(eq(applications.id, id), eq(applications.userId, userId));

    const [current] = await tx.select().from(applications).where(lockWhere).for('update');

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
      userId: userId ?? null,
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
