# Job Application Manager — Test Plan

**Date:** 2026-04-03
**Implementation plan:** `docs/plans/2026-04-03-job-app-manager.md`
**Testing strategy approved:** 2026-04-03

---

## Strategy Reconciliation

The approved testing strategy assumed four harnesses (Vitest unit, Fastify `inject()` integration, Playwright E2E with AI stub, and optional live AI smoke tests). The implementation plan is fully consistent with those assumptions:

- The `buildApp(options)` factory accepts `storageDir` and `aiProvider: 'stub'` overrides, making the Fastify `inject()` harness straightforward.
- The `AIProvider` interface and deterministic `StubProvider` are first-class plan artifacts, so AI stub isolation works exactly as designed.
- The Playwright config uses `AI_PROVIDER=stub` and seeds a temp `STORAGE_DIR` via `webServer`, matching the E2E harness design.
- No paid/external infrastructure beyond optional live AI smoke tests is required.
- One adjustment from the strategy: the plan names `buildApp` (not a separate test helper) as the Fastify harness entry point. This is a refinement, not a scope change.

No strategy changes require user approval.

---

## Harness Requirements

### H1 — Vitest unit harness (`packages/backend/test/unit/`)

**What it does:** Runs pure logic tests — storage, parsing, matching — against real temp directories with no HTTP layer. Fast (< 2s total).

**Exposes:** `ProjectStore`, `IndexStore`, `parseResume`, `matchJobDescription`, `createAIProvider` directly via TypeScript imports.

**State inspection:** Real filesystem via `mkdtempSync` / `rmSync` in `beforeEach` / `afterEach`.

**Estimated complexity:** Already scaffolded in the plan — tests and implementations are provided verbatim. Minimal setup required.

**Tests that depend on it:** Tests 1–18 (unit tier).

---

### H2 — Fastify `inject()` integration harness (`packages/backend/test/integration/`)

**What it does:** Builds a complete Fastify app with `buildApp({ storageDir, aiProvider: 'stub' })`, sends HTTP requests via `app.inject()`, and tears down the temp directory after each test. No live network.

**Exposes:** Full HTTP surface of all `/api/v1/*` routes against a real filesystem. Does not mock the filesystem.

**State inspection:** HTTP response status codes, JSON bodies, and filesystem side-effects (file existence, content).

**Estimated complexity:** `buildApp` factory is the only prerequisite. Must be implemented before integration tests run.

**Tests that depend on it:** Tests 19–40 (integration tier).

---

### H3 — Playwright E2E harness (`packages/frontend/e2e/`)

**What it does:** Launches Chromium via `playwright test`, starts the real Fastify backend with `AI_PROVIDER=stub` and `STORAGE_DIR=/tmp/e2e-data`, and starts the Vite dev server on port 5173. Screenshots are captured per test. AI stub returns deterministic text (`[AI STUB] ...`), verifiable without live credentials.

**Exposes:** Full browser UI surface — navigation, file inputs, buttons, text areas, CodeMirror editor (`.cm-content`), rendered markdown.

**State inspection:** DOM assertions via Playwright `expect()`, screenshot artifacts in `e2e-screenshots/`.

**Estimated complexity:** `playwright.config.ts` is provided by the plan. Requires `npx playwright install chromium`. E2E data directory (`/tmp/e2e-data`) must be writable.

**Tests that depend on it:** Tests 41–54 (E2E tier).

---

### H4 — AI live smoke harness (optional, guarded by `AI_API_KEY`)

**What it does:** Runs real AI provider calls against the stub-equivalent prompts when `AI_API_KEY` is set in the environment. Not required for CI to be green.

**Exposes:** Real Anthropic/OpenAI responses to verify the prompt format produces non-empty, non-error output.

**State inspection:** Response string is non-empty and does not contain an error message.

**Estimated complexity:** Thin wrapper around the existing integration harness — swap `aiProvider: 'stub'` for `aiProvider: process.env.AI_PROVIDER`.

**Tests that depend on it:** Tests 55–56 (optional smoke tier).

---

## Test Plan

### Tier 1: Unit Tests (H1 — Vitest)

#### ProjectStore

