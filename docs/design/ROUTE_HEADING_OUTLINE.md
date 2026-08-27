# Route heading outline — who names the route, and who names the panel

**Issue:** WIC-1581
**Author:** UI/UX Developer
**Status:** ruling; `/outreach/new` and `/resumes/exports` implemented in the same PR
**Related:** `COMPONENT_SPECS.md` §10 → "Heading level" (WIC-1417),
`COVER_LETTER_PANE_LABELLING.md` (WIC-1569 — the ruling this one's `<h1>` rule is a tripwire for;
see its §3), WIC-1571, WIC-1563

---

## 0. The ruling

**A component that is the sole body of a route must not render a heading that names the route.**

The page `<h1>` names the route. The component's own top-level sections are its `<h2>`s. A
component-level heading repeating the `<h1>` names nothing the page has not already named, and
costs a heading-navigation stop to say it.

Where the component's top heading slot sits inside chrome that carries meaning of its own — a
wizard progress bar is the only instance today — that slot keeps its text but gets copy for
**what the chrome actually is** (progress), not a second copy of the route name, and stops being
a heading.

This is option 2 from WIC-1581 for two routes and option 3, narrowly, for the third. Option 1
(keep the repetition) is rejected on §3.

## 1. Corrections to the WIC-1581 premise

Measured on `origin/main` @ `d84da39`. Three things in the ticket do not survive measurement, and
two of them change what needs doing.

### 1.1 There are two live instances, not one

The ticket found `/outreach/new`. A full sweep — every static `<h1>` and `<h2>` string in
`pages/` and `components/`, intersected — finds a second:

| route | page `<h1>` | component `<h2>` | live? |
|---|---|---|---|
| `/outreach/new` | `OutreachNew.tsx:29` — `Compose Outreach Message` | `OutreachComposer.tsx:129` — same | **yes** |
| `/resumes/exports` | `ResumeExports.tsx:52` — `Resume Exports` | `ResumeExportList.tsx:55` — same | **yes** |
| `/cover-letters/new` | *none* | `CoverLetterGenerator.tsx:181` — `Generate Cover Letter` | no — see §1.2 |

Those are the only two exact page-`<h1>`/component-`<h2>` collisions in the tree. The sweep is
reproducible: intersect the static heading strings, then check the mount site.

### 1.2 WIC-1571 has not shipped, so `/cover-letters/new` is not duplicated yet

`CoverLetterNew.tsx` on `origin/main` contains no `<h1>` — no heading of any level — and
`CoverLetterNew.test.tsx` does not exist. There is no open or merged PR for WIC-1571 and no
branch carrying it.

This is good news for sequencing rather than a problem. The `/cover-letters/new` `<h1>` and the
generator's `<h2>` can land **in the same commit**, so that route never ships the duplicate at
all. The ticket's framing — that WIC-1571 "propagated the pattern to a second route" — describes
an intent, not the tree. Nothing needs unwinding there.

### 1.3 Option 2 as written introduces the heading skip its own constraints forbid

The ticket says removing the component `<h2>`s is open because `CoverLetterNew.test.tsx` does not
pin the `<h2>` wording. But every one of these three `<h2>`s has `<h3>`s beneath it, and nothing
else in between:

| component | headings below the `<h2>` |
|---|---|
| `OutreachComposer` | `<h3>Context</h3>` (`:154`) |
| `ResumeExportList` | `<h3>{exportItem.name}</h3>` (`:96`, per row) |
| `CoverLetterGenerator` | six `<h3>`s (`:215, :317, :357, :404, :456, :561`) |

Delete the `<h2>` and the page goes `h1 → h3`. That is a skip, it is exactly what WIC-1563 is
closing elsewhere in this codebase, and `CoverLetterNew.test.tsx` — once it exists — is specified
to fail on it.

**So the change is "drop the `<h2>` *and* promote the `<h3>`s", not "drop the `<h2>`".** The
resulting outline is not merely legal, it is better: it names the page's actual sections instead
of restating the route.

