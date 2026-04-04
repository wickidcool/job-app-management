# Job Application Manager — Implementation Plan
> **For trycycle:** REQUIRED SUB-SKILL: Use `trycycle-executing` to implement this plan task-by-task.

**Date:** 2026-04-03  
**Branch:** `job-app-web-app`  
**Worktree:** `/Users/alwick/development/projects/job-app-management/.worktrees/job-app-web-app`

---

## Overview

Build a full-stack web application that helps users manage their job applications. Users can upload markdown files per company/project they have worked on, or upload a resume (PDF or plain text) to parse out company/project sections automatically. These markdown files can be edited manually or with AI assistance. An index markdown is kept in sync with tech keywords for each project file. Users can paste a job description to get a match score against their projects/skills, and generate a cover letter from the job description.

### Technology Decisions (with justification)

- **Frontend:** React 18 + TypeScript + Vite — idiomatic SPA, fast HMR, type-safe, aligned with user preference
- **Backend:** Node.js + Fastify + TypeScript — user-specified, excellent performance, schema-based validation via `@fastify/multipart` and `zod`
- **AI:** Configurable via env var `AI_PROVIDER` (`anthropic` | `openai`) with `AI_API_KEY`. Abstracted behind a shared `AIProvider` interface so providers are swappable without changing business logic.
- **Storage:** Local filesystem under a configurable `STORAGE_DIR` (default `./data`). Files are stored as `.md` files on disk, no database needed. This matches the single-user, locally-stored requirement.
- **Resume parsing:** `pdf-parse` for PDF extraction; plain text directly. Custom section parser extracts headings, companies, and bullet points.
- **Testing:** Vitest (unit + Fastify `inject()`), Playwright (E2E). Stubs for AI calls.
- **Monorepo layout:** `packages/backend` + `packages/frontend` with a root-level `package.json` for shared scripts.

### Key Invariants

1. Every markdown file in `STORAGE_DIR/projects/` is mirrored in `STORAGE_DIR/index.md` (keywords section).
2. The `index.md` is regenerated whenever a project file is created, updated, or deleted.
3. AI calls are always gated by the `AIProvider` interface; the stub implementation returns deterministic fake text during tests.
4. The frontend never calls AI APIs directly — all AI calls go through the backend.
5. PDF parsing produces structured sections; if parsing fails, the raw text is preserved verbatim.
6. File names are slugified from the company/project name; collisions append a numeric suffix.
7. The API uses `Content-Type: application/json` for all non-file endpoints.

### Tricky Boundaries

- **Index sync on concurrent writes:** Since this is a single-user local app, we use simple synchronous file writes with no locking. Document this as a known limitation.
- **Resume parsing ambiguity:** Resume section detection uses heuristics (uppercase headings, bold markers, common section names). Unparseable resumes fall back to raw text with a warning returned to the client.
- **AI provider switching:** The provider is resolved at startup and held for the process lifetime. Changing `AI_PROVIDER` requires a server restart.
- **Cover letter length:** OpenAI and Anthropic have different context windows; we cap prompt+context at 8,000 tokens for safety.
- **Large markdown files:** No hard limit, but the AI update endpoint documents a soft 50KB cap on project file content to avoid token overflow.

---

## Repository Layout

