# Job App Management — Developer Reference

## Project Structure

```
packages/
  api/    — Fastify backend (Node.js, TypeScript, PostgreSQL)
  web/    — Frontend (Vite, TypeScript)
  infra/  — Infrastructure config
```

## Environment Variables

All variables are set in `packages/api/.env` (copy from `packages/api/.env.example`).

### Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP server port |
| `HOST` | No | `127.0.0.1` | HTTP server bind address |
| `NODE_ENV` | No | `development` | Runtime environment |
| `DATABASE_URL` | Yes | — | PostgreSQL connection URL |
| `DATA_DIR` | No | `./data` | Directory for local file storage |

### LLM / AI

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No* | — | Anthropic API key for Claude. Required for AI-powered features (resume parsing, job fit analysis). |
| `LLM_MODEL` | No | `claude-sonnet-4-6` | Claude model to use for LLM features. |

*Features that call the LLM are disabled when `ANTHROPIC_API_KEY` is unset.

### Auth (Supabase)

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_URL` | No | — | Supabase project URL. When set, all `/api/*` endpoints require a valid JWT. |
| `SUPABASE_ANON_KEY` | No | — | Supabase anonymous key. |
| `SUPABASE_JWT_SECRET` | No | — | Supabase JWT secret for server-side verification. |

### Storage (R2 / S3)

| Variable | Required | Default | Description |
|---|---|---|---|
| `R2_ENDPOINT` | No | — | S3-compatible endpoint URL. When set, files are stored in R2 instead of the local filesystem. |
| `R2_ACCESS_KEY_ID` | No | — | R2 / S3 access key ID. |
| `R2_SECRET_ACCESS_KEY` | No | — | R2 / S3 secret access key. |
| `R2_BUCKET` | No | — | R2 / S3 bucket name. |

## Common Commands

```bash
# Install dependencies
npm install

# Start API in dev mode
cd packages/api && npm run dev

# Run API tests
cd packages/api && npm test

# Run e2e tests
npx playwright test
```
