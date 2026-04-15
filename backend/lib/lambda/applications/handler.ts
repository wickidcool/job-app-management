import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ApplicationRepository } from '../../../src/repository/dynamodb';
import {
  validateCreateRequest,
  validateUpdateRequest,
} from '../../../src/utils/validation';
import {
  ok,
  created,
  noContent,
  badRequest,
  unauthorized,
  notFound,
  conflict,
  internalError,
} from '../../../src/utils/response';

const repo = new ApplicationRepository();

function getUserId(event: APIGatewayProxyEvent): string | null {
  // Cognito authorizer injects claims into requestContext
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  return claims?.['sub'] ?? null;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) return unauthorized();

  const method = event.httpMethod;
  const appId = event.pathParameters?.['id'];

  try {
    // POST /applications — create
    if (method === 'POST' && !appId) {
      let body: unknown;
      try {
        body = JSON.parse(event.body ?? '{}');
      } catch {
        return badRequest('INVALID_JSON', 'Request body must be valid JSON');
      }

      const { data, errors } = validateCreateRequest(body);
      if (errors) {
        return badRequest('VALIDATION_ERROR', 'Invalid request', errors);
      }

      // Ensure user stats row exists
      await repo.initializeStats(userId);

      const application = await repo.create(userId, data!);
      return created({ application });
    }

    // GET /applications — list
    if (method === 'GET' && !appId) {
      const qs = event.queryStringParameters ?? {};
      const result = await repo.list(userId, {
        status: qs['status'] ?? undefined,
        company: qs['company'] ?? undefined,
        search: qs['search'] ?? undefined,
        sortBy: (qs['sortBy'] as 'createdAt' | 'updatedAt' | 'company') ?? 'updatedAt',
        sortOrder: (qs['sortOrder'] as 'asc' | 'desc') ?? 'desc',
        limit: qs['limit'] ? parseInt(qs['limit'], 10) : 50,
        cursor: qs['cursor'] ?? undefined,
      });
      return ok(result);
    }

    // GET /applications/:id — get by ID
    if (method === 'GET' && appId) {
      const result = await repo.getById(userId, appId);
      if (!result) return notFound('Application');
      return ok(result);
    }

    // PATCH /applications/:id — update
    if (method === 'PATCH' && appId) {
      let body: unknown;
      try {
        body = JSON.parse(event.body ?? '{}');
      } catch {
        return badRequest('INVALID_JSON', 'Request body must be valid JSON');
      }

      const { data, errors } = validateUpdateRequest(body);
      if (errors) {
        return badRequest('VALIDATION_ERROR', 'Invalid request', errors);
      }

      const result = await repo.update(userId, appId, data!);
      if (result === null) {
        // Could be not found or version conflict — check which
        const existing = await repo.getById(userId, appId);
        if (!existing) return notFound('Application');
        return conflict('VERSION_CONFLICT', 'Application was modified by another request');
      }

      return ok({ application: result });
    }

    // DELETE /applications/:id — delete
    if (method === 'DELETE' && appId) {
      const deleted = await repo.delete(userId, appId);
      if (!deleted) return notFound('Application');
      return noContent();
    }

    return badRequest('NOT_FOUND', 'Route not found');
  } catch (err) {
    console.error('Unhandled error in ApplicationsHandler', err);
    return internalError();
  }
}