```
job-app-management/
├── package.json                  # Root scripts: dev, build, test, lint
├── turbo.json                    # Turborepo config (optional; use if beneficial)
├── packages/
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts          # Fastify server entry
│   │   │   ├── config.ts         # Env-var config (STORAGE_DIR, AI_PROVIDER, AI_API_KEY, PORT)
│   │   │   ├── ai/
│   │   │   │   ├── interface.ts  # AIProvider interface
│   │   │   │   ├── anthropic.ts  # Anthropic implementation
│   │   │   │   ├── openai.ts     # OpenAI implementation
│   │   │   │   ├── stub.ts       # Deterministic stub for tests
│   │   │   │   └── factory.ts    # createAIProvider(config) -> AIProvider
│   │   │   ├── storage/
│   │   │   │   ├── projectStore.ts   # CRUD for project .md files
│   │   │   │   └── indexStore.ts     # Read/write/regenerate index.md
│   │   │   ├── resume/
│   │   │   │   └── parser.ts     # PDF + plain-text resume parser
│   │   │   ├── matching/
│   │   │   │   └── matcher.ts    # Job description ↔ index keyword matching
│   │   │   └── routes/
│   │   │       ├── projects.ts   # CRUD routes for project files
│   │   │       ├── resume.ts     # Upload + parse resume
│   │   │       ├── index.ts      # Get/regenerate index
│   │   │       ├── ai.ts         # AI update + cover letter routes
│   │   │       └── match.ts      # Job description matching
│   │   └── test/
│   │       ├── unit/
│   │       │   ├── resume-parser.test.ts
│   │       │   ├── index-generator.test.ts
│   │       │   └── matcher.test.ts
│   │       ├── integration/
│   │       │   ├── projects.test.ts
│   │       │   ├── resume.test.ts
│   │       │   ├── ai.test.ts
│   │       │   └── match.test.ts
│   │       └── fixtures/
│   │           ├── sample-resume.txt
│   │           └── sample-resume.pdf  (binary, generated by test setup)
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── playwright.config.ts
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── api/
│       │   │   └── client.ts     # Typed fetch wrappers for all backend routes
│       │   ├── components/
│       │   │   ├── FileList.tsx
│       │   │   ├── MarkdownEditor.tsx
│       │   │   ├── ResumeUpload.tsx
│       │   │   ├── IndexView.tsx
│       │   │   ├── JobMatcher.tsx
│       │   │   └── CoverLetter.tsx
│       │   └── pages/
│       │       ├── ProjectsPage.tsx
│       │       ├── UploadPage.tsx
│       │       ├── IndexPage.tsx
│       │       ├── MatchPage.tsx
│       │       └── CoverLetterPage.tsx
│       └── e2e/
│           ├── upload-markdown.spec.ts
│           ├── upload-resume.spec.ts
│           ├── edit-project.spec.ts
│           ├── ai-update.spec.ts
│           ├── generate-index.spec.ts
│           ├── job-match.spec.ts
│           └── cover-letter.spec.ts
└── data/                         # gitignored; runtime storage
    ├── projects/
    └── index.md
```

---

## API Contract

All endpoints are prefixed `/api/v1`.

### Projects

| Method | Path | Description |
|---|---|---|
| GET | `/projects` | List all project files (name, slug, size, mtime) |
| GET | `/projects/:slug` | Get project file content |
| POST | `/projects` | Create project file (JSON body: `{ name, content }`) |
| PUT | `/projects/:slug` | Update project file content |
| DELETE | `/projects/:slug` | Delete project file |
| POST | `/projects/upload` | Upload a `.md` file (multipart) |

### Resume

| Method | Path | Description |
|---|---|---|
| POST | `/resume/parse` | Upload resume (PDF or .txt), returns parsed sections as project candidates |

### Index

| Method | Path | Description |
|---|---|---|
| GET | `/index` | Get current index.md content |
| POST | `/index/regenerate` | Force regenerate index.md from all project files |

### AI

| Method | Path | Description |
|---|---|---|
| POST | `/ai/update/:slug` | AI-assisted update of a project file (body: `{ instruction }`) |
| POST | `/ai/cover-letter` | Generate cover letter (body: `{ jobDescription, additionalContext? }`) |

### Match

| Method | Path | Description |
|---|---|---|
| POST | `/match` | Score job description against index (body: `{ jobDescription }`) |

---

## Data Formats

### Project file on disk
```
STORAGE_DIR/projects/<slug>.md
```
Plain markdown. No frontmatter required, but AI updates preserve any existing frontmatter.

### index.md format
```markdown
# Project Index

## <Project Name>
- **File:** <slug>.md
- **Tech:** TypeScript, React, Node.js
- **Keywords:** authentication, OAuth, REST API, PostgreSQL

## <Next Project>
...
```
The index is regenerated by reading all `.md` files and extracting tech stack mentions and domain keywords using a keyword extraction pass (list of known tech/stack terms + regex for capitalized proper nouns).

### Resume parsed sections response
```json
{
  "sections": [
    {
      "heading": "Experience",
      "entries": [
        {
          "company": "Acme Corp",
          "title": "Senior Engineer",
          "dates": "2020–2023",
          "bullets": ["Led migration to microservices", "Reduced latency by 40%"]
        }
      ]
    }
  ],
  "rawText": "...",
  "warnings": []
}
```

### Match response
```json
{
  "score": 0.72,
  "matchedKeywords": ["TypeScript", "React", "REST API"],
  "missedKeywords": ["Kubernetes", "Go"],
  "projectScores": [
    { "slug": "acme-corp", "name": "Acme Corp", "score": 0.85, "matchedKeywords": ["..."] }
  ]
}
```

