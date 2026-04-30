# Authentication with Supabase

This document describes the authentication system implemented for the Job Application Manager.

## Overview

The application uses Supabase Auth for user authentication, supporting both local development and production deployments. The system includes:

- **Frontend**: React-based authentication UI with Supabase Auth UI components
- **Backend**: Fastify middleware for JWT token verification
- **Flexibility**: Optional authentication for local development

## Architecture

### Frontend (`packages/web`)

1. **Supabase Client** (`src/services/supabase.ts`)
   - Singleton instance configured with environment variables
   - Handles session management, token refresh, and auth state

2. **Auth Context** (`src/contexts/AuthContext.tsx`)
   - Provides app-wide authentication state
   - `useAuth()` hook for accessing user, session, and signOut function
   - Automatically subscribes to auth state changes

3. **Protected Routes** (`src/components/ProtectedRoute.tsx`)
   - Wraps application routes to require authentication
   - Shows loading spinner during auth check
   - Redirects to `/login` when unauthenticated

4. **Login Page** (`src/pages/Login.tsx`)
   - Renders Supabase Auth UI for email/password authentication
   - Auto-redirects authenticated users to dashboard
   - Styled with Tailwind to match design system

5. **Navigation** (`src/components/TopNavigation.tsx`)
   - Displays user email in dropdown menu
   - Sign out button with redirect to login

6. **API Client** (`src/services/api/index.ts`)
   - Automatically includes Supabase JWT in `Authorization: Bearer` header
   - Fetches token from active session on each request

### Backend (`packages/api`)

1. **Auth Plugin** (`src/plugins/auth.ts`)
   - Fastify plugin that protects all `/api/*` endpoints
   - Verifies Supabase JWT tokens using `jose` library
   - Extracts user ID from JWT `sub` claim and adds to `request.userId`
   - Returns 401 for missing/invalid tokens
   - **Bypass mode**: When `SUPABASE_JWT_SECRET` is not set, auth is disabled

## Setup Instructions

### Local Development (Optional Auth)

For single-user local development, authentication can be disabled:

**packages/api/.env**
```bash
# Omit or leave empty to disable auth
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_JWT_SECRET=
```

**packages/web/.env**
```bash
# Not required for local dev without auth
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=
```

The app will run without authentication requirements.

### Local Development with Supabase

To test authentication locally:

1. **Install Supabase CLI**
   ```bash
   npm install -g supabase
   ```

2. **Initialize Supabase**
   ```bash
   # In project root
   supabase init
   supabase start
   ```

3. **Get credentials**
   ```bash
   supabase status
   ```

   Look for:
   - API URL (typically `http://127.0.0.1:54321`)
   - anon key
   - service_role key
   - JWT secret

4. **Configure backend** (`packages/api/.env`)
   ```bash
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_ANON_KEY=<anon-key-from-supabase-status>
   SUPABASE_JWT_SECRET=<jwt-secret-from-supabase-status>
   ```

5. **Configure frontend** (`packages/web/.env`)
   ```bash
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_ANON_KEY=<anon-key-from-supabase-status>
   ```

6. **Start services**
   ```bash
   # Terminal 1: API
   npm run dev:api

   # Terminal 2: Frontend
   npm run dev
   ```

7. **Access app**
   - Navigate to `http://localhost:5173`
   - You'll be redirected to `/login`
   - Sign up with email/password
   - Check Supabase inbox (or local Inbucket at `http://127.0.0.1:54324`) for confirmation email

### Production Setup

1. **Create Supabase project**
   - Go to [supabase.com](https://supabase.com)
   - Create new project
   - Get credentials from project settings

2. **Configure environment variables**
   
   **Backend (API service)**
   ```bash
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=<anon-key>
   SUPABASE_JWT_SECRET=<jwt-secret>
   ```

   **Frontend (Web service)**
   ```bash
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-key>
   ```

3. **Deploy**
   - Build and deploy both packages
   - Ensure environment variables are set in deployment environment

## User Flow

### Sign Up
1. User navigates to app
2. Redirected to `/login`
3. Enters email and password in Supabase Auth UI
4. Submits sign up
5. Receives email confirmation (if enabled)
6. Confirms email and is automatically signed in
7. Redirected to dashboard

### Sign In
1. User navigates to `/login`
2. Enters email and password
3. Submits sign in
4. Session created and stored in localStorage
5. Redirected to dashboard
6. All subsequent API requests include JWT token

### Using Protected Features
1. User navigates to any route (e.g., `/applications`)
2. `ProtectedRoute` checks auth state
3. If authenticated: renders the page
4. If not authenticated: redirects to `/login`
5. API requests include `Authorization: Bearer <token>` header
6. Backend verifies JWT and extracts user ID

### Sign Out
1. User clicks user menu in navigation
2. Clicks "Sign Out"
3. Session cleared from Supabase
4. Redirected to `/login`
5. All protected routes now redirect to login

## Testing

### Unit Tests

Backend auth middleware has comprehensive unit tests:

```bash
cd packages/api
npm test -- auth.test.ts
```

Tests cover:
- Bypass mode (no JWT secret)
- Missing Authorization header
- Invalid Bearer token format
- Expired/invalid JWT
- Valid JWT verification
- User ID extraction

### E2E Tests

Frontend E2E tests require Supabase to be configured:

```bash
# Set test user credentials
export TEST_USER_EMAIL=test@example.com
export TEST_USER_PASSWORD=TestPassword123!

# Run E2E tests
npm run test:e2e -- auth.spec.ts
```

Tests cover:
- Unauthenticated redirect to login
- Sign up flow
- Sign in flow
- Protected route access
- User menu and logout
- API request token inclusion

## Security Considerations

1. **JWT Verification**: Backend uses `jose` library for secure JWT verification
2. **Token Storage**: Frontend stores session in localStorage (managed by Supabase SDK)
3. **Token Refresh**: Supabase SDK automatically refreshes tokens before expiry
4. **HTTPS Required**: Production deployments should use HTTPS for token transmission
5. **CORS Configuration**: Backend CORS is configured to allow frontend origin

## Troubleshooting

### "Missing or invalid authorization header" (401)
- Check that `SUPABASE_JWT_SECRET` is set in backend `.env`
- Verify frontend is sending `Authorization: Bearer` header
- Check that Supabase session is valid (not expired)

### Infinite redirect loop
- Clear localStorage and cookies
- Check that Supabase client is configured correctly
- Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set

### Email confirmation not working
- Check Supabase email settings in dashboard
- For local: check Inbucket at `http://127.0.0.1:54324`
- Consider disabling email confirmation for development

### Session not persisting
- Check browser localStorage (should have `supabase.auth.token`)
- Verify `persistSession: true` in Supabase client config
- Clear cache and try again

## Future Enhancements

Potential improvements:
- OAuth providers (Google, GitHub)
- Magic link authentication
- Multi-factor authentication (MFA)
- Role-based access control (RBAC)
- User profile management
- Password reset flow
