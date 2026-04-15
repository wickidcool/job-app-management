# Job Application Manager — Architecture Overview

## Executive Summary

This document describes the local-first backend architecture for the Job Application Manager. The application runs entirely on the user's machine with a Node.js/Fastify backend, PostgreSQL database, and local filesystem storage for documents. This design prioritizes simplicity, offline capability, and data privacy.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         User's Local Machine                                 │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     Frontend (React/Vite)                              │  │
│  │                     http://localhost:5173                              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    │ HTTP (localhost)                        │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     Backend (Node.js/Fastify)                          │  │
│  │                     http://localhost:3000/api                          │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐  │  │
│  │  │/applications│ │  /status    │ │/cover-letters│ │   /dashboard   │  │  │
│  │  │   CRUD      │ │ transitions │ │  (existing) │ │  aggregations  │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                          │                    │                              │
│              ┌───────────┘                    └───────────┐                  │
│              ▼                                            ▼                  │
│  ┌─────────────────────────────┐          ┌─────────────────────────────┐   │
│  │        PostgreSQL           │          │     Local Filesystem         │   │
│  │   localhost:5432            │          │     ./data/                  │   │
│  │                             │          │     ├── resumes/             │   │
│  │   Tables:                   │          │     ├── cover-letters/       │   │
│  │   - applications            │          │     └── projects/            │   │
│  │   - status_history          │          │                              │   │
│  │   - users (optional)        │          │                              │   │
│  └─────────────────────────────┘          └─────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | React 18, TypeScript, Vite | Existing scaffold, hot reload for development |
| **Backend** | Node.js 20, Fastify, TypeScript | Fast, low-overhead, excellent TypeScript support |
| **Database** | PostgreSQL 15+ | Robust, relational, excellent for structured data |
| **ORM** | Drizzle ORM | Type-safe, lightweight, SQL-like syntax |
| **Documents** | Local filesystem | Simple, no external dependencies, user owns data |
| **Dev Server** | Vite (frontend) + tsx (backend) | Fast iteration with hot reload |

## Design Decisions

### Why Local-First?

1. **Privacy**: User data never leaves their machine
2. **Offline**: Works without internet connection
3. **Simplicity**: No cloud infrastructure to manage or pay for
4. **Speed**: No network latency for API calls
5. **Ownership**: Users have full control of their data

### Why PostgreSQL?

1. **Relational model**: Natural fit for applications with status history
2. **ACID transactions**: Safe status transitions with history logging
3. **Rich queries**: Complex filtering, sorting, and aggregations
4. **Mature ecosystem**: Excellent tooling, backups, migrations
5. **Local installation**: Easy setup via Docker or native install

See [ADR-001: Database Selection](./adr/ADR-001-database-selection.md) for full analysis.

### Why Fastify?

1. **Performance**: Fastest Node.js framework
2. **TypeScript**: First-class support with type providers
3. **Schema validation**: Built-in JSON Schema validation
4. **Plugin system**: Modular, testable architecture
5. **Existing codebase**: Aligns with current project patterns

### Why Filesystem for Documents?

1. **Existing feature**: Resume/cover letter storage already file-based
2. **Simplicity**: No blob storage configuration needed
3. **Portability**: Easy backup (just copy the folder)
4. **Direct access**: Users can browse/edit files directly if needed

## Component Details

### Backend Server

**Framework**: Fastify 4.x with TypeScript

**Project Structure**:

```
backend/
├── src/
│   ├── index.ts                 # Server entry point
│   ├── app.ts                   # Fastify app configuration
│   ├── config.ts                # Environment configuration
│   ├── db/
│   │   ├── client.ts            # PostgreSQL connection
│   │   ├── schema.ts            # Drizzle schema definitions
│   │   └── migrations/          # SQL migrations
│   ├── routes/
│   │   ├── applications.ts      # /api/applications routes
│   │   ├── dashboard.ts         # /api/dashboard routes
│   │   └── cover-letters.ts     # /api/cover-letters routes
│   ├── services/
│   │   ├── application.service.ts
│   │   ├── status.service.ts
│   │   └── dashboard.service.ts
│   └── types/
│       └── index.ts             # Shared TypeScript types
├── package.json
├── tsconfig.json
└── drizzle.config.ts
```

**Key Dependencies**:

```json
{
  "dependencies": {
    "fastify": "^4.26.0",
    "@fastify/cors": "^9.0.0",
    "drizzle-orm": "^0.29.0",
    "postgres": "^3.4.0",
    "zod": "^3.22.0",
    "ulid": "^2.3.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.20.0",
    "tsx": "^4.7.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
```

### PostgreSQL Database

**Connection**: `postgresql://localhost:5432/job_app_manager`

**Tables**:

| Table | Purpose |
|-------|---------|
| `applications` | Core job application records |
| `status_history` | Audit trail of status changes |
| `app_settings` | User preferences (optional) |

See [DATA_MODEL.md](./DATA_MODEL.md) for full schema definitions.

### Local Filesystem Structure

```
data/
├── resumes/
│   └── {userId}/
│       └── {resumeId}.pdf
├── cover-letters/
│   └── {userId}/
│       └── {coverLetterId}.md
└── projects/
    └── {projectId}/
        └── notes.md
```

## API Design

### Base URL