### Cover letter response
```json
{
  "coverLetter": "Dear Hiring Manager, ..."
}
```

---

## Matching Algorithm

1. Extract keywords from the job description: split on non-alphanumeric, normalize case, filter stop words, keep known tech terms and capitalized tokens.
2. Extract keywords from `index.md` per-project section.
3. For each project, compute Jaccard similarity: `|job_keywords ∩ project_keywords| / |job_keywords ∪ project_keywords|`.
4. Overall score = weighted average of per-project scores (weight by project file recency, newer = higher).
5. Return sorted project list + global score + matched/missed keyword sets.

Justification: Jaccard similarity is simple, reproducible (no AI cost for matching), fast, and testable with exact assertions.

---

## AI Provider Interface

```typescript
interface AIProvider {
  updateProjectFile(content: string, instruction: string): Promise<string>;
  generateCoverLetter(indexContent: string, jobDescription: string, additionalContext?: string): Promise<string>;
}
```

Factory reads `AI_PROVIDER` env var (`anthropic` | `openai`). Both implementations use their respective SDKs (`@anthropic-ai/sdk`, `openai`). The stub returns `"[AI STUB] " + instruction` for `updateProjectFile` and a fixed cover letter string for tests.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Backend port |
| `STORAGE_DIR` | `./data` | Root directory for project files and index |
| `AI_PROVIDER` | _(required for AI features)_ | `anthropic`, `openai`, or `stub` (stub requires no key; used in tests/E2E) |
| `AI_API_KEY` | _(required for real AI providers)_ | Provider API key (not required when `AI_PROVIDER=stub`) |
| `VITE_API_BASE_URL` | `http://localhost:3001` | Backend URL for frontend |

---

## Tasks

### Task 1: Monorepo scaffold and tooling

**Goal:** Set up the repository structure, TypeScript configs, root scripts, and package.json files so the project compiles and lints cleanly from the root.

**Steps:**

