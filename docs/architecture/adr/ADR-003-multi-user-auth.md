# ADR-003: Multi-User Authentication with Supabase

## Status

Accepted

## Context

The Job Application Manager was originally designed as a local-first, single-user application. To support multiple users and cloud deployment, we need authentication and per-user data isolation.

Requirements:
- Support multiple users with separate data
- Enable cloud deployment (Cloudflare Pages/Workers)
- Minimize custom auth code and maintenance burden
- Support both local development and production modes

Options considered:
1. **Custom JWT auth** - Build our own auth system
2. **Auth0/Okta** - Enterprise auth providers
3. **Supabase Auth** - PostgreSQL-native auth with JWT tokens
4. **Clerk** - Developer-focused auth service

## Decision

Use **Supabase Auth** for authentication with server-side JWT verification.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                    │
│                                                                          │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────────┐     │
│  │  Login Page    │    │  Supabase SDK  │    │  Token Storage     │     │
│  │  (React)       │───▶│  (createClient)│───▶│  (supabase session)│     │
│  └────────────────┘    └────────────────┘    └────────────────────┘     │
│                                                       │                  │
└───────────────────────────────────────────────────────│──────────────────┘
                                                        │
                                          Authorization: Bearer {jwt}
                                                        │
                                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              Backend (Fastify)                           │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │                      Auth Plugin                                │     │
│  │  1. Extract Bearer token from Authorization header              │     │
│  │  2. Verify JWT signature using SUPABASE_JWT_SECRET              │     │
│  │  3. Set request.userId = payload.sub                            │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │                      Route Handlers                             │     │
│  │  - Filter queries by request.userId                             │     │
│  │  - Set user_id on INSERT operations                             │     │
│  │  - Return 403 if accessing another user's data                  │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Implementation Details

**Auth Plugin** (`packages/api/src/plugins/auth.ts`):
- Uses `jose` library for JWT verification (lightweight, no Supabase SDK needed on backend)
- Decorate `request.userId` with the JWT `sub` claim (Supabase user UUID)
- Returns 401 for missing/invalid tokens
- Gracefully bypasses auth when `SUPABASE_JWT_SECRET` not configured (local dev) — **the bypass still fires, but it supplies an owner rather than leaving one absent; see Addendum A**

**Database Schema Changes**:
- Add `user_id UUID` column to all user-specific tables
- Foreign key references `auth.users(id)` in Supabase
- Nullable initially for migration from single-user data

**Query Isolation**:
- All queries filter by `user_id = request.userId`
- INSERT operations set `user_id` from request context
- Services accept `userId` parameter for testability

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_JWT_SECRET` | Production | JWT signing secret from Supabase dashboard |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key for frontend |

## Consequences

### Positive

- **No custom auth code**: Supabase handles signup, login, password reset, OAuth
- **PostgreSQL-native**: Users stored in same database, easy to query/join
- **Standard JWT**: Any JWT library can verify tokens
- **Local dev flexibility**: Bypass auth when secret not set (as a *sentinel tenant*, not as an absent owner — see Addendum A)
- **Automatic session refresh**: Supabase SDK handles token refresh

### Negative

- **Supabase dependency**: Tied to Supabase for auth (can migrate to self-hosted Supabase if needed)
- **Two databases**: Auth in Supabase, app data in Cloudflare D1/local PG
- **Frontend SDK required**: Need Supabase JS SDK for login UI

### Migration Path

Single-user to multi-user:
1. Add nullable `user_id` column to all tables
2. Deploy new schema
3. User creates account, logs in
4. Existing data gets assigned to first logged-in user (~~or left as null for local-only~~ — **retired, see Addendum A**)

## Addendum A — the local-only null owner is retired (2026-09-02, WIC-1962)

**Status of this ADR is unchanged: `Accepted`.** Supabase Auth, JWT verification via `jose`, and
per-user `user_id` isolation all still bind. What is superseded is one affordance — the idea that a
row may carry **no** owner because it was created in local development.

**ADR-010 §D3 ("Local development gets an owner, not an absence") supersedes it.** The auth bypass
still fires on `!SUPABASE_URL && !SUPABASE_JWT_SECRET`, but it sets a real owner: a
`LOCAL_DEV_USER_ID` environment variable defaulting to the `00000000-0000-0000-0000-000000000000`
sentinel that migration `0017_enforce_userid_not_null.sql` backfills to. Single-user local dev is
therefore **one specific tenant**, not **no tenant**, so local dev and E2E exercise the tenancy
predicates instead of bypassing them.

Three claims above are affected, and all three are annotated in place: the Implementation Details
bullet on the bypass, the "Local dev flexibility" positive consequence, and Migration Path step 4.

### Why this note exists rather than a silent edit

The error direction matters. Left as written, this ADR invites a reader to *rely* on a null owner
being legitimate — and `user_id IS NULL` in a multi-tenant table is exactly the shape the
`packages/api` owner-predicate guard exists to police. An overclaim invites a check; a stale
affordance says "don't look."

### Implementation status — the decision binds, the code has not caught up

As of `main` `8ab4618`, **D3 is not implemented**: `LOCAL_DEV_USER_ID` appears only in comments and
tests (`routes/require-owner.ts:31`, `test/extraction.tenancy.test.ts:804`,
`test/helpers/authed-app.ts:21`), and `plugins/auth.ts:31-33` still returns with `request.userId`
unset. ADR-010's sequencing puts D1 before D2, but D2 landed first (WIC-1554), so routes that call
`requireOwner` — `projects`, `catalog`, `resume-variants`, `interview-preps` — currently answer 400
in the bypass mode. That is a sequencing artifact, not a reversal of this decision, and it closes
when **WIC-1964** lands D3.

Per the ADR Status-line convention (WIC-1932), a Status line records whether a decision **binds**,
not whether its cleanup has landed — which is why this addendum reports the gap instead of
downgrading either ADR.

## References

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [jose JWT Library](https://github.com/panva/jose)
- WIC-196: Database schema migration
- WIC-197: JWT auth middleware implementation
- WIC-199: Frontend authentication UI
