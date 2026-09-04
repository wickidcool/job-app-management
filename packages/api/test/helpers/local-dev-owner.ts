import { LOCAL_DEV_USER_ID_DEFAULT } from '../../src/config.js';

/**
 * The owner a bare `buildApp()` request resolves to (ADR-010 D3, WIC-1964).
 *
 * These route suites drive `buildApp()` with no Supabase config, which is the
 * local-dev auth bypass. Before D3 the bypass set `userId: null`, so routes that
 * launder the absence with `c.get('userId') ?? undefined` called their service
 * with `undefined` as the owner, and that is what the suites asserted. D3 gives
 * the bypass a real tenant, so the same call sites now receive this id instead.
 *
 * Asserting it by name rather than as a literal uuid keeps the change honest in
 * both directions: the suites still pin *which* owner reaches the service — a
 * bare `expect.anything()` there would stop distinguishing "the caller's owner"
 * from "somebody else's" — while staying correct if `LOCAL_DEV_USER_ID_DEFAULT`
 * is ever re-pointed. `local-dev-owner.test.ts` is what pins the value itself,
 * against migration `0017`.
 *
 * Note these suites are *not* asserting tenancy; they assert HTTP contracts and
 * happen to run under the bypass. The suites that assert tenancy supply an
 * explicit JWT-derived caller instead — see `authed-app.ts`.
 */
export const DEV_OWNER = LOCAL_DEV_USER_ID_DEFAULT;