1. Create root `package.json` with workspaces `["packages/backend", "packages/frontend"]`, scripts `dev`, `build`, `test`, `lint`.
2. Create `packages/backend/package.json` with deps: `fastify`, `@fastify/multipart`, `@fastify/cors`, `@fastify/static`, `pdf-parse`, `@anthropic-ai/sdk`, `openai`, `zod`, `slugify`. DevDeps: `typescript`, `tsx`, `vitest`, `@types/node`. Note: `pdf-parse` does not ship usable TypeScript declarations — add a `src/types/pdf-parse.d.ts` shim (`declare module 'pdf-parse'`) rather than relying on a non-existent `@types/pdf-parse`.
3. Create `packages/frontend/package.json` with deps: `react`, `react-dom`, `react-router-dom`, `codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown`, `@codemirror/commands`, `@codemirror/theme-one-dark`, `react-markdown`, `remark-gfm`. DevDeps: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@testing-library/react`, `@playwright/test`.
4. Create `tsconfig.json` files for both packages (strict mode, ES2022 target, module NodeNext for backend, ESNext for frontend).
5. Create `packages/backend/src/config.ts` — read and validate env vars with zod, export typed config object.
6. Create `.gitignore` additions: `data/`, `node_modules/`, `dist/`, `.env`.
7. Create `.env.example` documenting all env vars.
8. Run `npm install` from root.
9. Verify: `npm run build` succeeds from root (or at minimum TypeScript compilation passes with `tsc --noEmit`).

**Verification:** `npm run build` exits 0; no TypeScript errors.

---

### Task 2: Backend — storage layer (projectStore + indexStore)

**Goal:** Implement the file system abstraction for project files and the index. All other backend code depends on this.

**Steps:**

1. **Existing tests to run:** None yet — write new ones.
2. Write `packages/backend/test/unit/project-store.test.ts` with tests for:
   - `createProject(name, content)` → file created at correct slug path, slug returned
   - `getProject(slug)` → returns content or throws NotFound
   - `updateProject(slug, content)` → file updated
   - `deleteProject(slug)` → file removed
   - `listProjects()` → returns array of `{ slug, name, size, mtime }`
   - Slug collision: creating two projects with same name appends `-2`, `-3`
3. Run tests — they should be red.
4. Implement `packages/backend/src/storage/projectStore.ts`:
   - `STORAGE_DIR/projects/` created on first use
   - `slugify(name, { lower: true })` from `slugify` package for file names
   - All ops are synchronous (`fs.readFileSync`, etc.) — single-user app, no race risk
   - `NotFoundError` class exported for use in routes
5. Write `packages/backend/test/unit/index-store.test.ts` with tests for:
   - `regenerateIndex(projects)` → correct markdown structure
   - `getIndex()` → returns current `index.md` content or empty string if missing
   - Keyword extraction: given known tech terms in project content, they appear in index
6. Run new tests — red.
7. Implement `packages/backend/src/storage/indexStore.ts`:
   - Keyword extraction: maintain a list of ~100 common tech terms (TypeScript, React, Node.js, Python, Docker, Kubernetes, PostgreSQL, MongoDB, Redis, GraphQL, REST, OAuth, JWT, CI/CD, AWS, GCP, Azure, etc.) plus regex for capitalized multi-char tokens
   - `regenerateIndex` rebuilds `STORAGE_DIR/index.md` by reading all project files and extracting keywords
   - `getIndex` reads `STORAGE_DIR/index.md`
8. Run all tests — green.
9. Refactor: ensure no duplication between projectStore and indexStore path resolution (extract `getProjectsDir()` helper).
10. Run all tests again — still green.

**Verification:** `npm run test --workspace=packages/backend` passes with all unit tests green.

---

### Task 3: Backend — resume parser

**Goal:** Implement PDF and plain-text resume parsing to extract structured sections.

**Steps:**

1. Write `packages/backend/test/unit/resume-parser.test.ts` with tests for:
   - Plain text resume with "EXPERIENCE", "EDUCATION", "SKILLS" sections → correct sections parsed
   - Plain text with bold `**Company Name**` entries → company extracted
   - PDF buffer (use test fixture `test/fixtures/sample-resume.txt` encoded as PDF bytes — use `pdf-parse` on a real tiny PDF) → raw text extracted and passed through section parser
   - Unparseable input → returns `{ sections: [], rawText: "...", warnings: ["Could not parse sections"] }`
2. Create `packages/backend/test/fixtures/sample-resume.txt` — a realistic 2-company resume in plain text.
3. Run tests — red.
4. Implement `packages/backend/src/resume/parser.ts`:
   - `parseResume(buffer: Buffer, mimetype: string): Promise<ParsedResume>`
   - For PDF: call `pdf-parse(buffer)` → extract `.text` → pass to section parser
   - For text: decode buffer as UTF-8 → pass to section parser
   - Section parser: split on lines, detect headings by ALL CAPS or `##` prefix or common section names; detect company entries by bold or capitalization patterns; collect bullet points as lines starting with `-`, `•`, or `*`
   - Return `ParsedResume` matching the schema above
5. Run tests — green.
6. Refactor: extract heading detection into a small pure function for clarity.
7. Run tests — still green.

**Verification:** All resume parser unit tests pass.

---

### Task 4: Backend — matching engine

**Goal:** Implement the job-description matching algorithm against the index.

**Steps:**

1. Write `packages/backend/test/unit/matcher.test.ts` with tests for:
   - `matchJobDescription(jobDesc, indexContent)` → correct score, matched/missed keywords
   - All keywords matched → score = 1.0
   - No keywords matched → score = 0.0
   - Partial match → Jaccard similarity within floating-point epsilon
   - Per-project scores returned, sorted descending by score
2. Run tests — red.
3. Implement `packages/backend/src/matching/matcher.ts`:
   - Tokenize job description: split on `/[\s,;()\[\]{}<>'"]+/`, lowercase, filter stop words (the, a, an, is, are, was, were, be, been, being, to, of, for, in, on, at, etc.), minimum length 2
   - Parse index.md into per-project sections (split on `## ` headings)
   - For each project, extract its keyword list from the index Tech/Keywords lines
   - Compute Jaccard similarity per project
   - Weight by recency: use mtime from projectStore if available; otherwise equal weight
   - Aggregate: `overallScore = sum(weight_i * score_i) / sum(weight_i)`
4. Run tests — green.
5. Refactor: pull stop-word list into a constant; ensure tokenizer is a pure function.
6. Run tests — still green.

**Verification:** All matcher unit tests pass.

---

### Task 5: Backend — AI provider abstraction

**Goal:** Implement the AIProvider interface, both real providers, and the deterministic stub.

