# API Integration Module

This module provides the real backend API integration for the Job Application Manager, designed to replace `mockApplicationService` when the backend is deployed.

## Status: ⏸️ Ready for Backend

All API integration code is prepared and waiting for:

- ✅ API service structure built
- ✅ TypeScript types matching API contracts
- ✅ Authentication infrastructure ready
- ✅ Error handling implemented
- ⏳ **Backend API deployment** ([WIC-26](/WIC/issues/WIC-26))
- ⏳ API base URL
- ⏳ Cognito authentication configuration

## Structure

```
src/services/api/
├── index.ts              # Main export, configuration
├── apiClient.ts          # HTTP client with auth & error handling
├── applicationService.ts # Application CRUD operations
├── types.ts              # TypeScript types from API contracts
└── README.md             # This file
```

## When Backend is Ready

### 1. Update Environment Variables

Create `.env` file:

```bash
VITE_API_BASE_URL=https://api-dev.jobapp.example.com/v1
```

### 2. Implement Authentication

In `src/services/api/index.ts`, update the `getAuthToken()` function:

```typescript
import { Auth } from 'aws-amplify'; // or your auth library

async function getAuthToken(): Promise<string | null> {
  try {
    const session = await Auth.currentSession();
    return session.getIdToken().getJwtToken();
  } catch (error) {
    console.error('Failed to get auth token:', error);
    return null;
  }
}
```

### 3. Switch from Mock to Real API

In all components using `mockApplicationService`, change the import:

**Before:**

```typescript
import { mockApplicationService } from '../services/mockApplicationService';
```

**After:**

```typescript
import { applicationService } from '../services/api';
```

The interface is identical, so no other code changes needed!

### 4. Test All Operations

- [ ] List applications (GET /applications)
- [ ] Create application (POST /applications)
- [ ] Get by ID (GET /applications/:id)
- [ ] Update application (PATCH /applications/:id)
- [ ] Update status (PATCH /applications/:id/status)
- [ ] Delete application (DELETE /applications/:id)

## API Client Features

### Authentication

- Automatic Bearer token injection
- Token refresh support (when implemented)
- 401/403 error handling

### Error Handling

- Custom `APIError` class with error codes
- Network error handling
- API error response parsing
- Type-safe error details

### Type Safety

- Full TypeScript types from API contracts
- Date transformation (ISO strings ↔ Date objects)
- Request/response validation

## Implementation Details

### Date Handling

API uses ISO 8601 strings; app uses Date objects. Transformation handled automatically:

```typescript
// API Response (ISO strings)
{
  "createdAt": "2026-04-15T10:30:00.000Z",
  "updatedAt": "2026-04-15T10:30:00.000Z"
}

// App Domain (Date objects)
{
  createdAt: new Date("2026-04-15T10:30:00.000Z"),
  updatedAt: new Date("2026-04-15T10:30:00.000Z")
}
```

### Error Handling

```typescript
try {
  await applicationService.delete(id);
} catch (error) {
  if (error instanceof APIError) {
    console.log(error.code); // "NOT_FOUND"
    console.log(error.message); // "Application not found"
    console.log(error.status); // 404
  }
}
```

## Dependencies Required

When implementing auth, you may need:

```bash
npm install aws-amplify
# or
npm install @aws-sdk/client-cognito-identity-provider
```

## Related Tasks

- [WIC-17](/WIC/issues/WIC-17) - API contracts (complete)
- [WIC-25](/WIC/issues/WIC-25) - API integration (blocked)
- [WIC-26](/WIC/issues/WIC-26) - Backend implementation (in progress)

## Questions?

Contact: Frontend Developer (this agent) or Client Engagement Manager
