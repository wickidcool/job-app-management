# Event reachability matrix — which of the 9 WIC-814 events can arrive *right now*

**Measured 2026-08-30 ~06:45Z against `main` @ `614ad91` and live prod.**
Owner: Data Analyst (`01d53393`). Companion to `dashboard-spec.md`, `console-build-runbook.md`
and `organic_watch.py`.

## Why this document exists

Two different readers keep asking the same question and getting the same wrong answer:

- **`organic_watch.py` / WIC-1358 clause (a)** treats "0 organic events in project 551963" as a
  reading about *demand*.
- **Build day (`console-build-runbook.md`)** treats an empty tile as "no traffic yet — it will fill
  in".

Both are only true for events whose call site can actually execute. `export_viewed` already proved
that (WIC-1707: pinned at zero by a hardcoded `[]`, not by absent users), and prod is currently
degraded, which silences a further four. **A zero means three completely different things depending
on the event, and until now that split lived only in card comments.**

The rule this document exists to state:

> A zero is evidence about demand **only** for an event in the OUTAGE-IMMUNE class.
> For OUTAGE-BLOCKED events a zero is a restatement of the outage. For UNREACHABLE events a
> zero is a restatement of the code.

## The headline result: clause (a) is still falsifiable

This audit was opened on the hypothesis that **no** event could fire during the outage — which
would make WIC-1358's clause (a) unfalsifiable, the watcher incapable of ever releasing, and the
"two independent clauses" framing false. **That hypothesis is refuted.** Two client events survive
the outage, so a real first user still trips the watcher and clause (a) can still become true
before clause (b) does.

The refutation rests on three links, each checked rather than assumed:

1. **Login works under the outage.** `POST /api/auth/login` with a junk credential returns
   `401 {"error":{"code":"AUTH_ERROR","message":"Invalid login credentials"}}` — measured today,
   with no credential required to take the reading. That is Supabase Auth answering, not a Worker
   DB error. `routes/auth.ts:55` reaches Supabase via `supabase.auth.signInWithPassword`; it never
   touches the `DATABASE_URL` pooler that WIC-1386 has exhausted. Register (`:19`) is the same
   shape.
2. **The route shell renders on a Supabase session alone.** `ProtectedRoute` depends only on
   `useAuth().user`; it performs no DB-backed check of its own.
3. **Onboarding fails open.** `OnboardingContext.tsx:81` — `// On error, default to not showing
   onboarding` → `setShowOnboarding(false)`. When the onboarding-status fetch 500s, the modal
   returns `null` (`OnboardingModal.tsx:57`) instead of trapping the user behind a spinner. So a
   first-time user whose status call fails still reaches `/resumes/upload`.

Had any one of those three failed closed, the watcher would today be a detector that cannot fire.
It is worth re-checking all three if the auth or onboarding path is ever changed.

## The matrix

`I` = outage-immune · `B` = outage-blocked · `U` = structurally unreachable

| # | Event | Owner | Class | Call site | What gates it |
|---|---|---|---|---|---|
| 1 | `resume_upload_started` | client | **I** | `ResumeUpload.tsx:207` (drag_drop), `:234` (file_picker) | Fires in the drop / file-input handler **before** `uploadFile` issues any request. Nothing DB-backed precedes it but login. |
| 2 | `resume_upload_validation_failed` | client | **I** | `ResumeUpload.tsx:184` | Emitted from `validateFile`'s reject branch — pure local size/MIME arithmetic, no network at all. |
| 3 | `resume_upload_submitted` | server | **I\*** | `resume.service.ts:451` | Emitted **before** `const db = getDb()` at `:458`. See the asterisk below — immune by ordering, not by independence. |
| 4 | `resume_upload_cta_clicked` | client | **B** | `ResumeUpload.tsx:254`, `:263` | Both call sites guard on `parsedData`, which is only set from a **successful** upload response. A 500 leaves it `null` and neither CTA renders. |
| 5 | `resume_manager_viewed` | client | **B** | `ResumeManager.tsx:49` | The effect guard is `if (!isLoading && !error && resumes …)` (`:47`). A failed resume-list fetch sets `error`, so the event never fires. **This is the trap in the set** — it reads like a pure page-view event, and a reviewer scanning names would classify it immune. |
| 6 | `resume_exports_link_clicked` | client | **B** | `ResumeManager.tsx:153` | Rendered inside `resumes.map(...)` under the `hasResumes` branch (`:123`). Zero rows ⇒ no link ⇒ no click. Also structurally zero for any genuinely new user, outage or not. |
| 7 | `resume_upload_completed` | server | **B** | `resume.service.ts:597` (normal), `:486` (duplicate) | Both sites sit after DB reads/writes inside the `try` opened at `:457`. Unreachable while the pooler is exhausted. |
| 8 | `resume_upload_failed` | server | **B** | `resume.service.ts:760` | Fires in the `catch` — so the outage *does* reach it — but see "failure telemetry cannot escape" below. Classified **B** deliberately. |
| 9 | `export_viewed` | client | **U** | `ResumeExports.tsx:24` | `const exports: ResumeExport[] = []` hardcoded at `:21`; `onPreview` is only invoked from inside `exports.map(...)`. Zero forever, at any traffic level. **WIC-1707.** |

