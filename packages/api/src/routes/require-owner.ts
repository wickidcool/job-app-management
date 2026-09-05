import type { Context } from 'hono';
import type { AppEnv } from '../types/env.js';
import { AppError } from '../types/index.js';

/**
 * Raised when a request reaches an owner-scoped operation with no resolved
 * owner. 401 rather than 403: the caller is not identified, not unauthorised.
 */
export class OwnerRequiredError extends AppError {
  constructor() {
    super('OWNER_REQUIRED', 'Request has no resolved owner', undefined, 401);
    this.name = 'OwnerRequiredError';
  }
}

/**
 * Narrow the request's owner to a concrete id, or reject the request.
 *
 * This is the single place an absent owner is turned into an error, so that
 * service signatures can take `userId: string` and carry no owner-absent branch
 * (ADR-010 D2, AC-T0). Routes previously laundered the absence with
 * `c.get('userId') ?? undefined`, which pushed the decision down into every
 * predicate — the shape WIC-1638 was burning down.
 *
 * That burndown is complete: ADR-010 D1.3 (WIC-1600) converted the last 66 sites
 * across 11 route files, so `packages/api/src/routes` now holds zero of them and
 * this helper is the only way a route reads the owner. The `[LAUNDER]` check in
 * `scripts/audit-owner-predicates.mjs` holds it at zero — which is load-bearing,
 * because the compiler does not: `c.get('userId') ?? undefined` still typechecks
 * clean even with `HonoVariables.userId` narrowed to `string` (D1.2), a redundant
 * `??` being legal rather than an error.
 *
 * One caller reaches here with no owner, and it should be rejected:
 *
 *   - a token that verifies but carries no `sub` claim, which `middleware/auth.ts`
 *     resolves to `null` (WIC-1554). This is the security-relevant one.
 *
 * The local-dev auth bypass is no longer such a caller. ADR-010 D3 (WIC-1964)
 * landed in `middleware/auth.ts`: with neither `SUPABASE_URL` nor
 * `SUPABASE_JWT_SECRET` set, the bypass now supplies a real owner — a
 * `LOCAL_DEV_USER_ID` defaulting to the sentinel migration `0017` backfills to —
 * rather than `null`. So local dev reaches here with a concrete uuid and runs the
 * owner branch like any tenant, instead of taking the 401 it took while D3 was
 * outstanding. ADR-003's "left as null for local-only" affordance is retired.
 *
 * The empty string is rejected explicitly. `HonoVariables.userId` is
 * `string | null`, so `''` is representable, and it is falsy — which is exactly
 * how a `userId ? scoped : unscoped` ternary would have failed open even after
 * the signature was tightened (ADR-010 D4).
 */
export function requireOwner(c: Context<AppEnv>): string {
  // Read through the wider type on purpose (ADR-010 D1.2). `HonoVariables.userId`
  // is declared `string`, but this function is the one place that must not trust
  // that declaration: it is a claim about what `authMiddleware` guarantees, and
  // this is the guard that makes the claim true. Two ways the runtime value is
  // not a `string` even though the type says it is — a `PUBLIC_PATHS` request,
  // where the middleware never sets the variable, and any future middleware
  // change that reintroduces an absent owner. Both must 401, not fall through.
  //
  // Without the widening the three comparisons below are `TS2367` "no overlap"
  // errors, and the tempting fix — deleting them because the type says they
  // cannot fire — would delete the only runtime check in the system.
  const owner = c.get('userId') as string | null | undefined;
  if (owner === null || owner === undefined || owner === '') {
    throw new OwnerRequiredError();
  }
  return owner;
}
