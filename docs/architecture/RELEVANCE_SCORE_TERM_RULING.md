# Ruling: what `relevanceScore` means

**Status:** Accepted — WIC-1519 / WIC-1813, Business Analyst, 2026-08-30.
Measured against `origin/main` @ `a46c63a`.

WIC-1519 asked a terminological question: `relevanceScore` names two fields shipping two
different units, so *are these two concepts with two names, or one concept with one unit?*
This document answers it, and records one thing the answer does **not** fix.

It is deliberately short. The full rationale for the unit convention is
[ADR-008](adr/ADR-008-score-and-rate-unit-convention.md), and this ruling does not restate it.

---

## 1. The ruling was already made — in flight, not on `main`

Before ruling I checked whether the decision existed. It does. ADR-008 answers WIC-1519's
question directly, and a four-PR stack implements it end to end:

| PR | Branch | What it carries |
|---|---|---|
| [#166](https://github.com/wickidcool/job-app-management/pull/166) | `fix/wic1516-unit-convention` | ADR-008, `Ratio`/`Percent` brands, contract + spec corrections |
| [#167](https://github.com/wickidcool/job-app-management/pull/167) | `fix/wic1521-web-unit-adoption` | `StarEntryPicker` reads `[0,1]`, with tests |
| [#168](https://github.com/wickidcool/job-app-management/pull/168) | `fix/wic1521-prep-relevance-pct` | web adopts `relevanceScorePct` |
| [#249](https://github.com/wickidcool/job-app-management/pull/249) | `fix/wic1520-relevance-score-pct` | API + DB rename, migration `0020` |

**None of it is on `main`.** At `a46c63a` there is no `packages/api/src/types/units.ts`, no
`packages/web/src/types/units.ts`, and no `ADR-008`. WIC-1519's own premise — "WIC-1514's brand
would make the mismatch a compile error" — is therefore not true of `main` today. The four PRs
are open and `MERGEABLE`; the gate is merge, not authorship.

**So this ruling ratifies ADR-008 rather than competing with it.** Anyone landing a fifth
opinion here should not: the decision is written, and a second source of record for the same
term is the defect WIC-1519 is about.

## 2. The answer: one concept, one unit, and the deviant carries its unit in its name

Not "two concepts with two names". *Relevance* is one concept — how well a piece of the user's
history matches a job — measured over two populations. The unit is unified, and the population
that cannot adopt it is renamed:

| Term | Type | Range | Population |
|---|---|---|---|
| **`relevanceScore`** | `Ratio` | `[0, 1]`, real | Job-fit, resume-variant, and catalog bullets |
| **`relevanceScorePct`** | `Percent` | `[0, 100]`, integer | Interview-prep stories only |

`relevanceScore` — **the fraction of a job's requirements a bullet matches.** Deterministic and
computed per request: `job-fit.service.ts:882-883` is `Math.min(1, matchedTerms.length /
totalRequired)` and `resume-variant.service.ts:155` is `Math.min(matched.length /
Math.max(keywords.length, 1), 1)`. It has a denominator, so it *is* a ratio by construction
rather than by convention. Never persisted.

`relevanceScorePct` — **an LLM's holistic judgement of how well a STAR story fits a job.**
Not a fraction of anything: the prompt at `interviewPrep.service.ts:315` asks for a
`<0-100 integer>`, the result is clamped at `:548`, and it is stored in
`interview_prep_stories.relevance_score`, which is `integer().notNull()` (`schema.ts:708`).

**Why the deviation is legitimate rather than sloppy.** A `[0,1]` ratio cannot survive that
column — `0.85` rounds to `1`. Unifying downward would mean an LLM contract change plus a
column-type migration to buy nothing; unifying upward would mean multiplying a genuine fraction
by 100 and overstating its precision. Two units is the right answer here, which is exactly why
ADR-008 §2 makes the unit part of the *name* instead of a comment. The `Pct` suffix is what
keeps this from being the same trap under new management.

Both prior declarations are wrong-by-omission and are corrected in the stack:
`API_CONTRACTS.md:1434` (`// 0-1`) and `:2762` (`// 0-100`) declare the same identifier in
opposite units in one document, and `COMPONENT_SPECS.md:2406` annotates `CatalogEntry` as
`// 0-100, from fit analysis` — naming a producer that provably emits `[0,1]`. That single
contradictory line is what `StarEntryPicker` faithfully implemented.

## 3. `CatalogEntry.relevanceScore` — keep the field; the blocker is not the unit

WIC-1519 §3 asked whether to **populate `CatalogEntry.relevanceScore` or delete it**. This is
the one clause the PR stack leaves open — #249 states plainly that `CatalogEntry.relevanceScore`
is "correctly untouched", and at the stack tip `catalog.service.ts:512` still reads
`relevanceScore: undefined`.

**Ruling: keep it, typed `Ratio`.** Deleting it would revert work #167 has already paid for and
tested, to save two lines. It belongs to the `[0,1]` population by provenance.

**But "populate it" is not the small join it looks like, and that is the finding here.** The
data to populate it from does not exist to be read:

- There is **no job-fit analyses table** in `schema.ts`. Not one of the 21 tables stores an analysis.
- `AnalyzeJobFitResponse` (`types/index.ts:260`) has **no `id` field**, and `POST
  /catalog/job-fit/analyze` (`catalog.routes.ts:332`) persists nothing — it computes and returns.
- `jobFitAnalysisId` is never resolved to stored data anywhere in the API. Its only substantive
  uses are `cover-letter.service.ts:217` and `resume-variant.service.ts:355`, both of which
  interpolate it into an LLM prompt as the literal string `` `Job Fit Analysis ID: ${id}` ``.

So the `fitAnalysisId` that `CoverLetterNew.tsx:65` reads from the query string is a **phantom
identifier** — no endpoint can have produced it and no endpoint can dereference it. Populating
`CatalogEntry.relevanceScore` "from the fit analysis" therefore requires first persisting job-fit
analyses: a table, a `GET` by id, and tenancy plus retention decisions. That is a feature, not
the fix WIC-1519 imagined, and it should be scoped as one before anyone tries.

**Consequence today.** The "Recommended" section of `StarEntryPicker` is structurally
unreachable — `recommendedEntries` requires `relevanceScore != null`, which its sole producer
never sets. It is dead rather than wrong: the heading is guarded by `recommendedEntries.length >
0`, so nothing renders an empty section and no user sees a fault. `showRecommended={!!fitAnalysisId}`
(`CoverLetterGenerator.tsx:333`) reads like a live gate and is not one.

This is the *delivered-but-unreachable* class, not the undefined-term class WIC-1519 filed it
under, and it survives the entire unit ruling untouched.

## 4. What this ruling does not decide

- **Whether to persist job-fit analyses.** Named above as the prerequisite; filed separately.
- **The `Ratio` brand's reach.** Per ADR-008 §3 the brand is checked on assignment only —
  arithmetic, template interpolation and `JSON.stringify` all erase it, so it cannot defend
  `score >= 80` or `` {`${score}%`} ``. Tests, not types, pin those.