**1. Creating a project returns the correct slug and persists the file**
- Type: unit
- Disposition: new (greenfield)
- Harness: H1
- Preconditions: empty temp storage directory
- Actions: call `store.createProject('Acme Corp', '# Acme Corp\n\nContent here.')`
- Expected outcome: returned slug is `'acme-corp'`; `store.getProject('acme-corp')` returns content containing `'Acme Corp'`. Source of truth: user description (slugified filename convention) + plan Key Invariant 6.
- Interactions: `slugify` library; `node:fs` `writeFileSync`

**2. Getting a project that does not exist throws NotFoundError**
- Type: boundary
- Disposition: new
- Harness: H1
- Preconditions: empty store
- Actions: call `store.getProject('not-here')`
- Expected outcome: throws `NotFoundError`. Source of truth: plan API contract (404 behavior) + plan implementation spec.
- Interactions: none

**3. Updating a project replaces the file content**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: project `'foo'` exists with content `'original'`
- Actions: call `store.updateProject('foo', 'updated')`; call `store.getProject('foo')`
- Expected outcome: returned content is `'updated'`. Source of truth: plan API contract (`PUT /projects/:slug`).
- Interactions: `node:fs` `writeFileSync`

**4. Deleting a project removes the file**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: project `'foo'` exists
- Actions: call `store.deleteProject('foo')`; call `store.getProject('foo')`
- Expected outcome: second call throws `NotFoundError`. Source of truth: plan API contract (`DELETE /projects/:slug`).
- Interactions: `node:fs` `unlinkSync`

**5. Listing projects returns metadata array with correct structure**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: projects `'alpha'` and `'beta'` exist
- Actions: call `store.listProjects()`
- Expected outcome: array of length 2; each entry has `slug`, `name`, `size`, `mtime`. Source of truth: plan `ProjectMeta` interface.
- Interactions: `node:fs` `readdirSync`, `statSync`

**6. Duplicate project names get numeric suffix slugs**
- Type: boundary
- Disposition: new
- Harness: H1
- Preconditions: empty store
- Actions: create `'Same Name'` twice
- Expected outcome: first slug is `'same-name'`; second is `'same-name-2'`. Source of truth: plan Key Invariant 6.
- Interactions: `slugify`, `node:fs` `existsSync`

**7. Deleting a non-existent project throws NotFoundError**
- Type: boundary
- Disposition: new
- Harness: H1
- Preconditions: empty store
- Actions: `store.deleteProject('ghost')`
- Expected outcome: throws `NotFoundError`. Source of truth: plan implementation spec.
- Interactions: none

**8. Updating a non-existent project throws NotFoundError**
- Type: boundary
- Disposition: new
- Harness: H1
- Preconditions: empty store
- Actions: `store.updateProject('ghost', 'x')`
- Expected outcome: throws `NotFoundError`. Source of truth: plan implementation spec.
- Interactions: none

---

#### IndexStore

**9. getIndex returns empty string when index.md is missing**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: empty storage directory (no `index.md`)
- Actions: `indexStore.getIndex()`
- Expected outcome: returns `''`. Source of truth: plan `IndexStore` spec.
- Interactions: `node:fs` `existsSync`

**10. regenerateIndex creates index.md with correct heading structure**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: one project file containing `'TypeScript and React'`
- Actions: `indexStore.regenerateIndex(projectStore)`; `indexStore.getIndex()`
- Expected outcome: content contains `'# Project Index'`, project heading, and file reference (`slug.md`). Source of truth: plan `index.md format` spec.
- Interactions: `ProjectStore.listProjects()`, `ProjectStore.getProject()`, `node:fs` `writeFileSync`

**11. regenerateIndex extracts known tech keywords**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: project file containing `'Docker, Kubernetes, and GraphQL'`
- Actions: regenerate index; read index
- Expected outcome: index contains `'Docker'`, `'Kubernetes'`, `'GraphQL'`. Source of truth: plan `KNOWN_TECH_TERMS` set.
- Interactions: keyword extraction logic in `IndexStore`

**12. regenerateIndex with no projects produces empty index with heading only**
- Type: boundary
- Disposition: new
- Harness: H1
- Preconditions: empty project directory
- Actions: regenerate index; read index
- Expected outcome: content contains `'# Project Index'`; no project sections. Source of truth: plan `index.md format` spec.
- Interactions: none

---

#### Resume Parser

**13. Parsing a plain-text resume returns structured sections**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: `sample-resume.txt` fixture present
- Actions: `parseResume(buffer, 'text/plain')` with fixture
- Expected outcome: `result.sections.length > 0`; `result.rawText` contains `'Acme Corp'`; `result.warnings` is empty. Source of truth: plan `ParsedResume` interface.
- Interactions: section heading heuristics in `parser.ts`

