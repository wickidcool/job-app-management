# Job Application Manager

A modern web application for managing job applications built with React and TypeScript.

## Project Structure

This is a monorepo using npm workspaces with three packages:

```
packages/
├── web/          # Vite/React frontend (@wic/web)
├── api/          # Fastify local backend with Drizzle/PostgreSQL (@wic/api)
└── infra/        # AWS CDK infrastructure (@wic/infra)
```

## Tech Stack

### Frontend (`@wic/web`)
- **Framework:** React 19
- **Language:** TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **State:** TanStack Query
- **Forms:** React Hook Form + Zod

### Backend (`@wic/api`)
- **Framework:** Fastify
- **ORM:** Drizzle
- **Database:** PostgreSQL (local)
- **Language:** TypeScript

### Infrastructure (`@wic/infra`)
- **IaC:** AWS CDK
- **Runtime:** Lambda (Node.js)
- **Database:** DynamoDB (cloud deployment)

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm (v7 or higher for workspaces support)
- Docker (for PostgreSQL)

### Installation

1. Install dependencies (all packages):
   ```bash
   npm install
   ```

2. Start PostgreSQL:
   ```bash
   docker compose up -d
   ```

3. Run database migrations:
   ```bash
   npm run db:migrate
   ```

4. Start development servers:
   ```bash
   # Start frontend (http://localhost:5173)
   npm run dev

   # In another terminal, start API (http://localhost:3000)
   npm run dev:api
   ```

## Available Scripts

### Root Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend dev server |
| `npm run dev:api` | Start API dev server |
| `npm run build` | Build all packages |
| `npm run lint` | Lint all packages |
| `npm run test` | Run tests in all packages |
| `npm run format` | Format all code with Prettier |
| `npm run db:migrate` | Run database migrations |
| `npm run db:push` | Push schema changes to database |

### Package-Specific Commands

Run commands in specific packages:

```bash
# Run any script in a specific package
npm run <script> --workspace=@wic/web
npm run <script> --workspace=@wic/api
npm run <script> --workspace=@wic/infra
```

## Architecture

See [docs/architecture/](docs/architecture/) for detailed documentation:
- [Architecture Overview](docs/architecture/ARCHITECTURE.md)
- [API Contracts](docs/architecture/API_CONTRACTS.md)
- [Data Model](docs/architecture/DATA_MODEL.md)
- [ADR-001: Database Selection](docs/architecture/adr/ADR-001-database-selection.md)
- [ADR-002: Monorepo Structure](docs/architecture/adr/ADR-002-monorepo-structure.md)

## Development Guidelines

### Code Style

- Follow TypeScript best practices
- Use functional components with hooks
- Keep components small and focused
- Write descriptive variable and function names

### Formatting & Linting

Code formatting is enforced with Prettier and ESLint:

```bash
npm run format      # Auto-fix formatting
npm run lint        # Check for lint errors
```

## Project Status

In Development - See architecture documentation for current status.

## License

Proprietary - All rights reserved
