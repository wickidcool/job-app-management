# Cover letter generator — preview pane labelling

**Issue:** WIC-1569
**Author:** UI/UX Developer
**Status:** ruling — **implemented and shipped in PR #184 (`38bd487`)**, alongside WIC-1563. This
document is the reasoning behind that change, recorded after the fact; it is not an open work item.
**Related:** `COMPONENT_SPECS.md` §10 → "Heading level" (WIC-1417, WIC-1155), `ROUTE_HEADING_OUTLINE.md`
(WIC-1581), WIC-1563, WIC-1571

**Ruling: YES — label the pane.** Decided 2026-08-26.
Consequence: `CoverLetterPreview` earns a `headingLevel` prop, per the card's own "if yes" branch.

---

## 0. Provenance, and what shipped

The ruling was written against `fix/wic1417-emptystate-heading-level` @ `b0c34fe` (PR #182), before
the WIC-1563 branch was pushed — so parts of it originally cited a card transcript rather than a
tree. It is recorded here **after** implementation, and every claim below was re-checked against
the tree that actually shipped.

- **PR #182 (WIC-1417) landed.** `EmptyState` carries `EmptyStateHeadingLevel = 2 | 3 | 4 | 5 | 6`,
  `headingLevel = 2`, and pins the size across levels (`EmptyState.tsx:7,24,31,65`). That is the
  precedent §2.3 says to follow verbatim, and it was followed.
- **PR #184 (WIC-1563) landed on 2026-08-27 as `38bd487`,** and implemented **all of §2** — not
  just its own `h3`→`h2` correction. The two changes were entangled by construction: #184's own
  §10 worked example turned on `CoverLetterPreview` having its heading at exactly one depth, and
  this ruling is what put it at two, so shipping them separately would have left §10 asserting a
  criterion its own example contradicted.

**Acceptance audit — all seven items in §6, verified against `38bd487`:**

| §6 item | Shipped | Evidence |
|---|---|---|
| Header bar + heading render regardless of `showExportActions`; buttons still gated | ✅ | `CoverLetterPreview.tsx:96` (bar, unconditional), `:105` (`<Heading>`), `:106` (`{showExportActions && …}` now wraps only the button group) |
| Bar padding `px-4 py-3`, matching the editor's | ✅ | `CoverLetterPreview.tsx:96`; editor's at `CoverLetterGenerator.tsx:560` |
| `headingLevel?: 2\|3\|4\|5\|6` defaulting to `2`; size pinned across levels | ✅ | `CoverLetterPreview.tsx:8,35,46,66`; size comment and pinned `text-lg font-semibold` at `:97-105` |
| `CoverLetterGenerator` passes `headingLevel={3}` | ✅ | `CoverLetterGenerator.tsx:602` |
| C5 tripwire replaced with assertions at both depths | ✅ | `CoverLetterPreview.test.tsx` — `renders h2 by default…`, `renders h3 when the host asks for it`, `names the pane even when export actions are suppressed, without offering them`, `keeps the heading s rendered size independent of its level`, `keeps the header bar padding matched to the generator s editor pane`, and a source guard `is asked for h3 by CoverLetterGenerator and h2 by CoverLetterDetail` |
| §10 "Scope of the rule" carries §5's paragraph | ✅ | `COMPONENT_SPECS.md` §10 → "`CoverLetterPreview` is the second component in this class" |
| *(optional)* editor's `📝` wrapped in `aria-hidden` | ✅ | `CoverLetterGenerator.tsx:562-564` — taken, though §2.5 marked it non-blocking |

The test suite went beyond §4's ask: `headingLevelPassedBy()` (`CoverLetterPreview.test.tsx:62`)
parses the *call sites' source* to assert the generator passes `3` and the detail page relies on
the default, because a rendering test alone cannot prove a host passes a prop. That closes the
"dead assignment" failure mode #184's own §10 bullet warns about.

Note `CoverLetterGenerator` lives in `components/`, not `pages/` — see §3.

## 1. The decision

> **Tense note.** §§1–4 are preserved as written, in the present tense of the **defect** — that is,
> the tree *before* `38bd487`. Read "today" as "before this shipped". They are kept unedited
> because the argument is the record: the next person to look at a labelled/unlabelled pane pair,
> here or elsewhere, needs the reasoning and the rejected alternatives, not a description of the
> fixed state that §0's audit already gives.

`CoverLetterGenerator:557-594` renders a two-pane split in one bordered box. Today the left pane
carries a header bar with `<h3>📝 Editor</h3>` and the right pane — `CoverLetterPreview` with
`showExportActions={false}` — carries nothing at all.

**A labelled/unlabelled pair is not a design choice, it is a defect.** Three reasons, in the order
they actually bind:

1. **"Editor" only means anything by contrast.** A lone label on one half of a matched pair does
   not name that half — it invites the reader to infer that the other half is *not-editor*, which
   is a weak inference for a sighted user and no inference at all for a screen-reader user, who
   gets `heading: 📝 Editor` and then an unnamed run of serif prose with no way to tell a live
   preview of what they just typed from, say, the pasted job description.
2. **The panes are already visibly misaligned**, by exactly the height of the header the preview
   does not have. The editor's `border-b` draws a rule that crosses half the box and stops dead at
   the pane divider. That is a visual bug you can see without a screen reader, and it is the same
   bug — one pane has the chrome, the other does not.
3. **`showExportActions` is doing two jobs.** It was introduced to suppress the Copy / Download
   buttons in the generator, which is correct — the letter is not saved yet, so offering to export
   it is premature. It suppresses the *pane's identity* as a side effect. That conflation is the
   actual root cause, and splitting it is the fix.

Cost of saying yes: the preview loses ~3rem of a fixed 600px box (5%). The editor already pays
exactly that, so the panes equalise rather than the preview shrinking relative to its sibling.
That is a gain, not a cost.

**Rejected alternatives.**

- *`aria-label` on the generator's preview wrapper only.* Fixes nothing visible, and it fails on
  its own terms: `aria-label` on a role-less `<div>` maps to `generic`, which does not support an
  accessible name — dropped by most AT, flagged by axe as `aria-prohibited-attr`. This is settled
  ground; see `COMPONENT_SPECS.md` §10 → Accessibility, from WIC-1155.
- *`role="region"` + `aria-label`.* Makes the name stick, but §10 reserves `region` for major
  structural areas and — more to the point — the sibling pane is labelled **by a heading**.
  Symmetry is the whole argument here; answering it with a different labelling mechanism on each
  side re-creates the asymmetry one layer down, in the accessibility tree.
- *Close `wont_do`.* Rejected on point 2 alone. The misalignment is a live visual defect.

## 2. What to build

### 2.1 Hoist the heading, keep the buttons conditional

In `CoverLetterPreview.tsx`, the header bar and its heading render **always**; only the button
group stays behind `showExportActions`.

The prop's name survives the change intact — afterwards it controls exactly and only the export
actions, which is what it says. Do not rename it.

### 2.2 Match the editor's bar padding — this is load-bearing

The preview's bar is `p-4`; the editor's is `px-4 py-3`. **Change the preview's to `px-4 py-3`.**

Without this the panes stay misaligned by 8px and consequence 2 is only half-fixed. With it:

| | header bar box height |
|---|---|
| Generator, editor pane (`py-3` + `h3` line-box) | 3.25rem |
| Generator, preview pane (`py-3` + heading, **no buttons**) | 3.25rem — exact match |
| `CoverLetterDetail` (`py-3` + `h-10` buttons) | 4rem — grows to fit, no sibling to misalign against |

The generator is the only place two bars sit side by side, and it is the only place the buttons
are absent, so the two bars are pixel-identical exactly where it matters.

### 2.3 The heading level prop

```ts
export type CoverLetterPreviewHeadingLevel = 2 | 3 | 4 | 5 | 6;
```

`headingLevel?: CoverLetterPreviewHeadingLevel`, defaulting to `2`. `1` is excluded for the same
reason as `EmptyState`: the page `<h1>` names the route, and a preview pane is never the route.
Follow the `EmptyState` implementation from PR #182 / WIC-1417 verbatim — including **the rendered
size must not follow the level**. `text-lg font-semibold` stays pinned at every level.

Call sites after the change:

| Call site | host's nearest heading | `headingLevel` |
|---|---|---|
| `CoverLetterDetail:161` | `<h1>Cover Letter</h1>` at `:104` | `2` (default, omit) |
| `CoverLetterGenerator:590` | `<h2>Generate Cover Letter</h2>` at `:181`, sibling `<h3>📝 Editor</h3>` at `:561` | **`3`** (explicit) |

### 2.4 Heading copy: unchanged, and no `headingText` prop

"Cover Letter Preview" stays as-is at both depths. It is longer than "Editor" and it restates the
page subject, both of which I considered and both of which are fine: it is unambiguous, and it is
the component's own name for itself. A second prop to vary copy for a single call site is not
earned — one prop, one behavioural change.

### 2.5 No emoji on the preview heading (and the editor's should be hidden)

Symmetry with `📝 Editor` argues for an emoji. Do not add one. §10 already settled that icons in
this family are decorative and carry `aria-hidden="true"` — and an emoji baked into heading *text*
is the one place you cannot do that. `<h3>📝 Editor</h3>` has the accessible name "memo Editor".

The correct direction is to strip the editor's, not to match it:

```diff
-<h3 className="font-semibold text-gray-900">📝 Editor</h3>
+<h3 className="font-semibold text-gray-900">
+  <span aria-hidden="true">📝</span> Editor
+</h3>
```

**Adjacent, not a blocker.** Same JSX block, one line, and it is the other half of the same
labelling question — take it with this change if convenient, but do not hold the card for it.

## 3. Why the prop does not evaporate — read this before "fixing" the missing `<h1>`

`packages/web/src/pages/CoverLetterNew.tsx` had **no `<h1>`**. The generator's `<h2>Generate Cover
Letter</h2>` at `:181` was the top heading on `/cover-letters/new`, so that page's outline started
at `h2`. That is a real defect, it is out of scope here, and it is a **tripwire for this ruling**:

- Fix it by adding an `<h1>` in `CoverLetterNew.tsx` (the route names itself) → panes stay `h3`,
  the component renders at `h2` and `h3`, prop earned. ✅
- Fix it by promoting the component's `<h2>` to `<h1>` → panes become `h2`, the component renders
  at one depth, and the next §10 audit deletes the prop as unearned. ❌

**The first is correct.** `CoverLetterGenerator` is a component, not a page; a shared component
that emits its host page's `<h1>` is precisely the anti-pattern §10 exists to prevent. The `<h1>`
belongs to the route. "Generate Cover Letter" is a section heading inside it and stays `<h2>`.

> **Status of the tripwire — now live, and guarding a prop that exists.** When this was written the
> ❌ branch would merely have pre-empted a proposed prop. Since `38bd487` the prop is **shipped**,
> so taking that branch would now *delete working code and its tests*, not just forestall them.
>
> Filed as WIC-1571 and fixed the ✅ way in **PR #194**: the `<h1>` goes in a page shell wrapping
> all four render branches, the generator's `<h2>` is untouched, and the distinction is pinned with
> `?raw` source guards — necessary because an outline assertion alone passes under *both* fixes.
> As of 2026-08-27 PR #194 is open and `CONFLICTING`, so `main` still has no `<h1>` on that route.
>
> The ruling does not depend on that PR either way — see the structural statement below. But the
> constraint on *how* it gets fixed is now enforced from two directions: `CoverLetterPreview.test.tsx`'s
> `is asked for h3 by CoverLetterGenerator and h2 by CoverLetterDetail` reads the generator's source
> and fails if its heading level moves, whichever PR moves it.

Stated structurally, so it survives whatever happens to that `<h1>`: the preview is the **sole
content of a page** under `CoverLetterDetail`, and **one half of a split pane inside a wizard step**
under `CoverLetterGenerator`. Those are two different nesting depths by construction, not by the
current accident of tags. That is what earns the prop under §10's "Scope of the rule".

## 4. Test tripwire

`CoverLetterPreview.test.tsx` → `describes the pane only when the export header is shown` asserts
the component contributes **no** heading at `showExportActions={false}`. This ruling deliberately
inverts that. Expect 4 of 9 red (the card's control C5) — that is the tripwire firing as designed,
not a regression. Replace it with assertions at **both** depths:

- `showExportActions={false}` still renders the heading, and still renders no Copy/Download buttons
  (the split in §2.1 is the thing under test — assert both halves, or the next person re-merges them);
- default → `<h2>`; `headingLevel={3}` → `<h3>`;
- the rendered class list is identical across levels (§2.3, size does not follow level).

## 5. Spec text for `COMPONENT_SPECS.md` §10 → "Scope of the rule"

**Landed with the code in `38bd487`** — §10 now carries this paragraph, and §10's bullet links back
here for the reasoning. Kept below so the spec text and its justification stay legible as one unit;
if the two ever disagree, `COMPONENT_SPECS.md` is the normative copy.

> `CoverLetterPreview` is the second component in this class (WIC-1569). It renders at `h2` as the
> sole content of `CoverLetterDetail` and at `h3` as one half of `CoverLetterGenerator`'s
> editor/preview split, so it takes the same optional `headingLevel` defaulting to `2`. Note the
> order of operations: it qualified only *after* a design ruling put a heading on the generator's
> preview pane. Before that the heading rendered at one depth and the prop would have been
> unearned — which is the criterion working, not a near-miss. A component does not earn this prop
> by being shared; it earns it by having its heading land at more than one depth.

## 6. Acceptance — all met

- [x] Preview header bar + heading render regardless of `showExportActions`; buttons still gated.
- [x] Preview bar padding is `px-4 py-3`, matching the editor's.
- [x] `headingLevel?: 2|3|4|5|6` defaults to `2`; size pinned across levels.
- [x] `CoverLetterGenerator` passes `headingLevel={3}`.
- [x] `describes the pane only when the export header is shown` replaced per §4.
- [x] §10 "Scope of the rule" carries §5's paragraph.
- [x] *(adjacent, optional)* editor's `📝` wrapped in `aria-hidden` — taken, though §2.5 did not require it.

Per-item evidence is in §0's audit table, checked against `38bd487`.

**Not in scope:** the missing `<h1>` on `/cover-letters/new` (§3) — filed as WIC-1571, fixed the
correct way in PR #194, which is still open. See §3's status note.