**14. Experience section is extracted with at least two entries and bullets**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: `sample-resume.txt` fixture
- Actions: parse fixture; find section with heading matching `'experience'`
- Expected outcome: section exists; at least 2 entries; `'Acme'` entry has bullets. Source of truth: plan `ResumeSection` / `ResumeEntry` interfaces + fixture.
- Interactions: entry parsing logic

**15. Empty buffer returns empty sections and a warning**
- Type: boundary
- Disposition: new
- Harness: H1
- Preconditions: none
- Actions: `parseResume(Buffer.from(''), 'text/plain')`
- Expected outcome: `sections` is `[]`; `warnings.length > 0`. Source of truth: plan "rawText preserved verbatim on parse failure" invariant.
- Interactions: guard clause at top of `parseSections`

**16. Non-resume text preserves rawText**
- Type: boundary
- Disposition: new
- Harness: H1
- Preconditions: none
- Actions: `parseResume(Buffer.from('This is not a resume at all. Just some random text.'), 'text/plain')`
- Expected outcome: `result.rawText` contains `'random text'`. Source of truth: plan Key Invariant 5 ("if parsing fails, raw text is preserved verbatim").
- Interactions: fallback branch in `parser.ts`

---

#### Matching Algorithm

**17. Exact keyword match returns score > 0 with matched keywords**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: sample index with Acme Corp (TypeScript, React, Node.js) and Beta Inc (Python, Django)
- Actions: `matchJobDescription('TypeScript React Node.js', sampleIndex)`
- Expected outcome: `score > 0`; `matchedKeywords.length > 0`. Source of truth: plan matching algorithm spec (Jaccard similarity).
- Interactions: keyword normalization

**18. No matching keywords returns score of 0**
- Type: boundary
- Disposition: new
- Harness: H1
- Preconditions: sample index as above
- Actions: `matchJobDescription('Cobol Fortran Assembly', sampleIndex)`
- Expected outcome: `score === 0`; `matchedKeywords` is `[]`. Source of truth: plan matching algorithm spec.
- Interactions: Jaccard formula (intersection is empty)

**19. Partial match returns correct Jaccard similarity**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: sample index with Acme Corp (TypeScript, React, Node.js, REST API, authentication, OAuth — 6 terms)
- Actions: `matchJobDescription('TypeScript React', sampleIndex)` — job has 2 terms
- Expected outcome: Acme Corp `score ≈ 2/6 ≈ 0.333`. Source of truth: plan matching algorithm step 3 (Jaccard formula).
- Interactions: none

**20. Project scores are returned sorted descending**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: sample index with two projects of different scores
- Actions: `matchJobDescription('TypeScript React', sampleIndex)`
- Expected outcome: `projectScores[0].score >= projectScores[1].score`. Source of truth: plan matching algorithm step 5 ("Return sorted project list").
- Interactions: sort logic

**21. Matched and missed keyword sets are correct**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: sample index with TypeScript but not Kubernetes
- Actions: `matchJobDescription('TypeScript Kubernetes', sampleIndex)`
- Expected outcome: `matchedKeywords` contains `'typescript'`; `missedKeywords` contains `'kubernetes'`. Source of truth: plan `MatchResult` interface.
- Interactions: set difference logic

---

#### AI Factory

**22. createAIProvider('stub') returns stub with deterministic behavior**
- Type: unit
- Disposition: new
- Harness: H1
- Preconditions: none
- Actions: `createAIProvider({ AI_PROVIDER: 'stub' })`; call `provider.updateProjectFile('content', 'Add summary')`
- Expected outcome: returns a string starting with `'[AI STUB]'`. Source of truth: plan AI provider spec ("stub returns `[AI STUB] + instruction`").
- Interactions: stub implementation

**23. createAIProvider without a provider throws or returns null for AI calls**
- Type: boundary
- Disposition: new
- Harness: H1
- Preconditions: none
- Actions: `createAIProvider({ AI_PROVIDER: undefined })` and call an AI method
- Expected outcome: factory either throws a clear error at construction time, or the returned provider throws with a clear message when called (not a silent failure). Source of truth: plan "AI_PROVIDER is required for AI features".
- Interactions: factory guard clause

---

