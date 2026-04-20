# Job Application Manager

Local-first, single-user job application tracking app. No cloud dependencies — runs entirely on the user's machine.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 3, TanStack Query 5, React Router 7, React Hook Form, Radix UI, @dnd-kit
- **Backend**: Node.js, Fastify 4, TypeScript, Drizzle ORM
- **Database**: PostgreSQL 15 (Docker), migrations via drizzle-kit
- **Testing**: Vitest (backend), V8 coverage
- **Tooling**: npm workspaces monorepo, Prettier, ESLint

## Monorepo Layout

```
packages/
  api/          @wic/api  — Fastify REST API (port 3000)
    src/
      index.ts            Server entry point
      app.ts              Fastify app setup (CORS, error handler, routes)
      config.ts           Environment config (dotenv)
      db/
        client.ts         Drizzle/PostgreSQL connection
        schema.ts         Drizzle ORM table definitions
        migrate.ts        Migration runner
        migrations/       SQL migration files (0001, 0002, ...)
      routes/
        applications.ts   /api/applications CRUD + status transitions
        cover-letters.ts  /api/cover-letters filesystem listing
        dashboard.ts      /api/dashboard stats aggregation
        resumes.ts        /api/resumes upload + export endpoints
      services/
        application.service.ts   App CRUD, status changes with transactions
        dashboard.service.ts     Stats aggregation queries
        resume.service.ts        PDF/DOCX parsing, STAR markdown generation
        status.service.ts        Valid status transitions map
      types/
        index.ts          DTOs, error classes (AppError, NotFoundError, etc.)

  web/          @wic/web  — React SPA (Vite dev server port 5173)
    src/
      main.tsx            Entry point
      App.tsx             Root component, React Router setup
      components/         UI components (ApplicationCard, KanbanBoard, ResumeUpload, etc.)
      pages/              Route pages (Dashboard, ApplicationsList, ApplicationDetail, etc.)
      hooks/              TanStack Query hooks (useApplications, useDashboard, useResumes)
      services/api/       HTTP client layer (apiClient.ts + per-resource services)
      types/              Frontend type definitions

docs/
  architecture/           ARCHITECTURE.md, API_CONTRACTS.md, DATA_MODEL.md, ADRs
  design/                 DESIGN_SYSTEM.md, COMPONENT_SPECS.md, USER_FLOWS.md, WIREFRAMES.md
```

## Key Commands

```bash
docker compose up -d          # Start PostgreSQL
npm install                   # Install all workspace deps
npm run db:migrate            # Run database migrations
npm run dev:api               # Start API server (localhost:3000)
npm run dev                   # Start frontend dev server (localhost:5173)
npm run build                 # Build all packages
npm run lint                  # Lint all packages
npm run test                  # Run tests (backend only currently)
npm run format                # Prettier format
npm run db:push               # Push schema changes directly (dev only)
```

## Architecture Decisions

- **ES modules** throughout (`"type": "module"` in both packages)
- **ULIDs** for all primary keys (via `ulid` package)
- **Optimistic locking** — all mutable records have a `version` column; updates require the current version
- **Status transitions** are validated server-side via `VALID_TRANSITIONS` map in `status.service.ts`
- **Status changes** use database transactions with row-level locking
- **Cursor-based pagination** (base64url-encoded offset) on list endpoints
- **Zod** for request validation on all API routes
- **Local filesystem storage** for resumes and cover letters under `DATA_DIR` (default `./data`)
- **Vite proxy** forwards `/api` requests to the Fastify backend during development

## Database

PostgreSQL with Drizzle ORM. Tables:

| Table | Purpose |
|---|---|
| `applications` | Job applications with status, company, job title, etc. |
| `status_history` | Audit trail of status changes per application |
| `resumes` | Uploaded resume metadata (file stored on disk) |
| `resume_exports` | Generated STAR-format markdown exports |

Status enum: `saved → applied → phone_screen → interview → offer | rejected | withdrawn`

Terminal statuses: `offer`, `rejected`, `withdrawn` (no further transitions).

## Naming Conventions

- **Files**: camelCase for utilities/services, PascalCase for React components
- **Database columns**: snake_case
- **JS/TS properties**: camelCase
- **Constants**: UPPER_SNAKE_CASE

## Environment Variables

Required in `packages/api/.env` (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3000 | API server port |
| `HOST` | 127.0.0.1 | Bind address |
| `NODE_ENV` | development | Environment |
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `DATA_DIR` | ./data | Local file storage directory |

## Design System

Tailwind config defines custom tokens:
- **Colors**: primary (blue), neutral (gray), success/warning/error/info + per-status colors (`status.saved`, `status.applied`, etc.)
- **Typography**: display, h1–h4, body-lg/body/body-sm, caption, overline
- **Transitions**: fast (150ms), base (250ms), slow (350ms)

## Testing

- Backend: `vitest` with V8 coverage. Tests in `packages/api/test/`.
- Frontend: No test suite configured yet.
