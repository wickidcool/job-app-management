# Ruling — saved-filter shortcut naming

**Card:** WIC-1775 (routed via WIC-1812) · **Decided by:** UI/UX Developer · **Date:** 2026-08-30
**Measured at:** `origin/main` `a46c63a`

**Revisited:** WIC-2192 → WIC-2194 · **Decided by:** Code Reviewer · **Date:** 2026-09-07
**Re-measured at:** `origin/main` `9d769f05`

---

## The ruling, in one line

**A filter shortcut's label names what the filter selects. It never names a time window the
filter does not apply — and a shortcut whose destination ignores its filter must be wired up,
not merely renamed.**

**This one line is unchanged, and it is what the revisit applied.** The 2026-08-30 ruling could
only satisfy it by removing the label, because there was nothing to wire up. There is now, so
the same rule is satisfied the other way: the window is applied and the label is true.

| surface | 2026-08-30 | **2026-09-07** |
|---|---|---|
| `CommandPalette.tsx` · `SavedFilterShortcuts.tsx` | `Interviews This Week` → `Interviewing` | **`Interviews This Week`, now with the window** |
| `CommandPalette.tsx` · `SavedFilterShortcuts.tsx` | `Recently Applied` → `Applied` | **`Applied` — unchanged** |

The two rows diverge on purpose. There is still no "applied this week" filter, so `Applied`
stays the honest label; `Interviews This Week` earns its label by applying an interview-date
window. **A rule that produced the same answer for both regardless of the filters behind them
would not be the rule this document states.**

Both labels come from one constant, `packages/web/src/constants/filterShortcuts.ts`, which now
also holds the shortcut *filters* — so the two surfaces cannot drift apart on the window any
more than they can on the text.

---

## ⚠️ The section below is SUPERSEDED — read the revisit first

Everything from here to "Why relabelling alone would not have fixed the command palette" was
correct when measured and is **false today**. It is kept rather than deleted because the
condition it turns on is the whole reason the ruling was revisitable at all, and because a
reader who finds only the conclusion will re-derive the wrong one. The current position is in
[the revisit](#the-revisit-2026-09-07--option-2-is-adopted).

## Option 2 is rejected: there is no interview-date field to filter on

WIC-1775 offered a second fix — "give the filter the window its label promises" — conditional on
an interview-date field existing. **It does not exist at any layer.** Measured:

| layer | file | result |
|---|---|---|
| database | `packages/api/src/db/schema.ts` `applications` | no interview-date column. The only dates are `appliedAt`, `nextActionDue`, `createdAt`, `updatedAt` |
| API DTO | `packages/api/src/types/index.ts` | no interview-date field |
| web model | `packages/web/src/types/application.ts` | no interview-date field |

The single `interviewDate` in the codebase is `ApplicationSummary.interviewDate` in
`packages/web/src/types/interviewPrep.ts` — a view model, not a persisted column.

So option 2 is a **feature, not a fix**: it needs a schema migration, an API field, a form
control to populate it, and `dateRange` filter plumbing. Per WIC-1775's own instruction ("if it
does not, option 2 is a feature, not a fix, and should be split"), it is split out and not done
here.

### Two dead-code findings that fell out of that measurement

Neither was fixed here — both were noted so the next person did not mistake them for working
plumbing. **Both have since been resolved, and the descriptions below are historical:** finding 1
by WIC-2188 (which populates `Application.interviewDate` at the API boundary) with the render
sites asserted by WIC-2192 / PR #444, and finding 2 by WIC-1613 (which wired `dateRange` to
`filterByDateRange`). Do not re-file either.

1. **`InterviewPrepPage.tsx:287,368` read a property that does not exist.** Both sites spread
   `applicationSummary` and then override with `interviewDate: application.interviewDate`, where
   `application` is an `Application` — a type with no `interviewDate`. The value is **always
   `undefined`**, so the interview-date render sites in `InterviewPrepCard.tsx:138` and
   `QuickReferenceExport.tsx:93` are permanently dark. TypeScript does not catch it because the
   target property is optional.
2. **`FilterOptions.dateRange` has zero consumers.** It is declared at `FilterPanel.tsx:8` and
   read nowhere: `ApplicationsList` maps only `status`, `search`, `company` and `activeOnly` into
   its API filter. The one window field the filter contract already has is not wired to anything.