### Tier 2: Fastify HTTP Integration Tests (H2 — Fastify `inject()`)

All integration tests use `buildApp({ storageDir: tempDir, aiProvider: 'stub' })` and tear down the temp directory afterward.

#### Projects Routes

**24. POST /api/v1/projects creates project and returns 201 with slug**
- Type: integration
- Disposition: new
- Harness: H2
- Preconditions: empty temp storage
- Actions: inject `POST /api/v1/projects` with `{ name: 'Test Co', content: '# Test Co' }`
- Expected outcome: status 201; body contains `{ slug: 'test-co' }`. Source of truth: plan API contract.
- Interactions: `ProjectStore.createProject`, `IndexStore.regenerateIndex`

**25. POST /api/v1/projects triggers index regeneration**
- Type: invariant
- Disposition: new
- Harness: H2
- Preconditions: empty storage
- Actions: create project; inject `GET /api/v1/index`
- Expected outcome: index content contains project slug. Source of truth: plan Key Invariant 2 ("index is regenerated whenever a project file is created").
- Interactions: `IndexStore.regenerateIndex`

**26. GET /api/v1/projects returns array of project metadata**
- Type: integration
- Disposition: new
- Harness: H2
- Preconditions: one project exists
- Actions: inject `GET /api/v1/projects`
- Expected outcome: status 200; body is array of length 1 with `slug`, `name`, `size`, `mtime`. Source of truth: plan API contract + `ProjectMeta` interface.
- Interactions: `ProjectStore.listProjects`

**27. GET /api/v1/projects/:slug returns project content**
- Type: integration
- Disposition: new
- Harness: H2
- Preconditions: project `'foo'` with content `'# Foo content'` exists
- Actions: inject `GET /api/v1/projects/foo`
- Expected outcome: status 200; body contains `{ content: '# Foo content' }`. Source of truth: plan API contract.
- Interactions: `ProjectStore.getProject`

**28. GET /api/v1/projects/:slug returns 404 for unknown slug**
- Type: boundary
- Disposition: new
- Harness: H2
- Preconditions: empty storage
- Actions: inject `GET /api/v1/projects/nonexistent`
- Expected outcome: status 404. Source of truth: plan API contract + `NotFoundError` mapping.
- Interactions: error handler

**29. PUT /api/v1/projects/:slug updates content and regenerates index**
- Type: integration
- Disposition: new
- Harness: H2
- Preconditions: project `'bar'` exists with content `'original'`
- Actions: inject `PUT /api/v1/projects/bar` with `{ content: 'updated content' }`; inject `GET /api/v1/projects/bar`
- Expected outcome: PUT returns 200; subsequent GET returns `'updated content'`. Source of truth: plan API contract + Key Invariant 2.
- Interactions: `ProjectStore.updateProject`, `IndexStore.regenerateIndex`

**30. DELETE /api/v1/projects/:slug removes file and returns 204**
- Type: integration
- Disposition: new
- Harness: H2
- Preconditions: project `'baz'` exists
- Actions: inject `DELETE /api/v1/projects/baz`; inject `GET /api/v1/projects/baz`
- Expected outcome: DELETE returns 204; subsequent GET returns 404. Source of truth: plan API contract + Key Invariant 2 (deletion triggers index update).
- Interactions: `ProjectStore.deleteProject`, `IndexStore.regenerateIndex`

**31. POST /api/v1/projects/upload is reachable and does not 404 (route ordering invariant)**
- Type: invariant
- Disposition: new
- Harness: H2
- Preconditions: none
- Actions: inject `POST /api/v1/projects/upload` with a multipart body containing a `.md` file
- Expected outcome: status is not 404 (even if processing fails for other reasons, the route is registered and matched). Source of truth: plan "Tricky Boundaries — Fastify route registration order matters".
- Interactions: `@fastify/multipart`

---

#### Resume Route

**32. POST /api/v1/resume/parse returns structured sections for a plain-text resume**
- Type: integration
- Disposition: new
- Harness: H2
- Preconditions: none
- Actions: inject `POST /api/v1/resume/parse` with multipart body containing `sample-resume.txt`
- Expected outcome: status 200; body has `sections` array with at least one entry; `rawText` is non-empty. Source of truth: plan `ParsedResume` response format.
- Interactions: `parseResume`, `@fastify/multipart`

