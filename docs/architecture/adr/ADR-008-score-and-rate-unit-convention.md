# ADR-008: Unit Convention for Normalized Scores and Rates

## Status

**Accepted** (2026-09-01) — proposed 2026-08-26, WIC-1516.

Binding on every normalized score, rate, fraction and proportion that is newly written or
touched. Implemented and enforced in the tree:

| What landed | Where |
|---|---|
| The convention, the `Pct` suffix rule, the branded `Ratio` / `Percent` types, and the doc reconciliation | `38b4cc8e`, merged as PR #166 (`bc0bd8b1`) |
| Backend rename `relevance_score` → `relevance_score_pct` and migration `0020_prep_relevance_score_pct.sql` | PR #249 (`b64c743c`), WIC-1520 |
| Frontend consumers reading `relevanceScorePct: Percent` | PR #168 (`2c3b1ba3`), WIC-1521 |

The defect this ADR exists for is closed at its own boundary: `responseRate` is declared `Ratio`
at all four of its `packages/web` declarations and rendered through `toPercent`, so the
`Percent`-into-`Ratio` assignment that produced WIC-1514 no longer type-checks. Adoption on the
API-side DTOs is still incremental, exactly as §3 provides for — a bare `number` remains legal
there and is not a conformance gap. The one standing deviation, `completeness`, is recorded under
*Not addressed here* and in the API_CONTRACTS deviations table, so it reads as a decision.

**Why this is `Accepted` rather than "accepted once the last residual closes."** A `Status` line
records whether the decision *binds*, not whether every cleanup derived from it has landed — two
questions that move on different clocks. This ADR's rule governed the corpus from `38b4cc8e`
onward while §5's own last violation stood on `main` for six days after it (see the correction in
§5). Anyone reading `Status` in that window to decide how to unit a new field would have been
told the convention was not yet binding: a denial, and the more expensive direction of error,
because an overclaim invites a reader to check while a denial tells them not to look. Residual
conformance work is tracked in the Implementation table below, and does not hold this line
hostage.

