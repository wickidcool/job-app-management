import { APIGatewayProxyResult } from 'aws-lambda';
import { ErrorResponse } from '../types/api';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

export function ok(body: unknown): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export function created(body: unknown): APIGatewayProxyResult {
  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export function noContent(): APIGatewayProxyResult {
  return {
    statusCode: 204,
    headers: CORS_HEADERS,
    body: '',
  };
}

export function badRequest(code: string, message: string, details?: unknown): APIGatewayProxyResult {
  const body: ErrorResponse = { error: { code, message, details } };
  return {
    statusCode: 400,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export function unauthorized(): APIGatewayProxyResult {
  const body: ErrorResponse = { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization token' } };
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export function forbidden(): APIGatewayProxyResult {
  const body: ErrorResponse = { error: { code: 'FORBIDDEN', message: 'Access denied' } };
  return {
    statusCode: 403,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export function notFound(resource = 'Resource'): APIGatewayProxyResult {
  const body: ErrorResponse = { error: { code: 'NOT_FOUND', message: `${resource} not found` } };
  return {
    statusCode: 404,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export function conflict(code: string, message: string, details?: unknown): APIGatewayProxyResult {
  const body: ErrorResponse = { error: { code, message, details } };
  return {
    statusCode: 409,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export function internalError(message = 'Internal server error'): APIGatewayProxyResult {
  const body: ErrorResponse = { error: { code: 'INTERNAL_ERROR', message } };
  return {
    statusCode: 500,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}