**33. POST /api/v1/resume/parse returns 400 when no file is provided**
- Type: boundary
- Disposition: new
- Harness: H2
- Preconditions: none
- Actions: inject `POST /api/v1/resume/parse` with an empty body
- Expected outcome: status 400; error message present. Source of truth: plan route implementation ("No file uploaded").
- Interactions: multipart guard clause

---

#### Index Routes

**34. GET /api/v1/index returns current index content**
- Type: integration
- Disposition: new
- Harness: H2
- Preconditions: one project created (triggers auto-regeneration)
- Actions: inject `GET /api/v1/index`
- Expected outcome: status 200; body has `{ content: string }` with `'# Project Index'`. Source of truth: plan `index.md format` spec.
- Interactions: `IndexStore.getIndex`

**35. POST /api/v1/index/regenerate regenerates index and returns updated content**
- Type: integration
- Disposition: new
- Harness: H2
- Preconditions: two projects exist
- Actions: inject `POST /api/v1/index/regenerate`
- Expected outcome: status 200; body `content` contains both project slugs. Source of truth: plan Key Invariant 1 ("every project is mirrored in index.md").
- Interactions: `IndexStore.regenerateIndex`, `ProjectStore.listProjects`

---

#### AI Routes

**36. POST /api/v1/ai/update/:slug applies stub AI update and returns updated content**
- Type: integration
- Disposition: new
- Harness: H2
- Preconditions: project `'ai-test'` exists; `aiProvider: 'stub'`
- Actions: inject `POST /api/v1/ai/update/ai-test` with `{ instruction: 'Add summary' }`
- Expected outcome: status 200; body `content` starts with `'[AI STUB]'`. Source of truth: plan AI stub spec + `updateProjectFile` contract.
- Interactions: `StubProvider.updateProjectFile`, `ProjectStore.updateProject`, `IndexStore.regenerateIndex`

**37. POST /api/v1/ai/update/:slug returns 404 for unknown slug**
- Type: boundary
- Disposition: new
- Harness: H2
- Preconditions: empty storage
- Actions: inject `POST /api/v1/ai/update/ghost` with `{ instruction: 'x' }`
- Expected outcome: status 404. Source of truth: plan route error handling.
- Interactions: `NotFoundError` mapping

**38. POST /api/v1/ai/update/:slug returns 400 when instruction is missing**
- Type: boundary
- Disposition: new
- Harness: H2
- Preconditions: project `'foo'` exists
- Actions: inject `POST /api/v1/ai/update/foo` with `{}` (no instruction)
- Expected outcome: status 400. Source of truth: plan route implementation ("instruction is required").
- Interactions: request body validation

**39. POST /api/v1/ai/cover-letter returns non-empty cover letter from stub**
- Type: integration
- Disposition: new
- Harness: H2
- Preconditions: `aiProvider: 'stub'`
- Actions: inject `POST /api/v1/ai/cover-letter` with `{ jobDescription: 'TypeScript role at Acme' }`
- Expected outcome: status 200; body `coverLetter` is a non-empty string. Source of truth: plan cover letter response format.
- Interactions: `StubProvider.generateCoverLetter`, `IndexStore.getIndex`

---

#### Match Route

**40. POST /api/v1/match returns score, matched/missed keywords, and per-project scores**
- Type: integration
- Disposition: new
- Harness: H2
- Preconditions: project with TypeScript and React content exists; index regenerated
- Actions: inject `POST /api/v1/match` with `{ jobDescription: 'TypeScript React developer' }`
- Expected outcome: status 200; body has numeric `score` (0–1), `matchedKeywords` array containing `'typescript'` and/or `'react'`, `missedKeywords` array, and `projectScores` array with at least one entry. Source of truth: plan `MatchResult` response format.
- Interactions: `matchJobDescription`, `IndexStore.getIndex`

---

### Tier 3: Playwright E2E Tests (H3 — Playwright)

All E2E tests run against a real Fastify backend (`AI_PROVIDER=stub`, `STORAGE_DIR=/tmp/e2e-data`) and a real Vite dev server. Screenshots are saved to `e2e-screenshots/`.

#### Journey 1: Upload Markdown File

**41. Uploading a markdown file makes it appear in the project file list**
- Type: scenario
- Disposition: new
- Harness: H3
- Preconditions: app running; `/tmp/e2e-data/projects/` is empty
- Actions: navigate to `/`; set a file input to a temp `.md` file; click the Upload button
- Expected outcome: project slug appears in the file list within 5 seconds; screenshot saved. Source of truth: user description ("upload markdown files for each company/project").
- Interactions: `POST /api/v1/projects/upload`, `FileList` component