Supersedes nothing. Referenced by [API_CONTRACTS.md](../API_CONTRACTS.md) ("Units: normalized
scores and rates") and [COMPONENT_SPECS.md](../../design/COMPONENT_SPECS.md).

## Context

The corpus has no unit convention for normalized scores and rates, and the absence is not
theoretical — it has already produced one shipped user-visible fault and one latent one.

> **Read this whole section as evidence pinned to `origin/main` @ `45d70f6` (2026-08-26), not as
> live pointers.** Every `file:line` below described the tree as it stood when the defect was
> traced, and the tree has since moved under all of them — the two faults were fixed, the six
> `COMPONENT_SPECS.md` annotations were corrected, and the interview-prep field was renamed. Do
> not "repair" these numbers to today's: re-pointing them would misreport what was measured. Check
> a Context citation by reading `45d70f6`, and read the Decision and Implementation sections below
> for what is true now. *(Pin widened from the "Two live populations" table to the whole section,
> 2026-09-01 — the numbers outside that table had rotted with nothing marking them as historical.)*

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

- It is what the only accepted spec says (UC-3, `WIC-113` plan document — a board artifact, not a
  path in this repo).
- It is what the majority of shipped producers already do: each rounds to two decimals with
  `Math.round(x * 100) / 100` and emits `[0, 1]` — `job-fit.service.ts` (`relevanceScore` on the
  recommended-bullet map), `resume-variant.service.ts` (`relevanceScore` on the scored-bullet
  map), and `dashboard.service.ts` (`responseRate`, computed as `responded / totalApplied`). Only
  `interviewPrep.service.ts` dissents.
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

with explicit constructors and one conversion in each direction
(`packages/api/src/types/units.ts`, mirrored at `packages/web/src/types/units.ts`). Three of the
four constructors check: `ratio()` throws, `clampRatio()` folds into range, and `ratioFromWire()`
validates at a trust boundary. The fourth, `asRatio()`, deliberately does not — it is a bare
assertion for values entering the type system for the first time, where checking a literal `0`
would be noise. It is the weakest of the four and the one to reach for last; WIC-1514 arrived
through an *unbranded* passthrough, not a mis-asserted one, so the assertion is a cost the
convention accepts rather than a hole it leaves open. `Ratio` and
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

- It was persisted as `integer('relevance_score')` on `interviewPrepStories` (`schema.ts`).
  Converting the unit means a column type change plus a backfill of existing rows — a data
  migration with a failure mode (half-migrated table, values that are ambiguous between the two
  readings for `0` and `1`) strictly worse than the naming problem it solves.
- It is generated by an LLM prompt that asks for `<0-100 integer>` and clamped to that range in
  `interviewPrep.service.ts`. An integer 0-100 is a better-conditioned ask of a model than a
  two-decimal ratio, and re-tuning the prompt is unnecessary risk.
- The rename is value-preserving. `ALTER TABLE ... RENAME COLUMN` moves no data.

The six 0-100 annotations in `COMPONENT_SPECS.md` are reconciled: the five describing the
**job-fit** and **resume-variant** populations are corrected to `Ratio in [0,1]` — they were wrong
against shipped code, not describing a second convention — and the one genuine 0-100 site,
`STARStoryBank`, takes the rename to `relevanceScorePct`.

Likewise `matchConfidence` in `COMPONENT_SPECS.md` is reconciled to `confidence` as a ratio,
matching `API_CONTRACTS.md` and the API that actually produces it.

> **Shipped, 2026-09-01.** This section was written prospectively and its verbs are left in that
> mood, but the work has landed and can be read in the tree rather than inferred from here:
>
> - **Backend + migration** — PR #249 (`b64c743c`, WIC-1520). Column `relevance_score` →
>   `relevance_score_pct` by `ALTER TABLE ... RENAME COLUMN` in migration
>   `0020_prep_relevance_score_pct.sql`; wire field `relevanceScorePct`; the clamp is now
>   `clampPercent` from `types/units.ts`, so the range bound and the brand are the same call.
> - **Frontend consumers** — PR #168 (`2c3b1ba3`, WIC-1521). `PrepStory.relevanceScorePct` is
>   declared `Percent` in `types/interviewPrep.ts` and read under that name in `STARStoryBank`,
>   `QuestionsList`, `GapMitigationPanel`, `QuickReferenceExport` and `InterviewPrepPage`.
> - **Both brands exist** — `Ratio` and `Percent` in `packages/api/src/types/units.ts` and
>   `packages/web/src/types/units.ts`, with `toPercent` / `toRatio` as the only conversions.
> - **The latent `StarEntryPicker` fault in the Context section is fixed too** — it now thresholds
>   on the ratio and renders through `formatRatioAsPercent`.
>
> **The `file:line` citations that stood here have been replaced with symbol names because every
> one of them had rotted.** Checked 2026-09-01: `schema.ts:708` still resolved to the right line
> but to the *renamed* column, contradicting the sentence citing it, while
> `interviewPrep.service.ts:278` and `:506` and all six `COMPONENT_SPECS.md` numbers landed on
> unrelated text — box-drawing characters, blank lines, a `### Performance Considerations`
> heading. A line number in a Decision section is a claim about a file that is still being edited;
> `doc-reference-audit.py` resolves the filename and cannot see the number, so nothing catches the
> drift. Cite the symbol.

### 5. "percentage" never annotates a `[0, 1]` field

The `responseRate` declaration this ADR was written against is corrected to say *ratio*. The word
"percentage" in a comment on a ratio is worse than no comment, because it actively asserts the
wrong unit.

> **Correction, 2026-09-01 — the sweep this section claimed was complete was undone 31 minutes
> after it landed, and the second copy stood on `main` for six days.** This paragraph used to end
> *"`API_CONTRACTS.md:557`; corpus swept, one site"* (and the Implementation table said the same).
> That was true for about half an hour. `38b4cc8e` (2026-08-26 17:26:59Z) wrote the rule above and
> deleted the single offending annotation in the same commit. `8433ff2f` (17:58:05Z), whose subject
> is *"say what the brand actually guards, and unit the second declaration"*, then annotated the
> **second** `responseRate` declaration — `DashboardStats` — by copying the wording the ADR had
> just retracted: `// 0-1, percentage of applications with response`, byte-identical to the string
> `38b4cc8e` removed.
>
> So the corpus had **two** sites, not one, and the surviving one was the declaration that governs
> the dashboard stat whose mis-unit *is* WIC-1514 — a 75% response rate rendering as `1%`. The
> contract re-asserted the wrong unit on precisely the field the ADR exists because of. Fixed here;
> `DashboardStats.responseRate` now carries the same corrected annotation as its sibling.
>
> Two things generalise. **A retraction only protects the copy it is written next to** — the
> reverting commit was not careless, it was deliberately propagating an annotation to a second
> declaration and reached for the older wording because that is what the field had always said.
> And **a rule and its last known violation are not the same artifact**: this ADR stated the rule
> correctly for six days while `main` violated it. Sweep for the *string*, not for the rule.

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

- `relevanceScorePct` is a breaking wire change for the interview-prep endpoints, needing a
  coordinated backend + frontend landing (WIC-1516 children) and a DB migration. **That cost was
  paid on 2026-09-01** — PR #249 (`b64c743c`) and PR #168 (`2c3b1ba3`), landing 35 minutes apart;
  see the note under §4.
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
- **`completeness` (0-100, interview prep — `InterviewPrep` in `API_CONTRACTS.md`, the
  `interview_preps` table in `DATA_MODEL.md`) is a known, deliberate conformance gap.** It
  deviates from §1 and does not carry the `Pct` suffix §2 would require. It is not renamed here
  because no defect has been observed against it, the same quantity already appears under a
  conforming name elsewhere (`completionPercentage`, `PERSONAL_INFO_API.md`), and renaming it is
  a further breaking wire change across
  `completeness`, `completenessChange` and a persisted column for no measured benefit. It is
  recorded in the API_CONTRACTS.md deviations table so it reads as a decision rather than an
  oversight. New code does not get this latitude.

## Implementation

| Item | AC | Where |
|---|---|---|
| Convention preamble | AC-T3a | `API_CONTRACTS.md` "Units: normalized scores and rates"; referenced from `COMPONENT_SPECS.md` |
| Unit-in-name rule | AC-T3b | This ADR §2; applied at every deviating declaration |
| Doc reconciliation of `relevanceScore` | AC-T3c (docs) | `API_CONTRACTS.md` interview-prep declaration, `COMPONENT_SPECS.md` ×6, `matchConfidence` |
| Code reconciliation of `relevanceScore` | AC-T3c (code) | **Landed 2026-09-01** — PR #249 (`b64c743c`) backend + migration `0020`, PR #168 (`2c3b1ba3`) frontend consumers |
| "percentage" ≠ ratio | AC-T3d | **Two sites, not one.** Both `responseRate` declarations in `API_CONTRACTS.md`; the second was re-annotated with the retracted wording 31 min after this ADR landed and fixed 2026-09-01 — see §5 |
| Branded `Ratio` / `Percent` | Enforcement | `packages/api/src/types/units.ts`, `packages/web/src/types/units.ts` |

## Related

- **WIC-1514** — live instance, Dashboard "Response" stat renders 1% for a 75% rate.
- **WIC-1515** — sibling metric defect; semantic, explicitly *not* covered by §3.
- **WIC-1479** — same undefined-term class (two definitions of "stale").
- **WIC-15 US-6.3** — plan document `term-definition-audit` §5–6, the audit behind this ADR.
- Method: WIC-1353 / WIC-1430 / WIC-1480.