---

## Why relabelling alone would not have fixed the command palette

This is the part WIC-1775 did not have, and it changes the fix.

**The palette's `?status=` query string was never read.** `ApplicationsList` imported
`useNavigate` only — no `useSearchParams`, no `location.search` — and initialised
`useState<FilterOptions>({})`. `/applications` is the route for `ApplicationsList` (`App.tsx:93`).

So the palette entry did not filter by status either. It was not "status-only, no time window";
it was **no filter at all** — the user landed on the complete unfiltered list, `rejected` and
`withdrawn` rows included. Three of the palette's four shortcuts were inert this way
(`Interviews This Week`, `Recently Applied`, `Active Offers`); only `Needs Follow-up` had a real
destination, `/reports/stale`.

That makes the relabel insufficient on its own: renaming the palette entry to `Interviewing`
while the destination still ignored the filter would have replaced one false label with another.
**Both halves had to land together**, and they do:
`ApplicationsList` now parses `?status=` through `parseStatusParam` and seeds its filter state
from it.

Unknown status tokens are dropped rather than forwarded, so a hand-typed
`/applications?status=nonsense` filters nothing instead of sending the API an enum member it does
not have.

---

## Why the scope is four sites, not the two that were reported

`Recently Applied` carries the **identical defect** — `{ status: ['applied'] }`, no window —
and sits in the same two arrays, one entry away. Ruling on `Interviews This Week` alone would
have repeated, one level up, exactly the mistake WIC-1775 warned against: *"do not relabel one
surface without the other."* The unit that has to stay consistent is the shortcut row, not the
one label that got reported.

---

## The revisit, 2026-09-07 — option 2 is adopted

**Decided by the Code Reviewer on WIC-2194, re-measured at `origin/main` `9d769f05`.**

### The condition flipped

Option 2 was rejected *conditionally*: "conditional on an interview-date field existing … if it
does not, option 2 is a feature, not a fix, and should be split." It was split, the feature
shipped, and every layer the table above marked absent now has the field:

| layer | shipped by | state at `9d769f05` |
|---|---|---|
| database | WIC-2023 | `applications.interview_date`, `TIMESTAMPTZ` |
| API DTO | WIC-2023 | `toDTO` emits `interviewDate` |
| web model | WIC-2188 | `Application.interviewDate`, populated at the boundary |
| write path | WIC-2188 | `datetime-local` control |
| **query params** | **WIC-2189** | **`interviewDateFrom` / `interviewDateTo`, validated and tested** |

So the ruling's own precondition for option 2 is satisfied, and its one-line rule — *"must be
wired up, not merely renamed"* — now endorses the wiring it once had to refuse.

### Why server-side, and not the cheaper client-side route

Both were priced. Client-side would have reused the sanctioned `ApplicationsList` pattern over
the already-exhaustively-paged collection, with no API change. It was rejected:

- **The server capability was already shipped, validated, tested — and unreachable.**
  `buildListQuery` sent only `status`/`company`/`search`/`limit`/`page`, so WIC-2189's params
  were dark code. Filtering client-side leaves them dark.
- **It would have built a second implementation of one predicate.** `filterByDateRange` is
  hardcoded to `appliedAt ?? createdAt`, so a new predicate was needed either way — and two
  implementations of one filter is exactly the drift class this document exists to prevent, the
  same shape as the `CommandPalette`/`SavedFilterShortcuts` duplication that
  `FILTER_SHORTCUT_LABELS` was created to end.
- **"Cheaper" was only true in the short run**, since the server route would still have needed
  wiring later.
- **Correct at any size beats correct to 5,000 rows** for a filter whose purpose is *"did I miss
  an interview?"*.

### `wire-only` was rejected: a hidden filter is worse than a lying label

Applying the window while keeping the label `Interviewing` inverts the defect rather than fixing
it — the filter would apply a window the label does not name, so the user silently gets only this
week's rows with no way to tell why the rest are missing. The label and the filter move together.
The enforcement test now checks **both** directions for this reason.

### What "this week" means

**Calendar week: Monday 00:00:00.000 through Sunday 23:59:59.999, in the browser's timezone.**

- *Rolling 7 days* is honestly `Next 7 Days`; calling it "This Week" would re-create in miniature
  the label-vs-filter defect this ruling exists to prevent.
