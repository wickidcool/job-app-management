# Changelog

All notable changes to the Job Application Manager are documented here.

---

## [Unreleased]

> **Backfill note (2026-08-04):** Entries below reconstruct the shipped increments between UC-2 (2026-04-24) and the production launch. Each is grounded in merged commits, database migrations, and existing `docs/`. Reviewer to confirm scope and decide whether to cut a tagged production release (current `package.json` version is `0.1.0`) — the production analytics go-live below is a natural candidate for that first tag.

### Fixed — The six catalog list endpoints now return the documented envelope instead of a bare array (2026-08-26)

Every catalog list *service* computes a `nextCursor`; every catalog *route* destructured the items out and dropped it on the floor — `grep -n nextCursor src/routes/catalog.routes.ts` returned zero hits. So the shape was wrong twice over: an array where `API_CONTRACTS.md` specifies an object, and no cursor inside it. Pre-existing; found by the Code Reviewer on PR #119 (WIC-1336).

- **Six routes, five documented response types** — `ListDiffsResponse` (`:718`), `ListCompaniesResponse` (`:919`), `ListTagsResponse` (`:992`, serving both `/catalog/tags/job-fit` and `/catalog/tags/tech-stack`), `ListBulletsResponse` (`:1084`) and `ListThemesResponse` (`:1127`). The filing ticket cited three; tags and themes are specified too, so all six routes were divergent, not four. Each now returns the service result whole, as `/applications`, `/cover-letters` and `/resume-variants` already did. No documentation changed — the contract was already right and the code was wrong.
- **This mattered more after WIC-1312.** Before it, a bad catalog cursor silently served page one; after it, a `400` telling the caller to "pass back the `nextCursor` from a previous response verbatim." On these six a previous response never contained one, so the remedy the error offered could not be followed. The `400` was still correct — a hand-crafted `base64url(String(offset))` remains valid, so no correct client broke — but it pointed at a field that did not exist yet.
- **The breaking wire change was *not* free here, contrary to the ticket's expectation.** The argument that carried PR #111 (nothing consumes it) was checked rather than assumed, and it does not hold: `packages/web` consumes five of the six through `services/api/catalog.service.ts`, and `CatalogBrowseView.tsx` does `activeQuery.data || []` — an unwrapped object is truthy, so it would have reached `.map` and thrown rather than degrading. Only `/catalog/themes` has no client. The five are unwrapped at the web service layer, the seam `getStarEntries` already used for the `{ entries }` envelope, so hooks and components are untouched and the UI behaves exactly as before.
- **The regression guard is a *defined* cursor, because an undefined one proves nothing.** The pre-existing route tests already fed the services a `nextCursor: undefined` fixture, and `toEqual` treats an undefined property as absent — so `c.json({ diffs })` satisfied them, which is exactly how six routes shipped dropping the cursor under a green suite. Each of the six now mints a real cursor and requires it to survive the route. Confirmed by mutation: restoring the destructure at `/catalog/themes` fails precisely its two cases. A companion case counts the coverage table against the `catalog.service.ts` functions that actually mint a cursor, so a seventh list endpoint cannot land without a row (WIC-1335's lesson); dropping the themes row fails it. API suite: 418 passing, typecheck and lint clean.

### Fixed — Every paginated endpoint now rejects a malformed cursor, from one shared decoder (2026-08-25)

WIC-1308 fixed the unguarded base64url cursor decode in `reports.service.ts`. The identical decode was inlined, unguarded, at **nine more call sites across four services** — `catalog` (six), `application`, `cover-letter`, `resume-variant` — none of which had even the unreachable `try`/`catch` the reports version started with. Both failure modes carried over verbatim (WIC-1312).

- **Encoder and decoder now live together**, in `packages/api/src/lib/pagination.ts`. `encodeCursor` was copy-pasted at all twelve sites too; that every site could *mint* a cursor while only the reports trio could *reject* one is precisely how the guard came to be missing in nine places. The reports service now imports both rather than owning them.
- **Reject, not fall back — at all twelve sites, including the catalog ones.** `API_CONTRACTS.md:713` publishes the catalog cursor's encoding ("base64url-encoded offset") rather than calling it opaque, which raised the question of whether a hand-crafted catalog cursor is supported. It does not change the answer: a hand-crafted cursor that genuinely *is* a base64url non-negative offset still works, so the only requests this turns into a `400` are ones no correct client can send.
- **`GET /api/applications` is the odd one out and was checked separately**, per the ticket. Its parameter is `page`, not `cursor` — but `nextPage` is minted the same way (`Buffer.from(String(offset + limit))`), it is documented as coming "from a previous response", and no client constructs one, so the same `400` applies. Its `catch` was doubly dead: unreachable *and* the comment above it ("start from beginning") described a fallback that would not have happened anyway. The error message names `page`/`nextPage` rather than `cursor`/`nextCursor`, so it points at something the caller can find in their own request.
- **The guard is verified to be wired in at each site, not merely to exist.** `packages/api/test/pagination.test.ts` drives all twelve real service functions with a malformed cursor and a negative one against a database handle that throws on any access — so a site that skips the guard is caught by reaching the query builder, which is the actual defect. Confirmed by mutation: restoring the inline decode at `catalog.listCompanies` and `application.listApplications` fails exactly their four cases, each reporting `db.select was reached with a malformed cursor`. The `parseCursor` unit cases move here from `reports.service.test.ts` alongside them. API suite: 411 passing.
- **The coverage table is now counted rather than trusted (WIC-1335).** Its first draft listed only the nine sites this change converted and omitted the three in `reports.service.ts` — the ones WIC-1308 was about — so its own claim that "reverting any single site fails its case here" was false for a quarter of the codebase. Measured on review: reinstating the exact pre-WIC-1308 decode in `getNeedsActionReport` left the whole suite green. The three rows are added, and a companion case now compares `parseCursor` call sites found in `src/services/*.ts` against the table **per service**, so neither a new paginated endpoint nor a swapped row can shrink the claim silently. Confirmed by mutation in both directions: each reports site now fails its own two cases, and dropping a row — or trading one service's row for another's, leaving the total unchanged — fails the counter.
- **The error message no longer infers the response field from the request parameter.** It built the field name as ``next${param === 'page' ? 'Page' : 'Cursor'}``, so a future endpoint spelling its parameter anything else would have been told to pass back a `nextCursor` its response does not contain. `parseCursor` now takes both names as one `{ param, responseField }` value (`CURSOR_NAMES`, `PAGE_NAMES`). The two messages that exist today are byte-identical to before — this closes a latent trap, it does not change the contract.
- **Documentation divergence found, not fixed here** — `API_CONTRACTS.md` documents the applications list parameter as `cursor` returning `nextCursor`; the implementation has always used `page`/`nextPage`. A client following the document sends `cursor=…`, which the Zod schema drops silently, so it receives page one forever with no error. Pre-existing and independent of this change; handed to the Technical Writer with the cursor-contract update.

### Fixed — By-fit-tier tile blurbs no longer contradict the count printed beside them (2026-08-25)

Each tile on `GET /api/reports/by-fit-tier`'s page carried a one-line blurb describing its tier, and every blurb restated only the **match-percentage** arm of `computeRecommendation`. That function is an ordered four-way cascade over *three* variables — match percentage, critical-gap count, and the seniority flag — so a tier fires far outside the percentage band its blurb claimed. Found reviewing PR #111 (WIC-1309); the tiles are `opacity-50` placeholders rendering `—` today because UC-3 analyses are not persisted, so nothing user-visible has shipped wrong yet.

- **Measured, not argued.** Exercising the real `computeRecommendation` over every reachable `(match %, critical gaps, seniority)` triple at `totalRequired = 20` — 574 cases, match percentage in half-steps because partial matches weigh 0.5 — the shipped blurbs were false for **81 of them (14.1%)**. The worst case: a 100% skill match with 3 critical gaps returns `moderate_fit`, so **"50–79% of required skills" would have appeared directly above a match count of 20/20**. The independently-reported figure on a coarser 252-case grid was 32 (12.7%).
- **Blurbs are now necessary conditions of their tier, never sufficient ones.** A tile has no room to restate a cascade and does not need to; what it must never do is contradict the number next to it. Each of the four now carries the gap and seniority conditions that can pull a tier down. Re-measured over the same grid: **0 violations.**
- **The invariant is enforced, not just fixed.** `packages/api/test/fit-tier-blurbs.test.ts` pairs each shipped string with a machine-readable predicate, checks it against the real scorer over the whole grid, and re-reads the strings **out of `ReportsByFitTier.tsx`** — cross-package on purpose, because the copy lives in `web`, the rule lives in `api`, and nothing else connected the two. Reword a blurb without revisiting its predicate and the API suite fails. A companion assertion pins that all four tiers are actually reached, so the check cannot pass vacuously. Confirmed by reversal: restoring the original blurbs fails it with 81 named counterexamples.
- **The source doc had the same defect and is corrected in the same change.** `docs/architecture/API_CONTRACTS.md`'s scoring bullets (pre-existing, and almost certainly where the blurbs were copied from) read as four exclusive percentage bands. They are an **ordered cascade**: the first rule that matches wins, so a tier's range is not bounded above by the tier before it. `strong_fit`'s ≤1-critical-gap condition was unstated, `moderate_fit` was documented as 50–79% when it fires up to 100%, `stretch` did not mention the >3-critical-gap route into it, and `low_fit` omitted that it also requires no seniority mismatch.
- **Wording is provisional.** The strings are the Copywriter/Editor's to rule on (WIC-1318); the constraint this change locks down is truth, not phrasing.

### Fixed — A malformed report cursor is now a `400`, not a silently wrong page (2026-08-25)

`decodeCursor` in `reports.service.ts` wrapped its body in a `try`/`catch` that **could not fire**. `Buffer.from(s, 'base64url')` does not throw on invalid input — it discards characters outside the alphabet and decodes whatever is left, down to an empty buffer — so the intended "fall back to the first page" never happened. `parseInt('', 10)` returned `NaN`, and `NaN` is a value, not an exception: it flowed straight through to `.offset()` in all three paginated reports (`needs-action`, `stale`, `closed-loop`). Found while specifying those endpoints for WIC-1307 (WIC-1308).

- **The observed symptom was a silently wrong page, not the expected `500`** — the ticket predicted a Postgres syntax error. Drizzle in fact **omits the `OFFSET` clause entirely** when the value is falsy, and `NaN` is falsy, so `?cursor=not-base64!!` quietly returned page one. That is the behaviour the dead `catch` intended, arrived at by accident: a Drizzle internal, not a contract, and one that would change under it without warning. Verified against `drizzle-orm` + `postgres-js` by inspecting the generated SQL for `offset(NaN | 0 | 50 | -5 | 1.5 | Infinity)`.
- **A hand-crafted negative cursor was a genuine `500`** — this was not in the report. `LTU` (base64url of `-5`) decodes to `-5`, which is *not* falsy, so it survives as `OFFSET $2` with a parameter of `-5` and Postgres rejects it (`OFFSET must not be negative`). The caller could not have diagnosed that from an `INTERNAL_ERROR` response.
- **Rejecting beats falling back.** `decodeCursor` is replaced by `parseCursor`, which returns `400 VALIDATION_ERROR` for any cursor this module did not issue. The cursor is opaque and server-issued, so a client that echoes `nextCursor` back verbatim can never reach that branch; one that does has a bug, and serving page one both hides it and invites an endless pagination loop. An absent or empty `cursor` is still the first page — those are indistinguishable at the query-param layer.
- **The digit check is load-bearing, and `Number.isSafeInteger` alone is not enough** — `Number('')` is `0`, so a cursor decoding to nothing (`'!!!!'`) would still have silently meant page one; a negative offset *is* a safe integer; and `parseInt` would have accepted `'50junk'` as `50`. `isSafeInteger` still catches the remaining case, a digit string too large to survive `Number` intact. Confirmed by mutation: restoring the original body fails 8 of the new tests, and keeping `isSafeInteger` while dropping the regex still fails 3 (empty decode, negative, surrounding whitespace).
- **Validated in the service, not the route schema** — the encoding a cursor must match lives with `encodeCursor`, so duplicating a decoder in a Zod `refine` would put the two out of reach of each other. The thrown `AppError` reaches the client through `app.onError` in the same `{ error: { code, message } }` envelope the route's own schema rejections use; a route test pins that path.
- **The same pattern is unfixed in five other services** — `application`, `catalog` (six call sites), `cover-letter` and `resume-variant` all inline the identical `parseInt(Buffer.from(cursor, 'base64url')…)` with no guard. Filed separately rather than folded in here, since each endpoint's fallback-vs-reject choice is its own contract decision.

### Changed — One judgement, one enum: `FitTier` is now `recommendation` plus its two no-verdict states (2026-08-25)

Two types described the same judgement at different granularity, and the relationship between them was written down nowhere. `FitRecommendation` (UC-3, `POST /api/catalog/job-fit/analyze`) was `strong_fit | moderate_fit | stretch | low_fit | null`; `FitTier` (UC-5, `GET /api/reports/by-fit-tier`) was `strong_fit | moderate_fit | weak_fit | not_analyzed`. They agreed at the top and split at the bottom. `FitTier` is now **defined as** `FitRecommendation | 'unscored' | 'not_analyzed'`, so a report groups applications by the verdict the analysis actually reached, at the granularity it reached it (WIC-1298, spun out of WIC-1288).

- **`weak_fit` is gone; `stretch` and `low_fit` are distinct tiers (wire change)** — `stretch` is not a magnitude. `computeRecommendation` returns it on a _seniority_ mismatch even at a good skill match, so folding it into a bucket named "weak" told the user their skills were short when the finding was that the level was wrong — the opposite action. Reporting a coarser judgement than the one that was made loses the reason, not just the precision.
- **`unscored` splits "ran and could not score" out of `not_analyzed` (wire change)** — `recommendation: null` is a _result_: an empty catalog, or a job description in which no required skills were found (`totalRequired === 0`). `not_analyzed` means no analysis exists. One is fixed by fixing the catalog or the JD, the other by running the analysis; `not_analyzed` had been standing in for both. `summary.analyzed` counts `unscored` as analysed, and both counters are now derived from the groups rather than hardcoded.
- **Breaking in principle, inert in practice — and only at this exact moment.** Removing `weak_fit` and re-tiering `not_analyzed` versions the endpoint. But UC-3 analyses are not persisted (there is no `job_fit_analyses` table and `applications` carries no analysis reference), so `getByFitTierReport` hardcoded `not_analyzed` for every row and this endpoint has **never emitted a non-zero `weak_fit` count**. No client can depend on a value the server has never produced. The same change made after UC-3 persistence lands would be a real migration; the cost was at its minimum now and rising.
- **The mapping is a function, and it is specified** — `recommendationToFitTier()` in `reports.service.ts` is the single place the two vocabularies meet, and it takes the _analysis_ (or `null` for "none exists") rather than a bare recommendation, so the absent-vs-null distinction cannot be lost at a call site. `API_CONTRACTS.md` gains a `Reports (UC-5)` section documenting the endpoint and the mapping table. Six unit tests pin every arm, including the two "these must not be equal" cases — the mapping is otherwise unreachable from the API until persistence lands, so all but one arm would have shipped untested.
- **The two can no longer drift apart** — because `FitTier` is a union _of_ `FitRecommendation`, adding a recommendation member propagates by construction and fails `npm run typecheck` at `FIT_TIER_ORDER` until the new tier is ranked. An unranked tier would otherwise vanish from `groups` and `byTier`, silently dropping applications from a report that claims to cover the pipeline. Verified with three negative controls: adding a `FitRecommendation` member fails naming `"wildcard"`; dropping `stretch` from `FIT_TIER_ORDER` fails naming `"stretch"`; dropping `unscored` from `FIT_TIER_LABELS` fails naming the missing property.
- **The display-side workaround dissolves** — `FIT_TIER_LABELS` (added the same day by WIC-1288) had a hand-written `weak_fit: 'Weak fit'` entry precisely because that member had no `Recommendation` counterpart to borrow a label from, and the code comment said so. It is now `{ ...FIT_LEVEL_LABELS, unscored, not_analyzed }` — every fit level is spelled once. `unscored` reuses `NO_FIT_LEVEL_LABEL`, since it names the same condition the analysis screen already labels.
- **The by-fit-tier page renders the tiers it actually has** — its three hard-coded placeholder tiles (`strong_fit` / `moderate_fit` / `weak_fit`) became a four-tile grid over the verdict tiers, with `unscored` and `not_analyzed` given their own row apart from them: those are states of the analysis, not judgements about the job, and a tile invites comparison against a real fit level. Tile blurbs now restate the actual scoring thresholds instead of "High/Medium/Low match score", which was wrong for `stretch`.
- **Also corrected: the documented condition for `recommendation: null`.** `API_CONTRACTS.md` said "Catalog is empty (see `catalogEmpty: true`)". `computeRecommendation` also returns `null` whenever `parsedJd.requiredStack` is empty, with `catalogEmpty: false` — a second, unmentioned cause that a client checking `catalogEmpty` would mis-handle.

### Fixed — "Moderate" no longer means two different things on the Job Fit Analysis screen (2026-08-25)

`JobFitAnalysis` spent the word **`moderate` on two unrelated scales at once**: `recommendation: 'moderate_fit'` rendered "moderate fit" near the top as a verdict about the whole application, while `GapSeverity: 'moderate'` rendered "moderate" on each gap card below as one shortfall's severity. Opposite directions, no cue that the axis had changed, and nothing separating them but position on the page — gap severity's colour ramp is deliberately demoted to reinforcement (WIC-1146) and the fit value carries no colour at all. It surfaced as a Playwright strict-mode violation, `getByText('MODERATE')` resolving to two elements; if a locator cannot tell them apart, neither can a person skimming (WIC-1288, spun out of WIC-1146).

- **Fit level is now a verdict scale, not a magnitude one (visible change)** — `moderate_fit` renders **"Possible fit"** and `low_fit` renders **"Unlikely fit"**; `strong_fit` ("Strong fit") and `stretch` ("Stretch") are unchanged. The ladder reads yes / maybe / reaching / no. Renaming the fit level rather than gap severity is the cheaper side: severity is a named, contrast-verified token block in `DESIGN_SYSTEM.md`, whereas the fit value was an ad-hoc `recommendation.replace('_', ' ')` of the wire value.
- **`low_fit` was renamed pre-emptively, not because it collides today** — "Low fit" and "Confidence: low" render two lines apart in the same card, and only an implementation detail of the scoring service keeps them from co-occurring (a `low_fit` verdict requires a non-empty required stack, which forces confidence to `medium` or `high`). The screen carries two magnitude scales already — severity's `critical`/`moderate`/`minor` and confidence's `high`/`medium`/`low` — so any magnitude adjective used for fit level is one refactor away from the same bug.
- **No wire values changed** — `strong_fit` / `moderate_fit` / `stretch` / `low_fit` are API contract values and are untouched on the network. The rename is a presentation-layer remap in `packages/web/src/constants/fitLevel.ts` (new), and `API_CONTRACTS.md` now says so explicitly, so the next reader does not mistake a label for a contract.
- **The collision is now a compile error** — `fitLevel.ts` derives its reserved vocabulary from the `GapSeverity` and `Confidence` unions and fails `npm run typecheck` naming the offending word if a fit label ever reuses one; adding a member to either scale extends the guard automatically. Verified with a negative control: restoring the label "Moderate fit" fails with `Type 'boolean' is not assignable to type '["fit level reuses a word owned by gap severity or confidence:", "moderate"]'`.
- **One wire value, one label, across screens** — the by-fit-tier report hard-coded its own "Strong Fit" / "Moderate Fit" / "Weak Fit" headings for the overlapping `FitTier` enum. Those now read the shared map, so `moderate_fit` cannot mean "Possible fit" on one screen and "Moderate Fit" on another. The two enums still diverged at the bottom of the range (`stretch` + `low_fit` vs `weak_fit`) at the time of this change; that contract question is resolved in the entry above.
- **The rule is written down** — `DESIGN_SYSTEM.md` gains a "Scale Vocabulary" section: _a word may not carry two meanings on one screen_, with the fit-level label table, the rejected alternatives ("Partial fit" collides with the "Partial matches" section; "Weak fit" is already `FitTier: 'weak_fit'`), and a note that the fit-quality colour ramp still open in `JOBFIT_CAPS_DECISION_WIC1122.md` §3a must not be designed against labels that have not passed the guard.
- Casing is untouched: the fit value keeps the `uppercase` wrapper from the Overline change below. De-shouting that site is WIC-1122's call and is spec'd separately.

### Accessibility — ALL-CAPS strings moved out of the DOM into the Overline token (2026-08-19)

Six render sites spelled all-caps labels directly into the DOM. Caps baked into markup are what the accessibility tree receives, and some screen readers — VoiceOver notably — spell short all-caps strings out letter by letter; `text-transform: uppercase` renders caps visually while leaving the accessible name normal-cased. This is **known-good practice, not a WCAG conformance fix** — no success criterion was failing. Copy + `className` only, no logic changes (WIC-1069, implementing the corrections in WIC-1086).

- **Headings de-shouted (visible change)** — `QuickReferenceExport`'s `<h1>` is now "Interview quick reference" and `GapMitigationPanel`'s `<h4>` is "Key strengths to highlight". These are headings that happened to be shouted, not overlines, so the caps are dropped rather than re-applied in CSS. `AmbiguityResolver`'s three card titles ("Ambiguous tag", "Unresolved wikilink", "Fuzzy match") are `<h3>` titles by the same rule; dropping the caps there also avoids uppercasing the adjacent user-authored `item.value` that shares the element.
- **Badges keep their caps (no visible change)** — `GapMitigationPanel`'s severity badge and the two `.toUpperCase()` call sites in `JobFitAnalysis` are legitimate overline usage, so the source string is normal-cased and `uppercase` is applied via `className`. Each `JobFitAnalysis` site gets its own wrapping `<span>` because both sit inline beside sibling prose that must not be shouted. Matches the existing `MobileNavigation` / `CatalogBrowseTable` precedent.
- **`.replace('_', ' ')` retained deliberately** — `JobFitAnalysis` renders the API's underscored `FitRecommendation` enum (`moderate_fit`), so only `.toUpperCase()` was removed. Dropping the whole chain would render `moderate_fit` and break `job-fit-analysis.spec.ts:342`, `:421`, and `:574`, which match case-insensitively but not across an underscore. Confirmed by running the spec with the `.replace()` removed as a negative control (3 failures), then restored (18 passed, 2 pre-existing skips).

### Observability — Production analytics go-live (2026-08-11)

Product analytics is now **live in production**. The event sink was flipped from `noop` to **PostHog** on both tiers, so all 9 resume/export events instrumented under WIC-814 (documented in the section below) are wired to capture real user data. The Worker API — and therefore the server-side capture path — is live and auth-enforcing on the canonical app domain `https://app.careerpin.app/api/*`. PostHog-side verification has now been run (WIC-964, closed 2026-08-18): the sink is confirmed correctly wired — a QA acceptance probe lands in the prod PostHog project — but the 3 server events have not yet been observed in Live Events, because no live authenticated resume-upload traffic has exercised that path since the sink flipped. This is a traffic-coverage gap, not a sink or instrumentation defect (see below).

- **Server sink flipped** — the production Worker now runs `ANALYTICS_SINK=posthog` with `POSTHOG_API_KEY` / `POSTHOG_HOST` supplied from the GitHub `production` environment. The 3 server events (`resume_upload_submitted`, `resume_upload_completed`, `resume_upload_failed`) began capturing on the 2026-08-11 production deploy (WIC-821, PR #46). Verified live at the Worker origin `https://jobtrail.al-23f.workers.dev/api/*` (returns `401 application/json`, i.e. the Worker — not the SPA shell — is serving the API there).
- **Canonical-domain routing — confirmed correct (not a gap).** The app and its Worker API live at `https://app.careerpin.app`; `GET https://app.careerpin.app/api/applications` returns `401 application/json`, i.e. the Worker (not an SPA shell) serves the API on the canonical app domain, identical to the `jobtrail.al-23f.workers.dev` origin mirror. The apex `https://careerpin.app` is the **marketing surface by design** — it has no `/api/*` route and correctly serves marketing HTML (`200 text/html`), so its API paths falling through to HTML is expected, not a misroute. The production SPA is served from the app domain and its same-origin `/api` base (`packages/web/src/services/api/index.ts`) therefore resolves to the Worker, so server-side events from real user traffic reach the sink. PostHog-side verification is now complete (WIC-964, done 2026-08-18): with read access granted, the prod PostHog project (`551963`, whose `api_token` matches the Worker's `POSTHOG_API_KEY`) was queried directly. The sink is proven end-to-end — a QA acceptance probe (`qa_acceptance_probe_wic889`) is present — but the 3 server events (`resume_upload_submitted`, `resume_upload_completed`, `resume_upload_failed`) have **not yet been captured**: no `resume_upload_*` event definition exists in the project. The cause is a traffic-coverage gap, not a sink or code defect — the events are correctly instrumented (`resume.service.ts`) but no live authenticated resume-upload traffic has exercised them since the flip; the first real upload will populate them. Client events are unaffected (they post directly to the PostHog host).
- **Client sink flipped** — the production SPA build now bakes in `VITE_ANALYTICS_SINK=posthog` (plus `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`), so the 6 client events (`resume_upload_started`, `resume_upload_validation_failed`, `resume_upload_cta_clicked`, `resume_manager_viewed`, `resume_exports_link_clicked`, `export_viewed`) began capturing on the 2026-08-11 production deploy (WIC-899, PR #50). Preview builds remain `noop`.
- **Dashboards** — Dashboards A (Upload Health), B (Export/Engagement), and C (user-level retention) in `docs/analytics/dashboard-spec.md` are now fully computable from live data. The client `identify(userId)` alias shipped (WIC-825, PR #72), so on login the SPA emits a `$identify` event that stitches pre-login (`sessionId`) events onto the authenticated user (`distinct_id = userId`), and `reset()` clears identity on logout — closing the last gap for Dashboard C.

### Reliability — Boot-time credential preflight (2026-08-11)

Credentials are now validated at boot instead of failing deep in a run. A reusable, dependency-injected helper runs one cheap **authenticated** ping per configured provider and prints a structured, greppable result (`CREDENTIAL_PRECHECK_{OK,SKIP,FAIL} provider=… var=… reason=…`), naming the exact env var and provider on failure — no secret values are ever logged (WIC-878, PR #54; ADR-0001 Pillar 1).

- **Providers checked** — `github`, `anthropic`, `gemini`, `cloudflare`, `supabase`, `twilio`. `env`/`fetch`/`exec` are injected, so every path is unit-tested without the network (`packages/api/src/lib/credential-preflight.ts`).
- **GitHub env-precedence trap** — a present-but-invalid `GITHUB_TOKEN` is a hard failure even when the stored `gh` credential is valid, because env `GITHUB_TOKEN` shadows it (ADR-0001 Pillar 2, "unset beats invalid").
- **Wired into boot + CI** — runs on API server boot (opt out via `PREFLIGHT_ON_BOOT=false`) and in both CI deploy jobs, upgrading the presence-only (`-z`) checks to real authenticated pings. CLI entry: `npm run -w @wic/api preflight`.
- See `docs/architecture/CREDENTIAL_PREFLIGHT.md`.

### Fixed — Hardened credential-preflight Cloudflare & Supabase probes (2026-08-11)

The Pillar-1 preflight (above) false-failed two _valid_ least-privilege credentials on the first live production run, blocking the deploy. Both probes were hardened — per the WIC-910 EM directive the fix is to **harden** the check, not remove it — so a correctly-scoped token/key is no longer punished (WIC-903, PR #59, merged `191865c`).

- **Cloudflare probe — account-scoped token trap.** The check pinged the user-scoped `GET /user/tokens/verify`, which returns `401` (code 1000 "Invalid API Token") for an **account-scoped, least-privilege** Workers+R2 deploy token — the correct CI token. The probe now verifies against the **account-scoped** `GET /accounts/{id}/tokens/verify` when `CLOUDFLARE_ACCOUNT_ID` is set (HTTP 200 → parse `result.status`: `active` = ok, `disabled`/`expired` = fail `token-inactive`; `401`/`403` = fail `unauthorized`). With no account id it falls back to the user endpoint but treats a `401`/`403` there as **advisory** (`SKIP`, reason `advisory-unverified`) rather than a hard fail.
- **Supabase probe — publishable-key trap.** The check pinged the PostgREST root `GET /rest/v1/`, which under Supabase's current API-key format accepts only **secret** keys — a valid new-style **publishable** key (`sb_publishable_…`) is rejected there with `401` "Secret API key required". The probe now pings GoTrue `GET {SUPABASE_URL}/auth/v1/settings`, which validates both legacy anon JWTs and new publishable keys (clean `200`/`401`); a deleted/paused project still surfaces as a network/DNS error against `SUPABASE_URL`.
- **CI — advisory-first re-adoption.** The `preflight -- cloudflare supabase` step was re-added to both preview and production deploy jobs as **advisory** (`continue-on-error: true`) and now passes `CLOUDFLARE_ACCOUNT_ID` so the CF check uses the account-scoped endpoint. To be flipped to a hard gate once green across live dev/prod runs.
- See the "account-scoped-token trap" and "publishable-key trap" sections of `docs/architecture/CREDENTIAL_PREFLIGHT.md`.

### Security — RLS closed on `onboarding_status` & `personal_info` in production (2026-08-12)

The last two Supabase Security Advisor **"RLS disabled in public"** findings were closed. `onboarding_status` and `personal_info` — both user-scoped (`user_id` referencing `auth.users`) — were still running with **Row-Level Security off in production**: their enabling migrations sat in the drizzle journal gap (entries `0012+` were not run by CI until the journal was reconciled in WIC-930 — see the _"Drizzle migration journal reconciled"_ entry below), and an `INSERT … ON CONFLICT (hash)` line in each migration threw (`__drizzle_migrations` has no unique constraint on `hash`) and rolled back the `ENABLE ROW LEVEL SECURITY` above it on every prior manual replay. Both were enabled directly in the production Supabase project and verified live (WIC-926 / WIC-927).

- **What's enforced now** — each table has `ENABLE ROW LEVEL SECURITY`, an own-row policy (`FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`), and a FK to `auth.users(id) ON DELETE CASCADE`. A re-run of the Supabase Security Advisor returns no findings for either table — this clears the last "public table, no RLS" warnings.
- **Applied out-of-band, not via CI** — because of the journal gap the fix was run in the production SQL editor rather than by `db:migrate`. The checked-in migrations `0019_onboarding_status_rls.sql` and the hardened `0016_personal_info_rls.sql` — now using an idempotent `INSERT … SELECT … WHERE NOT EXISTS` journal guard instead of the buggy `ON CONFLICT (hash)`, so a future replay enables RLS instead of rolling back — landed in **PR #65** (`38d6aa8`). The systemic journal-gap reconciliation (so migrations `0012+` run in CI) has since landed in **WIC-930** (PR #67, `f635129`; see the _"Drizzle migration journal reconciled"_ entry below).
- **App runtime is unaffected** — the Worker reaches Postgres as the `postgres` owner role (via Hyperdrive), which bypasses RLS, and both tables are touched only through direct drizzle (`onboarding.service.ts` / personal-info service), never the anon-key PostgREST client. This closes the anon-key API surface only; no deploy or Worker restart was needed.

### Fixed — Drizzle migration journal reconciled so `0012`–`0018` run in CI (2026-08-12)

The drizzle migration journal (`packages/api/src/db/migrations/meta/_journal.json`) stopped at `0011`, so `drizzle migrate()` — the migrator CI runs via `npm run db:migrate` — never applied migrations `0012`–`0018`. Those seven had been applied out-of-band and self-recorded into `drizzle.__drizzle_migrations`, so production worked but any **fresh or rebuilt environment would silently skip them**. That gap is what let the `personal_info` (`0016`) and `onboarding_status` RLS enablements reach prod un-applied (WIC-926 / WIC-927 above), and it would have recurred for every migration past `0011` (WIC-930, PR #67, merged `f635129`).

- **Journal entries `0012`–`0018` re-added** with monotonic `when` timestamps immediately after `0011` (`1777587858000`). Drizzle applies a journal entry only when its `folderMillis` exceeds the `MAX(created_at)` already recorded, so on prod — where the recent out-of-band `NOW()` self-records dominate — all seven are **skipped as no-ops**, while a fresh CI database applies them in order.
- **Buggy self-record trailers removed** — the manual `INSERT INTO drizzle.__drizzle_migrations … ON CONFLICT (hash) DO NOTHING` lines in `0012`/`0013`/`0014`/`0016` were deleted. Drizzle records each migration itself, and that `ON CONFLICT (hash)` form **errors** under `migrate()` (the table has no unique constraint on `hash`) — leaving them would have broken the very CI run this unblocks.
- **Replay-safety net** — `0014` now guards its destructive `DROP TABLE personal_info CASCADE` behind a "new schema absent" check (keyed on the `first_name` column) so a replay cannot wipe live `personal_info` data, and `0018` uses `ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`. `0012`/`0013`/`0015`/`0016`/`0017` were already idempotent.
- **Verified** with drizzle-orm `readMigrationFiles`: all 18 migrations load, `folderMillis` strictly increasing, zero residual `ON CONFLICT (hash)` inserts. A live prod-shaped `migrate()` dry-run is the DevOps step under WIC-927.

### Security — Row-Level Security enforced & verified in the deploy pipeline (2026-08-11)

Production RLS is now **applied and fail-closed verified on every deploy**, closing the gap that WIC-902's publishable-key swap opened. When the prod `SUPABASE_ANON_KEY` moved from an RLS-bypassing `sb_secret_` key to a browser-safe `sb_publishable_` (anon) key, any direct PostgREST call to the project had to stop leaking data — which only holds if RLS is actually enforced in prod. It was not guaranteed: the original RLS SQL (`0001`) was stale and was **never wired into the deploy pipeline** (the drizzle migrator only runs `packages/api/src/db/migrations`) (WIC-905, PR #56, merged `b463b44`).

- **Current-schema RLS migration** — `supabase/migrations/0002_rls_current_schema.sql` is idempotent and existence-guarded: `ENABLE ROW LEVEL SECURITY`, own-row policies scoped `TO authenticated` (`auth.uid() = user_id`), and `REVOKE ALL` from `anon` on every user-scoped table. `0001_rls_user_isolation.sql` is marked deprecated / do-not-apply.
- **Coverage derived from the database, not a hand list** — a code-review catch (WIC-914) found the first cut hard-coded 16 tables and omitted 5 live user-scoped ones (`projects`, `company_catalog`, `job_fit_tags`, `tech_stack_tags`, `recurring_themes`). The migration and verifier now derive the table set dynamically, at deploy time, from every `public` base table with a `user_id` column in the **deploy database** (no hand-maintained list). The current schema defines **21** such user-scoped tables (`packages/api/src/db/schema.ts`); the deploy-time verifier secures and checks those present in the database it connects to, so its count reflects live state rather than the code schema. Two user-scoped tables — `onboarding_status` and `personal_info` — were not covered by this pipeline pass and were secured directly in production under WIC-926 / WIC-927 (see the _"RLS closed on `onboarding_status` & `personal_info`"_ entry above); the underlying drizzle journal gap — which kept migrations `0012+` from running in CI — has since been reconciled in **WIC-930** (PR #67, `f635129`), so those checked-in RLS migrations now apply on a fresh CI database.
- **Fail-closed verification** — `apply-rls.mjs` / `verify-rls.mjs` (`npm run db:rls` / `db:rls:verify`) apply the policies then fail the build if any user-scoped table lacks RLS or still grants `anon` access. `deploy.yml` runs apply + verify right after `db:migrate` on both preview and production, so a redeploy self-verifies and cannot ship an unsecured DB. `supabase/verify-rls.sql` is a read-only status report for the Supabase dashboard.
- **App runtime is unaffected** — the Worker reaches Postgres as the `postgres` owner role (via Hyperdrive), which bypasses RLS, and the SPA calls `/api`, never Supabase directly. Verified end-to-end against local Postgres: pre-fix `anon` reads all rows; post-fix `anon` is denied and an authenticated caller sees only its own row.

### Infrastructure — Cloud migration to Cloudflare Workers + Supabase (2026-05-05)

The application moved from a local-first Fastify/PostgreSQL stack to a serverless production deployment.

- **API framework:** migrated from Fastify to **Hono** to run on Cloudflare Workers (WIC-222; `ADR-006-hono-framework-workers`)
- **Deployment config:** Cloudflare Workers via `wrangler.jsonc`, SPA asset serving with `not_found_handling` (WIC-223, WIC-234)
- **Document storage:** migrated resume/cover-letter file storage from the local filesystem to **Cloudflare R2** (WIC-217, WIC-198; `ADR-004-cloudflare-r2-storage`). Buckets renamed `jobapp-documents` → `jobtrail-documents`.
- **Database connectivity:** production connects to **Supabase Postgres** via the transaction pooler; PDF parsing switched from `pdf-parse` to `pdfjs-dist` (legacy build) for Workers compatibility (WIC-235)
- **Health checks:** `/health` endpoint gained a database probe; deploys run a pre-deploy secret-validation step (WIC-234)
- See `docs/architecture/CLOUDFLARE_WORKERS_ARCHITECTURE.md`, `docs/architecture/CLOUD_MIGRATION_SCHEMA.md`, and `docs/architecture/CLOUD_ENV_SECRETS.md`.

### Infrastructure — CI/CD pipeline + production deploy (2026-05-02 → 2026-08)

- **GitHub Actions** CI/CD pipeline: lint, test, preview deploys per PR, and production deploy on merge to `main` (WIC-200, WIC-564; `ADR-005-github-actions-cicd`, `docs/architecture/CI_CD.md`)
- Preview deploys run DB migrations and E2E tests; production DB migrations run over the Supabase transaction pooler (WIC-564)
- Hardened `SUPABASE_DATABASE_URL` handling — fail fast on non-PostgreSQL URLs, configurable pooler region (WIC-633, WIC-638)

### Security — Secret-material CI lint (ADR-0001 Pillar 3, 2026-08-08)

- **Secret scanner:** new `npm run scan:secrets` CI step fails the build when secret-shaped
  material (API keys, tokens, PEM private keys) appears in a committed **non-secret field** —
  binding names, resource names, labels, or any tracked file. Cheap insurance against a repeat
  of the WIC-751 leak, where an Anthropic key rode in as a Worker binding name (WIC-879).
- Prefix/shape patterns for `ghp_`, `github_pat_`, `sk-ant-`, `AIza`, AWS/Slack/Twilio/Cloudflare
  tokens, plus a conservative high-entropy heuristic on config/manifest files only (ignores
  ids/SHAs/URLs to stay low false-positive). Findings point at `file:line:col` + field and are
  redacted — the scanner never echoes the raw secret.
- False positives handled via inline `secret-scan:allow` pragma or `.github/secret-scan-allowlist.json`.
  See `docs/architecture/secret-scan.md`. Pure core in `packages/api/src/lib/secret-scan.ts` (14 unit tests).

### Security — Credential precedence contract & registry (ADR-0001 Pillars 2 & 4, 2026-08-08)

Two canonical, **metadata-only** docs now govern how the fleet resolves and tracks every credential — the doc half of ADR-0001. No secret values are stored; both files are committed and covered by the Pillar 3 secret-scan (WIC-880, PR #63).

- **Precedence & provenance contract (Pillar 2)** — `docs/architecture/CREDENTIAL_PRECEDENCE.md` names one **authoritative source** per credential and a defined precedence order for its derived copies. Three rules: (1) one authoritative source, all other locations are derived copies reconciled _to_ it; (2) **`unset` beats `invalid`** — an absent source falls through, but a present-but-invalid one is a hard failure, never silently overridden (the WIC-855/859 GitHub env-shadow class); (3) no secret is ever set to a placeholder value. The executable half of this contract already ships in the Pillar 1 preflight's `GITHUB_TOKEN` env-shadow check.
- **Credential registry (Pillar 4)** — `docs/architecture/CREDENTIAL_REGISTRY.md` is the canonical inventory: one row per credential with owner, least-privilege required scopes, rotation cadence, next-review/expiry date, and authoritative source. Seeded for the four ADR-named providers (GitHub, Cloudflare, Supabase, Anthropic) plus incident-history providers (Gemini, Twilio) and emerging (PostHog). The scope column is the provisioning checklist that catches the WIC-869 Cloudflare mis-scope class; every row carries a review date so stale/mispointed creds (WIC-863/868 Supabase) surface on schedule.
- Both are linked from ADR-0001 and cross-linked with `docs/architecture/CLOUD_ENV_SECRETS.md` (env-var locations per environment).

### Security — Multi-user authentication & tenant isolation (2026-04-30 → 2026-05-05)

The app became multi-tenant. When Supabase env vars are set, all `/api/*` endpoints require a valid JWT.

- **Supabase JWT auth middleware**, backend-only (no frontend Supabase SDK) (WIC-197, WIC-193)
- **ES256 / JWKS verification** — verify Supabase JWTs against the project JWKS, not just the shared secret (WIC-233)
- **Route-level user isolation** — every endpoint scopes queries to the authenticated `user_id`; `NOT NULL` enforced with per-user indexes (WIC-213, WIC-196; migrations `0011`, `0017`)
- **Row-Level Security** policies on Supabase (originally `supabase/migrations/0001_rls_user_isolation.sql`; superseded and now enforced in the deploy pipeline by `0002_rls_current_schema.sql` — see the RLS enforcement entry above, WIC-905)
- Removed unauthenticated `/api/resumes/test-api-key` debug endpoint (WIC-216); removed a PII-leaking raw-text upload log
- Auto-logout on `401` responses (WIC-280); auth UI implemented with Supabase (WIC-199)
- See `docs/AUTHENTICATION.md` and `ADR-003-multi-user-auth`.

### Observability — Product analytics instrumentation & event taxonomy (2026-08-04)

The resume-upload and export flows are now instrumented against the KPIs in `docs/analytics/metrics-baseline.md`, feeding the PostHog dashboards spec'd in `docs/analytics/dashboard-spec.md` (WIC-814, WIC-815, WIC-817).

- **Server-side capture** (`packages/api/src/services/analytics.service.ts`) — a pluggable sink selected by `ANALYTICS_SINK` (`noop` default | `console` | `posthog`); the PostHog sink posts to the `/capture` HTTP endpoint, which works from Cloudflare Workers over `fetch`. A failed capture never throws or breaks the request path.
- **Attribution** — authenticated events now attribute to the user: `distinct_id = userId ?? session_id ?? anonymous` (WIC-822, merged). The raw `session_id` is still retained as an event property, so per-session funnels keep working and pre-login events remain session-scoped. This closes the server-side half of "Gap 2" in `docs/analytics/dashboard-spec.md`. The prod PostHog sink flip listed here as a follow-up has since shipped (server WIC-821/PR #46, client WIC-899/PR #50 — see the _"Production analytics go-live (2026-08-11)"_ entry at the top of [Unreleased]), and the remaining client-side half of Gap 2 has now shipped too: the SPA calls PostHog `identify(userId)` on login (emitting a `$identify` event whose `$anon_distinct_id` alias folds pre-login `sessionId` events onto the authenticated user) and `reset()` on logout (WIC-825, PR #72). With both halves merged, user-level retention KPIs (Dashboard C) are fully computable.
- **Event taxonomy:**
  - Server (`@wic/api`): `resume_upload_submitted`, `resume_upload_completed` (carries an `is_duplicate` boolean so P95 processing-time and funnel KPIs can exclude re-uploads — WIC-817), `resume_upload_failed`.
  - Client (`@wic/web`, `packages/web/src/services/analytics.ts`): `resume_upload_started`, `resume_upload_validation_failed`, `resume_upload_cta_clicked`, `resume_manager_viewed`, `resume_exports_link_clicked`, `export_viewed`.
- **Config** — `ANALYTICS_SINK` + `POSTHOG_API_KEY` / `POSTHOG_HOST` on the Worker; `VITE_ANALYTICS_SINK` + `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` on the web build (see each package's `.env.example`).
- Coverage: `packages/api/test/analytics.service.test.ts`. See `docs/analytics/metrics-baseline.md` and `docs/analytics/dashboard-spec.md`.

### Added — Onboarding wizard & Personal Information (2026-05-08 → 2026-05-12)

- **Onboarding flow**: guided multi-step wizard (resume upload → personal info → app overview) with step-state persistence (WIC-237, WIC-242, WIC-244; migrations `0012`, `0015`; `docs/design/ONBOARDING_FLOW.md`)
- **Personal Information**: `/api/personal-info` endpoints + React components; LinkedIn URL required (WIC-251, WIC-252; migrations `0013`–`0016`; `docs/architecture/PERSONAL_INFO_API.md`)

### Added — UC-7: Interview Prep (2026-04-29)

- **Interview Prep API** (`/api/interview-preps`) and a 5-component UI: STAR story bank, likely questions, and prep guidance (WIC-168, WIC-169; migration `0009_interview_prep.sql`)

### Added — UC-6: Resume Variant Generation (2026-04-28)

- Generate **targeted resume variants** from a base resume against a job description, with rebalance and one-page-compression modes (WIC-153; migration `0008_resume_variants.sql`)
- Export to Markdown / DOCX / PDF (DOCX base64→Uint8Array fix, WIC-158)
- See `docs/architecture/UC-6_RESUME_VARIANT_API.md`.

### Added — UC-5: Extended Application Tracking & Reports (2026-04-27)

- Extended application fields (contacts, next-action due dates, job description) and dedicated **report pages** (WIC-146; migrations `0007`, `0010`)
- Kanban/pipeline improvements, filter panel, global search, breadcrumbs, and mobile UX passes (WIC-171, WIC-177, WIC-178, WIC-179, WIC-295)

### Added — UC-4: Cover Letter Generation (2026-04-26)

- Generate and revise **cover letters** (base draft, revise existing, short-form outreach) wired into the fit-analysis → cover-letter workflow (PR #12, WIC-161; migrations `0005_cover_letters_schema.sql`, `0006_cover_letters_emphasis.sql`)

### Added — UC-3: Dialogue Capture Wizard (2026-04-23)

- Conversational **dialogue capture** wizard UI + API to elicit STAR stories and experience details (WIC-97, WIC-98; `docs/design/DIALOGUE_CAPTURE_WIZARD.md`)

### Added — Job Fit Analysis (2026-04-25)

- **Job Fit Analysis** endpoint (`/api/job-fit`) scoring a resume against a job description, with LLM-powered JD parsing and a regex fallback (WIC-116; `ADR-003-job-fit-api-design`)
- Configurable `LLM_MODEL` env var wired into `LLMService`

### Added — Local-first Projects & AI Resume Parser (2026-04-20 → 2026-04-21)

- **Project files** REST API + CRUD UI with Markdown editing (WIC-67, WIC-68, WIC-69)
- **AI-powered resume parser** using Claude — streaming extraction of STAR items, experience, education, and skills (WIC-71, WIC-72)
- **Duplicate resume detection** via content hashing (WIC-292; migration `0018_resume_content_hash.sql`)

### Added — CareerPin marketing site & domain pivot (2026-06)

- CareerPin marketing site pages and host-based 301 redirects on Cloudflare Pages; product pivot to the `careerpin.app` domain (WIC-507, WIC-522)

### Added — UC-2: Master Catalog Index (2026-04-24)

A normalized, queryable knowledge base of professional attributes automatically extracted from resumes and applications, with human-in-the-loop review for ambiguous or uncertain extractions.

#### Features

**Catalog API** (`/api/catalog/*`)

- `GET/POST /catalog/diffs` — list and generate extraction diffs
- `GET /catalog/diffs/:id` — retrieve full diff with changes and review items
- `POST /catalog/diffs/:id/apply` — approve all, reject all, or make partial decisions
- `POST /catalog/diffs/:id/resolve` — resolve a single change or review item
- `DELETE /catalog/diffs/:id` — discard a pending diff
- `GET /catalog/companies`, `POST /catalog/companies/merge` — browse and deduplicate company entries
- `GET /catalog/tags/:type`, `PATCH /catalog/tags/:type/:id`, `POST /catalog/tags/:type/merge` — manage job-fit and tech-stack tags
- `GET /catalog/quantified-bullets` — browse extracted metric achievements by impact category
- `GET /catalog/themes` — browse recurring career themes, with core-strength promotion at 3+ occurrences

**Extraction engine** (`extraction.service.ts`)

- Detects 60+ known technologies with aliases and legacy flags (e.g. jQuery, CoffeeScript)
- Extracts 14 job-fit signal patterns across role, industry, seniority, and work style
- Identifies 9 recurring career theme patterns
- Parses quantified bullet points with dual-metric support and approximate-value detection
- Resolves `[[wikilink]]` patterns against the `wikilink_registry` for cross-reference linking
- Flags ambiguous values (`PM`, fuzzy matches) as `ReviewItem` entries for human resolution

**Diff Review UI** (`/catalog` route)

- Tab-based Catalog browse page: Pending Diffs, Companies, Tech Stack, Job Fit, Quantified Bullets, Themes
- `DiffReviewModal` — approve all, reject all, or selectively apply individual changes
- `AmbiguityResolver` — radio-button UI for resolving ambiguous tags, fuzzy matches, and unresolved wikilinks
- `ChangeListItem` — before/after diff display with checkbox selection and action badges (CREATE / UPDATE / DELETE)

#### Database

New tables added via migration `0004_catalog_schema.sql`:

| Table                | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `company_catalog`    | Deduplicated company index with application counts       |
| `tech_stack_tags`    | Technology skill tags with category and legacy flags     |
| `job_fit_tags`       | Role/industry/seniority signal tags                      |
| `quantified_bullets` | Extracted metric achievements with impact classification |
| `recurring_themes`   | Career themes with core-strength promotion               |
| `catalog_diffs`      | Pending change diffs with 7-day expiry                   |
| `catalog_change_log` | Immutable audit trail of all catalog mutations           |
| `wikilink_registry`  | Resolved `[[wikilink]]` → catalog entity mappings        |

New enum types: `job_fit_category`, `tech_stack_category`, `metric_type`, `impact_category`, `change_action`, `diff_status`

#### Documentation

- `docs/architecture/API_CONTRACTS.md` — Catalog endpoint reference with schemas and error codes
- `docs/architecture/DATA_MODEL.md` — Catalog table definitions, enum values, wikilink resolution, and core-strength promotion rules
- `docs/design/USER_FLOWS.md` — UC-2 user flows: browse catalog, diff review, ambiguity resolution, expiry, and curation
