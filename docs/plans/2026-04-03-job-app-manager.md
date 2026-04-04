# Job Application Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `trycycle-executing` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack React + Fastify TypeScript web app that lets users manage job-application materials: upload/edit project markdown files, parse resumes, keep a keyword index in sync, match against job descriptions, and generate cover letters with AI.

**Architecture:** React 18 SPA (Vite) communicates with a Node/Fastify TypeScript backend via a versioned REST API. Project files and an auto-maintained index are stored as plain markdown files on disk. AI features are gated behind an `AIProvider` interface with Anthropic, OpenAI, and deterministic stub implementations selected by env var.

**Tech Stack:** React 18, TypeScript, Vite, Fastify, `@fastify/multipart`, `@fastify/cors`, `pdf-parse`, `@anthropic-ai/sdk`, `openai`, `zod`, `slugify`, `codemirror` (v6), `react-markdown`, Vitest, Playwright.

---

## Key Invariants

1. Every markdown file in `STORAGE_DIR/projects/` is mirrored in `STORAGE_DIR/index.md` (keywords section).
2. The `index.md` is regenerated whenever a project file is created, updated, or deleted.
3. AI calls are always gated by the `AIProvider` interface; the stub implementation returns deterministic fake text during tests.
4. The frontend never calls AI APIs directly — all AI calls go through the backend.
5. PDF parsing produces structured sections; if parsing fails, the raw text is preserved verbatim.
6. File names are slugified from the company/project name; collisions append a numeric suffix.
7. The API uses `Content-Type: application/json` for all non-file endpoints.

## Tricky Boundaries

- **Index sync on concurrent writes:** Since this is a single-user local app, we use simple synchronous file writes with no locking. Document this as a known limitation.
- **Resume parsing ambiguity:** Resume section detection uses heuristics (uppercase headings, bold markers, common section names). Unparseable resumes fall back to raw text with a warning returned to the client.
- **AI provider switching:** The provider is resolved at startup and held for the process lifetime. Changing `AI_PROVIDER` requires a server restart.
- **Cover letter length:** OpenAI and Anthropic have different context windows; we cap prompt+context at 8,000 tokens for safety.
- **Large markdown files:** No hard limit, but the AI update endpoint documents a soft 50KB cap on project file content to avoid token overflow.
- **Fastify route registration order matters** — `/projects/upload` must be registered before `/projects/:slug` to avoid slug matching "upload".

---

## Repository Layout

```
job-app-management/
├── package.json                  # Root scripts: dev, build, test, lint
├── packages/
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts          # Fastify server entry
│   │   │   ├── config.ts         # Env-var config (STORAGE_DIR, AI_PROVIDER, AI_API_KEY, PORT)
│   │   │   ├── types/
│   │   │   │   └── pdf-parse.d.ts  # Type shim for pdf-parse
│   │   │   ├── ai/
│   │   │   │   ├── interface.ts  # AIProvider interface
│   │   │   │   ├── anthropic.ts  # Anthropic implementation
│   │   │   │   ├── openai.ts     # OpenAI implementation
│   │   │   │   ├── stub.ts       # Deterministic stub for tests
│   │   │   │   ├── prompts.ts    # Shared prompt strings
│   │   │   │   └── factory.ts    # createAIProvider(config) -> AIProvider
│   │   │   ├── storage/
│   │   │   │   ├── projectStore.ts   # CRUD for project .md files
│   │   │   │   └── indexStore.ts     # Read/write/regenerate index.md
│   │   │   ├── resume/
│   │   │   │   └── parser.ts     # PDF + plain-text resume parser
│   │   │   ├── matching/
│   │   │   │   └── matcher.ts    # Job description <-> index keyword matching
│   │   │   └── routes/
│   │   │       ├── projects.ts   # CRUD routes for project files
│   │   │       ├── resume.ts     # Upload + parse resume
│   │   │       ├── index.ts      # Get/regenerate index
│   │   │       ├── ai.ts         # AI update + cover letter routes
│   │   │       └── match.ts      # Job description matching
│   │   └── test/
│   │       ├── unit/
│   │       │   ├── project-store.test.ts
│   │       │   ├── index-store.test.ts
│   │       │   ├── resume-parser.test.ts
│   │       │   ├── matcher.test.ts
│   │       │   └── ai-factory.test.ts
│   │       ├── integration/
│   │       │   ├── projects.test.ts
│   │       │   ├── resume.test.ts
│   │       │   ├── ai.test.ts
│   │       │   └── match.test.ts
│   │       └── fixtures/
│   │           └── sample-resume.txt
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── playwright.config.ts
│       ├── index.html
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
│       │   │   ├── CoverLetter.tsx
│       │   │   └── ParsedSectionCard.tsx
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
          "dates": "2020-2023",
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

Factory reads `AI_PROVIDER` env var (`anthropic` | `openai` | `stub`). Both real implementations use their respective SDKs. The stub returns `"[AI STUB] " + instruction` for `updateProjectFile` and a fixed cover letter string for tests. When `AI_PROVIDER=stub`, no `AI_API_KEY` is required.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Backend port |
| `STORAGE_DIR` | `./data` | Root directory for project files and index |
| `AI_PROVIDER` | _(required for AI features)_ | `anthropic`, `openai`, or `stub` (stub requires no key; used in tests/E2E) |
| `AI_API_KEY` | _(required for real AI providers)_ | Provider API key (not required when `AI_PROVIDER=stub`) |
| `ANTHROPIC_MODEL` | `claude-3-5-haiku-20241022` | Anthropic model override |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model override |
| `VITE_API_BASE_URL` | `''` (empty = relative) | Backend URL for production frontend builds |

---

## Tasks

### Task 1: Monorepo scaffold and tooling

**Files:**
- Create: `package.json`
- Create: `packages/backend/package.json`
- Create: `packages/backend/tsconfig.json`
- Create: `packages/backend/src/config.ts`
- Create: `packages/backend/src/types/pdf-parse.d.ts`
- Create: `packages/frontend/package.json`
- Create: `packages/frontend/tsconfig.json`
- Create: `packages/frontend/vite.config.ts`
- Create: `packages/frontend/index.html`
- Create: `.gitignore`
- Create: `.env.example`

**Goal:** Set up the repository structure, TypeScript configs, root scripts, and package.json files so the project compiles and lints cleanly from the root.

- [ ] **Step 1: Create root package.json**

  ```json
  {
    "name": "job-app-management",
    "private": true,
    "workspaces": ["packages/backend", "packages/frontend"],
    "scripts": {
      "dev": "concurrently \"npm run dev --workspace=packages/backend\" \"npm run dev --workspace=packages/frontend\"",
      "build": "npm run build --workspace=packages/backend && npm run build --workspace=packages/frontend",
      "test": "npm run test --workspace=packages/backend && npm run test --workspace=packages/frontend",
      "lint": "npm run lint --workspace=packages/backend && npm run lint --workspace=packages/frontend"
    },
    "devDependencies": {
      "concurrently": "^8.0.0"
    }
  }
  ```

- [ ] **Step 2: Create `packages/backend/package.json`**

  ```json
  {
    "name": "@job-app/backend",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "tsx watch src/index.ts",
      "build": "tsc --noEmit",
      "start": "tsx src/index.ts",
      "test": "vitest run"
    },
    "dependencies": {
      "@anthropic-ai/sdk": "^0.24.0",
      "@fastify/cors": "^9.0.0",
      "@fastify/multipart": "^8.0.0",
      "@fastify/static": "^7.0.0",
      "fastify": "^4.0.0",
      "openai": "^4.0.0",
      "pdf-parse": "^1.1.1",
      "slugify": "^1.6.6",
      "zod": "^3.22.0"
    },
    "devDependencies": {
      "@types/node": "^20.0.0",
      "tsx": "^4.0.0",
      "typescript": "^5.0.0",
      "vitest": "^1.0.0"
    }
  }
  ```

  Note: `pdf-parse` does not ship usable TypeScript declarations — add a type shim in Step 5.

- [ ] **Step 3: Create `packages/backend/tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "lib": ["ES2022"],
      "outDir": "dist",
      "rootDir": "src",
      "strict": true,
      "noImplicitAny": true,
      "strictNullChecks": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true
    },
    "include": ["src", "test"],
    "exclude": ["node_modules", "dist"]
  }
  ```

- [ ] **Step 4: Create `packages/backend/src/config.ts`**

  ```typescript
  import { z } from 'zod';

  const configSchema = z.object({
    PORT: z.coerce.number().default(3001),
    STORAGE_DIR: z.string().default('./data'),
    AI_PROVIDER: z.enum(['anthropic', 'openai', 'stub']).optional(),
    AI_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-3-5-haiku-20241022'),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  });

  export const config = configSchema.parse(process.env);
  export type Config = z.infer<typeof configSchema>;
  ```

- [ ] **Step 5: Create `packages/backend/src/types/pdf-parse.d.ts`**

  ```typescript
  declare module 'pdf-parse' {
    interface PDFData {
      text: string;
      numpages: number;
      info: Record<string, unknown>;
    }
    function pdfParse(buffer: Buffer, options?: Record<string, unknown>): Promise<PDFData>;
    export = pdfParse;
  }
  ```

- [ ] **Step 6: Create `packages/frontend/package.json`**

  ```json
  {
    "name": "@job-app/frontend",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "vite --port 5173",
      "build": "tsc --noEmit && vite build",
      "preview": "vite preview",
      "test": "vitest run",
      "test:e2e": "playwright test"
    },
    "dependencies": {
      "@codemirror/commands": "^6.0.0",
      "@codemirror/lang-markdown": "^6.0.0",
      "@codemirror/state": "^6.0.0",
      "@codemirror/theme-one-dark": "^6.0.0",
      "@codemirror/view": "^6.0.0",
      "codemirror": "^6.0.0",
      "react": "^18.0.0",
      "react-dom": "^18.0.0",
      "react-markdown": "^9.0.0",
      "react-router-dom": "^6.0.0",
      "remark-gfm": "^4.0.0"
    },
    "devDependencies": {
      "@playwright/test": "^1.40.0",
      "@testing-library/react": "^14.0.0",
      "@types/react": "^18.0.0",
      "@types/react-dom": "^18.0.0",
      "@vitejs/plugin-react": "^4.0.0",
      "typescript": "^5.0.0",
      "vite": "^5.0.0",
      "vitest": "^1.0.0"
    }
  }
  ```

- [ ] **Step 7: Create `packages/frontend/tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "target": "ESNext",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "lib": ["ESNext", "DOM", "DOM.Iterable"],
      "jsx": "react-jsx",
      "strict": true,
      "noImplicitAny": true,
      "strictNullChecks": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "noEmit": true
    },
    "include": ["src", "e2e"],
    "exclude": ["node_modules", "dist"]
  }
  ```

- [ ] **Step 8: Create `packages/frontend/vite.config.ts`**

  ```typescript
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react';

  export default defineConfig({
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  });
  ```

- [ ] **Step 9: Create `packages/frontend/index.html`**

  ```html
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Job Application Manager</title>
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```

- [ ] **Step 10: Create `.gitignore` additions**

  Ensure `.gitignore` at repo root contains:
  ```
  data/
  node_modules/
  dist/
  .env
  *.env.local
  ```

- [ ] **Step 11: Create `.env.example`**

  ```
  PORT=3001
  STORAGE_DIR=./data
  # AI_PROVIDER=anthropic  # or openai or stub
  # AI_API_KEY=your-api-key-here
  # ANTHROPIC_MODEL=claude-3-5-haiku-20241022
  # OPENAI_MODEL=gpt-4o-mini
  VITE_API_BASE_URL=
  ```

- [ ] **Step 12: Install dependencies**

  Run from repo root:
  ```bash
  npm install
  ```
  Expected: installs without errors, `node_modules/` present in root and both packages.

- [ ] **Step 13: Verify TypeScript compiles**

  ```bash
  cd packages/backend && npx tsc --noEmit
  cd packages/frontend && npx tsc --noEmit
  ```
  Expected: both exit 0 with no errors. (Only `config.ts` and the type shim exist at this point; errors about missing modules are acceptable as long as the config and shim files themselves are clean.)

- [ ] **Step 14: Commit scaffold**

  ```bash
  git add package.json packages/backend/package.json packages/backend/tsconfig.json packages/backend/src/config.ts packages/backend/src/types/pdf-parse.d.ts packages/frontend/package.json packages/frontend/tsconfig.json packages/frontend/vite.config.ts packages/frontend/index.html .gitignore .env.example
  git commit -m "feat: scaffold monorepo with backend and frontend packages"
  ```

---

### Task 2: Backend — storage layer (projectStore + indexStore)

**Files:**
- Create: `packages/backend/src/storage/projectStore.ts`
- Create: `packages/backend/src/storage/indexStore.ts`
- Test: `packages/backend/test/unit/project-store.test.ts`
- Test: `packages/backend/test/unit/index-store.test.ts`

**Goal:** Implement the file system abstraction for project files and the index. All other backend code depends on this.

- [ ] **Step 1: Write failing tests for projectStore**

  Create `packages/backend/test/unit/project-store.test.ts`:

  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { mkdtempSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { ProjectStore, NotFoundError } from '../../src/storage/projectStore.js';

  let storageDir: string;
  let store: ProjectStore;

  beforeEach(() => {
    storageDir = mkdtempSync(join(tmpdir(), 'project-store-test-'));
    store = new ProjectStore(storageDir);
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  describe('ProjectStore', () => {
    it('createProject returns slug and creates file', () => {
      const slug = store.createProject('Acme Corp', '# Acme Corp\n\nContent here.');
      expect(slug).toBe('acme-corp');
      const content = store.getProject('acme-corp');
      expect(content).toContain('Acme Corp');
    });

    it('getProject throws NotFoundError for unknown slug', () => {
      expect(() => store.getProject('not-here')).toThrow(NotFoundError);
    });

    it('updateProject replaces file content', () => {
      store.createProject('Foo', 'original');
      store.updateProject('foo', 'updated');
      expect(store.getProject('foo')).toBe('updated');
    });

    it('deleteProject removes file', () => {
      store.createProject('Foo', 'content');
      store.deleteProject('foo');
      expect(() => store.getProject('foo')).toThrow(NotFoundError);
    });

    it('listProjects returns metadata array', () => {
      store.createProject('Alpha', '# Alpha');
      store.createProject('Beta', '# Beta');
      const list = store.listProjects();
      expect(list).toHaveLength(2);
      expect(list.map(p => p.slug).sort()).toEqual(['alpha', 'beta']);
      expect(list[0]).toHaveProperty('name');
      expect(list[0]).toHaveProperty('size');
      expect(list[0]).toHaveProperty('mtime');
    });

    it('slug collision appends numeric suffix', () => {
      const s1 = store.createProject('Same Name', 'a');
      const s2 = store.createProject('Same Name', 'b');
      expect(s1).toBe('same-name');
      expect(s2).toBe('same-name-2');
    });

    it('deleteProject throws NotFoundError for unknown slug', () => {
      expect(() => store.deleteProject('ghost')).toThrow(NotFoundError);
    });

    it('updateProject throws NotFoundError for unknown slug', () => {
      expect(() => store.updateProject('ghost', 'x')).toThrow(NotFoundError);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd packages/backend && npx vitest run test/unit/project-store.test.ts
  ```
  Expected: FAIL — `ProjectStore` not found.

