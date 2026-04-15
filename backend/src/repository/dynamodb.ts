import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  TransactWriteCommand,
  UpdateCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import {
  ApplicationEntity,
  ApplicationStatus,
  StatusHistoryEntity,
  UserStatsEntity,
} from '../types/entities';
import {
  Application,
  StatusHistoryEntry,
  CreateApplicationRequest,
  UpdateApplicationRequest,
  UpdateStatusRequest,
  ListApplicationsParams,
} from '../types/api';
import { isValidTransition, ALL_STATUSES } from '../utils/validation';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME!;

// ─── Key helpers ────────────────────────────────────────────────────────────

function userPK(userId: string) {
  return `USER#${userId}`;
}

function appSK(appId: string) {
  return `APP#${appId}`;
}

function historySK(appId: string, timestamp: string) {
  return `APP#${appId}#HISTORY#${timestamp}`;
}

function statsSK() {
  return 'STATS';
}

function gsi1pk(userId: string, status: ApplicationStatus) {
  return `USER#${userId}#STATUS#${status}`;
}

// ─── Entity → API shape mapping ──────────────────────────────────────────────

function entityToApplication(e: ApplicationEntity): Application {
  return {
    id: e.id,
    jobTitle: e.jobTitle,
    company: e.company,
    url: e.url,
    location: e.location,
    salaryRange: e.salaryRange,
    status: e.status,
    coverLetterId: e.coverLetterId,
    resumeVersionId: e.resumeVersionId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    appliedAt: e.appliedAt,
    version: e.version,
  };
}

