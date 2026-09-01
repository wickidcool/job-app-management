# Per-route `document.title` convention — packages/web

**Issue:** WIC-1089 (split out of WIC-1046) · ported to `docs/design/` by **WIC-1582**
**Author:** UI/UX Developer
~~**Status:** design complete, ready for Frontend implementation~~
**Status:** implemented — see §9, and the modules named there, for what actually shipped.
**Measured against:** `main` @ `f457cc3`, 2026-08-27; §5 re-measured and §9 written against
`main` @ `6196dc3d`, 2026-09-01.
**Depends on:** [`ROUTE_HEADING_OUTLINE.md`](./ROUTE_HEADING_OUTLINE.md) — this document is a
*consumer* of it, not a peer. See §0.3.

> **Why this file exists at this path.** It was written 2026-08-19 and lived only in the UI/UX
> Developer's workspace directory, which is not the repository. WIC-1571 was handed "conform to
> `ROUTE_TITLE_CONVENTION.md`", looked for it, correctly concluded **it did not exist**, and had to
> invent a justification instead. A constraint an implementer cannot open is not a constraint.
> The §5 table has been **re-measured against the current tree** during the port; every correction
> is marked ~~struck~~ inline rather than silently rewritten, so the drift is auditable.

---

## 0. TL;DR for the implementer

1. Adopt the title pattern **already shipping on the marketing site**: `<Page> — Careerpin`. Do not invent a new one.
2. Mechanism: **`title` field on the route table + one effect in the shell**, plus a `useDocumentTitle()` escape hatch for the routes whose heading is dynamic.
3. **The title mirrors the page's `<h1>` verbatim** — the `<h1>` that [`ROUTE_HEADING_OUTLINE.md`](./ROUTE_HEADING_OUTLINE.md) assigns to the route. That single rule makes this work immune to the casing decision in [`CONTENT_STYLE.md`](./CONTENT_STYLE.md): when an `<h1>` changes, its title follows for free.
4. ~~The 404's inline effect collapses into the mechanism.~~ **Corrected 2026-08-27 — there is no longer an inline effect to collapse. See §1.**

Three defects fell out of the original audit and are **not** in scope here — filed separately (§6).

---

## 1. What exists today

`packages/web/index.html:13` sets one static title for the whole SPA:

```html
<title>Job Application Manager</title>
```

> ### Correction, 2026-08-27 (WIC-1582) — this section's premise changed
>
> The 2026-08-19 text read: *"Nothing in `src/` has ever written to `document.title` except
> `pages/NotFound.tsx:67-71`, added by WIC-1046 and deliberately flagged there as a one-off."*
>
> **That is no longer true, and the direction of the change matters.** At `f457cc3`,
> `grep -rn "document.title" packages/web/src/` returns **nothing at all** — the 404's effect was
> removed at some point after 2026-08-19 and *the shared mechanism that was supposed to replace it
> was never built*. So the app does not have "29 routes wrong and one right"; it has **every route
> wrong, with no reference implementation left in the tree** to copy behaviour from.
>
> Two consequences for whoever implements this:
> - **§7 AC5 is obsolete as written** — there is no `NotFound.tsx` `useEffect` to delete, and
>   `packages/web/e2e/not-found.spec.ts` contains **no title assertion at all** (no `toHaveTitle`,
>   no `Job Application Manager`), so the ":104 / :110" line references in AC5 point at nothing.
>   AC5 is restated in §7.
> - **The three hook behaviours in §3 are now specified from scratch, not inherited.** They were
>   written as "learned from the 404's version". That version is gone; they still hold, but nothing
>   in the tree demonstrates them.

So today all 31 in-app route entries plus `/login` announce the same string, and the browser tab, the history entry, the bookmark name, and the window-switcher entry are identical for every screen in the product.

That is the actual user cost, and it is not primarily a screen-reader cost:

- **Tabs.** Anyone with the app open twice — a common pattern here, given "compare this application against that one" is a core flow — gets two identically-labelled tabs.
- **History.** `Ctrl/Cmd+H` lists every screen the user has ever visited under one name, so history is unusable for returning to a specific application.
- **Bookmarks.** Bookmarking a specific application saves it as "Job Application Manager".