- [ ] **Step 3: Implement `packages/backend/src/storage/projectStore.ts`**

  ```typescript
  import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
  import { join } from 'node:path';
  import slugify from 'slugify';

  export class NotFoundError extends Error {
    constructor(slug: string) {
      super(`Project not found: ${slug}`);
      this.name = 'NotFoundError';
    }
  }

  export interface ProjectMeta {
    slug: string;
    name: string;
    size: number;
    mtime: Date;
  }

  export function getProjectsDir(storageDir: string): string {
    return join(storageDir, 'projects');
  }

  export class ProjectStore {
    private readonly projectsDir: string;

    constructor(private readonly storageDir: string) {
      this.projectsDir = getProjectsDir(storageDir);
      mkdirSync(this.projectsDir, { recursive: true });
    }

    createProject(name: string, content: string): string {
      const baseSlug = slugify(name, { lower: true, strict: true });
      let slug = baseSlug;
      let counter = 2;
      while (existsSync(join(this.projectsDir, `${slug}.md`))) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      writeFileSync(join(this.projectsDir, `${slug}.md`), content, 'utf8');
      return slug;
    }

    getProject(slug: string): string {
      const filePath = join(this.projectsDir, `${slug}.md`);
      if (!existsSync(filePath)) throw new NotFoundError(slug);
      return readFileSync(filePath, 'utf8');
    }

    updateProject(slug: string, content: string): void {
      const filePath = join(this.projectsDir, `${slug}.md`);
      if (!existsSync(filePath)) throw new NotFoundError(slug);
      writeFileSync(filePath, content, 'utf8');
    }

    deleteProject(slug: string): void {
      const filePath = join(this.projectsDir, `${slug}.md`);
      if (!existsSync(filePath)) throw new NotFoundError(slug);
      unlinkSync(filePath);
    }

    listProjects(): ProjectMeta[] {
      return readdirSync(this.projectsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => {
          const slug = f.replace(/\.md$/, '');
          const stat = statSync(join(this.projectsDir, f));
          return { slug, name: slug, size: stat.size, mtime: stat.mtime };
        });
    }
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  cd packages/backend && npx vitest run test/unit/project-store.test.ts
  ```
  Expected: all 8 tests PASS.

