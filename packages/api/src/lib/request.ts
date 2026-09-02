import type { Context } from 'hono';
import { AppError } from '../types/index.js';

/**
 * Reading a JSON request body, in one place.
 *
 * `c.req.json()` throws a `SyntaxError` on a body that is not valid JSON. Every
 * route used to await it bare — `schema.safeParse(await c.req.json())` — so the
 * `SyntaxError` propagated past the route to `app.onError`, which has no branch
 * for it and maps it to `500 INTERNAL_ERROR`. A client typo was reported as a
 * server fault and `console.error`'d into the logs as one (WIC-1524; 34 call
 * sites across 10 route files, none of them guarded).
 *
 * Note what this does *not* cover. Zod's own 400 path was always healthy — a
 * body that is valid JSON of the wrong shape has never taken this route. The
 * defect was strictly upstream of Zod, which is why `test/json-body.test.ts`
 * carries a wrong-shape control alongside every malformed case: without it a
 * test asserting only "400" cannot tell this guard from Zod's, and would still
 * pass if the helper were deleted.
 *
 * A per-route try/catch would have worked too, and reopened at every new
 * endpoint. This is the version that stays fixed.
 */
export async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body is not valid JSON', undefined, 400);
  }
}