```
http://localhost:3000/api
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/applications` | List all applications |
| GET | `/applications/:id` | Get single application |
| POST | `/applications` | Create application |
| PATCH | `/applications/:id` | Update application |
| DELETE | `/applications/:id` | Delete application |
| POST | `/applications/:id/status` | Update status |
| GET | `/dashboard` | Get dashboard stats |
| GET | `/cover-letters` | List available cover letters |

See [API_CONTRACTS.md](./API_CONTRACTS.md) for full specification.

## Development Setup

### Prerequisites

1. **Node.js 20+**: JavaScript runtime
2. **PostgreSQL 15+**: Database (via Docker or native)
3. **pnpm** (recommended): Package manager

### Quick Start

```bash
# 1. Start PostgreSQL (Docker)
docker run -d \
  --name job-app-postgres \
  -e POSTGRES_DB=job_app_manager \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15

# 2. Install dependencies
pnpm install

# 3. Run database migrations
pnpm db:migrate

# 4. Start backend
pnpm dev:backend   # Runs on http://localhost:3000

# 5. Start frontend (separate terminal)
pnpm dev           # Runs on http://localhost:5173
```

### Environment Variables

```bash
# .env.local
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/job_app_manager
DATA_DIR=./data
PORT=3000
```

## Data Flow

### Create Application

```
Frontend                    Backend                     PostgreSQL
   │                          │                            │
   │  POST /api/applications  │                            │
   │─────────────────────────▶│                            │
   │                          │  BEGIN TRANSACTION         │
   │                          │───────────────────────────▶│
   │                          │                            │
   │                          │  INSERT application        │
   │                          │───────────────────────────▶│
   │                          │                            │
   │                          │  INSERT status_history     │
   │                          │───────────────────────────▶│
   │                          │                            │
   │                          │  COMMIT                    │
   │                          │───────────────────────────▶│
   │                          │                            │
   │  201 { application }     │                            │
   │◀─────────────────────────│                            │
```

### Update Status (with validation)

```
Frontend                    Backend                     PostgreSQL
   │                          │                            │
   │  POST /status            │                            │
   │─────────────────────────▶│                            │
   │                          │                            │
   │                          │  Validate transition       │
   │                          │  (saved → applied OK)      │
   │                          │  (saved → offer INVALID)   │
   │                          │                            │
   │                          │  BEGIN TRANSACTION         │
   │                          │───────────────────────────▶│
   │                          │                            │
   │                          │  UPDATE application.status │
   │                          │───────────────────────────▶│
   │                          │                            │
   │                          │  INSERT status_history     │
   │                          │───────────────────────────▶│
   │                          │                            │
   │                          │  COMMIT                    │
   │                          │───────────────────────────▶│
   │                          │                            │
   │  200 { application }     │                            │
   │◀─────────────────────────│                            │
```

## Security Considerations

### Local-First Security Model

Since this is a local application, security focuses on:

| Concern | Approach |
|---------|----------|
| **Data at rest** | Filesystem permissions, optional encryption |
| **Database access** | Local-only binding (localhost:5432) |
| **API access** | Local-only binding (localhost:3000) |
| **Input validation** | Zod schemas on all inputs |
| **SQL injection** | Parameterized queries via Drizzle ORM |

### Optional: Multi-User Mode

For shared machines, an optional authentication layer can be added:

- Simple username/password stored in PostgreSQL
- Session-based auth with secure cookies
- User ID scoping on all queries

## Testing Strategy

### Unit Tests

```bash
pnpm test:unit
```

- Service layer logic
- Status transition validation
- Data transformation functions

### Integration Tests

```bash
pnpm test:integration
```

- API endpoint testing with supertest
- Database operations with test database
- Full request/response validation

### E2E Tests

```bash
pnpm test:e2e
```

- Playwright tests against running app
- Critical user flows (create, update status, filter)

## Backup & Data Portability

### Manual Backup

```bash
# Database backup
pg_dump job_app_manager > backup.sql

# Documents backup
cp -r ./data ./data-backup

# Full backup
tar -czf job-app-backup-$(date +%Y%m%d).tar.gz backup.sql data/
```

### Restore

```bash
# Database restore
psql job_app_manager < backup.sql

# Documents restore
cp -r ./data-backup ./data
```

### Export to JSON

For data portability, an export endpoint provides all data as JSON:

```bash
GET /api/export
# Returns: { applications: [...], statusHistory: [...] }
```

## Future Considerations

### Phase 2+ Features

| Feature | Implementation |
|---------|---------------|
| **Reminders (US-7.1)** | node-cron for local scheduling, system notifications |
| **Notes (US-8.1)** | New `notes` table, rich text with Markdown |
| **Contacts (US-8.2)** | New `contacts` table, linked to applications |
| **Cloud sync (optional)** | Future consideration for multi-device users |

### Potential Enhancements

- **Electron wrapper**: Desktop app with system tray
- **SQLite option**: Even simpler single-file database
- **Browser extension**: Quick-save jobs from listing sites

## References

- [API Contracts](./API_CONTRACTS.md)
- [Data Model](./DATA_MODEL.md)
- [ADR-001: Database Selection](./adr/ADR-001-database-selection.md)
- [Requirements Plan (WIC-15)](/WIC/issues/WIC-15#document-plan)
- [UI/UX Design Specs](../design/)
