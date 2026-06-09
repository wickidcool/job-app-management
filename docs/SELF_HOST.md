# Self-Hosting Careerpin

Careerpin is designed for local-first, self-hosted deployment. This guide covers configuration options for running your own instance.

## Prerequisites

- Node.js v18+
- Docker (for PostgreSQL)
- Git

## Quick Start

```bash
git clone <repo-url>
cd careerpin
npm install
docker compose up -d
cp packages/api/.env.example packages/api/.env
npm run db:migrate
npm run dev:api &
npm run dev
```

Open `http://localhost:5173` in your browser.

## Configuration

All configuration is done via environment variables in `packages/api/.env`. Copy the example file to get started:

```bash
cp packages/api/.env.example packages/api/.env
```

### Required Variables

| Variable       | Description                  |
| -------------- | ---------------------------- |
| `DATABASE_URL` | PostgreSQL connection string |

### Optional Variables

| Variable   | Default     | Description                  |
| ---------- | ----------- | ---------------------------- |
| `PORT`     | `3000`      | API server port              |
| `HOST`     | `127.0.0.1` | API bind address             |
| `DATA_DIR` | `./data`    | Local file storage directory |

## AI Features (BYO Claude API Key)

Careerpin includes AI-powered features for resume parsing and job fit analysis. These features are **optional** and require your own Claude API key from Anthropic.

### Getting a Claude API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account or sign in
3. Navigate to **API Keys** in the sidebar
4. Click **Create Key**
5. Copy the key (starts with `sk-ant-`)

### Enabling AI Features

Add your API key to `packages/api/.env`:

```bash
# Your Claude API key
ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional: specify model (default: claude-sonnet-4-6)
LLM_MODEL=claude-sonnet-4-6
```

Restart the API server after adding the key:

```bash
npm run dev:api
```

### What AI Features Do

When `ANTHROPIC_API_KEY` is set:

- **Resume parsing**: Upload a PDF/DOCX resume and Claude extracts structured data (experience, skills, education)
- **Job fit analysis**: Get AI-powered analysis of how well your resume matches a job description
- **STAR format export**: Generate interview-ready STAR narratives from your experience

### Without an API Key

If `ANTHROPIC_API_KEY` is not set, the app works normally but AI features are disabled. You can still:

- Track applications manually
- Upload and store resumes (without parsing)
- Manage your pipeline with the Kanban board

## Authentication (Optional)

For multi-device access with authentication, configure Supabase:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_JWT_SECRET=your-jwt-secret
```

See [AUTHENTICATION.md](./AUTHENTICATION.md) for setup instructions.

## Cloud Storage (Optional)

Store files in Cloudflare R2 or any S3-compatible service:

```bash
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET=careerpin-files
```

## Docker Deployment

For production deployment with Docker:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Environment variables can be set in `docker-compose.prod.yml` or via a `.env` file.

## Troubleshooting

### AI features not working

1. Verify your API key is valid at [console.anthropic.com](https://console.anthropic.com)
2. Check that `ANTHROPIC_API_KEY` is set correctly (no quotes, no trailing spaces)
3. Restart the API server after changing `.env`
4. Check API logs for error messages

### Database connection errors

1. Ensure PostgreSQL is running: `docker compose ps`
2. Verify `DATABASE_URL` format: `postgresql://user:password@host:port/database`
3. Check that the database exists and migrations have run

## Support

For issues and feature requests, see the project repository.