**Steps:**

1. Write `packages/backend/test/unit/ai-factory.test.ts` with tests for:
   - `createAIProvider({ provider: 'stub' })` → returns StubAIProvider
   - Stub `updateProjectFile` returns string containing `[AI STUB]`
   - Stub `generateCoverLetter` returns non-empty string
2. Run tests — red.
3. Implement `packages/backend/src/ai/interface.ts` (TypeScript interface only).
4. Implement `packages/backend/src/ai/stub.ts`.
5. Implement `packages/backend/src/ai/anthropic.ts`:
   - Use `@anthropic-ai/sdk`
   - `updateProjectFile`: send system prompt "You are a technical writer. Update the following project description as instructed. Return only the updated markdown." + user message with content + instruction
   - `generateCoverLetter`: send index content + job description as context; cap total prompt at 8,000 tokens (rough char estimate: 1 token ≈ 4 chars)
   - Model: `claude-3-5-haiku-20241022` (fast, cheap) — configurable via `ANTHROPIC_MODEL` env var
6. Implement `packages/backend/src/ai/openai.ts`:
   - Use `openai` SDK
   - Same prompts as Anthropic implementation
   - Model: `gpt-4o-mini` — configurable via `OPENAI_MODEL` env var
7. Implement `packages/backend/src/ai/factory.ts`:
   - Reads `AI_PROVIDER` and `AI_API_KEY` from config
   - Valid values for `AI_PROVIDER`: `anthropic`, `openai`, `stub`. When `AI_PROVIDER=stub`, return `StubAIProvider` without requiring `AI_API_KEY` — this is the value used in all automated tests and E2E runs.
   - Throws a clear error if provider is unknown or key is missing for a real provider
8. Run all tests — green.
9. Refactor: extract shared prompt strings into a `prompts.ts` file imported by both providers.

**Verification:** All AI unit tests pass; `tsc --noEmit` clean.

---

### Task 6: Backend — Fastify server and routes

**Goal:** Wire up all routes into a working Fastify server, verified via `inject()` integration tests.

**Steps:**

1. Write `packages/backend/test/integration/projects.test.ts` — Fastify `inject()` tests:
   - `POST /api/v1/projects` → 201 with `{ slug, name }`
   - `GET /api/v1/projects` → 200 with array
   - `GET /api/v1/projects/:slug` → 200 with content; 404 for unknown slug
   - `PUT /api/v1/projects/:slug` → 200; file updated; index regenerated
   - `DELETE /api/v1/projects/:slug` → 204; file gone; index regenerated
   - `POST /api/v1/projects/upload` → 201 with multipart `.md` file
   - Each test uses a fresh temp dir (via `os.tmpdir()` + random suffix)
2. Run tests — red.
3. Implement `packages/backend/src/routes/projects.ts` — Fastify plugin with all project routes. Each mutating route calls `indexStore.regenerateIndex()` after the file operation.
4. Write `packages/backend/test/integration/resume.test.ts`:
   - `POST /api/v1/resume/parse` with plain text fixture → 200 with sections
   - `POST /api/v1/resume/parse` with PDF buffer → 200 (may have empty sections for minimal PDF, but no 500)
5. Write `packages/backend/test/integration/match.test.ts`:
   - `POST /api/v1/match` with job description → 200 with `{ score, matchedKeywords, projectScores }`
6. Write `packages/backend/test/integration/ai.test.ts` (uses StubAIProvider wired in test server):
   - `POST /api/v1/ai/update/:slug` → 200 with updated content containing `[AI STUB]`
   - `POST /api/v1/ai/cover-letter` → 200 with non-empty `coverLetter`
7. Run all integration tests — red.
8. Implement remaining route files:
   - `packages/backend/src/routes/resume.ts`
   - `packages/backend/src/routes/index.ts` (get + regenerate)
   - `packages/backend/src/routes/ai.ts` (update + cover-letter)
   - `packages/backend/src/routes/match.ts`
9. Implement `packages/backend/src/index.ts` — register all plugins, `@fastify/cors` (allow frontend origin), `@fastify/multipart`, register all route plugins under `/api/v1`.
10. Run all tests — green.
11. Refactor: ensure consistent error response shape `{ error: string, message: string }` across all 4xx/5xx responses.
12. Run all tests — still green.

**Verification:** All backend integration tests pass via `inject()`; server starts (`tsx src/index.ts`) without crashing.