**42. Clicking a project file in the list shows its content in the editor**
- Type: scenario
- Disposition: new
- Harness: H3
- Preconditions: at least one project in the file list
- Actions: navigate to `/`; click a project slug in the list
- Expected outcome: the project's markdown content is visible in `.cm-content` within 5 seconds; screenshot saved. Source of truth: user description ("These markdown files can be updated by the user by editing them").
- Interactions: `GET /api/v1/projects/:slug`, `MarkdownEditor` component

---

#### Journey 2: Upload Resume and Parse

**43. Uploading a plain-text resume shows parsed experience section headings**
- Type: scenario
- Disposition: new
- Harness: H3
- Preconditions: app running; `/upload` page accessible
- Actions: navigate to `/upload`; set file input to `sample-resume.txt` fixture; click Parse/Upload button
- Expected outcome: `'experience'` (case-insensitive) heading is visible within 10 seconds; screenshot saved. Source of truth: user description ("upload resume and pull out the company/projects and bullet points").
- Interactions: `POST /api/v1/resume/parse`, `ParsedSectionCard` component, `ResumeUpload` component

**44. Clicking "Add as Project" from a parsed resume section navigates to the projects page**
- Type: scenario
- Disposition: new
- Harness: H3
- Preconditions: resume parsed; parsed sections visible (at least one with an `'Add as project'` button)
- Actions: click the first `'Add as project'` button
- Expected outcome: page URL becomes `/` within 5 seconds; screenshot saved. Source of truth: user description ("Once they have all the files created").
- Interactions: `POST /api/v1/projects`, React Router navigation

---

#### Journey 3: Edit Markdown File Manually

**45. Saving edited project content persists after reload**
- Type: scenario
- Disposition: new
- Harness: H3
- Preconditions: project `'edit-test'` seeded via API with content `'Original content.'`
- Actions: navigate to `/`; click `'edit-test'`; wait for `.cm-content`; click Save
- Expected outcome: Save button responds (status text appears or no error); after page reload `'edit-test'` content is still retrievable via `GET /api/v1/projects/edit-test`; screenshot saved. Source of truth: user description ("These markdown files can be updated by the user by editing them").
- Interactions: `PUT /api/v1/projects/:slug`, `MarkdownEditor` save handler

---

#### Journey 4: AI-Assisted Edit

**46. AI update dialog replaces editor content with stub AI response**
- Type: scenario
- Disposition: new
- Harness: H3
- Preconditions: project `'ai-test-project'` seeded via API; `AI_PROVIDER=stub`
- Actions: navigate to `/`; click `'ai-test-project'`; wait for `.cm-content`; click `'Ask AI'` button; fill instruction textarea with `'Add a summary paragraph'`; click `'Submit'`
- Expected outcome: `.cm-content` contains `'[AI STUB]'` within 10 seconds; screenshot saved. Source of truth: plan AI stub spec (`updateProjectFile` returns `[AI STUB] + instruction`).
- Interactions: `POST /api/v1/ai/update/:slug`, `MarkdownEditor` AI modal

---

#### Journey 5: Generate/Update Index

**47. Index page renders keyword content from project files**
- Type: scenario
- Disposition: new
- Harness: H3
- Preconditions: two projects seeded (`'Index Test Alpha'` with TypeScript/React content; `'Index Test Beta'` with Docker/Kubernetes content); `POST /api/v1/index/regenerate` called
- Actions: navigate to `/index`
- Expected outcome: `'Project Index'` heading is visible; `'TypeScript'` is visible within 5 seconds; screenshot saved. Source of truth: user description ("index markdown file is created/updated marking tech and keywords").
- Interactions: `GET /api/v1/index`, `IndexPage` component, `ReactMarkdown` render

**48. Regenerate button re-generates the index and refreshes the view**
- Type: scenario
- Disposition: new
- Harness: H3
- Preconditions: at least one project exists on the `/index` page
- Actions: click `'Regenerate'` button
- Expected outcome: `'Project Index'` is still visible after regeneration completes; screenshot saved. Source of truth: user description + plan `POST /api/v1/index/regenerate` contract.
- Interactions: `POST /api/v1/index/regenerate`, loading state, `IndexPage` update

