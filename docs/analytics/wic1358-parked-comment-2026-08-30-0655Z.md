# WIC-1358 parked comment — 2026-08-30 ~06:55Z

**Parked, not posted.** `POST /api/issues/{id}/comments` returned `403
cross_issue_influence_run_context_required` twice — once plain, once with the sanctioned
`X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` header, which the error message itself recommends. The run
scratch dir is named `paperclip-run-unassigned-*`, which is the reliable advance tell for this
403: the run carries no issue binding, so every write counts as cross-issue. Same failure mode and
same parking convention as `wic1358-parked-comment-2026-08-27-0040Z.md` and
`wic1358-parked-comment-2026-08-27-0345Z.md`.

Two consecutive failures of the same control-plane write, so no further retries this heartbeat.
The substantive work product is PR #255 and `event-reachability-matrix.md`; this file preserves
the thread text so the next agent with a bound run can post it verbatim.

---

**Watcher: exit 0. Hold stands, both clauses.** lifetime=6, all synthetic, newest `2026-08-26T04:19:39.262Z`. Root `GET /health` -> `503 degraded` ("Too many subrequests by single Worker invocation"). Per this card I would normally post nothing — this comment is not the watch result, it is a correction to how this card reads its own zero.

## I tried to prove this watcher can never fire, and failed to

The hypothesis: every `track()` call site sits behind `<ProtectedRoute>`, and `AuthContext` talks to the API Worker (`/auth/login`, `/auth/me`) rather than to Supabase directly. If those are down, no user ever authenticates, no client event can fire, **clause (a) is unfalsifiable**, and the "two independent clauses" framing on this card is false — the watcher would be a detector that cannot fire, and WIC-1024 would be held on a condition that cannot be met.

**Refuted, on three checked links:**

1. `POST /api/auth/login` with a junk credential returns `401 {"code":"AUTH_ERROR","message":"Invalid login credentials"}`. `routes/auth.ts:55` reaches **Supabase Auth** (`signInWithPassword`), never the exhausted `DATABASE_URL` pooler. Measured today, no credential required.
2. `ProtectedRoute` gates on `useAuth().user` only — no DB-backed check of its own.
3. `OnboardingContext.tsx:81` fails **open** (`// On error, default to not showing onboarding`), so a failed status fetch does not trap a new user behind the modal.

Had any one of those failed closed, this card would need re-scoping today. They didn't. **Clause (a) is falsifiable and the watcher is sound.**

## But this card's framing of the zero was wrong, and so was the watcher's NOTE

This card says the client leg "is independent of the Worker DB, so 0 organic still means 0 arrivals." **Only 2 of the 6 client events are independent of it.** Full split, by call site:

| class | events | what a `0` means |
|---|---|---|
| **outage-immune (2)** | `resume_upload_started` (`ResumeUpload.tsx:207`,`:234`), `resume_upload_validation_failed` (`:184`) | genuine demand reading — fires pre-network, browser -> `us.i.posthog.com` direct |
| **immune by ordering (1)** | `resume_upload_submitted` (`resume.service.ts:451`, before `getDb()` at `:458`) | corroborating only — inference, not measured |
| **outage-blocked (5)** | `resume_upload_cta_clicked`, `resume_manager_viewed`, `resume_exports_link_clicked`, `resume_upload_completed`, `resume_upload_failed` | restates the outage, says nothing about demand |
| **unreachable (1)** | `export_viewed` | restates the code (WIC-1707) |

Two things I did not expect:

- **`resume_manager_viewed` is the trap.** It reads like a pure page-view event and any name-based classification puts it in the immune column. Its guard is `!isLoading && !error` (`ResumeManager.tsx:47`) — a failed resume-list fetch suppresses it. Classify by call site, never by event name.
- **Failure telemetry cannot escape the failure it reports.** `resume_upload_failed` fires in the catch, so it looks like the outage's own alarm bell. Emission is a `fetch` to PostHog (`analytics.service.ts:124`) — **inside a Worker that fetch is itself a subrequest**, on the same exhausted budget — and `track()` swallows capture errors by contract (`:186`). So under exhaustion PostHog shows `submitted` with no `completed` and no `failed`: a gap, not an error event. That is the mechanism behind WIC-1476's gap-derived ruling, now written down.

## Shipped

**PR #255** — `docs/analytics/event-reachability-matrix.md` (the full matrix with call sites, the three invalidation triggers for the links above, and the build-day tile mapping), plus corrections to the `organic_watch.py` NOTE and to `console-build-runbook.md`'s "empty tiles fill in later" paragraph. Operator-facing strings only: **no query, predicate, verdict or exit-code semantics changed** — watcher re-run after the edit is still exit 0, and `doc-reference-audit.py` passes at 224 references.

The candidate branch now also names the 2 events an outage-window arrival should bear, so a candidate carrying any *other* event name during an outage gets scrutiny before adjudication.

## Net effect on the hold

**No change — hold stands.** Both clauses are still unmet and the card stays `todo`. What changed is the interpretation: today's `0` is a demand reading for 2 events and a restatement of the outage for the other 7, so it should not be quoted as clean demand evidence. Clause (b) is still owned by WIC-1386 / WIC-1473 (board decision), not by me.
