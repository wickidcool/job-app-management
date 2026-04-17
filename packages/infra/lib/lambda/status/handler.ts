import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ApplicationRepository } from '../../../src/repository/dynamodb';
import { validateStatusRequest } from '../../../src/utils/validation';
import {
  ok,
  badRequest,
  unauthorized,
  notFound,
  conflict,
  internalError,
} from '../../../src/utils/response';

const repo = new ApplicationRepository();

function getUserId(event: APIGatewayProxyEvent): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  return claims?.['sub'] ?? null;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) return unauthorized();

  const appId = event.pathParameters?.['id'];
  if (!appId) return badRequest('MISSING_PARAM', 'Application ID is required');

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('INVALID_JSON', 'Request body must be valid JSON');
  }

  const { data, errors } = validateStatusRequest(body);
  if (errors) {
    return badRequest('VALIDATION_ERROR', 'Invalid request', errors);
  }

  try {
    const result = await repo.updateStatus(userId, appId, data!);

    if (result === null) return notFound('Application');

    if (result === 'invalid_transition') {
      // Fetch current status for error details
      const current = await repo.getById(userId, appId);
      const currentStatus = current?.application.status ?? 'unknown';
      return badRequest(
        'INVALID_STATUS_TRANSITION',
        `Cannot transition from '${currentStatus}' to '${data!.status}'`,
        {
          currentStatus,
          requestedStatus: data!.status,
        },
      );
    }

    if (result === 'version_conflict') {
      return conflict('VERSION_CONFLICT', 'Application was modified by another request');
    }

    return ok(result);
  } catch (err) {
    console.error('Unhandled error in StatusHandler', err);
    return internalError();
  }
}
