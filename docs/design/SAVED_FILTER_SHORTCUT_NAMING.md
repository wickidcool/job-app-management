# Ruling — saved-filter shortcut naming

**Card:** WIC-1775 (routed via WIC-1812) · **Decided by:** UI/UX Developer · **Date:** 2026-08-30
**Measured at:** `origin/main` `a46c63a`

---

## The ruling, in one line

**A filter shortcut's label names what the filter selects. It never names a time window the
filter does not apply — and a shortcut whose destination ignores its filter must be wired up,
not merely renamed.**

| surface | was | is |
|---|---|---|
| `CommandPalette.tsx` · `SavedFilterShortcuts.tsx` | `Interviews This Week` | **`Interviewing`** |
| `CommandPalette.tsx` · `SavedFilterShortcuts.tsx` | `Recently Applied` | **`Applied`** |

Both labels now come from one constant, `packages/web/src/constants/filterShortcuts.ts`, so the
two surfaces cannot drift apart again.

---

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

Neither is fixed here — both are noted so the next person does not mistake them for working
plumbing.

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

## For implementers

- **The naming rule is enforced by test**, not convention:
  `packages/web/src/constants/filterShortcuts.test.ts` fails on any shortcut label containing a
  time word (`this`, `recent`, `week`, `month`, `upcoming`, …). Adding a shortcut called
  `Closing This Month` over a status-only filter breaks the build.
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
