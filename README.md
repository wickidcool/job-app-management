# Job Application Manager

A full-stack web app for managing job-application materials: upload/edit project markdown files, parse resumes, maintain a keyword index, match against job descriptions, and generate cover letters with AI.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, CodeMirror 6, React Markdown, React Router
- **Backend**: Node.js, Fastify, TypeScript, `pdf-parse`, `slugify`, `zod`
- **AI**: Anthropic Claude or OpenAI (optional; deterministic stub for tests)
- **Testing**: Vitest (unit + integration), Playwright (E2E)

## Prerequisites

- Node.js 20+
- npm 9+

## Setup

```bash
npm install
cp .env.example .env
# Edit .env — set AI_PROVIDER if you want AI features
```

## Running

```bash
# Development (backend + frontend concurrently)
npm run dev

# Backend only (port 3001)
npm run dev --workspace=packages/backend

# Frontend only (port 5173, proxies /api to backend)
npm run dev --workspace=packages/frontend
```

## Testing

```bash
# All unit + integration tests
npm test

# Backend tests only
npm test --workspace=packages/backend

# Frontend unit tests only
npm test --workspace=packages/frontend

# E2E tests (requires backend + frontend running, or uses playwright webServer)
npm run test:e2e --workspace=packages/frontend
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Backend port |
| `STORAGE_DIR` | `./data` | Root directory for project files and index |
| `AI_PROVIDER` | _(optional)_ | `anthropic`, `openai`, or `stub` |
| `AI_API_KEY` | _(optional)_ | Provider API key (not required for `stub`) |
| `ANTHROPIC_MODEL` | `claude-3-5-haiku-20241022` | Anthropic model override |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model override |
| `VITE_API_BASE_URL` | `''` | Backend URL for production frontend builds |

## Architecture Notes

- All AI calls go through the `AIProvider` interface. Use `AI_PROVIDER=stub` for tests.
- Project files are stored as plain markdown in `STORAGE_DIR/projects/`. The `index.md` is auto-regenerated on every project create/update/delete.
- Concurrent writes are not safe (single-user local app, no file locking).
- Changing `AI_PROVIDER` requires a server restart.
