# Changelog

All notable changes to the Job Application Manager are documented here.

---

## [Unreleased]

> **Backfill note (2026-08-04):** Entries below reconstruct the shipped increments between UC-2 (2026-04-24) and the production launch. Each is grounded in merged commits, database migrations, and existing `docs/`. Reviewer to confirm scope and decide whether to cut a tagged production release (current `package.json` version is `0.1.0`) — the production analytics go-live below is a natural candidate for that first tag.

### Security — App-host transport hardening (2026-08-19)

QA's WIC-1003 prod regression pass found `app.careerpin.app` — the authenticated surface, carrying Supabase session tokens, resume uploads and PII — serving the app shell over plaintext HTTP with a `200` and sending **no** security headers at all, while the marketing apex and `www` both `301` to HTTPS. Root cause: the app host is a Workers custom domain, so the zone-level HTTPS redirect that covers apex/www does not reach it, and neither the Worker nor the static-asset router was emitting hardening headers (WIC-1011).

- **Cleartext requests are redirected** — `httpsRedirect()` (`packages/api/src/middleware/security.ts`) turns away any request that arrived over HTTP before a handler runs: `301` for `GET`/`HEAD`, `308` for methods with a body so the retry keeps its method and payload. The client scheme is read from Cloudflare's `cf-visitor` — the only authoritative source at the edge — then the request URL. `x-forwarded-proto` is client-settable unless a trusted proxy rewrites it, so it is honoured only when `TRUST_PROXY_PROTO` is set; otherwise a spoofed `x-forwarded-proto: https` on a cleartext request still gets redirected. Private hosts are exempt — loopback, RFC1918/link-local literals, `*.local`/`*.internal`-style suffixes and dotless container names — so `npm run dev:api` / `wrangler dev` / Vitest, LAN and mobile testing, and container-network access by service name all stay on plain HTTP rather than being upgraded to a `:443` nothing listens on.
- **Security headers on every response** — `securityHeaders()` attaches `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` and `Content-Security-Policy: frame-ancestors 'none'`, without clobbering a value a handler already set. Responses that came out of `fetch()` — notably the `ASSETS` binding serving the SPA shell — have immutable headers, so the middleware rebuilds them rather than dropping the hardening. HSTS `preload` is deliberately withheld until the cleartext `301` is confirmed live, since preloading is not reversible on a useful timescale. A full CSP beyond `frame-ancestors` awaits an audit of the Supabase/PostHog/R2 origins the SPA talks to.
- **Static assets carry the same headers** — the asset router answers `/`, `/assets/*` and `/favicon.svg` *before* the Worker runs, so those responses can only be hardened at the edge. `packages/web/public/_headers` (copied verbatim into `packages/web/dist/`, the `assets.directory`) declares the same five headers.
- **Fingerprinted assets are now immutable** — Vite content-hashes everything under `/assets/`, but the Cloudflare default `public, max-age=0, must-revalidate` cost a revalidation round-trip per asset per page load. Those are now `public, max-age=31536000, immutable`; `index.html` is explicitly held at `must-revalidate` so clients cannot pin to a stale build and request asset hashes that no longer exist.
- **The first-contact gap was closed at the zone, not in code** — the Worker-side redirect only covers paths the Worker actually sees (`/api/*`, `/health`, SPA deep links); `/` and `/assets/*` are answered by the static-asset router before the Worker runs, so no code change could reach them. HSTS does not paper over this: per RFC 6797 §8.1 a browser **must ignore** an HSTS header received over plain HTTP, so the `_headers` HSTS on a cleartext `/` pins nothing — the pin only lands once a client completes an HTTPS response. The actual fix was the zone-level `Always Use HTTPS` setting on the `careerpin.app` zone, enabled 2026-08-19 under WIC-1014 and verified live: `curl -sI http://app.careerpin.app/` → `301` → `https://app.careerpin.app/`, with apex and `www` unchanged. HSTS `preload` remains deliberately withheld: it is now eligible (the `301` is confirmed), but submitting the domain is a separate, hard-to-reverse decision tracked apart from this change.
- **HSTS and `nosniff` also ship from the zone, ahead of this deploy** — for the same reason the redirect had to: the asset router answers `/` before the Worker runs, and `_headers` only takes effect on a deploy. The `careerpin.app` zone `security_header` setting was enabled 2026-08-19 (WIC-1011) with `max-age=31536000`, `includeSubDomains`, `nosniff`, and `preload` **off** — byte-identical to the values in `SECURITY_HEADERS` and `_headers`, so nothing drifts when this branch lands, and `securityHeaders()` only sets a header it does not already see. Verified live on all three hosts: `strict-transport-security: max-age=31536000; includeSubDomains` and `x-content-type-options: nosniff` on `app`, apex and `www`. `includeSubDomains` is safe here because every record in the zone is Cloudflare-proxied (including a proxied `*.careerpin.app` wildcard) with `Always Use HTTPS` on, so there is no plaintext-only host to strand. The remaining three headers (`X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`) and the immutable `/assets/*` `Cache-Control` are **not** reachable from the zone — the production API token is authorised for zone settings but not for the response-header transform ruleset (`request is not authorized`) — so those still ship only with this deploy.
### Docs — COMPONENT_SPECS wireframe casing is now marked per line instead of derived (2026-08-26)