function entityToHistoryEntry(e: StatusHistoryEntity): StatusHistoryEntry {
  return {
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    changedAt: e.changedAt,
    note: e.note,
  };
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class ApplicationRepository {
  // --- Create ----------------------------------------------------------------

  async create(userId: string, req: CreateApplicationRequest): Promise<Application> {
    const id = ulid();
    const now = new Date().toISOString();
    const status = req.status ?? 'saved';

    const appItem: ApplicationEntity = {
      PK: userPK(userId),
      SK: appSK(id),
      GSI1PK: gsi1pk(userId, status),
      GSI1SK: now,
      entityType: 'APPLICATION',
      id,
      userId,
      jobTitle: req.jobTitle,
      company: req.company,
      url: req.url,
      location: req.location,
      salaryRange: req.salaryRange,
      status,
      coverLetterId: req.coverLetterId,
      resumeVersionId: req.resumeVersionId,
      createdAt: now,
      updatedAt: now,
      appliedAt: status === 'applied' ? now : undefined,
      version: 1,
    };

    const historyItem: StatusHistoryEntity = {
      PK: userPK(userId),
      SK: historySK(id, now),
      entityType: 'STATUS_HISTORY',
      applicationId: id,
      fromStatus: null,
      toStatus: status,
      changedAt: now,
    };

    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE_NAME,
              Item: appItem,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: TABLE_NAME,
              Item: historyItem,
            },
          },
          {
            Update: {
              TableName: TABLE_NAME,
              Key: { PK: userPK(userId), SK: statsSK() },
              UpdateExpression:
                'ADD #counts.#status :one, #counts.#total :one SET updatedAt = :now',
              ExpressionAttributeNames: {
                '#counts': 'counts',
                '#status': status,
                '#total': 'total',
              },
              ExpressionAttributeValues: { ':one': 1, ':now': now },
            },
          },
        ],
      }),
    );

    return entityToApplication(appItem);
  }

  // --- Get by ID -------------------------------------------------------------

  async getById(
    userId: string,
    appId: string,
  ): Promise<{ application: Application; statusHistory: StatusHistoryEntry[] } | null> {
    // Query all items for this application (APP#<id> and APP#<id>#HISTORY#*)
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': userPK(userId),
          ':skPrefix': appSK(appId),
        },
      }),
    );

    const items = result.Items ?? [];
    const appItem = items.find((i) => i['entityType'] === 'APPLICATION') as
      | ApplicationEntity
      | undefined;

    if (!appItem) return null;

    const history = (items.filter((i) => i['entityType'] === 'STATUS_HISTORY') as StatusHistoryEntity[])
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt))
      .map(entityToHistoryEntry);

    return { application: entityToApplication(appItem), statusHistory: history };
  }

  // --- List ------------------------------------------------------------------

  async list(
    userId: string,
    params: ListApplicationsParams,
  ): Promise<{ applications: Application[]; nextCursor?: string; totalCount: number }> {
    const limit = Math.min(params.limit ?? 50, 100);

    // Decode cursor
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (params.cursor) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf-8'));
      } catch {
        // Invalid cursor — ignore, start from beginning
      }
    }

    let items: ApplicationEntity[];

    if (params.status) {
      // Filter by status using GSI1
      const statuses = params.status.split(',').map((s) => s.trim());
      const allItems: ApplicationEntity[] = [];

      for (const status of statuses) {
        const result = await ddb.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :gsi1pk',
            ExpressionAttributeValues: {
              ':gsi1pk': gsi1pk(userId, status as ApplicationStatus),
            },
            ScanIndexForward: params.sortOrder !== 'asc',
            Limit: limit,
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        allItems.push(...((result.Items ?? []) as ApplicationEntity[]));
      }

      items = allItems;
    } else {
      // All applications for this user
      const result = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          FilterExpression: 'entityType = :type',
          ExpressionAttributeValues: {
            ':pk': userPK(userId),
            ':prefix': 'APP#',
            ':type': 'APPLICATION',
          },
          ScanIndexForward: params.sortOrder === 'asc',
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items = (result.Items ?? []) as ApplicationEntity[];
    }

    // Apply search filter
    let filtered = items;
    if (params.search) {
      const q = params.search.toLowerCase();
      filtered = items.filter(
        (i) =>
          i.jobTitle.toLowerCase().includes(q) || i.company.toLowerCase().includes(q),
      );
    }
    if (params.company) {
      const q = params.company.toLowerCase();
      filtered = filtered.filter((i) => i.company.toLowerCase().includes(q));
    }

    // Sort
    const sortField = params.sortBy ?? 'updatedAt';
    filtered.sort((a, b) => {
      const av = a[sortField as keyof ApplicationEntity] as string;
      const bv = b[sortField as keyof ApplicationEntity] as string;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return params.sortOrder === 'asc' ? cmp : -cmp;
    });

    // Pagination: encode next cursor if we got a full page
    let nextCursor: string | undefined;
    const page = filtered.slice(0, limit);
    if (filtered.length > limit) {
      const lastItem = page[page.length - 1];
      const startKey = { PK: lastItem.PK, SK: lastItem.SK };
      nextCursor = Buffer.from(JSON.stringify(startKey)).toString('base64url');
    }

    return {
      applications: page.map(entityToApplication),
      nextCursor,
      totalCount: filtered.length,
    };
  }

  // --- Update ----------------------------------------------------------------

  async update(
    userId: string,
    appId: string,
    req: UpdateApplicationRequest,
  ): Promise<Application | null> {
    const now = new Date().toISOString();

    // Build update expression dynamically
    const setExpressions: string[] = ['updatedAt = :now', 'version = version + :one'];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':now': now, ':one': 1, ':expectedVersion': req.version };

    const optionalFields: (keyof UpdateApplicationRequest)[] = [
      'jobTitle',
      'company',
      'url',
      'location',
      'salaryRange',
      'coverLetterId',
      'resumeVersionId',
    ];

    for (const field of optionalFields) {
      if (req[field] !== undefined) {
        if (req[field] === null) {
          setExpressions.push(`REMOVE #${field}`);
          names[`#${field}`] = field;
        } else {
          setExpressions.push(`#${field} = :${field}`);
          names[`#${field}`] = field;
          values[`:${field}`] = req[field];
        }
      }
    }

    try {
      const result = await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: userPK(userId), SK: appSK(appId) },
          UpdateExpression: `SET ${setExpressions.filter((e) => !e.startsWith('REMOVE')).join(', ')}`,
          ConditionExpression: 'attribute_exists(PK) AND version = :expectedVersion',
          ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        }),
      );

      return entityToApplication(result.Attributes as ApplicationEntity);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.name === 'ConditionalCheckFailedException')
      ) {
        return null; // version mismatch or not found
      }
      throw err;
    }
  }

  // --- Delete ----------------------------------------------------------------

  async delete(userId: string, appId: string): Promise<boolean> {
    // First query all items (app + history)
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': userPK(userId),
          ':skPrefix': appSK(appId),
        },
      }),
    );

    const items = result.Items ?? [];
    if (items.length === 0) return false;

    const appItem = items.find((i) => i['entityType'] === 'APPLICATION') as ApplicationEntity | undefined;
    if (!appItem) return false;

    // Batch delete all items in chunks of 25
    const chunks: Array<Array<{ PK: string; SK: string }>> = [];
    const keys = items.map((i) => ({ PK: i['PK'] as string, SK: i['SK'] as string }));
    for (let i = 0; i < keys.length; i += 25) {
      chunks.push(keys.slice(i, i + 25));
    }

    const now = new Date().toISOString();

    await Promise.all([
      ...chunks.map((chunk) =>
        ddb.send(
          new BatchWriteCommand({
            RequestItems: {
              [TABLE_NAME]: chunk.map((key) => ({
                DeleteRequest: { Key: key },
              })),
            },
          }),
        ),
      ),
      // Update stats — decrement status count
      ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: userPK(userId), SK: statsSK() },
          UpdateExpression:
            'ADD #counts.#status :negOne, #counts.#total :negOne SET updatedAt = :now',
          ExpressionAttributeNames: {
            '#counts': 'counts',
            '#status': appItem.status,
            '#total': 'total',
          },
          ExpressionAttributeValues: { ':negOne': -1, ':now': now },
        }),
      ),
    ]);

    return true;
  }

  // --- Update Status ---------------------------------------------------------

  async updateStatus(
    userId: string,
    appId: string,
    req: UpdateStatusRequest,
  ): Promise<{ application: Application; statusHistory: StatusHistoryEntry[] } | null | 'invalid_transition' | 'version_conflict'> {
    // Get current application first
    const current = await this.getById(userId, appId);
    if (!current) return null;

    const { application } = current;

    if (!isValidTransition(application.status, req.status)) {
      return 'invalid_transition';
    }

    const now = new Date().toISOString();
    const newStatus = req.status;

    const historyItem: StatusHistoryEntity = {
      PK: userPK(userId),
      SK: historySK(appId, now),
      entityType: 'STATUS_HISTORY',
      applicationId: appId,
      fromStatus: application.status,
      toStatus: newStatus,
      changedAt: now,
      note: req.note,
    };

    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: TABLE_NAME,
                Key: { PK: userPK(userId), SK: appSK(appId) },
                UpdateExpression:
                  'SET #status = :newStatus, GSI1PK = :newGsi1pk, GSI1SK = :now, updatedAt = :now, version = version + :one' +
                  (newStatus === 'applied' ? ', appliedAt = :now' : ''),
                ConditionExpression: '#status = :oldStatus AND version = :expectedVersion',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                  ':newStatus': newStatus,
                  ':oldStatus': application.status,
                  ':newGsi1pk': gsi1pk(userId, newStatus),
                  ':now': now,
                  ':one': 1,
                  ':expectedVersion': req.version,
                },
              },
            },
            {
              Put: {
                TableName: TABLE_NAME,
                Item: historyItem,
              },
            },
            {
              Update: {
                TableName: TABLE_NAME,
                Key: { PK: userPK(userId), SK: statsSK() },
                UpdateExpression:
                  'ADD #counts.#old :negOne, #counts.#new :one SET updatedAt = :now',
                ExpressionAttributeNames: {
                  '#counts': 'counts',
                  '#old': application.status,
                  '#new': newStatus,
                },
                ExpressionAttributeValues: { ':negOne': -1, ':one': 1, ':now': now },
              },
            },
          ],
        }),
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'TransactionCanceledException') {
        return 'version_conflict';
      }
      throw err;
    }

    // Fetch updated application
    const updated = await this.getById(userId, appId);
    return updated;
  }

  // --- Get Stats -------------------------------------------------------------

  async getStats(userId: string): Promise<UserStatsEntity | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: userPK(userId), SK: statsSK() },
      }),
    );

    return (result.Item as UserStatsEntity) ?? null;
  }

  // --- Get Recent Activity ---------------------------------------------------

  async getRecentActivity(userId: string, limitItems = 10): Promise<ApplicationEntity[]> {
    // Query all applications sorted by updatedAt desc
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: 'entityType = :type',
        ExpressionAttributeValues: {
          ':pk': userPK(userId),
          ':prefix': 'APP#',
          ':type': 'APPLICATION',
        },
        ScanIndexForward: false,
        Limit: limitItems * 3, // over-fetch to account for filter
      }),
    );

    const items = ((result.Items ?? []) as ApplicationEntity[])
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limitItems);

    return items;
  }

  // --- Initialize Stats (idempotent) ----------------------------------------

  async initializeStats(userId: string): Promise<void> {
    const zeroCounts = Object.fromEntries(
      [...ALL_STATUSES, 'total'].map((s) => [s, 0]),
    ) as Record<ApplicationStatus | 'total', number>;

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: userPK(userId),
          SK: statsSK(),
          entityType: 'USER_STATS',
          counts: zeroCounts,
          appliedThisWeek: 0,
          appliedThisMonth: 0,
          responseRate: 0,
          updatedAt: new Date().toISOString(),
        } satisfies UserStatsEntity,
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    ).catch(() => {
      // Already exists — fine
    });
  }
}