---

#### Journey 6: Job Description Matching

**49. Pasting a job description returns a score and project match list**
- Type: scenario
- Disposition: new
- Harness: H3
- Preconditions: project `'TypeScript API'` seeded with TypeScript/Node.js/PostgreSQL content; index regenerated
- Actions: navigate to `/match`; fill the text area with `'Looking for TypeScript Node.js developer with REST API experience'`; click Match button
- Expected outcome: `'score'` label (or numeric score) is visible within 10 seconds; `'typescript-api'` project appears in results; screenshot saved. Source of truth: user description ("check for how close the projects and skills match").
- Interactions: `POST /api/v1/match`, `MatchPage` component

**50. Zero-match job description shows score of 0 or empty results**
- Type: boundary
- Disposition: new
- Harness: H3
- Preconditions: projects with TypeScript/React content exist in index
- Actions: navigate to `/match`; fill textarea with `'Cobol Fortran Assembly'`; click Match
- Expected outcome: score displayed is `0` or a `'No matches'` indication is visible. Source of truth: plan matching algorithm (score = 0 when no shared keywords).
- Interactions: `POST /api/v1/match`

---

#### Journey 7: Cover Letter Generation

**51. Cover letter is generated from job description and is non-empty**
- Type: scenario
- Disposition: new
- Harness: H3
- Preconditions: `AI_PROVIDER=stub`; app running
- Actions: navigate to `/cover-letter`; fill first textarea with `'We are looking for a TypeScript engineer with React experience.'`; click `'Generate Cover Letter'`
- Expected outcome: `'[AI STUB]'` text is visible within 15 seconds; screenshot saved. Source of truth: user description ("create cover letter from the job description") + plan stub spec.
- Interactions: `POST /api/v1/ai/cover-letter`, `CoverLetterPage` component

**52. Copy to Clipboard button copies cover letter text**
- Type: scenario
- Disposition: new
- Harness: H3
- Preconditions: cover letter has been generated (Test 51 precondition)
- Actions: grant clipboard permissions; click `'Copy to Clipboard'`
- Expected outcome: `navigator.clipboard.readText()` returns a non-empty string; screenshot saved. Source of truth: user description ("downloadable/copyable").
- Interactions: browser Clipboard API, `CoverLetterPage` copy handler

---

#### Invariant Tests (E2E)

**53. Index.md is always updated after any project mutation (invariant via E2E)**
- Type: invariant
- Disposition: new
- Harness: H3
- Preconditions: no projects exist; app at `/`
- Actions: create a project via the UI (upload or create); navigate to `/index`
- Expected outcome: the new project's slug appears in the rendered index within 5 seconds. Source of truth: plan Key Invariant 2 ("index.md is regenerated whenever a project file is created, updated, or deleted").
- Interactions: project creation route, `IndexStore.regenerateIndex`, `IndexPage`

**54. Navigation links reach all five pages without 404 or blank screen**
- Type: invariant
- Disposition: new
- Harness: H3
- Preconditions: app running
- Actions: click each nav link: Projects, Upload Resume, Index, Job Match, Cover Letter
- Expected outcome: each page renders its heading or primary content element without a console error or blank screen. Source of truth: plan `App.tsx` route definitions.
- Interactions: React Router, all five page components

---

### Tier 4: Optional Live AI Smoke Tests (H4 — guarded by `AI_API_KEY`)

These tests only run when `AI_API_KEY` and `AI_PROVIDER` are set in the environment. They are NOT required for CI to be green.

**55. AI update with real provider returns non-empty, non-error string**
- Type: integration
- Disposition: new
- Harness: H4
- Preconditions: `AI_PROVIDER=anthropic|openai`; `AI_API_KEY` set; project `'smoke-test'` seeded
- Actions: inject `POST /api/v1/ai/update/smoke-test` with `{ instruction: 'Add a one-sentence summary.' }`
- Expected outcome: status 200; body `content` is a non-empty string not starting with `'Error'` or `'[AI STUB]'`. Source of truth: plan AI provider interface contract.
- Interactions: real Anthropic/OpenAI API

**56. Cover letter with real provider returns non-empty string**
- Type: integration
- Disposition: new
- Harness: H4
- Preconditions: `AI_PROVIDER` and `AI_API_KEY` set
- Actions: inject `POST /api/v1/ai/cover-letter` with a short job description
- Expected outcome: status 200; body `coverLetter` is a non-empty string. Source of truth: plan cover letter response format.
- Interactions: real Anthropic/OpenAI API; `IndexStore.getIndex`

