# Route heading outline — who names the route, and who names the panel

**Issue:** WIC-1581
**Author:** UI/UX Developer
**Status:** ruling; `/outreach/new` and `/resumes/exports` implemented in the same PR.
**Revised 2026-08-27 (WIC-1598)** — §§1.2, 1.3 and 4 carried errors, one of which instructed a
change that would have deleted a shipped prop. Corrections are marked inline rather than silently
applied, because the errors are the useful part: see §1.2, §1.3 and especially **§4's correction
note**, plus the new §5 rules 4–6 that exist to stop the same class recurring.
**Revised 2026-09-01 (WIC-1886)** — §5 gains **rule 7**: on a route whose body is an always-open
modal, rule 1 is *wrong*, and `getOutline` could not see that it was wrong. Both halves are fixed
together, because the doc rule without the check is unenforceable and the check without the rule
explains nothing. Rule 1 is left as written and qualified by rule 7 rather than edited, per this
document's own convention of marking corrections inline.
**Related:** `COMPONENT_SPECS.md` §10 → "Heading level" (WIC-1417),
`COVER_LETTER_PANE_LABELLING.md` (WIC-1569 — the ruling this one's `<h1>` rule is a tripwire for;
see its §3), `CONTENT_STYLE.md` (heading copy is sentence case), WIC-1571, WIC-1563, WIC-1586,
WIC-1598, WIC-1675/PR #299 (the rendered route sweep), WIC-1886

> **Precedence.** Where this document and `COVER_LETTER_PANE_LABELLING.md` disagree about
> `CoverLetterPreview`'s `headingLevel`, **`COVER_LETTER_PANE_LABELLING.md` §3 governs.** It is the
> newer statement, it was written against a tree where the prop exists, and it is the ruling that
> put the heading there in the first place. This note is here so the next reader does not have to
> date three commits to work that out — which is what WIC-1598 had to do.

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
`CoverLetterNew.test.tsx` does not exist. ~~There is no open or merged PR for WIC-1571 and no
branch carrying it.~~

> **Correction (WIC-1598, 2026-08-27).** The struck sentence was false when written. PR #194
> (`fix/wic1571-cover-letter-new-h1`) was already open and carried WIC-1571. It is the second time
> a premise check in this family missed an open PR — see WIC-1563's thread. **Check `gh pr list`,
> not just `git log origin/main`, before writing "there is no branch."** A statement about what
> exists is measurable in one command; do not assert it from the default branch alone.
>
> The consequence was not cosmetic. "No branch carrying it" is what licensed §4's third row to be
> written as a fresh instruction rather than as a reconciliation with work already in flight — and
> that row went on to contradict a shipped prop. See §4's correction note.

The first two sentences still hold, and the sequencing point survives: the `/cover-letters/new`
`<h1>` and the generator's `<h2>` change land **in the same commit** (PR #194), so that route never
ships the duplicate at all. The ticket's framing — that WIC-1571 "propagated the pattern to a second
route" — describes an intent, not the tree. Nothing needs unwinding there.

### 1.3 Option 2 as written introduces the heading skip its own constraints forbid

The ticket says removing the component `<h2>`s is open because `CoverLetterNew.test.tsx` does not
pin the `<h2>` wording. But every one of these three `<h2>`s has `<h3>`s beneath it, and nothing
else in between:

| component | headings below the `<h2>` |
|---|---|
| `OutreachComposer` | `<h3>Context</h3>` (`:154`) |
| `ResumeExportList` | `<h3>{exportItem.name}</h3>` (`:96`, per row) |
| `CoverLetterGenerator` | **five** step-section `<h3>`s (`:215, :317, :357, :404, :456`) — plus one `<h3>` that is *not* a step section: `📝 Editor` (`:561`), a pane label inside step 4 |

> **Correction (WIC-1598, 2026-08-27).** This row previously read "six `<h3>`s
> (`:215, :317, :357, :404, :456, :561`)", counting the pane label as a sixth step section. That
> is a miscount of **kind**, not of arithmetic — the tally is right and the classification is
> wrong — and it is the single error that produced §4's contradiction with
> `COVER_LETTER_PANE_LABELLING.md` §3. `📝 Editor` names one half of a split view *within* step 4;
> promoting it alongside `Tone` and `Length` would make it a peer of the step sections it sits
> inside. See §4.
>
> The underlying fact the miscount hid: **step 4 had no section heading of its own.** Its only
> headings were the two pane labels. Steps 1–3 each own at least one. A sweep that promotes
> "the `<h3>`s" therefore does something different in step 4 than in the other three, and the
> table as written gave no way to see that.