---

### Task 7: Frontend — scaffold and API client

**Goal:** Bootstrap the React + Vite app and implement the typed API client.

**Steps:**

1. Create the frontend source structure manually (do NOT run `npm create vite` — the `packages/frontend/package.json` and `tsconfig.json` were already created in Task 1; running `create vite` would overwrite them). Create `packages/frontend/src/main.tsx`, `packages/frontend/src/App.tsx`, and `packages/frontend/index.html` by hand.
2. Configure `vite.config.ts` with proxy: `/api` → `http://localhost:${PORT}` so frontend dev server proxies API calls. Because the dev server proxies all `/api` requests, the API client should use relative paths (no host prefix) in dev; `VITE_API_BASE_URL` is used in production builds only — default to `''` (empty string) so requests are relative.
3. Set up `react-router-dom` with routes: `/` (projects list), `/upload`, `/index`, `/match`, `/cover-letter`.
4. Implement `packages/frontend/src/api/client.ts`:
   - Typed functions for each backend endpoint (matching the API contract above)
   - All functions use `fetch` with `VITE_API_BASE_URL` base
   - Return typed response objects; throw on non-2xx with error message from response body
5. Configure `packages/frontend/playwright.config.ts` with a `webServer` stanza that starts **both** the backend and the frontend before Playwright runs:
   ```ts
   webServer: [
     { command: 'tsx ../../packages/backend/src/index.ts', port: 3001, env: { AI_PROVIDER: 'stub', STORAGE_DIR: '/tmp/e2e-data' } },
     { command: 'vite --port 5173', port: 5173, reuseExistingServer: !process.env.CI },
   ]
   ```
   Tests hit `http://localhost:5173`. The backend uses `AI_PROVIDER=stub` so no real API key is needed.
6. Write basic Vitest smoke test: `client.ts` exports expected function names.
7. Run — green (smoke test only).

**Verification:** `npm run dev --workspace=packages/frontend` starts; `npm run build --workspace=packages/frontend` produces `dist/`.

---

### Task 8: Frontend — Projects page (list + upload + edit)

**Goal:** Implement the core project management UI: file list, markdown editor, file upload.

**Steps:**

1. Write Playwright test `e2e/upload-markdown.spec.ts`:
   - Navigate to `/`
   - Upload a `.md` file → file appears in list
   - Click file → content visible in editor
   - Screenshot taken and saved as artifact
2. Write Playwright test `e2e/edit-project.spec.ts`:
   - Navigate to `/`, click a file, edit content in editor, click Save → success toast shown; reload → edited content persists
3. Run E2E tests — red (UI not built yet).
4. Implement `FileList.tsx` — shows list of project files; each row has name, size, edit button, delete button.
5. Implement `MarkdownEditor.tsx` — CodeMirror 6 with markdown language support; Save button calls `PUT /api/v1/projects/:slug`; preview toggle renders markdown via `react-markdown`.
6. Implement `ResumeUpload.tsx` — file input (accept `.md`); calls `POST /api/v1/projects/upload`; on success, refreshes file list.
7. Implement `ProjectsPage.tsx` — composes FileList + MarkdownEditor + ResumeUpload.
8. Run E2E tests — green.
9. Refactor: extract a `useProjects()` custom hook for list fetch/invalidation logic.
10. Run E2E tests — still green.

**Verification:** E2E tests for upload-markdown and edit-project pass with screenshots.

---

### Task 9: Frontend — Resume upload and parse

**Goal:** Implement the resume upload UI that parses the resume and presents extracted sections as project candidates.

**Steps:**

1. Write Playwright test `e2e/upload-resume.spec.ts`:
   - Navigate to `/upload`
   - Upload the plain-text resume fixture → parsed sections appear as a list
   - Click "Create project from section" for one entry → navigates to `/` and that project appears in list
   - Screenshot taken
2. Run — red.
3. Implement `UploadPage.tsx`:
   - File input (accept `.pdf,.txt,.md`)
   - On upload: call `POST /api/v1/resume/parse`; display parsed sections
   - Each section entry shows company, title, dates, bullets
   - "Add as project" button → calls `POST /api/v1/projects` with auto-generated markdown content (heading + bullets)
4. Run E2E — green.
5. Refactor: extract `ParsedSectionCard.tsx` component.

**Verification:** Resume upload E2E test passes with screenshot.

---

### Task 10: Frontend — Index view

