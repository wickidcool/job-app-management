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
- Gracefully bypasses auth when `SUPABASE_JWT_SECRET` not configured (local dev)

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
- **Local dev flexibility**: Bypass auth when secret not set
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
4. Existing data gets assigned to first logged-in user (or left as null for local-only)

## References

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [jose JWT Library](https://github.com/panva/jose)
- WIC-196: Database schema migration
- WIC-197: JWT auth middleware implementation
- WIC-199: Frontend authentication UI
