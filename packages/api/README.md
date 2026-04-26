# Job Application Manager — Local Backend Server

A local Fastify + PostgreSQL backend for the Job Application Manager.

## Quick Start

### 1. Start PostgreSQL

```bash
# Via Docker Compose (from project root)
docker compose up -d postgres

# Or standalone Docker
docker run -d \
  --name job-app-postgres \
  -e POSTGRES_DB=job_app_manager \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15
```

### 2. Install Dependencies

```bash
cd server
npm install
```

### 3. Configure Environment

Create `.env` in the `server/` directory (or set env vars directly):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/job_app_manager
DATA_DIR=./data
PORT=3000
HOST=127.0.0.1
```

### 4. Run Migrations

```bash
npm run db:migrate
```

### 5. Start the Server

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build && npm start
```

The API is available at `http://localhost:3000/api`.

## API Endpoints

| Method | Path                           | Description                        |
| ------ | ------------------------------ | ---------------------------------- |
| GET    | `/api/applications`            | List applications (with filtering) |
| GET    | `/api/applications/:id`        | Get application + status history   |
| POST   | `/api/applications`            | Create application                 |
| PATCH  | `/api/applications/:id`        | Update application fields          |
| DELETE | `/api/applications/:id`        | Delete application                 |
| POST   | `/api/applications/:id/status` | Update application status          |
| GET    | `/api/dashboard`               | Dashboard stats + recent activity  |
| GET    | `/api/cover-letters`           | List available cover letters       |
| GET    | `/health`                      | Health check                       |

See [API Contracts](../docs/architecture/API_CONTRACTS.md) for full request/response schemas.

## Status Transitions

```
saved → applied → phone_screen → interview → offer (terminal)
                              ↘                  ↘ rejected (terminal)
                               → rejected          ↘
                ↘ rejected                          withdrawn (terminal)
                ↘ withdrawn
```

## Running Tests

```bash
# Unit + route tests (no DB required)
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## Database Migrations

```bash
# Generate new migration from schema changes
npm run db:generate

# Apply pending migrations
npm run db:migrate

# Push schema directly (dev only)
npm run db:push
```

## Project Structure

```
server/
├── src/
│   ├── index.ts          # Server entry point
│   ├── app.ts            # Fastify app setup
│   ├── config.ts         # Environment config
│   ├── db/
│   │   ├── client.ts     # PostgreSQL connection
│   │   ├── schema.ts     # Drizzle schema
│   │   ├── migrate.ts    # Migration runner
│   │   └── migrations/   # SQL migration files
│   ├── routes/
│   │   ├── applications.ts
│   │   ├── dashboard.ts
│   │   └── cover-letters.ts
│   ├── services/
│   │   ├── application.service.ts
│   │   ├── status.service.ts
│   │   └── dashboard.service.ts
│   └── types/
│       └── index.ts
├── test/
│   ├── status.service.test.ts
│   └── application.routes.test.ts
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```