**Goal:** Implement the index page showing tech keywords per project.

**Steps:**

1. Write Playwright test `e2e/generate-index.spec.ts`:
   - Seed two project files via API
   - Navigate to `/index`
   - Index content rendered; at least one keyword visible
   - Click "Regenerate" → success message shown
   - Screenshot taken
2. Run — red.
3. Implement `IndexPage.tsx`:
   - Fetches `GET /api/v1/index` → renders markdown content using `react-markdown`
   - "Regenerate" button calls `POST /api/v1/index/regenerate`
4. Run E2E — green.

**Verification:** Index E2E test passes.

---

### Task 11: Frontend — AI update

**Goal:** Implement the AI-assisted markdown editing UI.

**Steps:**

1. Write Playwright test `e2e/ai-update.spec.ts` (uses AI stub via test env `AI_PROVIDER=stub`):
   - Open a project in editor
   - Click "Ask AI to update"
   - Type instruction in dialog
   - Submit → editor content updates with AI response
   - Screenshot taken
2. Run — red.
3. Add "Ask AI" button to `MarkdownEditor.tsx`:
   - Opens modal with textarea for instruction
   - On submit: calls `POST /api/v1/ai/update/:slug`
   - Updates editor content with response
4. Run E2E — green.

**Verification:** AI update E2E test passes with stub.

---

### Task 12: Frontend — Job description matching

**Goal:** Implement the job matcher page.

**Steps:**

1. Write Playwright test `e2e/job-match.spec.ts`:
   - Seed project files with known keywords via API
   - Navigate to `/match`
   - Paste job description containing some of those keywords
   - Click "Match" → score displayed, project list with scores shown, matched keywords highlighted
   - Screenshot taken
2. Run — red.
3. Implement `MatchPage.tsx`:
   - Textarea for job description
   - "Match" button calls `POST /api/v1/match`
   - Shows overall score (percentage), list of matched/missed keywords, ranked project list with per-project score
4. Run E2E — green.

**Verification:** Job match E2E test passes.

---

### Task 13: Frontend — Cover letter generation

**Goal:** Implement the cover letter generation page.

**Steps:**

1. Write Playwright test `e2e/cover-letter.spec.ts` (uses AI stub):
   - Navigate to `/cover-letter`
   - Paste job description
   - Click "Generate" → cover letter text appears in output area
   - Click "Copy" → clipboard content matches cover letter text
   - Screenshot taken
2. Run — red.
3. Implement `CoverLetterPage.tsx`:
   - Textarea for job description
   - Optional "Additional context" textarea
   - "Generate" button calls `POST /api/v1/ai/cover-letter`
   - Displays result in a read-only editor with "Copy to clipboard" button
4. Run E2E — green.

**Verification:** Cover letter E2E test passes.

---

### Task 14: Final integration — wire it all together and run full suite

**Goal:** Ensure the complete test suite is green, the app runs end-to-end with real server and browser, and the build is production-ready.

**Steps:**

1. Run full test suite from root: `npm test`
2. Fix any remaining failures (do not weaken or delete any valid test).
3. Run `npm run build` — verify both backend and frontend build cleanly.
4. Smoke test: start backend (`tsx packages/backend/src/index.ts`), start frontend dev server; manually verify the 7 core user journeys using the E2E suite: `npx playwright test`.
5. Add `README.md` update with setup instructions, env var table, and how to run.
6. Ensure `.env.example` is complete.
7. Run full suite one final time — all green.

**Verification:** `npm test` exits 0; `npm run build` exits 0; all 7 Playwright journeys produce screenshots.

---

## Remember

- **Do not weaken, delete, or dilute a valid test to make it pass.** Tests may only be changed if the test itself is wrong, obsolete, or can be replaced by a stronger check.
- **Run the full test suite after each task**, not just the targeted new tests.
- **Index regeneration must be called** on every project create/update/delete — tests must cover this invariant.
- **The AIProvider stub must be used in all automated tests** — never make real AI API calls during CI.
- **File slugs must be stable** — changing a file's name should not silently create a duplicate.
- **Fastify route registration order matters** — `/projects/upload` must be registered before `/projects/:slug` to avoid slug matching "upload".
- **TypeScript strict mode is non-negotiable** — every file must compile with `noImplicitAny`, `strictNullChecks`, and `strict: true`.
- **All tests are done only when the full required automated suite is genuinely green**, not when a spot-check passes.