The screen-reader angle is real but smaller: title is announced on navigation in some SR/browser pairings and is the accessible name of the document, which is what WCAG **2.4.2 Page Titled (Level A)** requires be descriptive. A SPA that never updates the title after the initial load is the textbook failure mode for 2.4.2.

> **Conformance caveat.** [`README.md`](./README.md) and [`ACCESSIBILITY.md`](./ACCESSIBILITY.md)
> both now carry the WIC-1584 note that WCAG 2.1 AA is an *aspiration, unenforced by CI*. Nothing
> here changes that: this document specifies the fix, it does not assert the fix is checked. No CI
> job would fail today if every route kept the same title.

## 2. The pattern to adopt

The app is not the only thing shipping under this brand. `packages/marketing/*.html` already has a consistent, deployed title convention:

| File | Title |
|---|---|
| `index.html` | `Careerpin — Remember the career you've actually built` |
| `about.html` | `About — Careerpin` |
| `pricing.html` | `Pricing — Careerpin` |
| `privacy.html` | `Privacy — Careerpin` |
| `self-host.html` | `Self-host Careerpin — Installation Guide` |
| `packages/infra/redirect-pages/index.html` | `Redirecting to Careerpin` |

So: **`<Page> — Careerpin`**, em dash, product name last. The marketing site and the app are the same product to a user moving between them, and the marketing convention is the one that already ships publicly.

**This overrides the interim pattern in the 404.** WIC-1046 §2 specified `Page not found · Job Application Manager` — middle dot, and the `index.html` product string. That was written before auditing the sibling package; it was a guess made in isolation on a single page, and the marketing site is the better precedent.

### On the product name

Three names are in the repo right now:

- `Careerpin` — marketing site, and the production host `app.careerpin.app`
- `Job Application Manager` — `index.html` title and the `<h2>` on `pages/Login.tsx:60`
- `jobtrail` — root `package.json` `name` field, and the `jobtrail-preview` deploy target

The user-facing conflict is the first two, and `Careerpin` wins on the evidence: it is what the public site says and what the URL says.

This is **not** a blocking board question, because making it one would park a WCAG A item behind a branding thread. Put the product name in a single exported constant:

```ts
// packages/web/src/lib/title.ts
export const PRODUCT_NAME = 'Careerpin';
export const TITLE_SEPARATOR = ' — ';
export const formatTitle = (page?: string) =>
  page ? `${page}${TITLE_SEPARATOR}${PRODUCT_NAME}` : PRODUCT_NAME;
```

If the Copywriter or board lands somewhere else, it is one line. Flagged to Copywriter for confirmation, not for permission — and note that `Login.tsx`'s `<h2>` and `index.html` carry the same stale name and should move in the same commit as whatever is decided.

## 3. Mechanism

Two options were on the table in WIC-1089. Neither is sufficient alone.

**Route-table `title` field + one effect in the shell.** Strings live in one place next to the paths, and a new page cannot silently forget to set a title — the reviewer sees the missing field in the same diff as the new `<Route>`. This is the right default and covers most routes.

**`useDocumentTitle(title)` per page.** Necessary anyway, because four routes have a heading that is not knowable from the route table:

| Route | Heading source | Title |
|---|---|---|
| `/applications/:id` | `application.jobTitle` (`ApplicationDetail.tsx:147`) | `{jobTitle} — Careerpin` |
| `/projects/:projectId` | `projectName` (`ProjectDetail.tsx:46`) | `{projectName} — Careerpin` |
| `/projects/:projectId/files/:fileName` | `fileName` (`ProjectFileEditor.tsx:73`) | `{fileName} — Careerpin` |
| `/resume-variants/:id` | `variant.title` (`ResumeVariantDetail.tsx:170`) | `{variant.title} — Careerpin` |

Plus two routes whose heading changes by *stage* or *variant* rather than by params:

- `/job-fit-analysis` renders `Job Fit Analysis` at input (`JobFitAnalysis.tsx:481`) and `Job Fit Analysis Results` after submit (`:169`).
- `/projects/new/dialogue` renders `New Project`, `Enrich Project` or `Correct Project` depending on `variant` (`WizardContainer.tsx:398-401`).

**So: build both.** The route table is the mechanism; `useDocumentTitle` is the primitive it calls, exported for the six dynamic routes to call directly. A route with a `title` field gets it applied by the shell; a route without one is expected to call the hook itself.

Three behaviours the hook must have:

