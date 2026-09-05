# Casing standard — migration inventory and citation classification

**Project:** Careerpin
**Owner:** Copywriter / Editor
**Status:** 📏 Measurement record. **Decides nothing.** Filed under WIC-2112, carrying WIC-2096.
**Measured at:** `origin/main` `0922bed9`, 2026-09-05

---

## What this is, and what it is not

[`CONTENT_STYLE.md`](./CONTENT_STYLE.md) proposes sentence case for every UI string. **That
proposal has not been ratified.** The board decision is live on WIC-1066 as an
`ask_user_questions` with three options; until it is answered, the sentence-case rule is a
proposal and this document does not treat it as anything else.

This file exists because the same measurement is needed under **every** outcome:

| if the board… | this inventory is… |
|---|---|
| **ratifies + migrates** | the work-list, staged into child issues by area |
| **withdraws the standard** | the list of sentence-case strings to invert |
| **defers again** | the reason nobody re-derives it a fourth time |

⛔ **Nothing here has been applied.** No UI copy was changed, no doc's status was changed,
and none of the citations classified below were edited. Editing them now would pre-empt the
board and, under a ratify ruling, would be churn we immediately revert.

---

## Part 1 — the inventory is a script, not a table

The prior counts (93/7, then 77/13) came from hand-rolled greps, and they disagreed with
each other and with a third hand count. The inventory now lives in
[`ui-string-casing-inventory.py`](./ui-string-casing-inventory.py) so it can be re-run
instead of re-argued.

```bash
python3 docs/design/ui-string-casing-inventory.py                       # summary + per-area
python3 docs/design/ui-string-casing-inventory.py --strings             # the work-list
python3 docs/design/ui-string-casing-inventory.py --strings --case sentence
python3 docs/design/ui-string-casing-inventory.py --counterexamples     # the arbitration
python3 docs/design/ui-string-casing-inventory.py --json                # for staging issues
python3 docs/design/ui-string-casing-inventory.py --selftest            # offline, ~1s
```

**It always exits 0 and is deliberately not wired into `deploy.yml` or `docs-audit.yml`.**
A check that fails the build is a check that enforces a rule, and this rule is not adopted.
Adding an enforcing mode is a decision for *after* WIC-1066, not a drive-by.

It is a **sibling** of [`wireframe-casing-audit.py`](./wireframe-casing-audit.py), not a
mode inside it. WIC-2112 predicted that script was the right host and asked for the
prediction to be falsified cheaply; it is falsified. That script reads markdown wireframes
and answers a positional question about ALL-CAPS row labels; this one reads TSX and answers
a per-word question about title vs sentence case. No shared scope, input format, parser or
verdict — and that script is the *enforcing* gate at `deploy.yml:81`, so a second
non-enforcing mode would put a flag that changes exit semantics inside a build gate.

### Counts at `0922bed9`

⚠️ **Do not quote these numbers. Re-run the script.** They are a snapshot; the tree moves.

| bucket | title | sentence | note |
|---|---:|---:|---|
| **chrome** | **352** | **429** | the strings the rule is about |
| sample | 31 | 11 | `e.g.` placeholders, `<option>` mock records, `mock*` fixtures |
| derived | 20 | 2 | `constants/title.ts` — the §5 route-title mirror table |
| dynamic | — | — | 60 template literals with `${}`; listed, never guessed at |
| all-caps | — | — | governed by the WIC-1209 clause, already in force |

Per area, chrome only (title / sentence):

| area | title | sentence |
|---|---:|---:|
| `components` | 150 | 154 |
| `pages` | 142 | 173 |
| `components/onboarding` | 27 | 45 |
| `components/wizard` | 13 | 31 |
| `components/CatalogDiff` | 9 | 8 |
| `components/CatalogBrowse` | 8 | 5 |
| `constants` | 2 | 7 |
| everything else | 1 | 6 |

**The headline ratio moved.** WIC-2096 reported 77/13 — roughly 86% title case. Measured
over a wider and comment-stripped extraction, it is **352/429, about 45% title case**. Both
numbers are "real"; they count different populations. WIC-2096 counted headings and
button/link labels only. This counts every UI string the three channels can reach, which
pulls in validation messages, confirm dialogs and empty states — copy that
`CONTENT_STYLE.md` itself notes "is already sentence case ... in the tree". **The migration
is smaller as a fraction and larger in absolute terms than the doc's framing suggests.**

### Two staging traps

Both would have bitten a naive "migrate all title-case strings" card:

1. **`constants/title.ts` (20 strings) must never be migrated on its own.** Every entry is
   a route's `<h1>` *verbatim* — the file annotates each line with the `Component.tsx:line`
   it mirrors — and `route-title-table-audit.py` **enforces** that mirroring in
   `deploy.yml`. These strings move when their heading moves, for free. Touch them
   independently and the build goes red. Bucketed as `derived`.
2. **Mock and sample data is not chrome.** `mockApplicationService.ts` holds
   `Senior Frontend Engineer`, `TechCorp Inc`, `San Francisco, CA`; `ApplicationForm.tsx`
   holds `placeholder="Jane Smith, Engineering Manager"` and two hardcoded
   `<option>` records. Job titles, company names and sample people are user data standing
   in for records. Retitling them would be wrong under both outcomes. Bucketed as `sample`.

---

## Part 2 — the five counter-examples, arbitrated

`CONTENT_STYLE.md` "The rule" gives five ❌/✅ pairs. WIC-2096 and the WIC-2112 dispatch
measured them by raw `git grep -F -c` and **disagreed with each other**. Re-measured over
extracted UI strings with comments stripped:

| doc's ✅ form | WIC-2096 ✅ | dispatch ✅ | **script ✅** | dispatch ❌ | **script ❌** |
|---|---:|---:|---:|---:|---:|
| `Analyze fit` | 0 | 0 | **0** | 1 | **1** |
| `Job fit analysis` | 0 | 2 | **0** | 17 | **8** |
| `Generate resume variant` | 0 | 0 | **0** | 3 | **3** |
| `Back to dashboard` | 0 | 1 | **1** | 2 | **2** |
| `Try again` | 0 | 1 | **0** | 4 | **4** |

**Each prior count was right about something and wrong about something else.**

- **The dispatch's ✅=2 for `Job fit analysis` is prose.** Both hits are JSDoc:
  `types/jobFit.ts:181` and `:195` (`* Job fit analysis error codes`). WIC-2096 was right.
- **The dispatch's ❌=17 for `Job fit analysis` is inflated the same way** — 8 are real UI
  strings, the rest are comments and doc prose. The direction was never in doubt.
- **The dispatch's ✅=1 for `Back to dashboard` is real, and WIC-2096's 0 is wrong.**
  `NotFound.copy.ts:23` sets `primaryAction: 'Back to dashboard'`, rendered at
  `NotFound.tsx:103`. See the correction below.