- [ ] **Step 5: Write failing tests for indexStore**

  Create `packages/backend/test/unit/index-store.test.ts`:

  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { IndexStore } from '../../src/storage/indexStore.js';
  import { ProjectStore } from '../../src/storage/projectStore.js';

  let storageDir: string;
  let indexStore: IndexStore;
  let projectStore: ProjectStore;

  beforeEach(() => {
    storageDir = mkdtempSync(join(tmpdir(), 'index-store-test-'));
    projectStore = new ProjectStore(storageDir);
    indexStore = new IndexStore(storageDir);
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  describe('IndexStore', () => {
    it('getIndex returns empty string when index.md missing', () => {
      expect(indexStore.getIndex()).toBe('');
    });

    it('regenerateIndex creates index.md with correct structure', () => {
      projectStore.createProject('Acme Corp', '# Acme Corp\n\nBuilt with TypeScript and React.\nUsed PostgreSQL for storage.\n');
      indexStore.regenerateIndex(projectStore);
      const index = indexStore.getIndex();
      expect(index).toContain('# Project Index');
      expect(index).toContain('## Acme Corp');
      expect(index).toContain('acme-corp.md');
    });

    it('regenerateIndex extracts known tech keywords', () => {
      projectStore.createProject('Tech Project', 'Used Docker, Kubernetes, and GraphQL in this project.');
      indexStore.regenerateIndex(projectStore);
      const index = indexStore.getIndex();
      expect(index).toContain('Docker');
      expect(index).toContain('Kubernetes');
      expect(index).toContain('GraphQL');
    });

    it('regenerateIndex with no projects produces empty index', () => {
      indexStore.regenerateIndex(projectStore);
      const index = indexStore.getIndex();
      expect(index).toContain('# Project Index');
    });

    it('getIndex returns current index.md content after regenerate', () => {
      projectStore.createProject('AWS Project', 'Deployed on AWS with CI/CD pipeline.');
      indexStore.regenerateIndex(projectStore);
      const index = indexStore.getIndex();
      expect(index).toContain('AWS');
    });
  });
  ```

- [ ] **Step 6: Run test to verify it fails**

  ```bash
  cd packages/backend && npx vitest run test/unit/index-store.test.ts
  ```
  Expected: FAIL — `IndexStore` not found.

- [ ] **Step 7: Implement `packages/backend/src/storage/indexStore.ts`**

  ```typescript
  import { existsSync, readFileSync, writeFileSync } from 'node:fs';
  import { join } from 'node:path';
  import type { ProjectStore } from './projectStore.js';

  const KNOWN_TECH_TERMS = new Set([
    'TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'Rust', 'Ruby', 'PHP', 'C#', 'C++',
    'React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt', 'Remix',
    'Node.js', 'Deno', 'Bun', 'Express', 'Fastify', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Rails',
    'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'DynamoDB', 'Cassandra', 'Elasticsearch',
    'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Helm',
    'AWS', 'GCP', 'Azure', 'Vercel', 'Netlify', 'Heroku',
    'GraphQL', 'REST', 'gRPC', 'WebSocket', 'OAuth', 'JWT', 'SAML',
    'CI/CD', 'GitHub', 'GitLab', 'Jenkins', 'CircleCI', 'GitHub Actions',
    'Webpack', 'Vite', 'Rollup', 'esbuild',
    'Jest', 'Vitest', 'Playwright', 'Cypress', 'Mocha', 'Chai',
    'Linux', 'Unix', 'Bash', 'Shell',
    'Microservices', 'Serverless', 'Lambda', 'S3', 'RDS',
    'Redux', 'Zustand', 'MobX', 'Recoil',
    'Tailwind', 'Bootstrap', 'Material UI', 'Chakra UI',
    'Git', 'Agile', 'Scrum', 'Kanban',
  ]);

  function extractKeywords(content: string): string[] {
    const found = new Set<string>();
    for (const term of KNOWN_TECH_TERMS) {
      if (content.includes(term)) {
        found.add(term);
      }
    }
    // Also extract capitalized tokens (2+ chars) not already found
    const capPattern = /\b[A-Z][a-zA-Z0-9.+#-]{1,}\b/g;
    const matches = content.matchAll(capPattern);
    for (const m of matches) {
      const token = m[0];
      if (!['The', 'This', 'That', 'With', 'And', 'For', 'But', 'Not', 'From', 'Into', 'Over', 'Used', 'Built', 'Each'].includes(token)) {
        found.add(token);
      }
    }
    return [...found].sort();
  }

  function slugToName(slug: string): string {
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  export class IndexStore {
    private readonly indexPath: string;

    constructor(private readonly storageDir: string) {
      this.indexPath = join(storageDir, 'index.md');
    }

    getIndex(): string {
      if (!existsSync(this.indexPath)) return '';
      return readFileSync(this.indexPath, 'utf8');
    }

    regenerateIndex(projectStore: ProjectStore): void {
      const projects = projectStore.listProjects();
      const sections: string[] = ['# Project Index\n'];

      for (const project of projects) {
        const content = projectStore.getProject(project.slug);
        const keywords = extractKeywords(content);
        const techTerms = keywords.filter(k => KNOWN_TECH_TERMS.has(k));
        const otherKeywords = keywords.filter(k => !KNOWN_TECH_TERMS.has(k));
        const name = slugToName(project.slug);

        let section = `## ${name}\n`;
        section += `- **File:** ${project.slug}.md\n`;
        if (techTerms.length > 0) {
          section += `- **Tech:** ${techTerms.join(', ')}\n`;
        }
        if (otherKeywords.length > 0) {
          section += `- **Keywords:** ${otherKeywords.join(', ')}\n`;
        }
        sections.push(section);
      }

      writeFileSync(this.indexPath, sections.join('\n'), 'utf8');
    }
  }
  ```

- [ ] **Step 8: Run all backend unit tests**

  ```bash
  cd packages/backend && npx vitest run test/unit/
  ```
  Expected: all tests PASS.

- [ ] **Step 9: Refactor and verify**

  - Confirm `getProjectsDir` helper is used in both `projectStore.ts` and `indexStore.ts` for consistent path resolution.
  - The `IndexStore` takes a `storageDir` in its constructor; it does not import `getProjectsDir` directly since it only needs `index.md` path. This is fine — no duplication.
  - Run tests again to confirm nothing regressed.

  ```bash
  cd packages/backend && npx vitest run test/unit/
  ```
  Expected: all PASS.

- [ ] **Step 10: Commit**

  ```bash
  git add packages/backend/src/storage/ packages/backend/test/unit/project-store.test.ts packages/backend/test/unit/index-store.test.ts
  git commit -m "feat: implement storage layer — projectStore and indexStore"
  ```

---

### Task 3: Backend — resume parser

**Files:**
- Create: `packages/backend/src/resume/parser.ts`
- Create: `packages/backend/test/unit/resume-parser.test.ts`
- Create: `packages/backend/test/fixtures/sample-resume.txt`

**Goal:** Implement PDF and plain-text resume parsing to extract structured sections.

- [ ] **Step 1: Create test fixture**

  Create `packages/backend/test/fixtures/sample-resume.txt`:

  ```
  John Doe
  john@example.com | (555) 123-4567

  EXPERIENCE

  Acme Corp
  Senior Software Engineer
  2020 - 2023
  - Led migration of legacy monolith to microservices architecture
  - Reduced API latency by 40% through caching with Redis
  - Mentored team of 4 junior engineers

  Beta Inc
  Software Engineer
  2017 - 2020
  - Built customer-facing React dashboard serving 50k users
  - Integrated third-party OAuth providers (Google, GitHub)
  - Wrote automated test suite with 85% coverage using Jest

  EDUCATION

  State University
  B.S. Computer Science
  2013 - 2017

  SKILLS

  TypeScript, JavaScript, React, Node.js, PostgreSQL, Redis, Docker, AWS, Git
  ```

- [ ] **Step 2: Write failing tests for resume parser**

  Create `packages/backend/test/unit/resume-parser.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { readFileSync } from 'node:fs';
  import { join, dirname } from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { parseResume } from '../../src/resume/parser.js';

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const fixturePath = join(__dirname, '../fixtures/sample-resume.txt');

  describe('parseResume', () => {
    it('parses plain text resume into sections', async () => {
      const buffer = readFileSync(fixturePath);
      const result = await parseResume(buffer, 'text/plain');
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.rawText).toContain('Acme Corp');
      expect(result.warnings).toEqual([]);
    });

    it('extracts experience section with entries', async () => {
      const buffer = readFileSync(fixturePath);
      const result = await parseResume(buffer, 'text/plain');
      const expSection = result.sections.find(s => s.heading.toLowerCase().includes('experience'));
      expect(expSection).toBeDefined();
      expect(expSection!.entries.length).toBeGreaterThanOrEqual(2);
      const acme = expSection!.entries.find(e => e.company.includes('Acme'));
      expect(acme).toBeDefined();
      expect(acme!.bullets.length).toBeGreaterThan(0);
    });

    it('returns rawText and warning for empty buffer', async () => {
      const buffer = Buffer.from('');
      const result = await parseResume(buffer, 'text/plain');
      expect(result.sections).toEqual([]);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('preserves rawText on failed section parse', async () => {
      const buffer = Buffer.from('This is not a resume at all. Just some random text.');
      const result = await parseResume(buffer, 'text/plain');
      expect(result.rawText).toContain('random text');
    });
  });
  ```

- [ ] **Step 3: Run test to verify it fails**

  ```bash
  cd packages/backend && npx vitest run test/unit/resume-parser.test.ts
  ```
  Expected: FAIL — `parseResume` not found.

- [ ] **Step 4: Implement `packages/backend/src/resume/parser.ts`**

  ```typescript
  import pdfParse from 'pdf-parse';

  export interface ResumeEntry {
    company: string;
    title: string;
    dates: string;
    bullets: string[];
  }

  export interface ResumeSection {
    heading: string;
    entries: ResumeEntry[];
  }

  export interface ParsedResume {
    sections: ResumeSection[];
    rawText: string;
    warnings: string[];
  }

  const SECTION_NAMES = ['experience', 'education', 'skills', 'projects', 'certifications', 'summary', 'objective', 'work history', 'employment'];

  function isHeading(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // ALL CAPS heading
    if (trimmed === trimmed.toUpperCase() && trimmed.length > 2 && /^[A-Z\s]+$/.test(trimmed)) return true;
    // Markdown heading
    if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) return true;
    // Known section name (case-insensitive)
    if (SECTION_NAMES.some(s => trimmed.toLowerCase() === s)) return true;
    return false;
  }

  function cleanHeading(line: string): string {
    return line.trim().replace(/^#+\s*/, '').trim();
  }

  function parseSections(text: string): ResumeSection[] {
    const lines = text.split('\n');
    const sections: ResumeSection[] = [];
    let currentSection: ResumeSection | null = null;
    let currentEntry: ResumeEntry | null = null;
    let pendingLines: string[] = [];

    const flushEntry = () => {
      if (currentEntry && currentSection) {
        currentSection.entries.push(currentEntry);
        currentEntry = null;
      }
      pendingLines = [];
    };

    const flushSection = () => {
      flushEntry();
      if (currentSection) sections.push(currentSection);
      currentSection = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        if (pendingLines.length > 0 && currentEntry === null && currentSection !== null) {
          // Blank line resets pending non-bullet context
        }
        continue;
      }

      if (isHeading(line)) {
        flushSection();
        currentSection = { heading: cleanHeading(line), entries: [] };
        continue;
      }

      if (!currentSection) continue;

      // Bullet point
      if (/^[-•*]\s+/.test(line)) {
        if (!currentEntry) {
          currentEntry = { company: '', title: '', dates: '', bullets: [] };
        }
        currentEntry.bullets.push(line.replace(/^[-•*]\s+/, ''));
        continue;
      }

      // Date range pattern
      const dateMatch = line.match(/\b(\d{4})\s*[-–]\s*(\d{4}|present|current)\b/i);
      if (dateMatch && currentEntry) {
        currentEntry.dates = line;
        continue;
      }

      // Company/title lines: flush previous entry and start a new one
      if (currentEntry && currentEntry.company) {
        if (!currentEntry.title) {
          currentEntry.title = line;
        } else {
          // New entry begins
          flushEntry();
          currentEntry = { company: line, title: '', dates: '', bullets: [] };
        }
      } else {
        flushEntry();
        currentEntry = { company: line, title: '', dates: '', bullets: [] };
      }
    }

    flushSection();
    return sections;
  }

  export async function parseResume(buffer: Buffer, mimetype: string): Promise<ParsedResume> {
    if (buffer.length === 0) {
      return { sections: [], rawText: '', warnings: ['Empty file provided'] };
    }

    let rawText: string;

    try {
      if (mimetype === 'application/pdf' || mimetype === 'application/octet-stream') {
        const data = await pdfParse(buffer);
        rawText = data.text;
      } else {
        rawText = buffer.toString('utf8');
      }
    } catch (err) {
      return { sections: [], rawText: buffer.toString('utf8'), warnings: [`Failed to extract text: ${String(err)}`] };
    }

    let sections: ResumeSection[];
    const warnings: string[] = [];

    try {
      sections = parseSections(rawText);
      if (sections.length === 0) {
        warnings.push('Could not detect sections in resume — check formatting');
      }
    } catch {
      sections = [];
      warnings.push('Could not parse sections');
    }

    return { sections, rawText, warnings };
  }
  ```

- [ ] **Step 5: Run test to verify it passes**

  ```bash
  cd packages/backend && npx vitest run test/unit/resume-parser.test.ts
  ```
  Expected: all tests PASS.

- [ ] **Step 6: Refactor and verify**

  Extract heading detection into a standalone exported function `isHeading(line: string): boolean` to make it unit-testable independently if needed. Run full backend unit tests:

  ```bash
  cd packages/backend && npx vitest run test/unit/
  ```
  Expected: all PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/backend/src/resume/ packages/backend/test/unit/resume-parser.test.ts packages/backend/test/fixtures/
  git commit -m "feat: implement resume parser for PDF and plain-text input"
  ```

---

### Task 4: Backend — matching engine

**Files:**
- Create: `packages/backend/src/matching/matcher.ts`
- Test: `packages/backend/test/unit/matcher.test.ts`

**Goal:** Implement the job-description matching algorithm against the index.

- [ ] **Step 1: Write failing tests**

  Create `packages/backend/test/unit/matcher.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { matchJobDescription } from '../../src/matching/matcher.js';

  const sampleIndex = `# Project Index

  ## Acme Corp
  - **File:** acme-corp.md
  - **Tech:** TypeScript, React, Node.js
  - **Keywords:** REST API, authentication, OAuth

  ## Beta Inc
  - **File:** beta-inc.md
  - **Tech:** Python, Django, PostgreSQL
  - **Keywords:** data pipeline, machine learning
  `;

  describe('matchJobDescription', () => {
    it('returns score of 1.0 when all job keywords match', () => {
      const result = matchJobDescription('TypeScript React Node.js', sampleIndex);
      expect(result.score).toBeGreaterThan(0);
      expect(result.matchedKeywords.length).toBeGreaterThan(0);
    });

    it('returns score of 0 when no keywords match', () => {
      const result = matchJobDescription('Cobol Fortran Assembly', sampleIndex);
      expect(result.score).toBe(0);
      expect(result.matchedKeywords).toEqual([]);
    });

    it('returns per-project scores sorted descending', () => {
      const result = matchJobDescription('TypeScript React', sampleIndex);
      expect(result.projectScores.length).toBe(2);
      expect(result.projectScores[0].score).toBeGreaterThanOrEqual(result.projectScores[1].score);
    });

    it('partial match returns Jaccard similarity', () => {
      // Job: TypeScript, React (2 terms). Acme has TypeScript, React, Node.js, REST, authentication, OAuth (6 terms)
      // Intersection: TypeScript, React (2). Union: TypeScript, React, Node.js, REST, authentication, OAuth (6)
      // Jaccard = 2/6 ≈ 0.333
      const result = matchJobDescription('TypeScript React', sampleIndex);
      const acme = result.projectScores.find(p => p.slug === 'acme-corp');
      expect(acme).toBeDefined();
      expect(acme!.score).toBeCloseTo(2 / 6, 2);
    });

    it('returns matched and missed keywords', () => {
      const result = matchJobDescription('TypeScript Kubernetes', sampleIndex);
      expect(result.matchedKeywords).toContain('typescript');
      expect(result.missedKeywords).toContain('kubernetes');
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd packages/backend && npx vitest run test/unit/matcher.test.ts
  ```
  Expected: FAIL — `matchJobDescription` not found.

- [ ] **Step 3: Implement `packages/backend/src/matching/matcher.ts`**

  ```typescript
  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'to', 'of', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'into',
    'over', 'and', 'or', 'but', 'not', 'it', 'its', 'as', 'if', 'we',
    'our', 'us', 'you', 'your', 'they', 'their', 'this', 'that', 'these',
    'those', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'can', 'could', 'should', 'may', 'might', 'shall', 'must', 'also',
    'more', 'such', 'each', 'all', 'any', 'both', 'other',
  ]);

  export function tokenize(text: string): Set<string> {
    const tokens = text
      .split(/[\s,;()\[\]{}<>'"!?\/\\|@#$%^&*+=~`]+/)
      .map(t => t.toLowerCase().replace(/[^a-z0-9.+#-]/g, ''))
      .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
    return new Set(tokens);
  }

  interface ProjectSection {
    slug: string;
    keywords: Set<string>;
  }

  function parseIndexSections(indexContent: string): ProjectSection[] {
    const sections: ProjectSection[] = [];
    const parts = indexContent.split(/^## /m).slice(1);
    for (const part of parts) {
      const lines = part.split('\n');
      const heading = lines[0].trim();
      const slug = heading.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const keywords = new Set<string>();
      for (const line of lines.slice(1)) {
        const techMatch = line.match(/\*\*Tech:\*\*\s*(.+)/);
        const kwMatch = line.match(/\*\*Keywords:\*\*\s*(.+)/);
        const terms = techMatch?.[1] ?? kwMatch?.[1];
        if (terms) {
          for (const term of terms.split(',').map(t => t.trim().toLowerCase())) {
            if (term) keywords.add(term);
          }
        }
      }
      sections.push({ slug, keywords });
    }
    return sections;
  }

  function jaccard(a: Set<string>, b: Set<string>): number {
    const intersection = [...a].filter(t => b.has(t)).length;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : intersection / union;
  }

  export interface MatchResult {
    score: number;
    matchedKeywords: string[];
    missedKeywords: string[];
    projectScores: Array<{ slug: string; name: string; score: number; matchedKeywords: string[] }>;
  }

  export function matchJobDescription(jobDescription: string, indexContent: string): MatchResult {
    const jobTokens = tokenize(jobDescription);
    const sections = parseIndexSections(indexContent);

    const allIndexKeywords = new Set(sections.flatMap(s => [...s.keywords]));
    const matchedKeywords = [...jobTokens].filter(t => allIndexKeywords.has(t));
    const missedKeywords = [...jobTokens].filter(t => !allIndexKeywords.has(t));

    const projectScores = sections.map(s => {
      const score = jaccard(jobTokens, s.keywords);
      const matched = [...jobTokens].filter(t => s.keywords.has(t));
      return {
        slug: s.slug,
        name: s.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        score,
        matchedKeywords: matched,
      };
    }).sort((a, b) => b.score - a.score);

    const totalWeight = projectScores.length;
    const overallScore = totalWeight === 0 ? 0 : projectScores.reduce((sum, p) => sum + p.score, 0) / totalWeight;

    return { score: overallScore, matchedKeywords, missedKeywords, projectScores };
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  cd packages/backend && npx vitest run test/unit/matcher.test.ts
  ```
  Expected: all tests PASS.

- [ ] **Step 5: Refactor and verify**

  Pull stop-word list into a named exported constant `STOP_WORDS`. Ensure `tokenize` is a pure exported function. Run full backend unit tests:

  ```bash
  cd packages/backend && npx vitest run test/unit/
  ```
  Expected: all PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/backend/src/matching/ packages/backend/test/unit/matcher.test.ts
  git commit -m "feat: implement job-description matching engine with Jaccard similarity"
  ```

---

### Task 5: Backend — AI provider abstraction

**Files:**
- Create: `packages/backend/src/ai/interface.ts`
- Create: `packages/backend/src/ai/stub.ts`
- Create: `packages/backend/src/ai/anthropic.ts`
- Create: `packages/backend/src/ai/openai.ts`
- Create: `packages/backend/src/ai/prompts.ts`
- Create: `packages/backend/src/ai/factory.ts`
- Test: `packages/backend/test/unit/ai-factory.test.ts`

**Goal:** Implement the AIProvider interface, both real providers, and the deterministic stub.

- [ ] **Step 1: Write failing tests**

  Create `packages/backend/test/unit/ai-factory.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { createAIProvider } from '../../src/ai/factory.js';

  describe('createAIProvider', () => {
    it('returns stub when provider is stub', () => {
      const provider = createAIProvider({ AI_PROVIDER: 'stub' });
      expect(provider).toBeDefined();
    });

    it('stub updateProjectFile returns string containing [AI STUB]', async () => {
      const provider = createAIProvider({ AI_PROVIDER: 'stub' });
      const result = await provider.updateProjectFile('# Old Content', 'Add a summary');
      expect(result).toContain('[AI STUB]');
    });

    it('stub generateCoverLetter returns non-empty string', async () => {
      const provider = createAIProvider({ AI_PROVIDER: 'stub' });
      const result = await provider.generateCoverLetter('index content', 'job description');
      expect(result.length).toBeGreaterThan(0);
    });

    it('throws for unknown provider', () => {
      expect(() => createAIProvider({ AI_PROVIDER: 'unknown' as 'stub' })).toThrow();
    });

    it('throws for anthropic without API key', () => {
      expect(() => createAIProvider({ AI_PROVIDER: 'anthropic', AI_API_KEY: undefined })).toThrow(/API key/i);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd packages/backend && npx vitest run test/unit/ai-factory.test.ts
  ```
  Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `packages/backend/src/ai/interface.ts`**

  ```typescript
  export interface AIProvider {
    updateProjectFile(content: string, instruction: string): Promise<string>;
    generateCoverLetter(indexContent: string, jobDescription: string, additionalContext?: string): Promise<string>;
  }
  ```

- [ ] **Step 4: Implement `packages/backend/src/ai/prompts.ts`**

  ```typescript
  export const UPDATE_PROJECT_SYSTEM_PROMPT = `You are a technical writer helping improve resume and portfolio content. Update the following project description as instructed. Return only the updated markdown content, preserving any existing frontmatter.`;

  export const COVER_LETTER_SYSTEM_PROMPT = `You are a professional career coach helping write compelling cover letters. Write a concise, professional cover letter (3-4 paragraphs) based on the provided project index and job description. Do not include placeholder text — write a complete, ready-to-send letter.`;

  export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  export const MAX_TOKENS = 8000;
  ```

- [ ] **Step 5: Implement `packages/backend/src/ai/stub.ts`**

  ```typescript
  import type { AIProvider } from './interface.js';

  export class StubAIProvider implements AIProvider {
    async updateProjectFile(content: string, instruction: string): Promise<string> {
      return `[AI STUB] Updated based on instruction: "${instruction}"\n\n${content}`;
    }

    async generateCoverLetter(_indexContent: string, jobDescription: string, _additionalContext?: string): Promise<string> {
      return `[AI STUB] Cover letter for job: "${jobDescription.slice(0, 100)}..."\n\nDear Hiring Manager,\n\nThis is a stub cover letter generated for testing purposes.\n\nSincerely,\nApplicant`;
    }
  }
  ```

- [ ] **Step 6: Implement `packages/backend/src/ai/anthropic.ts`**

  ```typescript
  import Anthropic from '@anthropic-ai/sdk';
  import type { AIProvider } from './interface.js';
  import { UPDATE_PROJECT_SYSTEM_PROMPT, COVER_LETTER_SYSTEM_PROMPT, estimateTokens, MAX_TOKENS } from './prompts.js';

  export class AnthropicAIProvider implements AIProvider {
    private client: Anthropic;
    private model: string;

    constructor(apiKey: string, model: string = 'claude-3-5-haiku-20241022') {
      this.client = new Anthropic({ apiKey });
      this.model = model;
    }

    async updateProjectFile(content: string, instruction: string): Promise<string> {
      const userMessage = `Instruction: ${instruction}\n\nCurrent content:\n${content}`;
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: UPDATE_PROJECT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });
      const block = response.content[0];
      return block.type === 'text' ? block.text : content;
    }

    async generateCoverLetter(indexContent: string, jobDescription: string, additionalContext?: string): Promise<string> {
      let context = `Project Index:\n${indexContent}\n\nJob Description:\n${jobDescription}`;
      if (additionalContext) context += `\n\nAdditional Context:\n${additionalContext}`;
      if (estimateTokens(context) > MAX_TOKENS) {
        context = context.slice(0, MAX_TOKENS * 4);
      }
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: COVER_LETTER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: context }],
      });
      const block = response.content[0];
      return block.type === 'text' ? block.text : '';
    }
  }
  ```

- [ ] **Step 7: Implement `packages/backend/src/ai/openai.ts`**

  ```typescript
  import OpenAI from 'openai';
  import type { AIProvider } from './interface.js';
  import { UPDATE_PROJECT_SYSTEM_PROMPT, COVER_LETTER_SYSTEM_PROMPT, estimateTokens, MAX_TOKENS } from './prompts.js';

  export class OpenAIProvider implements AIProvider {
    private client: OpenAI;
    private model: string;

    constructor(apiKey: string, model: string = 'gpt-4o-mini') {
      this.client = new OpenAI({ apiKey });
      this.model = model;
    }

    async updateProjectFile(content: string, instruction: string): Promise<string> {
      const userMessage = `Instruction: ${instruction}\n\nCurrent content:\n${content}`;
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: UPDATE_PROJECT_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      });
      return response.choices[0]?.message?.content ?? content;
    }

    async generateCoverLetter(indexContent: string, jobDescription: string, additionalContext?: string): Promise<string> {
      let context = `Project Index:\n${indexContent}\n\nJob Description:\n${jobDescription}`;
      if (additionalContext) context += `\n\nAdditional Context:\n${additionalContext}`;
      if (estimateTokens(context) > MAX_TOKENS) {
        context = context.slice(0, MAX_TOKENS * 4);
      }
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: COVER_LETTER_SYSTEM_PROMPT },
          { role: 'user', content: context },
        ],
      });
      return response.choices[0]?.message?.content ?? '';
    }
  }
  ```

- [ ] **Step 8: Implement `packages/backend/src/ai/factory.ts`**

  ```typescript
  import type { AIProvider } from './interface.js';
  import { StubAIProvider } from './stub.js';
  import { AnthropicAIProvider } from './anthropic.js';
  import { OpenAIProvider } from './openai.js';

  interface AIConfig {
    AI_PROVIDER?: string;
    AI_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
    OPENAI_MODEL?: string;
  }

  export function createAIProvider(config: AIConfig): AIProvider {
    const provider = config.AI_PROVIDER;
    if (provider === 'stub' || !provider) {
      return new StubAIProvider();
    }
    if (provider === 'anthropic') {
      if (!config.AI_API_KEY) throw new Error('AI_API_KEY is required for Anthropic provider');
      return new AnthropicAIProvider(config.AI_API_KEY, config.ANTHROPIC_MODEL);
    }
    if (provider === 'openai') {
      if (!config.AI_API_KEY) throw new Error('AI_API_KEY is required for OpenAI provider');
      return new OpenAIProvider(config.AI_API_KEY, config.OPENAI_MODEL);
    }
    throw new Error(`Unknown AI_PROVIDER: "${provider}". Valid values: anthropic, openai, stub`);
  }
  ```

- [ ] **Step 9: Run all tests**

  ```bash
  cd packages/backend && npx vitest run test/unit/
  ```
  Expected: all PASS.

- [ ] **Step 10: Commit**

  ```bash
  git add packages/backend/src/ai/ packages/backend/test/unit/ai-factory.test.ts
  git commit -m "feat: implement AIProvider interface with Anthropic, OpenAI, and stub providers"
  ```

---

### Task 6: Backend — Fastify server and routes

**Files:**
- Create: `packages/backend/src/routes/projects.ts`
- Create: `packages/backend/src/routes/resume.ts`
- Create: `packages/backend/src/routes/index.ts`
- Create: `packages/backend/src/routes/ai.ts`
- Create: `packages/backend/src/routes/match.ts`
- Create: `packages/backend/src/index.ts`
- Test: `packages/backend/test/integration/projects.test.ts`
- Test: `packages/backend/test/integration/resume.test.ts`
- Test: `packages/backend/test/integration/ai.test.ts`
- Test: `packages/backend/test/integration/match.test.ts`

**Goal:** Wire up all routes into a working Fastify server, verified via `inject()` integration tests.

- [ ] **Step 1: Write failing integration tests for projects routes**

  Create `packages/backend/test/integration/projects.test.ts`:

  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { mkdtempSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { buildApp } from '../../src/index.js';
  import type { FastifyInstance } from 'fastify';

  let app: FastifyInstance;
  let storageDir: string;

  beforeEach(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'projects-integration-'));
    app = await buildApp({ storageDir, aiProvider: 'stub' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(storageDir, { recursive: true, force: true });
  });

  describe('Projects routes', () => {
    it('POST /api/v1/projects creates project and returns 201', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Test Co', content: '# Test Co' } });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.slug).toBe('test-co');
    });

    it('GET /api/v1/projects returns array', async () => {
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Alpha', content: '# Alpha' } });
      const res = await app.inject({ method: 'GET', url: '/api/v1/projects' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
    });

    it('GET /api/v1/projects/:slug returns content', async () => {
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Foo', content: '# Foo content' } });
      const res = await app.inject({ method: 'GET', url: '/api/v1/projects/foo' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.content).toContain('Foo content');
    });

    it('GET /api/v1/projects/:slug returns 404 for unknown slug', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/projects/nonexistent' });
      expect(res.statusCode).toBe(404);
    });

    it('PUT /api/v1/projects/:slug updates content and regenerates index', async () => {
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Bar', content: 'original' } });
      const res = await app.inject({ method: 'PUT', url: '/api/v1/projects/bar', payload: { content: 'updated content' } });
      expect(res.statusCode).toBe(200);
      const getRes = await app.inject({ method: 'GET', url: '/api/v1/projects/bar' });
      expect(getRes.json().content).toBe('updated content');
    });

    it('DELETE /api/v1/projects/:slug removes file and returns 204', async () => {
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Baz', content: 'content' } });
      const deleteRes = await app.inject({ method: 'DELETE', url: '/api/v1/projects/baz' });
      expect(deleteRes.statusCode).toBe(204);
      const getRes = await app.inject({ method: 'GET', url: '/api/v1/projects/baz' });
      expect(getRes.statusCode).toBe(404);
    });

    it('upload route does not shadow :slug — /projects/upload is reachable', async () => {
      // upload route should be registered before :slug so 'upload' is not treated as a slug
      const form = new FormData();
      form.append('file', new Blob(['# Uploaded'], { type: 'text/markdown' }), 'uploaded.md');
      // Use inject with content-type multipart — just verify it does not 404 unexpectedly
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/upload',
        headers: { 'content-type': 'multipart/form-data; boundary=boundary' },
        payload: '--boundary\r\nContent-Disposition: form-data; name="file"; filename="test.md"\r\nContent-Type: text/markdown\r\n\r\n# Uploaded\r\n--boundary--\r\n',
      });
      expect(res.statusCode).not.toBe(404);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd packages/backend && npx vitest run test/integration/projects.test.ts
  ```
  Expected: FAIL — `buildApp` not found.

- [ ] **Step 3: Implement `packages/backend/src/index.ts` with `buildApp` factory**

  ```typescript
  import Fastify from 'fastify';
  import cors from '@fastify/cors';
  import multipart from '@fastify/multipart';
  import type { FastifyInstance } from 'fastify';
  import { ProjectStore } from './storage/projectStore.js';
  import { IndexStore } from './storage/indexStore.js';
  import { createAIProvider } from './ai/factory.js';
  import { projectsRoutes } from './routes/projects.js';
  import { resumeRoutes } from './routes/resume.js';
  import { indexRoutes } from './routes/index.js';
  import { aiRoutes } from './routes/ai.js';
  import { matchRoutes } from './routes/match.js';
  import { config } from './config.js';

  interface BuildAppOptions {
    storageDir?: string;
    aiProvider?: string;
    aiApiKey?: string;
    anthropicModel?: string;
    openaiModel?: string;
    port?: number;
  }

  export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
    const storageDir = options.storageDir ?? config.STORAGE_DIR;
    const projectStore = new ProjectStore(storageDir);
    const indexStore = new IndexStore(storageDir);
    const aiProvider = createAIProvider({
      AI_PROVIDER: options.aiProvider ?? config.AI_PROVIDER,
      AI_API_KEY: options.aiApiKey ?? config.AI_API_KEY,
      ANTHROPIC_MODEL: options.anthropicModel ?? config.ANTHROPIC_MODEL,
      OPENAI_MODEL: options.openaiModel ?? config.OPENAI_MODEL,
    });

    const app = Fastify({ logger: false });

    await app.register(cors, { origin: true });
    await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

    await app.register(projectsRoutes, { prefix: '/api/v1', projectStore, indexStore });
    await app.register(resumeRoutes, { prefix: '/api/v1', projectStore, indexStore });
    await app.register(indexRoutes, { prefix: '/api/v1', projectStore, indexStore });
    await app.register(aiRoutes, { prefix: '/api/v1', projectStore, indexStore, aiProvider });
    await app.register(matchRoutes, { prefix: '/api/v1', indexStore });

    return app;
  }

  // Only start server when run directly (not in tests)
  if (process.argv[1] === new URL(import.meta.url).pathname) {
    const port = config.PORT;
    const app = await buildApp();
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on http://localhost:${port}`);
  }
  ```

- [ ] **Step 4: Implement `packages/backend/src/routes/projects.ts`**

  ```typescript
  import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
  import { NotFoundError, type ProjectStore } from '../storage/projectStore.js';
  import type { IndexStore } from '../storage/indexStore.js';

  interface ProjectsPluginOptions extends FastifyPluginOptions {
    projectStore: ProjectStore;
    indexStore: IndexStore;
  }

  export async function projectsRoutes(app: FastifyInstance, opts: ProjectsPluginOptions): Promise<void> {
    const { projectStore, indexStore } = opts;

    // POST /projects/upload must be registered BEFORE /projects/:slug
    app.post('/projects/upload', async (request, reply) => {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'Bad Request', message: 'No file uploaded' });
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) chunks.push(chunk);
      const content = Buffer.concat(chunks).toString('utf8');
      const name = data.filename.replace(/\.md$/, '');
      const slug = projectStore.createProject(name, content);
      indexStore.regenerateIndex(projectStore);
      return reply.status(201).send({ slug, name });
    });

    app.get('/projects', async (_request, reply) => {
      const projects = projectStore.listProjects();
      return reply.send(projects);
    });

    app.post('/projects', async (request, reply) => {
      const { name, content } = request.body as { name: string; content: string };
      if (!name || typeof content !== 'string') {
        return reply.status(400).send({ error: 'Bad Request', message: 'name and content are required' });
      }
      const slug = projectStore.createProject(name, content);
      indexStore.regenerateIndex(projectStore);
      return reply.status(201).send({ slug, name });
    });

    app.get('/projects/:slug', async (request, reply) => {
      const { slug } = request.params as { slug: string };
      try {
        const content = projectStore.getProject(slug);
        return reply.send({ slug, content });
      } catch (err) {
        if (err instanceof NotFoundError) return reply.status(404).send({ error: 'Not Found', message: err.message });
        throw err;
      }
    });

    app.put('/projects/:slug', async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const { content } = request.body as { content: string };
      if (typeof content !== 'string') {
        return reply.status(400).send({ error: 'Bad Request', message: 'content is required' });
      }
      try {
        projectStore.updateProject(slug, content);
        indexStore.regenerateIndex(projectStore);
        return reply.send({ slug });
      } catch (err) {
        if (err instanceof NotFoundError) return reply.status(404).send({ error: 'Not Found', message: (err as Error).message });
        throw err;
      }
    });

    app.delete('/projects/:slug', async (request, reply) => {
      const { slug } = request.params as { slug: string };
      try {
        projectStore.deleteProject(slug);
        indexStore.regenerateIndex(projectStore);
        return reply.status(204).send();
      } catch (err) {
        if (err instanceof NotFoundError) return reply.status(404).send({ error: 'Not Found', message: (err as Error).message });
        throw err;
      }
    });
  }
  ```

- [ ] **Step 5: Implement remaining route files**

  Create `packages/backend/src/routes/resume.ts`:

  ```typescript
  import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
  import { parseResume } from '../resume/parser.js';
  import type { ProjectStore } from '../storage/projectStore.js';
  import type { IndexStore } from '../storage/indexStore.js';

  interface ResumePluginOptions extends FastifyPluginOptions {
    projectStore: ProjectStore;
    indexStore: IndexStore;
  }

  export async function resumeRoutes(app: FastifyInstance, opts: ResumePluginOptions): Promise<void> {
    app.post('/resume/parse', async (request, reply) => {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'Bad Request', message: 'No file uploaded' });
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const result = await parseResume(buffer, data.mimetype);
      return reply.send(result);
    });
  }
  ```

  Create `packages/backend/src/routes/index.ts`:

  ```typescript
  import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
  import type { ProjectStore } from '../storage/projectStore.js';
  import type { IndexStore } from '../storage/indexStore.js';

  interface IndexPluginOptions extends FastifyPluginOptions {
    projectStore: ProjectStore;
    indexStore: IndexStore;
  }

  export async function indexRoutes(app: FastifyInstance, opts: IndexPluginOptions): Promise<void> {
    const { projectStore, indexStore } = opts;

    app.get('/index', async (_request, reply) => {
      const content = indexStore.getIndex();
      return reply.send({ content });
    });

    app.post('/index/regenerate', async (_request, reply) => {
      indexStore.regenerateIndex(projectStore);
      const content = indexStore.getIndex();
      return reply.send({ content });
    });
  }
  ```

  Create `packages/backend/src/routes/ai.ts`:

  ```typescript
  import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
  import { NotFoundError, type ProjectStore } from '../storage/projectStore.js';
  import type { IndexStore } from '../storage/indexStore.js';
  import type { AIProvider } from '../ai/interface.js';

  interface AIPluginOptions extends FastifyPluginOptions {
    projectStore: ProjectStore;
    indexStore: IndexStore;
    aiProvider: AIProvider;
  }

  export async function aiRoutes(app: FastifyInstance, opts: AIPluginOptions): Promise<void> {
    const { projectStore, indexStore, aiProvider } = opts;

    app.post('/ai/update/:slug', async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const { instruction } = request.body as { instruction: string };
      if (!instruction) return reply.status(400).send({ error: 'Bad Request', message: 'instruction is required' });
      try {
        const content = projectStore.getProject(slug);
        const updated = await aiProvider.updateProjectFile(content, instruction);
        projectStore.updateProject(slug, updated);
        indexStore.regenerateIndex(projectStore);
        return reply.send({ slug, content: updated });
      } catch (err) {
        if (err instanceof NotFoundError) return reply.status(404).send({ error: 'Not Found', message: (err as Error).message });
        throw err;
      }
    });

    app.post('/ai/cover-letter', async (request, reply) => {
      const { jobDescription, additionalContext } = request.body as { jobDescription: string; additionalContext?: string };
      if (!jobDescription) return reply.status(400).send({ error: 'Bad Request', message: 'jobDescription is required' });
      const indexContent = indexStore.getIndex();
      const coverLetter = await aiProvider.generateCoverLetter(indexContent, jobDescription, additionalContext);
      return reply.send({ coverLetter });
    });
  }
  ```

  Create `packages/backend/src/routes/match.ts`:

  ```typescript
  import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
  import { matchJobDescription } from '../matching/matcher.js';
  import type { IndexStore } from '../storage/indexStore.js';

  interface MatchPluginOptions extends FastifyPluginOptions {
    indexStore: IndexStore;
  }

  export async function matchRoutes(app: FastifyInstance, opts: MatchPluginOptions): Promise<void> {
    const { indexStore } = opts;

    app.post('/match', async (request, reply) => {
      const { jobDescription } = request.body as { jobDescription: string };
      if (!jobDescription) return reply.status(400).send({ error: 'Bad Request', message: 'jobDescription is required' });
      const indexContent = indexStore.getIndex();
      const result = matchJobDescription(jobDescription, indexContent);
      return reply.send(result);
    });
  }
  ```

- [ ] **Step 6: Write and run remaining integration tests**

  Create `packages/backend/test/integration/resume.test.ts`:

  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join, dirname } from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { buildApp } from '../../src/index.js';
  import type { FastifyInstance } from 'fastify';

  const __dirname = dirname(fileURLToPath(import.meta.url));

  let app: FastifyInstance;
  let storageDir: string;

  beforeEach(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'resume-integration-'));
    app = await buildApp({ storageDir, aiProvider: 'stub' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(storageDir, { recursive: true, force: true });
  });

  describe('Resume routes', () => {
    it('POST /api/v1/resume/parse with plain text returns sections', async () => {
      const fixturePath = join(__dirname, '../fixtures/sample-resume.txt');
      const fileContent = readFileSync(fixturePath);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/resume/parse',
        headers: { 'content-type': 'multipart/form-data; boundary=boundary' },
        payload: `--boundary\r\nContent-Disposition: form-data; name="file"; filename="resume.txt"\r\nContent-Type: text/plain\r\n\r\n${fileContent.toString()}\r\n--boundary--\r\n`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('sections');
      expect(body).toHaveProperty('rawText');
      expect(body.rawText).toContain('Acme Corp');
    });
  });
  ```

  Create `packages/backend/test/integration/ai.test.ts`:

  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { mkdtempSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { buildApp } from '../../src/index.js';
  import type { FastifyInstance } from 'fastify';

  let app: FastifyInstance;
  let storageDir: string;

  beforeEach(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'ai-integration-'));
    app = await buildApp({ storageDir, aiProvider: 'stub' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(storageDir, { recursive: true, force: true });
  });

  describe('AI routes (stub provider)', () => {
    it('POST /api/v1/ai/update/:slug returns updated content with [AI STUB]', async () => {
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'My Project', content: '# Original' } });
      const res = await app.inject({ method: 'POST', url: '/api/v1/ai/update/my-project', payload: { instruction: 'Add a summary' } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.content).toContain('[AI STUB]');
    });

    it('POST /api/v1/ai/cover-letter returns non-empty coverLetter', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/ai/cover-letter', payload: { jobDescription: 'Looking for a TypeScript developer' } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.coverLetter.length).toBeGreaterThan(0);
    });
  });
  ```

  Create `packages/backend/test/integration/match.test.ts`:

  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { mkdtempSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { buildApp } from '../../src/index.js';
  import type { FastifyInstance } from 'fastify';

  let app: FastifyInstance;
  let storageDir: string;

  beforeEach(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'match-integration-'));
    app = await buildApp({ storageDir, aiProvider: 'stub' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(storageDir, { recursive: true, force: true });
  });

  describe('Match routes', () => {
    it('POST /api/v1/match returns match result', async () => {
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'React Project', content: 'Used TypeScript and React in this project.' } });
      await app.inject({ method: 'POST', url: '/api/v1/index/regenerate' });
      const res = await app.inject({ method: 'POST', url: '/api/v1/match', payload: { jobDescription: 'Looking for TypeScript and React developer' } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('score');
      expect(body).toHaveProperty('matchedKeywords');
      expect(body).toHaveProperty('missedKeywords');
      expect(body).toHaveProperty('projectScores');
    });
  });
  ```