1. **Restore on unmount.** Without it a stale title outlives its route during transitions.
2. **Loading and error states must not leave the previous route's title up.** The dynamic routes render before their data arrives. Use the static fallback (`Application`, `Project`, `Resume variant`) until the record loads, then swap. Do not render `undefined — Careerpin`.
3. **Set the title in a `useEffect`, not during render.** Writing `document.title` in a render body is a side effect in the render phase and misbehaves under StrictMode double-invocation.

### 3.1 Which `<h1>` does the title mirror? *(new, WIC-1582)*

§0.3 says "the page's `<h1>`", which was unambiguous when every route had at most one. It no longer is:

- **`/applications/:id/prep` renders a second `<h1>`** — `QuickReferenceExport.tsx:107`
  (`Interview quick reference`) inside a `fixed inset-0 … z-50` export modal, rendered only when
  `showExportModal` is true (`InterviewPrepPage.tsx:363`). The route's own `<h1>` is
  `InterviewPrepPage.tsx:263` (`Interview Preparation`).

**The rule: the title mirrors the `<h1>` that [`ROUTE_HEADING_OUTLINE.md`](./ROUTE_HEADING_OUTLINE.md) assigns to the *route*.** Overlay content — modals, dialogs, sheets — never changes `document.title`, however it is marked up. Opening a modal is not a navigation, the tab label must not flicker when one opens, and the title must be restorable by closing it. (That `QuickReferenceExport` emits an `<h1>` at all is a heading-outline defect, not a title defect — §6.4.)

## 4. Why this does not wait on the casing standard

[`CONTENT_STYLE.md`](./CONTENT_STYLE.md) declares the house casing standard for UI strings (sentence case; WIC-1066) and found an undeclared ~87:7 title-case habit. Titles are UI strings, so on the surface this work depends on that decision.

It doesn't, because of the rule in §0.3: **the title mirrors the page's `<h1>` verbatim.** Whatever casing lands, it will be applied to the `<h1>`s, and the titles inherit it in the same commit with no separate migration and no second decision. Copying the heading is also the correct behaviour independently — the tab label and the page heading naming the same screen differently is its own small defect.

The only strings in this work that are *not* copied from an `<h1>` are the two in §5 marked **new copy**, and those are short enough to re-case trivially.

## 5. Title table — all route entries

Strings are the current `<h1>` **verbatim, re-measured at `f457cc3` on 2026-08-27**. `— Careerpin` is appended by `formatTitle()` and is omitted from this column for readability.

