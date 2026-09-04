# ADR-012: Job fit analyses are persisted

- **Status:** Accepted
- **Date:** 2026-08-30
- **Deciders:** Architect
- **Cards:** WIC-1809 (ruling), WIC-1652 (defect), WIC-1536 / PR #217 (the wiring that could not reach this)
- **Measured at:** `main` @ `a46c63a`

## Context

`WorkflowChecklist` exposes three props that no caller can supply truthfully —
`hasFitAnalysis`, `fitScore`, and the `recommended` badges on "Cover Letter" and
"Tailored Resume" that derive from `hasFitAnalysis`. WIC-1652 traced this to the
fact that **a job fit analysis is never stored**, and asked for a ruling: persist
the analysis, or delete the dead props and columns.

### What is actually on `main` @ `a46c63a`

- There is no `job_fit_analyses` table in `packages/api/src/db/schema.ts`.
  (`job_fit_tags` is unrelated — it is a user's tag vocabulary.)
- `POST /catalog/job-fit/analyze` (`catalog.routes.ts:332`) computes a result and
  returns it. It writes no row.
- `AnalyzeJobFitResponse` (`types/index.ts:260`) carries no id, so the caller
  cannot even name the analysis it just received.
- Four tables carry a bare `text('job_fit_analysis_id')` referencing nothing:
  `cover_letters` (`schema.ts:411`), `resume_variants` (`:431`),
  `outreach_messages` (`:531`), `interview_preps` (`:683`).

### Two facts that decide this, which WIC-1652 did not have

**1. The data model of record already specifies the table.** `DATA_MODEL.md:981`
gives the DDL for `interview_preps` as:

```sql
job_fit_analysis_id   TEXT REFERENCES job_fit_analyses(id) ON DELETE SET NULL,
```

and `DATA_MODEL.md:1128` lists the relationship `interview_preps → job_fit_analyses`,
`N:1 (optional)`. So `job_fit_analyses` is not a new idea being weighed here — it is
an **already-documented table that was never built**. The bare `text` columns are not
an association someone speculatively reserved; they are a specified FK that regressed
to `text` when the referent was skipped. Note the doc is itself half-finished: it
references the table in a foreign key and in the relationship index, but never defines
it. The direction is unambiguous even so.

**2. The id is not inert — it is load-bearing, and it is doing harm.** WIC-1652
described the columns as vestigial. They are not. `jobFitAnalysisId` is an accepted
**request** field on three generation endpoints, typed `z.string().optional()` with no
format or existence check, and because it can never be dereferenced it currently:

- **Satisfies `JOB_CONTEXT_REQUIRED`.** `cover-letter.service.ts:144-151` and
  `resume-variant.service.ts:211-218` accept `jobFitAnalysisId` as one of the three
  ways to supply job context.
- **Waives `TARGET_INFO_REQUIRED`.** `cover-letter.service.ts:164` and
  `resume-variant.service.ts:225` both read
  `if (!hasAnalysis && (!input.targetCompany || !input.targetRole)) throw`.
  Supplying an analysis id therefore removes the obligation to name the company and role.
- **Becomes the entire job-description context handed to the LLM.**
  `cover-letter.service.ts:217` — ``jdContext = `Job Fit Analysis ID: ${input.jobFitAnalysisId}` ``;
  `resume-variant.service.ts:355` — the same, `Job fit analysis ID: ${...}`.
- **Silently suppresses a quality warning.** `interviewPrep.service.ts:494` emits
  `NO_FIT_ANALYSIS` ("gaps may be incomplete") only when the field is absent. Any
  string turns the warning off; nothing ever reads the analysis.

Net effect on `main` today: `POST /cover-letters/generate` with
`{"jobFitAnalysisId": "x", "selectedStarEntryIds": [...]}` is accepted, skips both
guards, and generates a cover letter whose only job context is the literal string
`Job Fit Analysis ID: x`. This is a live output-quality defect, not dead code.

**3. The frontend already carries the association and the API drops it.**
`WorkflowChecklist` links to `/job-fit-analysis?appId={id}`; `JobFitAnalysis.tsx:23-24`
reads `appId` and loads the application. But `analyzeJobFitSchema`
(`catalog.routes.ts:127-131`) accepts only `jobDescriptionText | jobDescriptionUrl` —
there is nowhere to put the application. `analyzeJobFit()` does not even receive a
`userId`, only a `clientId` for rate limiting. The owning application is known in the
browser and discarded at the API boundary.

## Decision

**Persist job fit analyses.** Add a `job_fit_analyses` table with an id and an optional
owning application, return the id from `POST /catalog/job-fit/analyze`, and make the four
`job_fit_analysis_id` columns real foreign keys.

We do **not** remove the props and columns.

## Rationale

- **Removal contradicts the documented design.** `DATA_MODEL.md` specifies the FK and the
  relationship. Choosing removal means editing the architecture doc to delete a documented
  association across four tables, three request schemas, `API_CONTRACTS.md`,
  `UC-6_RESUME_VARIANT_API.md`, and both DTO layers. That is a larger and more destructive
  diff than adding the table, and it discards a design decision rather than completing it.
- **Removal is not the cheap option it appears to be.** Because `jobFitAnalysisId` waives
  `TARGET_INFO_REQUIRED`, deleting the field is a breaking change to two public endpoints:
  the guards must be restored unconditionally, which rejects requests that are valid today.
  Neither option is a pure deletion, so "cheaper" is not a tiebreaker.
- **The analysis is expensive and rate-limited.** `analyzeJobFit` is LLM-backed and returns
  `X-RateLimit-Remaining` / `X-RateLimit-Reset`. `JobFitAnalysis.tsx:26` holds the result in
  `useState` only, so a refresh destroys it and costs the user rate-limit budget to
  reproduce. Persistence is a product requirement in its own right, independent of the
  checklist.
- **It is the only option that fixes the quality defect properly.** Once the id resolves to a
  row, the three services can feed the real fit analysis to the LLM instead of interpolating
  an opaque identifier, and existence can be validated at the boundary.

## Consequences

### Required work

- **AC-1** — `job_fit_analyses` table: `id` (ULID PK), `user_id`, nullable
  `application_id` referencing `applications(id) ON DELETE CASCADE`, the analysis payload,
  and `created_at`. Written by `analyzeJobFit`. `applicationId` added to
  `analyzeJobFitSchema` as optional; `JobFitAnalysis.tsx` already has `appId` to send.
- **AC-2** — `AnalyzeJobFitResponse` gains `id`. `ApplicationDetail` resolves
  `hasFitAnalysis` / `fitScore` by listing analyses for the application; the step ticks with
  the real score.
- **AC-3** — the two `recommended` badges become reachable, pinned by a test.
- **AC-4** — the four `job_fit_analysis_id` columns become real FKs
  (`ON DELETE SET NULL`, matching `DATA_MODEL.md:981`). Existing values reference nothing and
  must be nulled in the migration before the constraint is added.
- **AC-5** *(new, from fact 2)* — validate `jobFitAnalysisId` exists and belongs to the
  caller in all three generation services; replace the interpolated-id `jdContext` with the
  stored analysis; make `interview_preps`' `NO_FIT_ANALYSIS` warning depend on a resolvable
  row rather than a non-empty string.

### Ordering

AC-5 is the only user-visible harm on `main` and does not depend on the checklist. It is
severable and should land first; it can be done as a boundary rejection (422 on an
unresolvable id) even before the table exists. AC-1 → AC-4 then unblock WIC-1652 and the
`hasFitAnalysis` half of WIC-1536 / PR #217.

### Costs accepted

- A migration that nulls existing `job_fit_analysis_id` values. Acceptable: every current
  value already references nothing, so no real association is lost.
- `AnalyzeJobFitResponse` gains a field — additive, not breaking.
- Analyses accumulate per user. No retention policy is set here; revisit if volume warrants.

### Not decided here

Whether an analysis should be unique per application, or whether a history of analyses per
application is kept. The listing in AC-2 works either way. Deferred to implementation.

## Alternatives considered

**Remove the props, the four columns, and the request field.** Defensible, and WIC-1652
presented it as an equal option. Rejected on the three grounds above: it contradicts
`DATA_MODEL.md`, it is a breaking API change rather than a deletion, and it leaves the
product's flagship analysis ephemeral and re-billable against a rate limit.

**Leave it.** Explicitly rejected by WIC-1652, and fact 2 makes it worse than that card
knew — the status quo actively degrades generated cover letters and resumes.
