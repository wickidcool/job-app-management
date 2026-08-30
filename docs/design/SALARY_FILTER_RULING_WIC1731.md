# Ruling: salary filtering is dropped (WIC-1731)

**Status:** Decided. **Decided by:** UI/UX Developer, owner of `COMPONENT_SPECS.md`.
**Date:** 2026-08-30.
**Scope:** The salary *filter* in COMPONENT_SPECS §6 (FilterPanel) only.
**Measured against:** `origin/main` @ `ac490f9` and PR #221 @ `43bbcb6`.

The one-paragraph version lives in [`COMPONENT_SPECS.md`](./COMPONENT_SPECS.md) §6, next
to the `FilterOptions` block it governs. This file is the evidence behind it.

---

## The decision

**Salary filtering is not wanted and is dropped.** WIC-1731 offered two outcomes —
drop it with a recorded reason, or keep it as a tracked implementation gap. This is
option 1. WIC-1731 closes; no implementation card is opened.

Salary remains **captured and displayed**. This ruling removes nothing a user can see
today.

## Why

### 1. Salary is free text, and the specified control needs a number

The spec asked for a range slider — *min $0k, max $500k, step $10k*. Nothing numeric
exists to drive it.

| Layer | Declaration | Source |
| ----- | ----------- | ------ |
| Database | `salary_range TEXT` (nullable) | `docs/architecture/DATA_MODEL.md:74` |
| ORM | `salaryRange: text('salary_range')` | `DATA_MODEL.md:150` |
| API | `salaryRange?: string` — "Optional, 1-50 chars" | `API_CONTRACTS.md:408` |
| Web type | `salaryRange?: string` | `packages/web/src/services/api/types.ts:24` |
| Capture | plain text input, `z.string().optional()` | `ApplicationForm.tsx:25,326` |

`salaryMin` / `salaryMax` on `FilterOptions` were the **only** numeric salary anywhere in
the repository. Nothing produced them, nothing consumed them.

### 2. The format is not merely unvalidated — it is already inconsistent

The repo's own fixtures spell it three ways:

- `'$140k - $180k'` — `mockApplicationService.ts:10`
- `'$150k-180k'` — `API_CONTRACTS.md:304`
- `'$180k-220k'` — `API_CONTRACTS.md:823`

Spacing around the dash already varies inside our own examples. A real user is
additionally free to enter an hourly rate, a non-USD currency, a single figure, a range
with no unit, or "DOE" / "Competitive" — all valid against `string`, 1-50 chars.

### 3. The unanswerable question is what to do with rows that will not parse

A numeric bound must decide the fate of every row it cannot read, and both answers are
bad:

- **Exclude them** — the filter silently hides an unknown, probably large share of the
  user's own applications. On an *optional* field, "unparseable" and "never filled in"
  are the common cases, not the edge ones.
- **Include them** — "$0k–$50k" returns rows that plainly do not match, and the control
  stops meaning anything.

Nothing in the spec ever chose. That is the tell that the control was drawn, not
designed. For a job seeker, quietly dropping applications out of a list is a materially
worse failure than having no salary filter at all — the user cannot tell it happened.

### 4. Nothing promised it

US-6.3 is P0/MVP and accepted. Its filter clause reads:

> **Filter by status, company, date**
> — `WIC-15.plan.md:48`

Salary is absent. This is the substantive difference from `dateRange`, whose four-month
fossil (WIC-1613) prompted this whole line of work: `dateRange` was **owed** and missing,
so the fix was to build it. Salary was never owed, so the fix is to stop advertising it.
Verified against the plan text quoted in WIC-1613, not inferred from PR #221's summary.

## What it would take to revisit

Salary filtering is a **data-model change first**, not a filter-panel task:

1. Capture structured bounds on `Application` — a numeric minimum and maximum, plus a
   currency and a period (annual / hourly). That is an API contract change, a migration,
   and a form change.
2. Decide the back-compat rule for existing free-text `salary_range` values, including
   the ones that will never parse.
3. Only then respecify the control here, against fields that exist.

Re-opening this as "add a salary slider to FilterPanel" would reproduce exactly the
fossil §6 now exists to prevent. If that day comes, this ruling is superseded — strike
it and say why, the same way it was made.

## Related

- **WIC-1613** / PR #221 — struck `salaryMin`/`salaryMax` from §6 and added the
  `activeOnly` field that was built but never specified. This ruling stacks on it and
  supplies the decision that PR deliberately left open.
- **WIC-1731** — this card.
- **WIC-15** US-6.3 — the accepted requirement.

## Also fixed here

§6's **Focus Order** line survived PR #221 unchanged, still reading
`Search → Status → Company → Date → Salary`. It named a control the same PR had just
deleted, and omitted **Active Only**, the `role="switch"` toggle that PR added. It is now
transcribed from the rendered DOM order in `FilterPanel.tsx` — Active Only sits **second**,
directly after Search, not last. Prose corrections that miss the neighbouring
representation are how a spec keeps a stale promise after the obvious edit is made.