| Path | Page title | Source (verified `f457cc3`) |
|---|---|---|
| `/` | `Dashboard` | `Dashboard.tsx:37` |
| `/applications` | `Applications` | `ApplicationsList.tsx:155` |
| `/applications/new` | `New Application` | **new copy** — page has no `<h1>` (§6.1) |
| `/applications/:id` | `{jobTitle}` | `ApplicationDetail.tsx:147`, dynamic; fallback `Application` |
| `/applications/:id/prep` | `Interview Preparation` | `InterviewPrepPage.tsx:263` — *not* the modal `<h1>` (§3.1) |
| `/reports` | `Reports` | `Reports.tsx:49` |
| `/reports/needs-action` | `Needs Action` | `ReportsNeedsAction.tsx:76` |
| `/reports/stale` | `Stale Applications` | `ReportsStale.tsx:41` |
| `/reports/closed-loop` | `Closed Loop Analysis` | `ReportsClosedLoop.tsx:113` |
| `/reports/by-fit-tier` | `By Fit Tier` | `ReportsByFitTier.tsx:227` |
| `/resumes` | `Resume Manager` | `ResumeManager.tsx:119` |
| `/resumes/upload` | `Upload Resume` | `ResumeUpload.tsx:35` |
| `/resumes/exports` | `Resume Exports` | `ResumeExports.tsx:52` |
| `/resumes/:resumeId/exports` | `Resume Exports` | **added 2026-08-27** — same component, `resumeId` optional (`ResumeExports.tsx:12`); route absent from the 2026-08-19 table |
| `/catalog` | `Master Catalog Index` | `CatalogBrowse/CatalogBrowseView.tsx:116` |
| `/job-fit-analysis` | `Job Fit Analysis` → `Job Fit Analysis Results` | `JobFitAnalysis.tsx:481` / `:169`, stage-dependent (§3) — ~~`:462` / `:144`~~ |
| `/cover-letters` | `Cover Letters` | `CoverLettersList.tsx:54` — **added 2026-08-27** by **WIC-1533**, the route's first standing entry point; sibling of `/resume-variants` below |
| `/cover-letters/new` | `Generate Cover Letter` | `CoverLetterNew.tsx:47` — ~~`CoverLetterGenerator.tsx:181`~~, moved to a page `<h1>` by **WIC-1571** |
| `/cover-letters/:id` | `Cover Letter` | `CoverLetterDetail.tsx:114` |
| `/outreach/new` | `Compose Outreach Message` | `OutreachNew.tsx:30` |
| `/resume-variants` | `Resume Variants` | `ResumeVariantsList.tsx:44` |
| `/resume-variants/new` | `Generate Resume Variant` | `ResumeVariantNew.tsx:114` |
| `/resume-variants/:id` | `{variant.title}` | `ResumeVariantDetail.tsx:170`, dynamic; fallback `Resume Variant` |
| `/projects` | `Projects` | `ProjectsList.tsx:107` |
| `/projects/new/dialogue` | `New Project` / `Enrich Project` / `Correct Project` | `WizardContainer.tsx:398-401`, varies by wizard variant (§3) |
| `/projects/:projectId` | `{projectName}` | `ProjectDetail.tsx:46`, dynamic; fallback `Project` |
| `/projects/:projectId/files/:fileName` | `{fileName}` | `ProjectFileEditor.tsx:73`, dynamic; fallback `Project File` |
| `/settings` | `Settings` | `Settings.tsx:29` |
| `/login` | `Sign In` | **new copy** — page has only an `<h2>`, and it is the product name (§6.1) |
| `*` (NotFound) | `That page couldn't be found` | `NotFound.copy.ts:18` ← `NOT_FOUND_COPY.heading` — ~~`NotFound.tsx:94`~~ moved 2026-09-01 (§9); ~~`Page not found`~~, corrected 2026-08-27 |

> **The 404 row is the one to read twice.** The 2026-08-19 table said `Page not found`, and §7 AC5
> told the implementer to assert exactly `Page not found — Careerpin`. The shipped `<h1>` is
> `That page couldn't be found` (`NotFound.tsx:11-21`, `COPY.heading`). Following the old table
> would have *introduced* the title/heading mismatch that §0.3 exists to prevent. Take the string
> from `COPY.heading`, do not retype it.

**Redirect-only routes need no title** — they never paint:

| Path | Note |
|---|---|
| `/dashboard` | `<Navigate to="/" replace>` (`App.tsx:92`, WIC-1054) |
| `/reports/pipeline` | `<Navigate to="/applications" replace>` (`App.tsx:99-101`) |

**Root/document title** — `index.html:13` becomes `Careerpin`, the bare product name, since it is only visible for the moment before React mounts.

Counting the table: **27 table-driven routes, 6 hook-driven** (four param-dynamic, `/job-fit-analysis` stage-dependent, `/projects/new/dialogue` variant-dependent), plus 2 redirects that need nothing.

## 6. Found during the audit — out of scope, filed separately

These are pre-existing and none of them should grow this PR. **All four re-verified at `f457cc3`.**

### 6.1 Two routes render no `<h1>` at all — *still true*

- **`/applications/new`** — `pages/ApplicationNew.tsx` has no heading, and `components/ApplicationForm.tsx`'s highest is an `<h3>` (`:382`). The route paints a form with no heading of any level.
- **`/login`** — `pages/Login.tsx:60` is an `<h2>` with no `<h1>` above it, and its text is the product name rather than a description of the screen.

Both are WCAG-adjacent (1.3.1 heading structure) and both are why §5 needs new copy for those two rows. A route that cannot name itself is a route the user cannot orient on.

**Correction (carried forward from the original).** WIC-1046 §1 argued against the `EmptyState` option partly on the grounds that it "leaves NotFound as the only route with no `<h1>` in `<main>`". That was wrong — `/applications/new` already had none. The rest of that argument stands, and the built page has a proper `<h1>`, so the conclusion is unaffected.

### 6.2 `/job-fit-analysis` loses its `<h1>` in two states — *still true*

