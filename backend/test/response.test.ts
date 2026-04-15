import {
  ok,
  created,
  noContent,
  badRequest,
  unauthorized,
  notFound,
  conflict,
  internalError,
} from '../src/utils/response';

describe('response helpers', () => {
  it('ok returns 200 with JSON body', () => {
    const res = ok({ foo: 'bar' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ foo: 'bar' });
    expect(res.headers?.['Content-Type']).toBe('application/json');
  });

  it('created returns 201', () => {
    const res = created({ id: '123' });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ id: '123' });
  });

  it('noContent returns 204 with empty body', () => {
    const res = noContent();
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('badRequest returns 400 with error code', () => {
    const res = badRequest('VALIDATION_ERROR', 'Something is wrong');
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Something is wrong');
  });

  it('unauthorized returns 401', () => {
    const res = unauthorized();
    expect(res.statusCode).toBe(401);
  });

  it('notFound returns 404 with resource name', () => {
    const res = notFound('Application');
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.message).toContain('Application');
  });

  it('conflict returns 409', () => {
    const res = conflict('VERSION_CONFLICT', 'Stale version');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('VERSION_CONFLICT');
  });

  it('internalError returns 500', () => {
    const res = internalError();
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error.code).toBe('INTERNAL_ERROR');
  });

  it('all responses include CORS headers', () => {
    const responses = [ok({}), created({}), badRequest('E', 'M'), notFound()];
    for (const res of responses) {
      expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
    }
  });
});