- **The dispatch's ✅=1 for `Try again` is a substring artifact.** It falls inside the
  longer message at `OnboardingModal.tsx:265` ("...Try again — we won't create a second
  one."), which is a sentence in a paragraph, not an instance of the button label.

### ⚠️ One factual correction owed to `CONTENT_STYLE.md`

Its adoption-status section states:

> `Back to dashboard` — the string WIC-1063 arbitrated, and the reason this document
> exists — does not appear in the codebase at all

**That is false at `0922bed9`.** It appears at `packages/web/src/pages/NotFound.copy.ts:23`
and is rendered at `NotFound.tsx:103`. The whole 404 copy block is already sentence case
(`That page couldn't be found`, `Search applications`, `Address you tried:`) and is owned
by Copywriter/Editor under WIC-1051. The related claim that "three of the five ✅ forms
appear zero times" should read **four of five**, with `Back to dashboard` appearing once.

**This has deliberately not been fixed here.** WIC-2112 fences edits to that section on the
grounds that the board is reading it, and that fence is right — but the board should read it
knowing this one sentence is wrong. The direction of the doc's argument is unaffected: the
❌ forms still outnumber the ✅ forms at every one of the five pairs.

---

## Part 3 — citation classification

WIC-2096 recorded "8 docs cite it as authority" and treated that as one work item. **It is
not one shape, and the count is both an overcount and an undercount.**

- **Overcount as work:** of the 24 citation sites, only **10** treat the unadopted
  sentence-case rule as settled. The other 14 are correct as written.
- **Undercount as sites:** 8 *files*, but **24 lines**. The dispatch classified 11 of them;
  the remaining 13 were unclassified. All 24 are below.

Had this shipped as "fix all 8", roughly nine of the edits would have been wrong.

### Group A — cites the ALL-CAPS clause. In force via WIC-1209. **Leave alone.**

| site | what it says |
|---|---|
| `COMPONENT_SPECS.md:136` | cites §"ALL CAPS is a typographic treatment, not casing" for scope |
| `DESIGN_SYSTEM.md:517` | "settled in `CONTENT_STYLE.md` § *ALL CAPS is a typographic treatment*" |
| `JOBFIT_CAPS_DECISION_WIC1122.md:83` | "is spelled in caps in source" |

### Group B — cites Exception 1 / the product-name ruling. In force via WIC-1102. **Leave alone.**

The dispatch's three-shape model did not have this group; it is the second clause
`CONTENT_STYLE.md` itself lists as independently in force.

| site | what it says |
|---|---|
| `ROUTE_TITLE_CONVENTION.md:403` | "The reasoning is in `CONTENT_STYLE.md` under Exception 1" |
| `ROUTE_TITLE_CONVENTION.md:474` | "the ruling reached the repo late (`CONTENT_STYLE.md` Exception 1)" |
| `packages/api/src/constants/product.ts:8` | "Exception 1, for the ruling" |
| `packages/api/src/services/interviewPrep.service.ts:1169` | "see `CONTENT_STYLE.md`, Exception 1" |
| `packages/web/src/constants/title.ts:40` | "under Exception 1" |
| `packages/api/test/interview-prep.export.test.ts:76` | pins the WIC-1953 export byline |

### Group C — already hedged as a pending decision. **Leave alone.**

| site | what it says |
|---|---|
| `ROUTE_TITLE_CONVENTION.md:25` | "immune to the casing decision in `CONTENT_STYLE.md`" |
| `ROUTE_TITLE_CONVENTION.md:155` | "on the surface this work depends on that decision" |
| `ROUTE_TITLE_CONVENTION.md:462` | quotes §0.3's immunity claim |

### Group D — treats sentence case as settled house style. **The only group in scope.**

| site | what it says |
|---|---|
| `COMPONENT_SPECS.md:317` | "`CONTENT_STYLE.md` governs heading copy and asks for sentence case" |
| `ROUTE_HEADING_OUTLINE.md:17` | "(heading copy is sentence case)" |
| `ROUTE_HEADING_OUTLINE.md:215` | "sentence-cased per `CONTENT_STYLE.md` — not invented" |
| `ROUTE_HEADING_OUTLINE.md:242` | "per `CONTENT_STYLE.md`" |
| `ROUTE_TITLE_CONVENTION.md:463` | "`Sign In` was title case, which `CONTENT_STYLE.md` does not permit" |
| `ROUTE_TITLE_CONVENTION.md:481` | "a rule whose *exception list is closed*" |
| `SAVED_FILTER_SHORTCUT_NAMING.md:122` | "sentence case for every UI string" |
| `DIALOGUE_CAPTURE_WIZARD.md:92` | "**Confirm copy** — follow `CONTENT_STYLE.md`" |
| `README.md:123` | index entry: "Define how UI strings are written" |
| `README.md:239` | reading order: "**CONTENT_STYLE.md** — Write the strings" |

**Under a ratify ruling all ten become correct on their own** and need no edit. Under a
withdraw ruling all ten need hedging. That is precisely why none was touched.

### Group E — dangling section references. **Broken independent of the ruling.**

| site | cites | problem |
|---|---|---|
| `JOBFIT_CAPS_DECISION_WIC1122.md:292` | "the casing rule §1.3 applies" | `CONTENT_STYLE.md` has no numbered sections; there is no §1.3 |
| `ROUTE_TITLE_CONVENTION.md:325` | "casing of the underlying strings (§4)" | likewise, no §4 |

`CONTENT_STYLE.md`'s headings are named, not numbered (`## The rule`, `## Exceptions`,
`## Casing by slot`, `## ALL CAPS is a typographic treatment, not casing`, …). These two
references resolve to nothing today and will resolve to nothing under either ruling.
`doc-reference-audit.py` does not catch them: it validates cited *filenames*, not section
anchors, which is why they have survived.

**These are the only two citation sites fixable now without pre-empting the board** — and
they are still not fixed here, because this card's fence is "produce the classified list,
do not edit the docs". They are the cheapest item on whichever card follows.

---

## Related

- [`CONTENT_STYLE.md`](./CONTENT_STYLE.md) — the proposal being measured
- [`ui-string-casing-inventory.py`](./ui-string-casing-inventory.py) — the re-runnable inventory
- [`wireframe-casing-audit.py`](./wireframe-casing-audit.py) — the ALL-CAPS clause, enforcing
- [`ROUTE_TITLE_CONVENTION.md`](./ROUTE_TITLE_CONVENTION.md) — §5, the mirror table that makes `constants/title.ts` derived