`JobFitAnalysis.tsx:129` (`Analyzing Job Fit...`) and `:414` (`Analysis Failed`) are `<h2>`s rendered *instead of* the `<h1>`, not below it. So the page has no `<h1>` while analysing and no `<h1>` when analysis fails — the error state in particular is one a user needs to orient in. Should be an `<h1>`, or the `<h1>` should be persistent with the stage message below it.

**Interaction with this document:** those two states are exactly when §3 behaviour 2 applies. Whatever the heading fix is, the title must not sit at `Job Fit Analysis Results` while the screen says `Analysis Failed`.

### 6.3 `pages/ReportsPipeline.tsx` is orphaned — *still true*

It is imported by nothing. `App.tsx:99-101` redirects `/reports/pipeline` to `/applications`, and the file — plus its `useReportsPipeline` hook — is unreachable dead code carrying an `<h1>Pipeline Report</h1>` (`:157`) that no user can ever see. Delete or re-route; not a design call. It must **not** get a row in §5.

### 6.4 `QuickReferenceExport` emits an `<h1>` from inside a modal — *new, WIC-1582*

`components/QuickReferenceExport.tsx:89` renders `<h1>Interview quick reference</h1>` inside an overlay on `/applications/:id/prep`, which already has its own `<h1>` at `InterviewPrepPage.tsx:263`. Opening the export modal therefore puts **two `<h1>`s** in the document.

This is a heading-outline call and belongs to [`ROUTE_HEADING_OUTLINE.md`](./ROUTE_HEADING_OUTLINE.md) §5 (*the rule for new routes*), not here — the same "a component must not emit its host page's `<h1>`" rule that `CoverLetterNew.test.tsx` pins for `/cover-letters/new`. §3.1 above makes the title behaviour correct regardless of how the heading question is settled.

## 7. Acceptance criteria

1. Every route in the §5 table sets `document.title` to the listed string, suffixed via `formatTitle()`.
2. The product name and separator exist in exactly one module; changing the brand is a one-line diff.
3. Navigating away from a route restores the prior title; no route leaves a stale title from the route before it.
4. The six dynamic/stage-dependent routes show their static fallback while loading and never render `undefined` or `null` in the title.
5. **Restated 2026-08-27 (WIC-1582).** ~~`NotFound.tsx`'s inline `useEffect` is gone, replaced by the shared mechanism. Both assertions in `e2e/not-found.spec.ts` move: `:104` … and `:110` …~~ — there is no inline effect left to remove and that spec asserts no title today (§1). Instead: the 404 route is title-driven by the shared mechanism like any other, its string is read from `COPY.heading` rather than retyped, and `e2e/not-found.spec.ts` **gains** a `toHaveTitle` assertion plus a back-navigation assertion covering AC3.
6. `index.html` no longer says `Job Application Manager`.
7. Opening a modal never changes `document.title` (§3.1).
8. A new `<Route>` added without a `title` field or a `useDocumentTitle()` call is visible as such in review. A lint rule is not required; co-location is the mechanism.

### Testing

One Playwright spec asserting `await expect(page).toHaveTitle(...)` across a sample of routes — one static, one dynamic-loaded, the 404 — plus a back-navigation assertion for AC3 and a modal-open assertion for AC7. Full coverage of all rows is not worth the runtime; the table is the spec, the test guards the mechanism.

**Watch the em dash.** `formatTitle` emits U+2014, not a hyphen. Assert with the real character or a regex on the page part only — do not hand-type `-` and expect it to match. Playwright's `toHaveTitle` with a string argument is an exact match.

**Watch the apostrophe — and do not guess which one it is.** The 404 heading is
`That page couldn't be found`, and the apostrophe in source is a **straight** `'` (U+0027), *not*
the typographic `’` (U+2019) that prose in these docs uses. That is the opposite of what the em
dash rule above would lead you to assume, which is exactly why it is worth stating: the separator
is typographic and the apostrophe is not. Read the string from `COPY.heading` rather than retyping
it and this cannot bite you.

---

## 8. Related

- [`ROUTE_HEADING_OUTLINE.md`](./ROUTE_HEADING_OUTLINE.md) — **the source of every string in §5.** That document decides which element names a route; this one copies the result into `document.title`. Change a route's `<h1>` there and §5 must follow.
- [`CONTENT_STYLE.md`](./CONTENT_STYLE.md) — casing of the underlying strings (§4).
- [`ACCESSIBILITY.md`](./ACCESSIBILITY.md) — WCAG 2.4.2 context, and the standing note that none of it is CI-enforced.
- [`COMPONENT_SPECS.md`](./COMPONENT_SPECS.md) §10 → "Heading level" — *"The page `<h1>` names the route"*, the rule §3.1 leans on.