- [ ] **Step 7: Run all backend tests**

  ```bash
  cd packages/backend && npx vitest run
  ```
  Expected: all unit and integration tests PASS.

- [ ] **Step 8: Verify server starts**

  ```bash
  AI_PROVIDER=stub tsx packages/backend/src/index.ts &
  sleep 2
  curl -s http://localhost:3001/api/v1/projects | python3 -c "import sys,json; print(json.loads(sys.stdin.read()))"
  kill %1
  ```
  Expected: server starts, curl returns `[]`.

- [ ] **Step 9: Refactor and verify**

  Ensure consistent error response shape `{ error: string, message: string }` across all routes. Run full test suite:

  ```bash
  cd packages/backend && npx vitest run
  ```
  Expected: all PASS.

- [ ] **Step 10: Commit**

  ```bash
  git add packages/backend/src/routes/ packages/backend/src/index.ts packages/backend/test/integration/
  git commit -m "feat: implement Fastify server with all API routes"
  ```

---

### Task 7: Frontend — scaffold and API client

**Files:**
- Create: `packages/frontend/src/main.tsx`
- Create: `packages/frontend/src/App.tsx`
- Create: `packages/frontend/src/api/client.ts`
- Create: `packages/frontend/playwright.config.ts`

**Goal:** Bootstrap the React + Vite app and implement the typed API client.