Delete the `<h2>` and the page goes `h1 → h3`. That is a skip, it is exactly what WIC-1563 is
closing elsewhere in this codebase, and `CoverLetterNew.test.tsx` — once it exists — is specified
to fail on it.

**So the change is "drop the `<h2>` *and* promote the section `<h3>`s", not "drop the `<h2>`".**
The resulting outline is not merely legal, it is better: it names the page's actual sections
instead of restating the route. "Section" is load-bearing in that sentence — see §5 rule 4.

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
| `/cover-letters/new` | the step-bar `<h2>` becomes a non-heading `Step {n} of 4` label; the **five** step-section `<h3>`s → `<h2>`; **step 4 gains an `<h2>Review & edit</h2>` of its own**; the two pane labels (`📝 Editor`, `Cover Letter Preview`) stay at `<h3>` and **`headingLevel={3}` is unchanged** | **WIC-1571** / PR #194; row corrected and confirmed by **WIC-1598** |

> **Correction (WIC-1598, 2026-08-27) — this row previously retired a shipped prop.** It read:
>
> > the six step-section `<h3>`s → `<h2>`; `CoverLetterPreview`'s `headingLevel` follows
>
> Applied literally that is the ❌ branch of `COVER_LETTER_PANE_LABELLING.md` §3 — reached by
> demoting everything around the component rather than by promoting its `<h2>`, but landing in the
> same place: `CoverLetterGenerator` asks for `2` and `CoverLetterDetail` takes the default `2`, so
> the prop has **no non-default call site anywhere in the tree** and `COMPONENT_SPECS.md` §10's
> "more than one nesting depth" criterion fails. The prop and its guards, shipped in `38bd487`,
> would have been deleted as unearned — as a side effect of a heading sweep, by a row written
> **before that prop existed**. Order of landing: `6911bcb` (this document) → `38bd487` (the prop)
> → `1c54133` (§3's "now live" note). §3 is the newest statement and it is the one that stands.
>
> **The ruling is: keep `headingLevel={3}`.** Two independent reasons, either sufficient.
>
> 1. **The promotion was never owed.** It rested on the §1.3 miscount above. `📝 Editor` is a pane
>    label, not a step section, and the sweep this row describes does not reach it.
> 2. **Step 4 needs a section heading regardless.** Delete the step-bar `<h2>` and leave step 4's
>    only headings at `<h3>`, and that step runs `h1 → h3` — the exact skip §1.3 forbids. Something
>    must sit at `<h2>`. Promoting the pane labels is the wrong candidate: "Editor" and "Cover
>    Letter Preview" are not two sections, they are **two views of one thing**, so the section is
>    the step. `Review & edit` is that section, and its copy is the step's own existing source
>    label (`{/* Step 4: Review & Edit */}`), sentence-cased per `CONTENT_STYLE.md` — not invented.
>
> This satisfies the goal in §1.3 — *names the page's actual sections instead of restating the
> route* — more faithfully than the sweep did, because step 4's actual section is now named where
> before it was anonymous. That the two depths survive is a consequence, not the motive; if the
> honest outline had collapsed them, the right move would have been a deliberate card to retire the
> prop, never a silent deletion inside a heading sweep. It did not, so there is nothing to retire.
>
> **Measured, not argued.** Reconstructing the row literally — drop step 4's `<h2>`, promote
> `📝 Editor` to `<h2>`, let `headingLevel` follow to `2` — reds **2 of 34** cases across the four
> interacting test files (`routeHeadingOutline`, `headingOutline`, `CoverLetterPreview`,
> `CoverLetterNew`). Both are in `CoverLetterPreview.test.tsx`:
> `is asked for h3 by CoverLetterGenerator and h2 by CoverLetterDetail` (the §10 call-site guard,
> catching the prop collapse) and `has the generator keep its editor pane s emoji out of the
> heading s accessible name` (which reads the source tag, so promoting that heading breaks an
> unrelated accessibility guard as collateral). Flipping only `headingLevel={3}` → `{2}` and
> changing nothing else reds exactly **1** — the call-site guard alone.
>
> **The part worth internalising: every outline test stays green.** `routeHeadingOutline`,
> `headingOutline`, and `CoverLetterNew.test.tsx`'s per-branch step sweep all pass under the row
> applied literally, because promoting `📝 Editor` does give step 4 an `h2` opener — the outline is
> *legal*, it is just wrong about what a section is. **No heading check catches this; only the
> prop's own source guard does.** A sweep that had run the outline suite and seen green would have
> shipped the prop deletion. That is the argument for §5 rule 5 (grep the subtree for
> `headingLevel` first) rather than trusting a green outline run.
>
> Shipped shape is PR #194, merged as `0bb159b` (heading copy sentence-cased to `Review & edit` in
> `7a5d04c`, per `CONTENT_STYLE.md`).
>
> **A caveat worth keeping.** §3 defends the prop *structurally* — the preview is the sole content
> of a page under `CoverLetterDetail` and one half of a split pane inside a wizard step under
> `CoverLetterGenerator`, "two different nesting depths by construction, not by the current accident
> of tags." That argument is sound and it is **not** what the guard checks. `headingLevelPassedBy()`
> reads the literal numbers at the call sites. So the structural claim cannot save the prop from a
> tag change; only the tags can. Treat §3's structure as the *reason* the depths differ and the tags
> as the *thing under test* — and when a sweep proposes to move a tag, re-derive the structure
> rather than assuming the guard encodes it.

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
4. **Classify each heading before you promote it — a pane label is not a section.** (WIC-1598.)
   When a route's body has branches (wizard steps, tabs, accordion panels), "promote the `<h3>`s"
   is not one instruction, it is one per branch, and the branches do not all have the same shape.
   Two checks, both cheap:
   - **Per branch, not per file.** Read each branch's outline on its own. A file-wide `<h3>` tally
     hides a branch that has no section heading of its own — which is exactly what §1.3's table
     did to step 4. Every branch needs its own `<h2>`; a branch that lacks one gets a new heading
     naming the branch, not a promoted label borrowed from inside it.
   - **A heading that names half of a matched pair is a label, not a section.** `📝 Editor` beside
     `Cover Letter Preview`, a left/right split, a before/after diff: these are views of one
     subject. Promoting one makes it a peer of things it sits inside, and promoting both leaves the
     subject itself unnamed. Name the subject, keep the pair one level down.