## 9. What shipped, and where it deviates from §3 and §7

Implemented 2026-09-01 against `main` @ `6196dc3d`. Recorded here rather than by editing §3
and §7 in place, so the deviations stay auditable — same convention the WIC-1582 port used.

| Concern | Module |
|---|---|
| `PRODUCT_NAME`, `TITLE_SEPARATOR`, `formatTitle`, the §5 table | `packages/web/src/constants/title.ts` |
| The hook (§3's three behaviours) | `packages/web/src/hooks/useDocumentTitle.ts` |
| The one effect in the shell | `packages/web/src/components/RouteTitle.tsx` |
| The 404's copy, so its title is read and not retyped | `packages/web/src/pages/NotFound.copy.ts` |

**Four deviations, each with its reason.**

1. **The title table is not a `title` field on the route table (§3, AC8).** It could not be.
   `packages/web/src/test/route-integrity.test.ts` reads `App.tsx` as raw source and parses
   `path="…" element={<X` out of the JSX, in both directions — link→route and route→link.
   Converting the `<Route>` elements into a data array so they could carry a `title` field
   would leave that audit matching almost nothing and passing vacuously, trading a live guard
   for a stylistic preference. The table therefore lives in `constants/title.ts`.
2. **AC8 is enforced by CI, not by review.** §7 AC8 accepted that "co-location is the
   mechanism" and that a lint rule was not required. Co-location is what deviation 1 gives up,
   so it is replaced by something stronger rather than weaker:
   `packages/web/src/test/route-title-coverage.test.ts` asserts that the set of paths declared
   on a `<Route>` in `App.tsx` is exactly the set accounted for in `constants/title.ts`, in
   both directions. Adding a route without a title fails the build; so does leaving a title
   behind for a route that was deleted.
3. **`/login` is in `HOOK_TITLED_ROUTES`, though its heading is not dynamic.** §5 lists it
   separately because it is not in the §5 table proper. Mechanically it belongs with the six:
   it sits in the *outer* `<Routes>`, above `ProtectedRoute`, so the shell that applies the
   table is never mounted for it and the page must call the hook itself.
4. **`constants/title.ts`, not `lib/title.ts` as §2 wrote.** There is no `src/lib/` in this
   package; `src/constants/` is the existing home for exactly this shape (a constant plus its
   formatter plus a co-located `.test.ts`).

**§6.1's second finding is now half-fixed, and deliberately only half.** `/login`'s `<h2>` was
the product name; it is now `{PRODUCT_NAME}`. It is still an `<h2>` with no `<h1>` above it — the
heading-structure half is a `ROUTE_HEADING_OUTLINE.md` call, not this document's, and is left
where §6.1 filed it.

> **Correction to §2 — `index.html` and `Login.tsx` were not the only two.** §2 says the stale
> product name lives in "`index.html` title and the `<h2>` on `pages/Login.tsx:60`". Measured
> 2026-09-01, two more user-visible occurrences exist and were **not** touched by this work:
> `components/onboarding/OnboardingModal.tsx:330` (`title="Welcome to Your Job Application
> Manager"`, the onboarding step-1 headline) and `components/QuickReferenceExport.tsx:201`
> (`Generated with Job Application Manager`, in the footer of the exported interview sheet — so it
> reaches printed and shared output).
>
> Both are **prose, not titles**, and neither renames mechanically: "Welcome to Your Careerpin"
> does not read. Renaming them is a copy decision belonging to the Copywriter/Editor, and §2 itself
> flags the name to that role "for confirmation, not for permission". They are therefore recorded
> here rather than changed, so that the next reader does not repeat §2's count. Anyone completing
> the rename should also check `packages/web/src/components/index.ts` and
> `services/api/index.ts`, where it survives in comments only.

**AC7 is enforced structurally.** Rather than open each dialog and assert the title held still,
the coverage test asserts that `useDocumentTitle` is called only from pages and from
`RouteTitle`. If no overlay can call it, no overlay can move the title. That also covers
`QuickReferenceExport` (§6.4) without depending on how the heading question there is settled.
