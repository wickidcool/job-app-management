# ADR-008: Unit Convention for Normalized Scores and Rates

## Status

Proposed — WIC-1516

Supersedes nothing. Referenced by [API_CONTRACTS.md](../API_CONTRACTS.md) ("Units: normalized
scores and rates") and [COMPONENT_SPECS.md](../../design/COMPONENT_SPECS.md).

## Context

The corpus has no unit convention for normalized scores and rates, and the absence is not
theoretical — it has already produced one shipped user-visible fault and one latent one.

### The field that is declared both ways in one document

`relevanceScore` is defined twice inside `docs/architecture/API_CONTRACTS.md`, in opposite
units, with nothing to say which is authoritative:

| Site | Declaration |
|---|---|
| `API_CONTRACTS.md:1399` | `relevanceScore: number;  // 0-1, how relevant to this JD` |
| `API_CONTRACTS.md:2279` | `relevanceScore: number;  // 0-100 match to job requirements` |

`docs/design/COMPONENT_SPECS.md` then annotates `// 0-100` at all six of its declarations
(`:1087, :2239, :2569, :2820, :3158, :3447`), while `packages/web/src/types/jobFit.ts:77`
annotates `// 0-1`. Five of those six COMPONENT_SPECS sites describe the **0-1** population and
are therefore simply wrong against shipped code (see below).

### Two live populations under one field name

Traced against `origin/main` @ `45d70f6`. Each population is internally consistent, which is why
neither has produced a fault *yet*. That is luck, not design — nothing in the type system
prevents a value from one crossing into a consumer written for the other.

| Population | Produced | Consumed | Unit | Accepted spec |
|---|---|---|---|---|
| Job-fit / resume-variant bullets | `job-fit.service.ts:853`, `resume-variant.service.ts:874` (`Math.round(x*100)/100`) | `JobFitAnalysis.tsx:289` (`Math.round(score * 100)` + `%`) | **0-1** | **Yes** — UC-3, `WIC-113.plan.md:227` |
| Interview-prep stories | `interviewPrep.service.ts:278` (prompt asks for `<0-100 integer>`), clamped `:506`, stored `integer` (`schema.ts:708`) | `STARStoryBank.tsx:159`, `QuestionsList.tsx:242`, `GapMitigationPanel.tsx:253`, `QuickReferenceExport.tsx:124`, `InterviewPrepPage.tsx:231` | **0-100** | **No** |

`WIC-113.plan.md:227` is the corpus's only *accepted* definition of `relevanceScore`, and it
fixes 0-1. The interview-prep population contradicts it under the same field name.

### The two faults this has already caused

1. **Shipped and user-visible (WIC-1514).** `dashboard.service.ts:64,98` computes
   `responded / totalApplied` and returns it rounded to two decimals — a ratio.
   `packages/web/src/types/application.ts:44` and `DashboardStats.tsx:5` both declare
   `responseRate: number; // 0-100` and render the value raw. A 75% response rate renders as
   **1%**. The producer and the consumer disagreed about the unit, and `number` could not tell
   them apart.

2. **Latent, primed to fire (this card).** `StarEntryPicker.tsx:24-25,191` splits on
   `relevanceScore >= 80` and renders `{score}%` — both assuming 0-100 — on a `CatalogEntry`
   whose only producer, `catalog.service.ts:428`, currently hardcodes `relevanceScore:
   undefined`. `CatalogEntry` belongs to the **0-1** job-fit population
   (`api/src/types/index.ts:412`). The day that field is populated from the job-fit path, every
   entry scores below `0.8 < 80`, no entry is ever "recommended", and every badge renders
   `0.85%`.

### Why comments were the load-bearing artifact

In every instance above, the only thing distinguishing the two units was a `//` comment. A
comment is not checked by anything. `relevanceScore: number` and `relevanceScore: number` are
the same type to `tsc`, so the compiler assigns one population to the other silently. The
corpus proves the comments themselves drift: `API_CONTRACTS.md` contradicts itself, and
`COMPONENT_SPECS.md` is wrong at five of six sites.

The same shape recurs one field over: `API_CONTRACTS.md:929` `confidence?: number // 0–1, match
confidence` and `COMPONENT_SPECS.md:1075` `matchConfidence: number // 0-100` are the same
quantity under two names in two units.

And `API_CONTRACTS.md:557` — `responseRate: number; // 0-1, percentage of applications with
response` — annotates a **ratio** with the word *percentage*. That is the exact confusion
WIC-1514 documents in shipped code, written into the contract that the code was built from.

## Decision

### 1. Ratios at the API boundary

**Every normalized score, rate, fraction, and proportion crossing the API boundary is a ratio in
`[0, 1]`.** The presentation layer multiplies by 100 and appends `%`. Producers do not
pre-multiply, and consumers do not assume they have.

This direction, rather than the reverse, because:

- It is what the only accepted spec says (`WIC-113.plan.md:227`, UC-3).
- It is what the majority of shipped producers already do — `job-fit.service.ts:853`,
  `resume-variant.service.ts:874`, `dashboard.service.ts:98`. Only `interviewPrep.service.ts`
  dissents.
- A ratio is the unit-free form. `0.85` composes, averages, and multiplies correctly; `85`
  silently produces `7225` when squared and `170` when two are summed.
- Percent is a *display* concern, and display is where the multiplication belongs.
- **Only the ratio side can be range-checked at runtime.** `[0, 1]` is a subset of `[0, 100]`,
  so a percent field handed `0.85` by mistake passes every validation and renders `0.85%`; a
  ratio field handed `85` cannot. Putting the boundary at `[0, 1]` is therefore the direction
  in which a wrong unit is *detectable* without types. This asymmetry is asserted as a test
  (`packages/api/test/units.test.ts`, "the check is one-sided") so it is not rediscovered.

### 2. A field whose unit deviates carries the unit in its name

Any field that is not a `[0, 1]` ratio **carries its unit as a name suffix** — `relevanceScorePct`,
`completenessPct` — not as a comment. Comments are unenforceable and have already drifted at
every site audited. The suffix is `Pct` for `[0, 100]`.

This makes a deviation visible at every call site, in every IDE, in every diff, without
consulting a document.

### 3. `Ratio` and `Percent` are branded types

Acceptance criteria alone cannot hold this line, because the failure mode is two `number`s a
compiler cannot distinguish. The unit is branded into the type:

```ts
export type Ratio = number & { readonly __unit: 'ratio-0-1' };
export type Percent = number & { readonly __unit: 'percent-0-100' };
```

with explicit, checked constructors and one conversion in each direction
(`packages/api/src/types/units.ts`, mirrored at `packages/web/src/types/units.ts`). `Ratio` and
`Percent` are then mutually non-assignable, and a bare `number` is assignable to neither — so a
conversion has to be written down. The reverse direction stays open on purpose: both brands
remain assignable *to* `number`, which is what keeps ordinary arithmetic working (and is also
why the brand does not survive it — see below).

**What the brand actually catches is _assignment_, and only assignment.** Arithmetic and
rendering both erase the brand: `Ratio` is assignable to `number`, so `score >= 80` is a
well-typed relational comparison, and `{score}%` in JSX is a well-typed `ReactNode`. Both
compile. Measured against `packages/web/tsconfig.app.json` at this ADR's own commit — a probe
containing exactly those two expressions produced no error, while a bare `number` passed to
`formatRatioAsPercent` produced `TS2345` in the same run.

This matters because it is the *cross-layer assignment* — a `Percent`, or a bare `number` off a
wire parse, landing in a `Ratio` field — that carries the defect class this ADR exists to stop.
That is real and it is what the brand is for. It is not a general guarantee that a mis-united
value cannot be *used*.

Scope of what this catches, stated so the type is not mistaken for full coverage:

- **Catches WIC-1514.** `DashboardStats` would have to accept a `Percent`; `dashboard.service.ts`
  returns a `Ratio`; the assignment fails to compile.
- **Catches the `StarEntryPicker` instance _at its assignment_, not at its uses.** Typing
  `entry.relevanceScore` as `Ratio` makes it a compile error to populate that field from the
  0-100 interview-prep population — which is the day the latent bug fires. It does **not** make
  the existing `>= 80` split or the raw `{score}%` render type errors; both compile, as above.
  - A **render** can be forced to a compile error, but only by routing it through a function
    that takes the brand: `formatRatioAsPercent(r: Ratio)`. Deleting the brand then yields
    `TS2345` at the call site. Treat that as a design instruction — *convert through `units.ts`,
    never with a hand-written `* 100`* — and not as a property of the type.
  - A **threshold** has no such mechanism. Nothing in the type system distinguishes `>= 0.8`
    from `>= 80`. That line is held by a test and only by a test, so **a field that carries a
    threshold needs one**; typing it is not a substitute.
- **Does not catch WIC-1515.** That is a *semantic* disagreement about what the metric counts,
  not a unit disagreement. Both sides would be `Ratio` and both would compile. Branding units
  does not brand meaning.
- **Does not catch values crossing the wire.** JSON has no brands. The boundary where a
  `Ratio` is *constructed* from a parsed response is a deliberate, reviewable cast — which is
  the point: there is exactly one such site per DTO instead of an assumption at every use.

Adoption is incremental. New and touched fields are branded; a bare `number` remains legal so
this does not require a big-bang refactor to land.

### 4. The interview-prep population is renamed, not converted

`PrepStory.relevanceScore` (0-100) becomes **`relevanceScorePct`**, per §2. It is not converted
to a ratio, because:

- It is persisted as `integer('relevance_score')` (`schema.ts:708`). Converting the unit means a
  column type change plus a backfill of existing rows — a data migration with a failure mode
  (half-migrated table, values that are ambiguous between the two readings for `0` and `1`)
  strictly worse than the naming problem it solves.
- It is generated by an LLM prompt that asks for `<0-100 integer>` (`interviewPrep.service.ts:278`)
  and clamped to that range (`:506`). An integer 0-100 is a better-conditioned ask of a model
  than a two-decimal ratio, and re-tuning the prompt is unnecessary risk.
- The rename is value-preserving. `ALTER TABLE ... RENAME COLUMN` moves no data.

The five 0-100 annotations in `COMPONENT_SPECS.md` that describe the **job-fit** population
(`:1087`, `:2239`, `:2569`, `:2820`, and the unannotated `:3158`) are corrected to `0-1` — they
were wrong against shipped code, not describing a second convention. Only `:3447`
(`STARStoryBank`, interview-prep) is a genuine 0-100 site and takes the rename.

Likewise `matchConfidence` (`COMPONENT_SPECS.md:1075`) is reconciled to `confidence: Ratio`,
matching `API_CONTRACTS.md:929` and the API that actually produces it.

### 5. "percentage" never annotates a `[0, 1]` field

`API_CONTRACTS.md:557` is corrected to say *ratio*. The word "percentage" in a comment on a
ratio is worse than no comment, because it actively asserts the wrong unit.

## Consequences

**Positive**

- One rule, stated once, that covers every score and rate rather than a per-field comment.
- The deviation cases are self-describing at the call site (`Pct` suffix) instead of requiring a
  document lookup.
- The two defect classes above become compile errors *at the assignment* once the branded types
  are adopted at the affected boundaries — which is the point at which a wrong-unit value enters
  a field. Uses of an already-wrong value (thresholds especially) still need a test; §3.
- Ratios compose arithmetically; percents do not.

**Negative / costs**

- `relevanceScorePct` is a breaking wire change for the interview-prep endpoints. It needs a
  coordinated backend + frontend landing (WIC-1516 children) and a DB migration.
- Branded types add a construction ceremony at parse boundaries. This is deliberate — the
  ceremony is where the unit assertion becomes reviewable — but it is real friction.
- Adoption is incremental, so for a period the corpus contains both branded and bare `number`
  scores. The `Pct` suffix rule applies immediately and independently, so the naming signal is
  available before the types are.

**Not addressed here**

- Semantic disagreements about what a metric counts (WIC-1515). A separate class of defect
  needing a separate mechanism — a definition, not a type.
- Currency, duration, and byte-size units. The same branding technique would apply; no defect
  has been observed, so no rule is asserted.
- **`completeness` (0-100, interview prep — `API_CONTRACTS.md:2301`, `DATA_MODEL.md:869`) is a
  known, deliberate conformance gap.** It deviates from §1 and does not carry the `Pct` suffix
  §2 would require. It is not renamed here because no defect has been observed against it, the
  same quantity already appears under a conforming name elsewhere (`completionPercentage`,
  `PERSONAL_INFO_API.md:155`), and renaming it is a further breaking wire change across
  `completeness`, `completenessChange` and a persisted column for no measured benefit. It is
  recorded in the API_CONTRACTS.md deviations table so it reads as a decision rather than an
  oversight. New code does not get this latitude.

## Implementation

| Item | AC | Where |
|---|---|---|
| Convention preamble | AC-T3a | `API_CONTRACTS.md` "Units: normalized scores and rates"; referenced from `COMPONENT_SPECS.md` |
| Unit-in-name rule | AC-T3b | This ADR §2; applied at every deviating declaration |
| Doc reconciliation of `relevanceScore` | AC-T3c (docs) | `API_CONTRACTS.md:2279`, `COMPONENT_SPECS.md` ×6, `matchConfidence` |
| Code reconciliation of `relevanceScore` | AC-T3c (code) | Delegated — backend rename + migration, frontend consumers |
| "percentage" ≠ ratio | AC-T3d | `API_CONTRACTS.md:557`; corpus swept, one site |
| Branded `Ratio` / `Percent` | Enforcement | `packages/api/src/types/units.ts`, `packages/web/src/types/units.ts` |

## Related

- **WIC-1514** — live instance, Dashboard "Response" stat renders 1% for a 75% rate.
- **WIC-1515** — sibling metric defect; semantic, explicitly *not* covered by §3.
- **WIC-1479** — same undefined-term class (two definitions of "stale").
- **WIC-15 US-6.3** — plan document `term-definition-audit` §5–6, the audit behind this ADR.
- Method: WIC-1353 / WIC-1430 / WIC-1480.