The casing note at the top of `docs/design/COMPONENT_SPECS.md` asked readers to sort a shouted wireframe line into "heading" (a bug) or "badge" (intentional). An ASCII wireframe renders both as the same glyphs, so every reader re-derived the split by hand and some derived it wrong — producing four tickets that each found the same defect further down the same file (WIC-1069 → WIC-1184 → WIC-1187 → WIC-1195). Docs only; no source or rendered output changes (WIC-1195).

- **Intent is now marked on the line, not inferred** — intentional-caps lines carry a trailing `‹overline›`, non-UI-string lines (placeholders, example content, acronyms, annotations) carry `‹sample›`, and lines whose fix is owned by another ticket carry `‹deferred›`, with an owner table in the note. The rule collapses to one sentence with no judgement in it: **a caps label with no marker is a defect.** 53 wireframe rows changed in all — 25 de-shouted, 28 marked. Markers sit outside the closing box border, so no wireframe alignment changed: every changed row is identical to its predecessor modulo case and the appended marker, and an East-Asian-width-aware measure reports 0 width drift across all 53.
- **25 wireframe lines de-shouted** to the strings their components actually ship — `QuestionsList` (5), `GapMitigationPanel` (3), and 17 unbuilt-spec headings that take sentence case by default. The triage that drove this had missed three lines (`TASK` in both STAR blocks, and `STORY:`); the sweep is now mechanical and exhaustive rather than hand-enumerated, which is what let the earlier passes leave residue.
- **The note's over-strong clause is corrected** — it previously said a shouted heading must always be de-shouted. A heading uppercased by a CSS `uppercase` class is *correct*: the caps never reach the accessibility tree, so "fixing" it in the source string would be the mirror-image defect. `ResumeVariantDetail` is the model case and is now marked as such.
- **Colon-terminated labels get their own clause** — a source string ending in `:` is an inline field label introducing the content beneath it, never an Overline, so it is de-shouted with no `uppercase` class (`Key phrases:`, `Redirect to:` — WIC-1205). The test reads off the source string, not the wireframe: `🔴 CRITICAL:` draws a separator colon the source does not contain. This also makes the convention self-checking — `‹overline›` on a colon-terminated label is a contradiction rather than merely a lookup miss.
- **The convention is machine-checkable, not just written down** — `docs/design/wireframe-casing-audit.py` walks every fenced wireframe block and exits non-zero on any unmarked caps label. It is what makes the note self-terminating: the next shouted line fails a check instead of waiting to become ticket number five. Running it also caught a real defect in this change's own first draft, which excluded "runs in which no word reaches four letters" as acronyms — `STAR` and `DOCX` are four letters, so that heuristic demanded markers on ~20 acronym lines while `TASK`, a genuine label, is also four. The rule is now **positional**: a label opens its box row and is followed by nothing but trailing space, a colon, or a right-aligned badge; caps inside a sentence are acronyms. The script documents its own limit — it checks row-leading labels only, so a mid-row run such as `Overall Fit: MODERATE FIT` is still the reader's job.
- **Only the two `GapMitigationPanel` lines remain outstanding, and they are marked** — `KEY PHRASES:` / `REDIRECT TO:` carry `‹deferred›` pointing at WIC-1205 (PR #103), whose source fix is not yet merged. The QuickReferenceExport wireframes that earlier drafts of this entry deferred to PR #100 / PR #102 are no longer deferred: those PRs and PR #98 have all merged, so those lines already match what the component ships.

### Accessibility — ALL-CAPS strings moved out of the DOM into the Overline token (2026-08-19)

Six render sites spelled all-caps labels directly into the DOM. Caps baked into markup are what the accessibility tree receives, and some screen readers — VoiceOver notably — spell short all-caps strings out letter by letter; `text-transform: uppercase` renders caps visually while leaving the accessible name normal-cased. This is **known-good practice, not a WCAG conformance fix** — no success criterion was failing. Copy + `className` only, no logic changes (WIC-1069, implementing the corrections in WIC-1086).

- **Headings de-shouted (visible change)** — `QuickReferenceExport`'s `<h1>` is now "Interview quick reference" and `GapMitigationPanel`'s `<h4>` is "Key strengths to highlight". These are headings that happened to be shouted, not overlines, so the caps are dropped rather than re-applied in CSS. `AmbiguityResolver`'s three card titles ("Ambiguous tag", "Unresolved wikilink", "Fuzzy match") are `<h3>` titles by the same rule; dropping the caps there also avoids uppercasing the adjacent user-authored `item.value` that shares the element.
- **Badges keep their caps (no visible change)** — `GapMitigationPanel`'s severity badge and the two `.toUpperCase()` call sites in `JobFitAnalysis` are legitimate overline usage, so the source string is normal-cased and `uppercase` is applied via `className`. Each `JobFitAnalysis` site gets its own wrapping `<span>` because both sit inline beside sibling prose that must not be shouted. Matches the existing `MobileNavigation` / `CatalogBrowseTable` precedent.
- **`.replace('_', ' ')` retained deliberately** — `JobFitAnalysis` renders the API's underscored `FitRecommendation` enum (`moderate_fit`), so only `.toUpperCase()` was removed. Dropping the whole chain would render `moderate_fit` and break `job-fit-analysis.spec.ts:342`, `:421`, and `:574`, which match case-insensitively but not across an underscore. Confirmed by running the spec with the `.replace()` removed as a negative control (3 failures), then restored (18 passed, 2 pre-existing skips).
### Accessibility — Post-delete focus and announcement on the resume list (2026-08-25)

Closes the confirm-path half of WIC-1141. PR #95 restored focus to the trigger on every *cancel*-shaped exit of `ConfirmationModal`, but could not fix the **confirm** path, because there the trigger is the thing the confirmed action destroys: the `🗑️ Delete` button is rendered per row inside `resumes.map(...)`, so deleting a resume unmounts it. Focus ended on `<body>` — after the app's only irreversible action, with nothing announced (WIC-1181).

- **Measured before fixing, because the obvious diagnosis is wrong.** Instrumenting `focusin`/`focusout` against the real page shows the restore *succeeds* and is then undone: `focusin` on the 🗑️ Delete button with both rows present → `focusout` to `<body>` → the refetch commit lands and the row count drops to 1, with focus stranded on `<body>` through t+1500ms. So this is an ordering race, not a detached node, and an `isConnected` test at restore time cannot see it — matching what WIC-1282 found on `ProjectsList`.
- **`ConfirmationModal` gains a `restoreFocusTo` prop** and delegates to `useDialogFocusRestore` (the hook introduced alongside it for the same class of bug) instead of carrying its own inline capture. It still prefers the trigger and is unchanged on every cancel path; the fallback is consulted only when the trigger cannot take focus back. The component deliberately does not guess where focus belongs when its trigger dies — the caller names a stable element.
- **The fallback is the section wrapping the list, not the list itself.** It has to survive *both* arms of the `hasResumes` branch: the list container is inside it and unmounts when the last resume goes, and `EmptyState` does not exist yet at the moment the dialog closes. The wrapper is always mounted, carries `tabIndex={-1}` and `role="region" aria-label="Resumes"`, and is the part of the page the user just changed.
- **The deletion is announced** in a polite live region, because moving focus does not tell a screen-reader user that an irreversible action succeeded.
- **The announcer is portalled to `<body>`, outside `#root`.** The `aria-hidden` package Radix uses to hide the background exempts `[aria-live]` elements *and their whole ancestor chain*. Rendered in place, the announcer therefore stopped `#root` being hidden behind every open dialog — the WIC-1155 defect reached from the other side, and it failed that existing assertion on the first run. As a body-level sibling it is exempted on its own, hides nothing, and wraps no control. For both reasons it must not move into `EmptyState`.
- **`useDeleteResume.onSuccess` was left racing deliberately.** Returning the `invalidateQueries` promise would make the ordering deterministic, but it also makes the modal sit open for the length of the refetch with no pending affordance, on a destructive action. The post-restore watch is correct under both orderings, so the determinism buys nothing here.
- **Regression coverage** — 4 new Playwright tests in `packages/web/e2e/modal-focus.spec.ts`, driving a mock list that a DELETE genuinely shrinks (the existing fixture returns a fixed single resume, so the trigger never actually unmounts). They cover: focus after deleting one of two, focus after deleting the last one (where the whole container is replaced by `EmptyState`), the announcement plus its two structural constraints, and a guard that the cancel path still restores the trigger. All 4 fail against the un-fixed component; the full 23-test focus suite passes with it.

### Accessibility — Focus management on the remaining five dialogs (2026-08-19)

Completes the WIC-1141 sweep (PR 2 of 2, after `ConfirmationModal` in PR #95). `QuickReferenceExport`, `ProjectsList`'s create-project dialog, `OnboardingModal` (both its panel and its nested dismiss-confirm), `WizardContainer` and `DiffReviewModal` were all hand-rolled `<div className="fixed inset-0 …">` overlays with no focus trap, no `Escape`, no focus restore and no scroll lock. All five are now Radix `Dialog`s, satisfying `docs/design/ACCESSIBILITY.md` §Modals. No className was changed and no pixel moves — positioning moved onto `Dialog.Content`.

- **`useDialogFocusRestore`** (`packages/web/src/hooks/useDialogFocusRestore.ts`) generalises the focus-restore fix PR #95 established for controlled dialogs. Capturing the trigger takes two mechanisms with non-overlapping blind spots: `onOpenAutoFocus` fires while `document.activeElement` is still the trigger, but Radix's `FocusScope` skips it entirely when something inside the panel already holds focus — which is what React's `autoFocus` does, in `ProjectsList` and `WizardContainer`. A `focusin` note of the last element focused while no dialog was open covers those two; it in turn cannot see a trigger that lives *inside* another dialog, which is exactly the onboarding dismiss-confirm case that `onOpenAutoFocus` handles.
- **A trigger can also be destroyed by the action its own dialog performed** — the WIC-1181 class, and `ProjectsList`'s empty-state "Create Your First Project" button is an instance of it: creating the first project makes the list non-empty, which unmounts the button. Instrumenting the real close sequence showed the restore *succeeds* and is then undone (`focusin` on the button → `focusout` to `<body>` → button removed on the refetch commit), so an `isConnected` check at restore time cannot see it. Declining to `preventDefault()` does not help either: `composeEventHandlers` defaults to `checkForDefaultPrevented: true`, so falling through runs Radix's own handler, which `preventDefault()`s anyway and focuses its always-`null` `triggerRef` — suppressing `FocusScope`'s `focus(previouslyFocusedElement ?? document.body)` fallback too. Instead the hook takes an optional `fallbackRef` and briefly watches the element it restored to; if that element leaves the document while still holding focus, focus moves to the fallback. `ProjectsList` points it at the header "Create Project" button, the one control offering the same action that survives the re-render.
- **Every dismissal path now runs the same teardown.** `ProjectsList` previously cleared its draft `newProjectName`/`newProjectDescription` in the Cancel button's inline handler only; routing `Escape`, outside-click and `Dialog.Close` through `onOpenChange` means the draft can no longer be stranded. The onboarding ✕ keeps its confirm gate rather than becoming a `Dialog.Close`, so `Escape` and outside-click also go through "Save progress and exit?".
- **The dismiss-confirm is nested inside the onboarding panel** rather than replacing it via an early return, so Radix stacks the two layers and returns focus to the onboarding panel — not the page — when the inner dialog closes.
- **Regression coverage** — `packages/web/e2e/modal-focus-projects.spec.ts`, 10 Playwright tests against the create-project dialog, the one of the five that both autofocuses its own field and has parent state to reset. The 8 dismissal-path tests all drive the header trigger, which never unmounts; the 2 create-success tests drive the empty-state trigger, which does. Three negative controls confirm the coverage is load-bearing: reverted to the pre-migration component, 8 of 8 fail; keeping the Radix migration but dropping only the `useDialogFocusRestore` handlers, exactly the 2 focus-restore tests fail; keeping the whole fix but disabling only the post-restore watch, exactly the 1 unmounting-trigger test fails.
- **Background hiding is asserted on the trigger's reachability, not on `#root[aria-hidden]`.** Radix hides the background through the `aria-hidden` package, which deliberately exempts `[aria-live]` elements and `<script>` — and exempting a node keeps its whole ancestor chain unhidden. `EmptyState` carries `role="region" aria-live="polite"`, so on every page that renders it `#root` and `<main>` stay unhidden by design, and the empty state's own action button remains exposed to the virtual cursor while a modal is open. That is a pre-existing `EmptyState` question (a static empty state is not a live region), tracked separately.
### Accessibility — Focus management on the destructive-delete confirmation (2026-08-19)

`ConfirmationModal` — the app's only destructive-action gate, used by `ResumeManager` for the irreversible "delete resume" — was a plain `<div className="fixed inset-0 …">`. To assistive tech that is a `<div>`: nothing announced that a dialog had opened, the irreversible-action warning was never spoken, `Tab` walked straight out into the page behind the overlay, and `Escape` did nothing. It is now a Radix `Dialog`, which supplies the focus trap, `Escape`/outside-click dismissal, background scroll lock, `role="dialog"`, and the accessible name/description wiring required by `docs/design/ACCESSIBILITY.md` §Modals (WIC-1141, PR 1 of 2).

- **Focus restore needed an explicit fix, not just the migration.** Radix's modal `Dialog.Content` unconditionally cancels the focus-scope restore and focuses `Dialog.Trigger` instead. This dialog is controlled through an `isOpen` prop and its trigger lives in the parent, so no `Dialog.Trigger` is rendered, that ref is always `null`, and focus silently landed on `<body>`. `ConfirmationModal` now captures the trigger in `onOpenAutoFocus` (which fires before focus moves) and restores it in `onCloseAutoFocus`. This affects every controlled dialog and applies to the five still to be migrated.
- **No caller changes and no visual change** — the props contract is identical, `ResumeManager` is untouched, and every className is preserved; positioning moved onto `Dialog.Content`.
- **Regression coverage** — `packages/web/e2e/modal-focus.spec.ts` automates the ACCESSIBILITY.md L486–487 manual checklist as 9 Playwright tests (dialog announcement, accessible description carrying "This action cannot be undone", focus-in-on-open defaulting to the safe action, `Tab`/`Shift+Tab` trapping, `Escape` and Cancel both restoring focus and clearing the parent's pending state, scroll lock, background `aria-hidden`, and a happy-path guard that deletion still works). Verified as load-bearing: 8 of the 9 fail against the pre-migration component.
- **`ACCESSIBILITY.md:566` corrected** — `- [x] Focus management in modals` claimed this was shipped while zero of six dialogs implemented any of it. Now unchecked, naming the two PRs that together complete it — deliberately worded identically in PR #97 so the two do not collide on this line.
### Fixed — Onboarding completion screen stranded new users (2026-08-19)

The final onboarding step's two shortcut buttons never actually completed onboarding, and one of them pointed at a route that does not exist (WIC-1032).

- **"Go to Dashboard" pointed at `/dashboard`** — the Dashboard is mounted at `/` (`packages/web/src/App.tsx`), and `TopNavigation` already linked there correctly. `/dashboard` matched no route, and the in-app `<Routes>` block has no catch-all, so the click landed on the app chrome with an empty content area.
- **Neither shortcut marked onboarding complete** — reaching step 6 only advances local state (`STEP_MAP` has no entry for it), so the server still read `first_application` with a null `completedAt`. Both shortcuts were plain `<a href>`, so the full page reload re-mounted `OnboardingProvider`, which re-fetched that untouched status and **reopened the onboarding modal at step 5**. The only way to genuinely finish was the step's footer button.
- **Fix** — both shortcuts now `await completeOnboarding()` and then navigate in-router, matching the footer button. This also stops the reload from discarding query cache and auth state. These were the only two raw in-app `<a href>` links in `packages/web/src`.
- **Same dead route in three breadcrumb trails** — `ProjectsList`, `ProjectDetail`, and `ProjectFileEditor` each passed `{ label: 'Dashboard', href: '/dashboard' }` to `Breadcrumb`, which renders it as a `<Link to>`, giving the identical blank-content-area symptom on three pages any user with a project reaches. All three now use `href: '/'`, matching the nine other pages that already did. Every breadcrumb `href` in `packages/web/src` now resolves to a declared route, and `/dashboard` no longer appears anywhere in the tree. This is not an all-clear on in-app navigation generally: two unrelated pre-existing dead routes (`/resumes/:resumeId/exports` and `/applications/:id/prep/practice`, neither introduced or touched here) are tracked separately under WIC-1044.

> Related: WIC-1004's SPA fallback changes `/dashboard` from a plaintext `404` to a `200` shell, which would have converted this from a visible error into a silent blank page. Both fixes are needed.
### Accessibility — residual ALL-CAPS sites left after WIC-1069 (2026-08-19)

Finishes the WIC-1069 sweep. WIC-1069 enumerated six render sites; two more were found during its code review and are corrected here, so no component in `packages/web/src` now spells an all-caps label into the DOM (WIC-1127).

- **`ChangeActionBadge` — the one site CSS could not have fixed.** Its `create`/`update`/`delete` labels were interpolated into an explicit ``aria-label={`${config.label} action`}``, so the accessible name was literally "CREATE action". `text-transform` never reaches an attribute value, so this was unreachable from the stylesheet — the string itself had to change. Labels are now `Create`/`Update`/`Delete` and the rendered caps are restored with `uppercase tracking-wider`, matching the `GapMitigationPanel` severity badge shipped in WIC-1069.
- **`QuickReferenceExport`'s three section `<h2>`s de-shouted** — "Your top N stories", "Key questions & suggested answers", "Gap talking points". WIC-1069 de-shouted the `<h1>` directly above them in the same card, which left one sentence-case heading over three shouted ones; these fall under the same heading rule and are dropped to sentence case rather than re-uppercased in CSS.
- **Audited to closure.** The only remaining `.toUpperCase()` calls in the web tree are file-format acronyms (`QuickReferenceExport.tsx:263`, `ResumeUpload.tsx:305`, `onboarding/ResumeUploadZone.tsx:342` — `pdf` → `PDF`, `docx` → `DOCX`), as is the `AI/ML` `<option>` in `CatalogBrowseView.tsx:180`. Acronyms are genuinely uppercase words and letter-by-letter announcement is the correct reading, so they are deliberately left alone.

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