```
before (/outreach/new)          after
  h1 Compose Outreach Message     h1 Compose Outreach Message
    h2 Compose Outreach Message     h2 Context
      h3 Context
```

## 2. Why not make the heading a prop

`COMPONENT_SPECS.md` §10 already answers this, in its scope bullet:

> This treatment is for **shared presentational components rendered at more than one nesting
> depth**. A single-call-site feature panel's heading level is effectively part of its page's
> outline and belongs in the page's own audit.

All three components here have exactly one mount site — `OutreachComposer` only in
`OutreachNew.tsx:59`, `ResumeExportList` only in `ResumeExports.tsx:61`, `CoverLetterGenerator`
only in `CoverLetterNew.tsx:102`. They are single-call-site feature panels, so their headings are
part of their pages' outlines and the `headingLevel` treatment (`EmptyState`, `CoverLetterPreview`)
does not apply. Adding a prop for a second mount that does not exist buys ceremony against a
hypothesis.

If a second mount site appears, the person adding it owns the prop then — at which point the
component genuinely renders at two depths and §10 applies on its own terms.

## 3. Why not keep the repetition

The re-anchoring argument in WIC-1581 option 1 has no factual basis on these routes: both
duplicate `<h2>`s are above the fold, roughly 200px below their `<h1>`, with no scroll between
them. There is no scrolled state in which the `<h2>` re-anchors anything.

What the repetition does cost is real, if small. Heading navigation is the primary way a screen
reader user skims a page; `H` twice yielding the same words at two levels spends the outline's
budget saying nothing. And a heading that duplicates its parent trains readers — sighted ones
included — that headings on this product are decorative, which is the habit that makes the *next*
heading defect invisible.

Repetition is cheap when it is redundant against a different modality. Here both copies are text,
stacked, in the same viewport.

## 4. Per-route outcome

| route | change | status |
|---|---|---|
| `/outreach/new` | delete `OutreachComposer`'s `<h2>`; `<h3>Context</h3>` → `<h2>` | done, this PR |
| `/resumes/exports` | delete `ResumeExportList`'s `<h2>`; per-row `<h3>{name}</h3>` → `<h2>`; the header row keeps its **Create New** button and becomes `justify-end` | done, this PR |
| `/cover-letters/new` | the step-bar `<h2>` becomes a non-heading `Step {n} of 4` label; the six step-section `<h3>`s → `<h2>`; `CoverLetterPreview`'s `headingLevel` follows | **WIC-1571**, to land with the new `<h1>` |

On the third row: replacing the step-bar heading with `Step {n} of 4` is not a consolation prize
for deleting it. That slot sits beside a 1-2-3-4 indicator whose state is currently conveyed only
by colour — filled, green, grey — which is a `docs/design/ACCESSIBILITY.md` "colour is not the
sole indicator" problem independent of this ticket. Naming the step in text fixes that in the same
line that removes the duplication, and it is the one place among the three where the slot has
something of its own to say.

## 5. The rule for new routes

When adding a `/new` route or any route whose body is a single component:

1. The page owns the `<h1>` and it names the route's action — `Compose Outreach Message`,
   `Generate Resume Variant`. This is the existing convention; it is now written down.
2. The component starts at `<h2>`. It does not restate the route.
3. If the component is later mounted somewhere nested, that is when `headingLevel` appears,
   per `COMPONENT_SPECS.md` §10.

## 6. Note on `ROUTE_TITLE_CONVENTION.md`

WIC-1581 reports that `ROUTE_TITLE_CONVENTION.md` does not exist in the tree. That is correct and
worth fixing separately: the document is real, it is WIC-1089's design output, and it lives only
in the UI/UX Developer's workspace. It also does not govern `<h1>` copy — it specifies
`document.title`, and its rule is that the title *mirrors* the `<h1>`, which makes it a consumer
of this document rather than a peer.

Filed as a follow-up: design docs that constrain implementation belong in `docs/design/`, or
implementers correctly conclude the constraint does not exist. This ruling is in `docs/design/`
for that reason.