5. **Before promoting a level anywhere, grep for a `headingLevel` prop in the subtree.**
   (WIC-1598.) Moving a host's tag silently changes what depth a shared child is asked for. If
   every call site ends up passing the same value, the prop is now dead, `COMPONENT_SPECS.md` §10
   will retire it on the next audit, and a heading sweep will have deleted working code that a
   different ruling put there on purpose. That is not a reason to never promote — it is a reason to
   notice, and to make the retirement a card of its own with the ruling that earned the prop cited
   in it. `CoverLetterPreview.test.tsx`'s source guard fails loudly when this happens; do not rely
   on it existing for the next component.
6. **`routeHeadingOutline.test.ts` reads JSX comments as live source.** (WIC-1598.) The sweep is a
   `?raw` regex over `<hN>…</hN>`, so a heading tag written in prose inside a `{/* … */}` block
   registers as a real heading and can report a collision that does not exist in the rendered tree.
   The test's own docstring says so; it is stated here too because that is one file away from where
   you will hit it. It is fail-noisy rather than fail-open, which is the right bias — but it means
   **"comment the heading out" is not a valid fix**, and it means a documentation comment explaining
   a heading decision should name levels as `h2` / `h3`, not as `<h2>` / `<h3>`. Prefer that form in
   new comments. The same blind spot in reverse is real too: interpolated headings are invisible to
   the sweep entirely (33% of `<h1>`, 26% of `<h2>` at `6911bcb` — WIC-1586), so a green run means
   "no *literal* collision", never "no collision".