---

## Coverage Summary

### Action Space Covered

| Surface | Actions | Covered by |
|---|---|---|
| ProjectStore | create, read, update, delete, list, slug collision | Tests 1–8 (H1) |
| IndexStore | getIndex, regenerateIndex, keyword extraction | Tests 9–12 (H1) |
| Resume parser | plain-text parse, empty buffer, non-resume text | Tests 13–16 (H1) |
| Matching algorithm | full match, zero match, partial Jaccard, sort, keyword sets | Tests 17–21 (H1) |
| AI factory | stub creation, undefined provider | Tests 22–23 (H1) |
| `POST /projects` | create + index side-effect | Tests 24–25 (H2) |
| `GET /projects` | list | Test 26 (H2) |
| `GET /projects/:slug` | get content, 404 | Tests 27–28 (H2) |
| `PUT /projects/:slug` | update + index side-effect | Test 29 (H2) |
| `DELETE /projects/:slug` | delete, 204, subsequent 404 | Test 30 (H2) |
| `POST /projects/upload` | route reachability invariant | Test 31 (H2) |
| `POST /resume/parse` | structured result, 400 | Tests 32–33 (H2) |
| `GET /index` | current content | Test 34 (H2) |
| `POST /index/regenerate` | regenerate + return | Test 35 (H2) |
| `POST /ai/update/:slug` | stub update, 404, 400 | Tests 36–38 (H2) |
| `POST /ai/cover-letter` | stub cover letter | Test 39 (H2) |
| `POST /match` | full match result | Test 40 (H2) |
| Upload markdown UI | upload → file list | Test 41 (H3) |
| View project content | click → editor | Test 42 (H3) |
| Upload resume UI | parse → sections | Test 43 (H3) |
| Add section as project | button → navigate | Test 44 (H3) |
| Edit + save project | save persists | Test 45 (H3) |
| AI update UI | dialog → [AI STUB] in editor | Test 46 (H3) |
| Index page render | keywords visible | Test 47 (H3) |
| Regenerate index button | triggers refresh | Test 48 (H3) |
| Job match UI | paste → score + project list | Test 49 (H3) |
| Job match zero result | empty job desc → score 0 | Test 50 (H3) |
| Cover letter generate | generate → [AI STUB] visible | Test 51 (H3) |
| Cover letter copy | copy → clipboard non-empty | Test 52 (H3) |
| Index-sync invariant (E2E) | create project → index updated | Test 53 (H3) |
| Navigation invariant | all 5 nav links reachable | Test 54 (H3) |
| Real AI update | live provider smoke | Test 55 (H4, optional) |
| Real cover letter | live provider smoke | Test 56 (H4, optional) |

### Explicitly Excluded

- **PDF resume parsing fidelity beyond the plain-text fixture:** The plan notes this as a known residual risk. PDF parsing with exotic layouts is not covered by automated test fixtures; real-world PDF samples would be needed.
- **Concurrent write behavior:** The plan documents this as a known limitation (single-user, no locking). No concurrency tests are included.
- **AI provider switching at runtime:** Provider is resolved at startup. Restart behavior is not tested.
- **Visual regression baselines / screenshot diffing:** Screenshots are captured per test as diagnostic artifacts but not compared against committed baselines (no snapshot tool is included in the stack). This is a gap; if visual regressions become a concern, Playwright's built-in snapshot feature can be added.
- **Frontend unit tests (React Testing Library):** The plan does not scaffold RTL tests for individual components, and the agreed strategy de-prioritizes unit tests that only verify internal consistency. Component behavior is fully covered at the E2E level.

### Risk Summary

- **Residual risk (medium):** PDF parsing correctness depends on `pdf-parse` heuristics and the fixture quality. If users upload PDFs with unusual formats, the parser may produce unexpected output that unit tests miss.
- **Residual risk (low):** The `upload` route ordering invariant (Test 31) verifies the route is registered, but does not test a full multipart round-trip for markdown upload in the HTTP integration tier — this is covered at the E2E tier (Test 41) instead.
- **Residual risk (low):** Visual regressions in the markdown preview or index render are not caught automatically — screenshot review would catch them, but automated diffing is not set up.