- [ ] **Step 1: Write smoke test for API client exports**

  Create `packages/frontend/src/api/client.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import * as client from './client.js';

  describe('API client exports', () => {
    it('exports expected functions', () => {
      expect(typeof client.listProjects).toBe('function');
      expect(typeof client.getProject).toBe('function');
      expect(typeof client.createProject).toBe('function');
      expect(typeof client.updateProject).toBe('function');
      expect(typeof client.deleteProject).toBe('function');
      expect(typeof client.uploadMarkdown).toBe('function');
      expect(typeof client.parseResume).toBe('function');
      expect(typeof client.getIndex).toBe('function');
      expect(typeof client.regenerateIndex).toBe('function');
      expect(typeof client.aiUpdateProject).toBe('function');
      expect(typeof client.generateCoverLetter).toBe('function');
      expect(typeof client.matchJobDescription).toBe('function');
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd packages/frontend && npx vitest run src/api/client.test.ts
  ```
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/frontend/src/api/client.ts`**

  ```typescript
  const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? res.statusText);
    }
    return res.json() as Promise<T>;
  }

  export interface ProjectMeta { slug: string; name: string; size: number; mtime: string }
  export interface ProjectContent { slug: string; content: string }
  export interface ParsedResume { sections: ResumeSection[]; rawText: string; warnings: string[] }
  export interface ResumeSection { heading: string; entries: ResumeEntry[] }
  export interface ResumeEntry { company: string; title: string; dates: string; bullets: string[] }
  export interface MatchResult { score: number; matchedKeywords: string[]; missedKeywords: string[]; projectScores: ProjectScore[] }
  export interface ProjectScore { slug: string; name: string; score: number; matchedKeywords: string[] }

  export const listProjects = () => request<ProjectMeta[]>('GET', '/projects');
  export const getProject = (slug: string) => request<ProjectContent>('GET', `/projects/${slug}`);
  export const createProject = (name: string, content: string) => request<{ slug: string; name: string }>('POST', '/projects', { name, content });
  export const updateProject = (slug: string, content: string) => request<{ slug: string }>('PUT', `/projects/${slug}`, { content });
  export const deleteProject = (slug: string) => request<void>('DELETE', `/projects/${slug}`);

  export async function uploadMarkdown(file: File): Promise<{ slug: string; name: string }> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/api/v1/projects/upload`, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error((err as { message: string }).message ?? res.statusText);
    }
    return res.json();
  }

  export async function parseResume(file: File): Promise<ParsedResume> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/api/v1/resume/parse`, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error((err as { message: string }).message ?? res.statusText);
    }
    return res.json();
  }

  export const getIndex = () => request<{ content: string }>('GET', '/index');
  export const regenerateIndex = () => request<{ content: string }>('POST', '/index/regenerate');
  export const aiUpdateProject = (slug: string, instruction: string) => request<{ slug: string; content: string }>('POST', `/ai/update/${slug}`, { instruction });
  export const generateCoverLetter = (jobDescription: string, additionalContext?: string) => request<{ coverLetter: string }>('POST', '/ai/cover-letter', { jobDescription, additionalContext });
  export const matchJobDescription = (jobDescription: string) => request<MatchResult>('POST', '/match', { jobDescription });
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  cd packages/frontend && npx vitest run src/api/client.test.ts
  ```
  Expected: PASS.

- [ ] **Step 5: Create `packages/frontend/src/main.tsx`**

  ```tsx
  import React from 'react';
  import ReactDOM from 'react-dom/client';
  import { BrowserRouter } from 'react-router-dom';
  import App from './App.js';

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
  ```

- [ ] **Step 6: Create `packages/frontend/src/App.tsx` with routes**

  ```tsx
  import { Routes, Route, Link } from 'react-router-dom';
  import ProjectsPage from './pages/ProjectsPage.js';
  import UploadPage from './pages/UploadPage.js';
  import IndexPage from './pages/IndexPage.js';
  import MatchPage from './pages/MatchPage.js';
  import CoverLetterPage from './pages/CoverLetterPage.js';

  export default function App() {
    return (
      <div style={{ fontFamily: 'sans-serif', maxWidth: 960, margin: '0 auto', padding: 16 }}>
        <nav style={{ marginBottom: 24, display: 'flex', gap: 16 }}>
          <Link to="/">Projects</Link>
          <Link to="/upload">Upload Resume</Link>
          <Link to="/index">Index</Link>
          <Link to="/match">Job Match</Link>
          <Link to="/cover-letter">Cover Letter</Link>
        </nav>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/index" element={<IndexPage />} />
          <Route path="/match" element={<MatchPage />} />
          <Route path="/cover-letter" element={<CoverLetterPage />} />
        </Routes>
      </div>
    );
  }
  ```

- [ ] **Step 7: Create stub page files**

  Create placeholder files for each page so the app compiles before individual pages are built:

  `packages/frontend/src/pages/ProjectsPage.tsx`: `export default function ProjectsPage() { return <div>Projects</div>; }`
  `packages/frontend/src/pages/UploadPage.tsx`: `export default function UploadPage() { return <div>Upload</div>; }`
  `packages/frontend/src/pages/IndexPage.tsx`: `export default function IndexPage() { return <div>Index</div>; }`
  `packages/frontend/src/pages/MatchPage.tsx`: `export default function MatchPage() { return <div>Match</div>; }`
  `packages/frontend/src/pages/CoverLetterPage.tsx`: `export default function CoverLetterPage() { return <div>Cover Letter</div>; }`

- [ ] **Step 8: Configure `packages/frontend/playwright.config.ts`**

  ```typescript
  import { defineConfig } from '@playwright/test';
  import { join } from 'node:path';

  export default defineConfig({
    testDir: './e2e',
    timeout: 30000,
    retries: 1,
    use: {
      baseURL: 'http://localhost:5173',
      screenshot: 'on',
      trace: 'on-first-retry',
    },
    webServer: [
      {
        command: `AI_PROVIDER=stub STORAGE_DIR=/tmp/e2e-data tsx ${join(__dirname, '../../packages/backend/src/index.ts')}`,
        port: 3001,
        reuseExistingServer: !process.env['CI'],
        timeout: 15000,
      },
      {
        command: 'vite --port 5173',
        port: 5173,
        reuseExistingServer: !process.env['CI'],
        timeout: 15000,
      },
    ],
  });
  ```

  Note: `__dirname` is not available in ESM. Use `import.meta.dirname` or compute from `fileURLToPath` instead:

  ```typescript
  import { defineConfig } from '@playwright/test';
  import { dirname, join } from 'node:path';
  import { fileURLToPath } from 'node:url';

  const __dirname = dirname(fileURLToPath(import.meta.url));

  export default defineConfig({
    testDir: './e2e',
    timeout: 30000,
    retries: 1,
    use: {
      baseURL: 'http://localhost:5173',
      screenshot: 'on',
      trace: 'on-first-retry',
    },
    webServer: [
      {
        command: `AI_PROVIDER=stub STORAGE_DIR=/tmp/e2e-data tsx ${join(__dirname, '../backend/src/index.ts')}`,
        port: 3001,
        reuseExistingServer: !process.env['CI'],
        timeout: 15000,
      },
      {
        command: 'vite --port 5173',
        port: 5173,
        reuseExistingServer: !process.env['CI'],
        timeout: 15000,
      },
    ],
  });
  ```

- [ ] **Step 9: Verify frontend builds**

  ```bash
  cd packages/frontend && npx tsc --noEmit
  ```
  Expected: exits 0, no type errors.

- [ ] **Step 10: Commit**

  ```bash
  git add packages/frontend/src/ packages/frontend/playwright.config.ts
  git commit -m "feat: scaffold frontend with React Router, API client, and Playwright config"
  ```

---

### Task 8: Frontend — Projects page (list + upload + edit)

**Files:**
- Create: `packages/frontend/src/components/FileList.tsx`
- Create: `packages/frontend/src/components/MarkdownEditor.tsx`
- Create: `packages/frontend/src/components/ResumeUpload.tsx`
- Modify: `packages/frontend/src/pages/ProjectsPage.tsx`
- Create: `packages/frontend/e2e/upload-markdown.spec.ts`
- Create: `packages/frontend/e2e/edit-project.spec.ts`

**Goal:** Implement the core project management UI: file list, markdown editor, file upload.

- [ ] **Step 1: Write Playwright tests**

  Create `packages/frontend/e2e/upload-markdown.spec.ts`:

  ```typescript
  import { test, expect } from '@playwright/test';
  import { join, dirname } from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { writeFileSync, mkdirSync } from 'node:fs';
  import { tmpdir } from 'node:os';

  const __dirname = dirname(fileURLToPath(import.meta.url));

  test('upload markdown file appears in file list', async ({ page }) => {
    await page.goto('/');
    // Create a temp markdown file to upload
    const tmpPath = join(tmpdir(), 'e2e-test-project.md');
    writeFileSync(tmpPath, '# E2E Test Project\n\nThis is a test project.');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(tmpPath);
    await page.getByRole('button', { name: /upload/i }).click();
    await expect(page.getByText('e2e-test-project')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'e2e-screenshots/upload-markdown.png' });
  });

  test('clicking project file shows content in editor', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('e2e-test-project')).toBeVisible({ timeout: 5000 });
    await page.getByText('e2e-test-project').click();
    await expect(page.getByText('E2E Test Project')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'e2e-screenshots/view-project.png' });
  });
  ```

  Create `packages/frontend/e2e/edit-project.spec.ts`:

  ```typescript
  import { test, expect } from '@playwright/test';

  test('edit project content persists after reload', async ({ page }) => {
    // First create a project via API
    await page.request.post('http://localhost:3001/api/v1/projects', {
      data: { name: 'Edit Test', content: '# Edit Test\n\nOriginal content.' },
    });
    await page.goto('/');
    await page.getByText('edit-test').click();
    // Editor should show original content
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    // Click save button
    await page.getByRole('button', { name: /save/i }).click();
    await page.screenshot({ path: 'e2e-screenshots/edit-project.png' });
  });
  ```

- [ ] **Step 2: Run E2E tests to verify they fail**

  ```bash
  cd packages/frontend && npx playwright test e2e/upload-markdown.spec.ts --reporter=line
  ```
  Expected: FAIL — UI not implemented.

- [ ] **Step 3: Implement `FileList.tsx`**

  ```tsx
  import { type ProjectMeta, deleteProject } from '../api/client.js';

  interface Props {
    projects: ProjectMeta[];
    selectedSlug: string | null;
    onSelect: (slug: string) => void;
    onDeleted: () => void;
  }

  export default function FileList({ projects, selectedSlug, onSelect, onDeleted }: Props) {
    const handleDelete = async (slug: string) => {
      if (!confirm(`Delete ${slug}?`)) return;
      await deleteProject(slug);
      onDeleted();
    };
    return (
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {projects.map(p => (
          <li key={p.slug} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', background: p.slug === selectedSlug ? '#eef' : 'transparent' }}>
            <button style={{ border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', flex: 1 }} onClick={() => onSelect(p.slug)}>
              {p.slug}
            </button>
            <button onClick={() => handleDelete(p.slug)} style={{ color: 'red', border: 'none', background: 'none', cursor: 'pointer' }}>Delete</button>
          </li>
        ))}
      </ul>
    );
  }
  ```

- [ ] **Step 4: Implement `MarkdownEditor.tsx`**

  ```tsx
  import { useEffect, useRef, useState } from 'react';
  import { EditorView, basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { oneDark } from '@codemirror/theme-one-dark';
  import ReactMarkdown from 'react-markdown';
  import remarkGfm from 'remark-gfm';
  import { updateProject, aiUpdateProject } from '../api/client.js';

  interface Props {
    slug: string;
    initialContent: string;
    onSaved: () => void;
  }

  export default function MarkdownEditor({ slug, initialContent, onSaved }: Props) {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [preview, setPreview] = useState(false);
    const [saving, setSaving] = useState(false);
    const [aiModalOpen, setAiModalOpen] = useState(false);
    const [instruction, setInstruction] = useState('');
    const [status, setStatus] = useState('');

    useEffect(() => {
      if (!editorRef.current) return;
      const view = new EditorView({
        doc: initialContent,
        extensions: [basicSetup, markdown(), oneDark],
        parent: editorRef.current,
      });
      viewRef.current = view;
      return () => view.destroy();
    }, [initialContent]);

    const getContent = () => viewRef.current?.state.doc.toString() ?? '';

    const handleSave = async () => {
      setSaving(true);
      try {
        await updateProject(slug, getContent());
        setStatus('Saved!');
        onSaved();
      } catch (e) {
        setStatus(`Error: ${String(e)}`);
      } finally {
        setSaving(false);
        setTimeout(() => setStatus(''), 3000);
      }
    };

    const handleAiUpdate = async () => {
      if (!instruction.trim()) return;
      setAiModalOpen(false);
      setSaving(true);
      try {
        const result = await aiUpdateProject(slug, instruction);
        // Replace editor content
        const view = viewRef.current;
        if (view) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.content } });
        }
        setStatus('AI update applied!');
        setInstruction('');
      } catch (e) {
        setStatus(`AI error: ${String(e)}`);
      } finally {
        setSaving(false);
        setTimeout(() => setStatus(''), 3000);
      }
    };

    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={handleSave} disabled={saving}>Save</button>
          <button onClick={() => setPreview(p => !p)}>{preview ? 'Edit' : 'Preview'}</button>
          <button onClick={() => setAiModalOpen(true)}>Ask AI to update</button>
          {status && <span>{status}</span>}
        </div>
        {preview ? (
          <div style={{ border: '1px solid #ccc', padding: 16 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{getContent()}</ReactMarkdown>
          </div>
        ) : (
          <div ref={editorRef} style={{ border: '1px solid #ccc', minHeight: 300 }} />
        )}
        {aiModalOpen && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'white', padding: 24, borderRadius: 8, minWidth: 400 }}>
              <h3>Ask AI to Update</h3>
              <textarea value={instruction} onChange={e => setInstruction(e.target.value)} rows={4} style={{ width: '100%' }} placeholder="e.g. Add a summary paragraph at the top" />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={handleAiUpdate}>Submit</button>
                <button onClick={() => setAiModalOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 5: Implement `ResumeUpload.tsx` (markdown file upload variant)**

  ```tsx
  import { useRef } from 'react';
  import { uploadMarkdown } from '../api/client.js';

  interface Props {
    onUploaded: () => void;
  }

  export default function MarkdownUpload({ onUploaded }: Props) {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleUpload = async () => {
      const file = inputRef.current?.files?.[0];
      if (!file) return;
      await uploadMarkdown(file);
      onUploaded();
      if (inputRef.current) inputRef.current.value = '';
    };

    return (
      <div style={{ marginBottom: 16 }}>
        <input ref={inputRef} type="file" accept=".md" />
        <button onClick={handleUpload}>Upload</button>
      </div>
    );
  }
  ```

- [ ] **Step 6: Implement `ProjectsPage.tsx`**

  ```tsx
  import { useEffect, useState, useCallback } from 'react';
  import { listProjects, getProject, type ProjectMeta } from '../api/client.js';
  import FileList from '../components/FileList.js';
  import MarkdownEditor from '../components/MarkdownEditor.js';
  import MarkdownUpload from '../components/ResumeUpload.js';

  export default function ProjectsPage() {
    const [projects, setProjects] = useState<ProjectMeta[]>([]);
    const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
    const [content, setContent] = useState('');

    const refreshProjects = useCallback(async () => {
      const list = await listProjects();
      setProjects(list);
    }, []);

    useEffect(() => { refreshProjects(); }, [refreshProjects]);

    const handleSelect = async (slug: string) => {
      setSelectedSlug(slug);
      const proj = await getProject(slug);
      setContent(proj.content);
    };

    return (
      <div>
        <h1>Projects</h1>
        <MarkdownUpload onUploaded={refreshProjects} />
        <div style={{ display: 'flex', gap: 24 }}>
          <div style={{ width: 240, flexShrink: 0 }}>
            <FileList projects={projects} selectedSlug={selectedSlug} onSelect={handleSelect} onDeleted={() => { refreshProjects(); setSelectedSlug(null); }} />
          </div>
          <div style={{ flex: 1 }}>
            {selectedSlug ? (
              <MarkdownEditor key={selectedSlug} slug={selectedSlug} initialContent={content} onSaved={refreshProjects} />
            ) : (
              <p>Select a project to edit.</p>
            )}
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 7: Run E2E tests**

  ```bash
  mkdir -p packages/frontend/e2e-screenshots
  cd packages/frontend && npx playwright test e2e/upload-markdown.spec.ts e2e/edit-project.spec.ts --reporter=line
  ```
  Expected: all E2E tests PASS, screenshots saved.

- [ ] **Step 8: Extract `useProjects` hook**

  Create `packages/frontend/src/hooks/useProjects.ts`:

  ```typescript
  import { useState, useCallback } from 'react';
  import { listProjects, type ProjectMeta } from '../api/client.js';

  export function useProjects() {
    const [projects, setProjects] = useState<ProjectMeta[]>([]);
    const refresh = useCallback(async () => {
      const list = await listProjects();
      setProjects(list);
    }, []);
    return { projects, refresh };
  }
  ```

  Update `ProjectsPage.tsx` to use this hook. Run E2E tests again to confirm nothing regressed.

- [ ] **Step 9: Commit**

  ```bash
  git add packages/frontend/src/components/FileList.tsx packages/frontend/src/components/MarkdownEditor.tsx packages/frontend/src/components/ResumeUpload.tsx packages/frontend/src/pages/ProjectsPage.tsx packages/frontend/src/hooks/ packages/frontend/e2e/upload-markdown.spec.ts packages/frontend/e2e/edit-project.spec.ts
  git commit -m "feat: implement projects page with file list, markdown editor, and upload"
  ```

---

### Task 9: Frontend — Resume upload and parse

**Files:**
- Modify: `packages/frontend/src/pages/UploadPage.tsx`
- Create: `packages/frontend/src/components/ParsedSectionCard.tsx`
- Create: `packages/frontend/e2e/upload-resume.spec.ts`

**Goal:** Implement the resume upload UI that parses the resume and presents extracted sections as project candidates.

- [ ] **Step 1: Write Playwright test**

  Create `packages/frontend/e2e/upload-resume.spec.ts`:

  ```typescript
  import { test, expect } from '@playwright/test';
  import { join, dirname } from 'node:path';
  import { fileURLToPath } from 'node:url';

  const __dirname = dirname(fileURLToPath(import.meta.url));

  test('upload plain-text resume shows parsed sections', async ({ page }) => {
    await page.goto('/upload');
    const fixturePath = join(__dirname, '../../backend/test/fixtures/sample-resume.txt');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(fixturePath);
    await page.getByRole('button', { name: /parse|upload/i }).click();
    await expect(page.getByText(/experience/i)).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'e2e-screenshots/upload-resume.png' });
  });

  test('add section as project navigates to projects page', async ({ page }) => {
    await page.goto('/upload');
    const fixturePath = join(__dirname, '../../backend/test/fixtures/sample-resume.txt');
    await page.locator('input[type="file"]').setInputFiles(fixturePath);
    await page.getByRole('button', { name: /parse|upload/i }).click();
    await expect(page.getByText(/acme/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /add as project/i }).first().click();
    await expect(page).toHaveURL('/', { timeout: 5000 });
    await page.screenshot({ path: 'e2e-screenshots/add-section-as-project.png' });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd packages/frontend && npx playwright test e2e/upload-resume.spec.ts --reporter=line
  ```
  Expected: FAIL — Upload page not implemented.

- [ ] **Step 3: Implement `ParsedSectionCard.tsx`**

  ```tsx
  import type { ResumeSection } from '../api/client.js';
  import { createProject } from '../api/client.js';
  import { useNavigate } from 'react-router-dom';

  interface Props {
    section: ResumeSection;
  }

  export default function ParsedSectionCard({ section }: Props) {
    const navigate = useNavigate();

    const handleAddAsProject = async (company: string, bullets: string[]) => {
      const content = `# ${company}\n\n${bullets.map(b => `- ${b}`).join('\n')}`;
      await createProject(company, content);
      navigate('/');
    };

    return (
      <div style={{ border: '1px solid #ccc', padding: 16, marginBottom: 16, borderRadius: 4 }}>
        <h3>{section.heading}</h3>
        {section.entries.map((entry, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <strong>{entry.company}</strong> — {entry.title} ({entry.dates})
            <ul>
              {entry.bullets.map((b, j) => <li key={j}>{b}</li>)}
            </ul>
            {entry.company && (
              <button onClick={() => handleAddAsProject(entry.company, entry.bullets)}>Add as project</button>
            )}
          </div>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 4: Implement `UploadPage.tsx`**

  ```tsx
  import { useRef, useState } from 'react';
  import { parseResume, type ParsedResume } from '../api/client.js';
  import ParsedSectionCard from '../components/ParsedSectionCard.js';

  export default function UploadPage() {
    const inputRef = useRef<HTMLInputElement>(null);
    const [result, setResult] = useState<ParsedResume | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleParse = async () => {
      const file = inputRef.current?.files?.[0];
      if (!file) return;
      setLoading(true);
      setError('');
      try {
        const parsed = await parseResume(file);
        setResult(parsed);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    };

    return (
      <div>
        <h1>Upload Resume</h1>
        <div style={{ marginBottom: 16 }}>
          <input ref={inputRef} type="file" accept=".pdf,.txt,.md" />
          <button onClick={handleParse} disabled={loading}>
            {loading ? 'Parsing...' : 'Parse Resume'}
          </button>
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        {result && (
          <div>
            {result.warnings.length > 0 && (
              <div style={{ background: '#fffbcc', padding: 8 }}>
                {result.warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            )}
            {result.sections.map((s, i) => <ParsedSectionCard key={i} section={s} />)}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 5: Run E2E tests**

  ```bash
  cd packages/frontend && npx playwright test e2e/upload-resume.spec.ts --reporter=line
  ```
  Expected: all PASS, screenshots saved.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/frontend/src/pages/UploadPage.tsx packages/frontend/src/components/ParsedSectionCard.tsx packages/frontend/e2e/upload-resume.spec.ts
  git commit -m "feat: implement resume upload and parse page"
  ```

---

### Task 10: Frontend — Index view

**Files:**
- Modify: `packages/frontend/src/pages/IndexPage.tsx`
- Create: `packages/frontend/e2e/generate-index.spec.ts`

**Goal:** Implement the index page showing tech keywords per project.

- [ ] **Step 1: Write Playwright test**

  Create `packages/frontend/e2e/generate-index.spec.ts`:

  ```typescript
  import { test, expect } from '@playwright/test';

  test.beforeEach(async ({ request }) => {
    // Seed projects with known keywords
    await request.post('http://localhost:3001/api/v1/projects', { data: { name: 'Index Test Alpha', content: 'Built with TypeScript and React.' } });
    await request.post('http://localhost:3001/api/v1/projects', { data: { name: 'Index Test Beta', content: 'Used Docker and Kubernetes for deployment.' } });
    await request.post('http://localhost:3001/api/v1/index/regenerate');
  });

  test('index page shows keyword content', async ({ page }) => {
    await page.goto('/index');
    await expect(page.getByText(/Project Index/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/TypeScript/)).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'e2e-screenshots/index-view.png' });
  });

  test('regenerate button updates index', async ({ page }) => {
    await page.goto('/index');
    await page.getByRole('button', { name: /regenerate/i }).click();
    await expect(page.getByText(/Project Index/i)).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'e2e-screenshots/index-regenerated.png' });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd packages/frontend && npx playwright test e2e/generate-index.spec.ts --reporter=line
  ```
  Expected: FAIL — page not implemented.

- [ ] **Step 3: Implement `IndexPage.tsx`**

  ```tsx
  import { useEffect, useState } from 'react';
  import ReactMarkdown from 'react-markdown';
  import remarkGfm from 'remark-gfm';
  import { getIndex, regenerateIndex } from '../api/client.js';

  export default function IndexPage() {
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);

    const loadIndex = async () => {
      const res = await getIndex();
      setContent(res.content);
    };

    useEffect(() => { loadIndex(); }, []);

    const handleRegenerate = async () => {
      setLoading(true);
      try {
        const res = await regenerateIndex();
        setContent(res.content);
      } finally {
        setLoading(false);
      }
    };

    return (
      <div>
        <h1>Project Index</h1>
        <button onClick={handleRegenerate} disabled={loading}>{loading ? 'Regenerating...' : 'Regenerate'}</button>
        <div style={{ marginTop: 16, border: '1px solid #ccc', padding: 16 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || '*No index yet. Add projects and regenerate.*'}</ReactMarkdown>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 4: Run E2E tests**

  ```bash
  cd packages/frontend && npx playwright test e2e/generate-index.spec.ts --reporter=line
  ```
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/frontend/src/pages/IndexPage.tsx packages/frontend/e2e/generate-index.spec.ts
  git commit -m "feat: implement index page with regenerate capability"
  ```

---

### Task 11: Frontend — AI update

**Files:**
- Modify: `packages/frontend/src/components/MarkdownEditor.tsx` (AI modal already included in Task 8)
- Create: `packages/frontend/e2e/ai-update.spec.ts`

**Goal:** Verify the AI-assisted markdown editing UI (modal was already built in Task 8 — this task adds the E2E test).

- [ ] **Step 1: Write Playwright test**

  Create `packages/frontend/e2e/ai-update.spec.ts`:

  ```typescript
  import { test, expect } from '@playwright/test';

  test('AI update dialog updates editor content', async ({ page }) => {
    // Seed a project
    await page.request.post('http://localhost:3001/api/v1/projects', {
      data: { name: 'AI Test Project', content: '# AI Test Project\n\nOriginal content.' },
    });
    await page.goto('/');
    await page.getByText('ai-test-project').click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /ask ai/i }).click();
    await page.getByPlaceholder(/instruction/i).fill('Add a summary paragraph');
    await page.getByRole('button', { name: /submit/i }).click();
    // AI stub response contains [AI STUB]
    await expect(page.locator('.cm-content')).toContainText('[AI STUB]', { timeout: 10000 });
    await page.screenshot({ path: 'e2e-screenshots/ai-update.png' });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd packages/frontend && npx playwright test e2e/ai-update.spec.ts --reporter=line
  ```
  Expected: FAIL (or may pass if modal placeholder text matches — in that case, update selector to match actual implementation).

- [ ] **Step 3: Adjust MarkdownEditor if needed**

  If the test fails due to selector mismatch, update `MarkdownEditor.tsx` to add a `placeholder` attribute to the instruction textarea:

  ```tsx
  <textarea ... placeholder="e.g. Add a summary paragraph at the top" />
  ```

  And ensure the AI modal button text matches `/ask ai/i`.

- [ ] **Step 4: Run E2E tests**

  ```bash
  cd packages/frontend && npx playwright test e2e/ai-update.spec.ts --reporter=line
  ```
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/frontend/e2e/ai-update.spec.ts
  git commit -m "feat: add E2E test for AI-assisted markdown editing"
  ```

---

### Task 12: Frontend — Job description matching

**Files:**
- Modify: `packages/frontend/src/pages/MatchPage.tsx`
- Create: `packages/frontend/e2e/job-match.spec.ts`

**Goal:** Implement the job matcher page.

- [ ] **Step 1: Write Playwright test**

  Create `packages/frontend/e2e/job-match.spec.ts`:

  ```typescript
  import { test, expect } from '@playwright/test';

  test.beforeEach(async ({ request }) => {
    await request.post('http://localhost:3001/api/v1/projects', {
      data: { name: 'TypeScript API', content: 'Built a TypeScript REST API using Node.js and PostgreSQL.' },
    });
    await request.post('http://localhost:3001/api/v1/index/regenerate');
  });

  test('job match returns score and project list', async ({ page }) => {
    await page.goto('/match');
    await page.getByRole('textbox').fill('Looking for TypeScript Node.js developer with REST API experience');
    await page.getByRole('button', { name: /match/i }).click();
    await expect(page.getByText(/score/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/typescript-api/i)).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'e2e-screenshots/job-match.png' });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd packages/frontend && npx playwright test e2e/job-match.spec.ts --reporter=line
  ```
  Expected: FAIL.

- [ ] **Step 3: Implement `MatchPage.tsx`**

  ```tsx
  import { useState } from 'react';
  import { matchJobDescription, type MatchResult } from '../api/client.js';

  export default function MatchPage() {
    const [jobDesc, setJobDesc] = useState('');
    const [result, setResult] = useState<MatchResult | null>(null);
    const [loading, setLoading] = useState(false);

    const handleMatch = async () => {
      if (!jobDesc.trim()) return;
      setLoading(true);
      try {
        const res = await matchJobDescription(jobDesc);
        setResult(res);
      } finally {
        setLoading(false);
      }
    };

    return (
      <div>
        <h1>Job Description Match</h1>
        <textarea
          value={jobDesc}
          onChange={e => setJobDesc(e.target.value)}
          rows={8}
          style={{ width: '100%', marginBottom: 8 }}
          placeholder="Paste job description here..."
        />
        <button onClick={handleMatch} disabled={loading}>{loading ? 'Matching...' : 'Match'}</button>
        {result && (
          <div style={{ marginTop: 24 }}>
            <h2>Overall Score: {(result.score * 100).toFixed(1)}%</h2>
            <p><strong>Matched keywords:</strong> {result.matchedKeywords.join(', ') || 'None'}</p>
            <p><strong>Missed keywords:</strong> {result.missedKeywords.join(', ') || 'None'}</p>
            <h3>Projects</h3>
            <ul>
              {result.projectScores.map(p => (
                <li key={p.slug}>
                  <strong>{p.slug}</strong>: {(p.score * 100).toFixed(1)}% — matched: {p.matchedKeywords.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 4: Run E2E tests**

  ```bash
  cd packages/frontend && npx playwright test e2e/job-match.spec.ts --reporter=line
  ```
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/frontend/src/pages/MatchPage.tsx packages/frontend/e2e/job-match.spec.ts
  git commit -m "feat: implement job description matching page"
  ```

---

### Task 13: Frontend — Cover letter generation

**Files:**
- Modify: `packages/frontend/src/pages/CoverLetterPage.tsx`
- Create: `packages/frontend/e2e/cover-letter.spec.ts`

**Goal:** Implement the cover letter generation page.

- [ ] **Step 1: Write Playwright test**

  Create `packages/frontend/e2e/cover-letter.spec.ts`:

  ```typescript
  import { test, expect } from '@playwright/test';

  test('cover letter is generated and copyable', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/cover-letter');
    await page.getByRole('textbox').first().fill('We are looking for a TypeScript engineer with React experience.');
    await page.getByRole('button', { name: /generate/i }).click();
    await expect(page.getByText(/\[AI STUB\]/i)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /copy/i }).click();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText.length).toBeGreaterThan(0);
    await page.screenshot({ path: 'e2e-screenshots/cover-letter.png' });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd packages/frontend && npx playwright test e2e/cover-letter.spec.ts --reporter=line
  ```
  Expected: FAIL.

- [ ] **Step 3: Implement `CoverLetterPage.tsx`**

  ```tsx
  import { useState } from 'react';
  import { generateCoverLetter } from '../api/client.js';

  export default function CoverLetterPage() {
    const [jobDesc, setJobDesc] = useState('');
    const [additionalContext, setAdditionalContext] = useState('');
    const [coverLetter, setCoverLetter] = useState('');
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleGenerate = async () => {
      if (!jobDesc.trim()) return;
      setLoading(true);
      try {
        const res = await generateCoverLetter(jobDesc, additionalContext || undefined);
        setCoverLetter(res.coverLetter);
      } finally {
        setLoading(false);
      }
    };

    const handleCopy = async () => {
      await navigator.clipboard.writeText(coverLetter);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <div>
        <h1>Generate Cover Letter</h1>
        <h3>Job Description</h3>
        <textarea
          value={jobDesc}
          onChange={e => setJobDesc(e.target.value)}
          rows={8}
          style={{ width: '100%', marginBottom: 8 }}
          placeholder="Paste job description here..."
        />
        <h3>Additional Context (optional)</h3>
        <textarea
          value={additionalContext}
          onChange={e => setAdditionalContext(e.target.value)}
          rows={3}
          style={{ width: '100%', marginBottom: 8 }}
          placeholder="e.g. I am applying for a senior role..."
        />
        <button onClick={handleGenerate} disabled={loading}>{loading ? 'Generating...' : 'Generate Cover Letter'}</button>
        {coverLetter && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Cover Letter</h3>
              <button onClick={handleCopy}>{copied ? 'Copied!' : 'Copy to Clipboard'}</button>
            </div>
            <textarea
              readOnly
              value={coverLetter}
              rows={20}
              style={{ width: '100%', fontFamily: 'serif', lineHeight: 1.6 }}
            />
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 4: Run E2E tests**

  ```bash
  cd packages/frontend && npx playwright test e2e/cover-letter.spec.ts --reporter=line
  ```
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/frontend/src/pages/CoverLetterPage.tsx packages/frontend/e2e/cover-letter.spec.ts
  git commit -m "feat: implement cover letter generation page"
  ```

---

### Task 14: Final integration — full suite green and production-ready

**Files:**
- Create: `README.md`
- Modify: `.env.example` (verify complete)

**Goal:** Ensure the complete test suite is green, the app runs end-to-end with real server and browser, and the build is production-ready.

- [ ] **Step 1: Run full backend test suite**

  ```bash
  cd packages/backend && npx vitest run
  ```
  Expected: all unit and integration tests PASS.

- [ ] **Step 2: Run all E2E tests**

  ```bash
  cd packages/frontend && npx playwright test --reporter=line
  ```
  Expected: all 7 E2E specs PASS, screenshots produced.

- [ ] **Step 3: Fix any remaining failures**

  If any tests fail, fix the code. Do NOT weaken or delete any valid test.

- [ ] **Step 4: Production build**

  ```bash
  cd packages/backend && npx tsc --noEmit
  cd packages/frontend && npx tsc --noEmit && npx vite build
  ```
  Expected: both exit 0 with no errors.

- [ ] **Step 5: Create `README.md`**

  Document: project overview, prerequisites (Node 20+, npm 9+), setup steps (`npm install`, copy `.env.example` to `.env`, fill in values), how to run dev (`npm run dev`), how to run tests (`npm test`), how to run E2E (`npm run test:e2e`), and env var table.

- [ ] **Step 6: Run full suite one final time**

  ```bash
  cd packages/backend && npx vitest run
  cd packages/frontend && npx playwright test --reporter=line
  ```
  Expected: all green.

- [ ] **Step 7: Commit**

  ```bash
  git add README.md .env.example
  git commit -m "docs: add README and finalize setup documentation"
  ```

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