7. **If the route's body is an always-open modal, rule 1 inverts: the `<h1>` goes on the dialog
   title, not the page file.** (WIC-1886.) Radix's `Dialog.Content` calls `hideOthers()`, which puts
   `aria-hidden="true"` on everything outside the portal. When the dialog *is* the route, "outside
   the portal" is the page file, permanently — so an `<h1>` placed there per rule 1 is in the DOM
   and in **no** screen reader, for the entire life of the route. Write it as
   `<Dialog.Title asChild><h1>…</h1></Dialog.Title>`: the dialog title and the route `<h1>` are the
   same node, and `asChild` keeps Radix's accessible-name wiring. `WizardContainer`
   (`/projects/new/dialogue`) is the worked instance; `ApplicationForm` (`/applications/new`) is the
   second. `CatalogBrowseView` is the same shape reached by analogy rather than by rule, which is
   why this is written down.

   **How to recognise one:** the page component renders a single child, and that child hardcodes
   `<Dialog.Root open>` with no `modal={false}`. It is not "a route that can open a dialog" — it is
   a route with no non-dialog state.

   > **The check could not see this, and now can.** `getOutline` was a plain `querySelectorAll`, so
   > it counted the hidden `<h1>` and scored the rule-1 fix green — the failure mode WIC-1483 named,
   > *a mechanism that certifies the wrong fix is not enforcement*. It now skips any heading inside
   > an `aria-hidden="true"` or `inert` subtree, i.e. it reads the accessibility tree rather than
   > the DOM.
   >
   > **Two measured details worth keeping**, both of which cost a wrong turn if you rediscover them
   > the hard way:
   >
   > 1. **The heading itself is not `aria-hidden` — an ancestor is.** `hideOthers()` marks the
   >    page's top-level wrapper. So the obvious `node.getAttribute('aria-hidden') !== 'true'`
   >    filter is a **silent no-op**: measured, it leaves the positive control below fully green.
   >    The fix has to be `closest()`. A filter written the obvious way would have been the same
   >    class of non-fix this rule exists to prevent.
   > 2. **What bites is the "opens at exactly one `<h1>`" assertion, not the skip assertion.** With
   >    the page `<h1>` removed from the accessibility tree the route's outline is `h2 -> h3`, which
   >    contains no *skip* — `findOutlineSkips` returns `[]` either way. Only the `<h1>` rule sees it.
   >
   > **Positive control** (`/applications/new`, WIC-1675 route sweep on PR #299): add an `<h1>` to
   > the page file per rule 1, delete the four `/applications/new|*` lines from `MISSING_H1`, and
   > drop the size pin 25 → 21 — the fix the inventory's ratchet actively invites. Unfiltered, that
   > passes **10/10**. Ancestor-filtered, it reds on all four branches. **Cost of the filter on the
   > tree as it stands: zero** — 19/19 on that branch, 43/43 across every `getOutline` consumer on
   > `main`. It reds nothing today and is purely a tripwire on the wrong fix.

## 6. Note on [`ROUTE_TITLE_CONVENTION.md`](./ROUTE_TITLE_CONVENTION.md)

> **Resolved 2026-08-27 (WIC-1582).** The file now exists at
> [`docs/design/ROUTE_TITLE_CONVENTION.md`](./ROUTE_TITLE_CONVENTION.md). The paragraph below is
> kept as the record of why it was missing; the "does not exist" finding is no longer current.

~~WIC-1581 reports that `ROUTE_TITLE_CONVENTION.md` does not exist in the tree.~~ That was correct
when written: the document was real — WIC-1089's design output — but it lived only in the UI/UX
Developer's workspace directory, which is not the repository, so an implementer sent to conform to
it could only conclude it did not exist. It has since been ported here and re-measured against the
tree.

It does not govern `<h1>` copy — it specifies `document.title`, and its rule is that the title
*mirrors* the `<h1>`, which makes it a **consumer of this document rather than a peer**.

**That dependency is live, in this direction:** every string in its §5 title table is copied from
the `<h1>` this document assigns to the route. **Change a route's `<h1>` in §4 above and
`ROUTE_TITLE_CONVENTION.md` §5 must be updated in the same PR**, or the tab label and the page
heading start naming the same screen differently. The port already caught three such drifts —
`/cover-letters/new`'s heading moving to `CoverLetterNew.tsx` (WIC-1571), the 404's heading copy,
and a route (`/resumes/:resumeId/exports`) added after the table was written.

Design docs that constrain implementation belong in `docs/design/`, or implementers correctly
conclude the constraint does not exist. This ruling is in `docs/design/` for that reason.