**Net: 2 events (1, 2) are unconditionally immune. 1 more (3) is immune by ordering. 5 are blocked
by the outage. 1 is dead code.**

### \* Why `resume_upload_submitted` is starred

It is immune only because it is emitted first. The Cloudflare failure mode is *"Too many
subrequests by single Worker invocation"* — a per-invocation budget, not a dead upstream. At
`:451` the invocation has spent almost none of that budget, so its capture `fetch` gets out. By
`:597` or `:760` the budget has been spent on pooler retries.

This is a code-ordering inference, **not a live measurement** — taking one would require a real
authenticated account and a real upload against degraded prod, which I have not done. Treat rows
1 and 2 as the load-bearing ones and row 3 as corroborating.

### Failure telemetry cannot escape the failure it reports

`resume_upload_failed` deserves its own note because it is the one row where the naive reading is
backwards. The event fires *because* of the outage, so it looks like the outage's own alarm bell.
It is not.

Emission is `fetch()` to `https://us.i.posthog.com/capture/` (`analytics.service.ts:119`, `:124`)
— **and inside a Worker that fetch is itself a subrequest.** When the invocation has already
exhausted its subrequest budget, the capture call fails on the same limit that caused the failure
being reported. `track()` "never throws and never rejects — a failed capture is logged and
swallowed" (`analytics.service.ts:186`), so the loss is silent: no error, no retry, no trace in
PostHog.

So under subrequest exhaustion PostHog would show **`submitted` with no matching `completed` and no
matching `failed`** — a gap, not an error event. That is precisely why WIC-1476 concluded failure
telemetry here must be **gap-derived, not event-derived**. This matrix is the mechanism behind that
conclusion, and the two should be read together.

## Consequences

### For `organic_watch.py` and the WIC-1358 hold

- **Clause (a) remains falsifiable.** A real first user who reaches the upload page and picks a
  file emits `resume_upload_started` straight from the browser to PostHog, with the Worker
  nowhere in the path (`packages/web/src/services/analytics.ts:184` posts to
  `${VITE_POSTHOG_HOST}/capture/`; the live bundle resolves that to `us.i.posthog.com`). The
  watcher sees it and exits 10.
- **But the watcher's own NOTE overstated the case.** It said the client leg "is independent of the
  Worker DB, so 0 organic still means 0 arrivals". Only 2 of the 6 client events are independent of
  it; the other 4 are gated by a failed fetch or by dead code. The NOTE is corrected in this change.
- **The two clauses are not symmetric.** Clause (a) can be satisfied while (b) is false — that is
  the point of holding on both. But a user who arrives during the outage will emit *at most* the
  two immune events and then hit a broken app, so a release triggered in that window still means
  6 of 9 events have never been observed once.

### For build day

`console-build-runbook.md` tells the operator that empty tiles fill in once traffic arrives. That is
true for tiles fed by classes **I** and, after recovery, **B** — and false for **U**. Concretely:

- **B1 (Export View Rate)** — numerator is `export_viewed` (class **U**). Pinned at a red `0%`
  regardless of traffic until WIC-1707 lands. Already flagged in the runbook by PR #237.
- **Any tile keyed on `resume_upload_completed` timing or `person_id`** (the completion/timing
  insights and C1–C3) needs traffic arriving **after** clause (b) is satisfied. Traffic during the
  outage will not populate them, because event 7 cannot fire.
- **Tiles fed only by events 1–2** are the ones that would render honestly from outage-window
  traffic.

## What would invalidate this document

Re-run this audit if any of the following change, because each is a link in the chain above:

1. `routes/auth.ts` login/register stops going straight to Supabase Auth (would break link 1).
2. `ProtectedRoute` gains a DB-backed check (link 2).
3. `OnboardingContext.tsx:81` stops defaulting to `setShowOnboarding(false)` on error (link 3).
4. A `track()` call site moves across a `getDb()` boundary, in either direction.
5. The client sink is changed to proxy through the API Worker instead of posting directly to
   PostHog — that single change would move all six client events from **I**/**B** to **B**, and
   would make clause (a) genuinely unfalsifiable during an outage.
6. Autocapture or `$pageview` is enabled. There is **none** today — no PostHog browser SDK is
   installed and the wrapper emits only the six explicit `track()` names — so no passive event
   exists that a mere visitor could generate. Enabling it would make clause (a) fire on any page
   load, including one that never reaches the app.

## Readings this was built on

| Probe | Result |
|---|---|
| `GET https://app.careerpin.app/health` | `503 {"status":"degraded","hyperdrive":false,"db":"Too many subrequests by single Worker invocation…"}` |
| `POST /api/auth/login` (junk credential) | `401 AUTH_ERROR "Invalid login credentials"` — **auth path healthy** |
| `GET /api/auth/me` (no token) | `401 UNAUTHORIZED "Missing or invalid authorization header"` |
| `python3 docs/analytics/organic_watch.py` | exit `0` — lifetime 6, all synthetic, newest `2026-08-26T04:19:39.262Z` |

All three HTTP probes are unauthenticated and cost nothing to repeat. The login probe in particular
is the cheap way to separate "the Worker is down" from "the Worker's DB is down" — a `401` proves
the request reached the application and got a real answer.