- *Rest of the week* hides interviews earlier in the week that already happened, which is not
  what "this week" means to anyone reading it — and is the opposite of what this filter is for.

⚠️ **Known inconsistency, recorded rather than silently resolved.** `FilterPanel`'s own
`This Week` date preset starts on **Sunday** (date-fns' default `weekStartsOn: 0`) and ends
*today*. It is a different control over a different field (date added/applied), so the two are
not interchangeable — but they do disagree about which day a week starts. Changing a shipped
preset's meaning was outside WIC-2194's scope, and deviating from this ruling's explicit
Monday start to match it would have been worse. Whoever unifies them should do it deliberately,
in one card, with a decision recorded here.

### The bounds are instants with offset, not `YYYY-MM-DD`

The single constraint most likely to be got wrong, because it is the *opposite* of the
convention the sibling `dateRange` filter uses. `GET /api/applications` validates both bounds
with `z.string().datetime({ offset: true })`, so a date-only bound is a **400**, deliberately:
`new Date('2026-09-07')` reads as UTC midnight and shifts the window by up to a day for anyone
west of Greenwich. The conversion lives in `packages/web/src/utils/interviewWeek.ts` and nothing
else should construct these strings. The bounds stay **strings** through `FilterOptions`, for the
same `JSON.stringify` reason `DateRangeFilter` documents.

A `NULL` interview date falls out of either bound on its own, so the shortcut shows exactly the
scheduled interviews with no `activeOnly`-style companion flag.

### The palette carries a marker, not a date

`CommandPalette` navigates rather than emitting `FilterOptions`, so its half of the shortcut
travels through the URL as `?interviewWindow=this-week`, resolved by `ApplicationsList` on
arrival. **Do not put resolved instants in that link** — it is a module-level string, so a baked
window would be correct until the following Monday and would freeze one week into every bookmark.

---

## For implementers

- **The naming rule is enforced by test**, not convention:
  `packages/web/src/constants/filterShortcuts.test.ts`.

  It asserts the **biconditional** — *a label names a time window if and only if its filter
  applies that window* — over the shortcut registry, not a time-word ban over the labels alone.
  Adding `Closing This Month` over a status-only filter still breaks the build; so now does
  applying a window under a label that names none. Both mutants are pinned as explicit cases.

  ⚠️ **The old form banned time words outright.** That was a *proxy*, exact only while no
  shortcut could apply a window, and it would have banned this fix. Replacing it is a
  strengthening: it catches the hidden-filter direction the ban could not see. **Do not
  "restore" the ban.**
- **Assert the label and its filter together.** Each is defensible alone; only the pair is wrong.
  That is why `SavedFilterShortcuts.test.tsx` clicks the shortcut and asserts the emitted
  `FilterOptions`, rather than snapshotting the text.
- **Shortcut `id`s are unchanged** — `interviews-this-week` and `recently-applied` remain, so the
  ids no longer match their labels. Deliberate: ids are compared against user entries in
  `localStorage` under `wic-saved-filters`, and renaming them buys nothing a user can see. Only
  `name` is rendered.
- Predefined shortcuts are **not** persisted by name, so the rename needs no migration.

## Related

- **WIC-1743 / PR #260** — the window-metric half (`Applied This Week` on the Dashboard).
  ⚠️ **PR #260 was still open at `a46c63a`.** WIC-1775 cites
  `packages/web/src/constants/appliedWindow.ts` as "added by WIC-1743" and as the pattern to
  follow; that file exists only on `fix/wic1743-window-metric-labels` and is **not on `main`**.
  This ruling therefore follows the *shape* of that pattern (a shared constant plus tests)
  without importing from it.
- **WIC-143** `plan` — **AC-N12**, *"Every surface that renders a window metric labels the window
  it actually measures."* A shortcut renders no metric, so AC-N12 does not reach it. This
  document is the governing criterion for the navigation-target case, and does not widen AC-N12.
- **`docs/design/CONTENT_STYLE.md`** — sentence case for every UI string. `Interviewing` and
  `Applied` are single words and so comply either way. `Needs Follow-up` and `Active Offers` are
  left in title case: they are outside this ruling's scope and belong to the casing migration,
  not here.
