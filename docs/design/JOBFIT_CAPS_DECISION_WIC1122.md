# `JobFitAnalysis` caps decision + fit-colour gate (WIC-1122)

**Author:** UI/UX Developer · **Original date:** 2026-08-19 · **Amended:** 2026-08-19 (WIC-1142
colour verdict), 2026-08-25 (WIC-1125 as-built), 2026-08-26 (shipped)
**Ported into the repo and re-measured against `a59b869`:** 2026-08-27 (WIC-1626, part 2 of WIC-1582)

> **Why this file exists.** `docs/design/DESIGN_SYSTEM.md` cites *"the fit-quality colour ramp still
> open in `JOBFIT_CAPS_DECISION_WIC1122.md` §3a"* as the standing gate on adding a third colour
> scale to the Job Fit Analysis screen. Until this port that citation pointed at a document living
> only in the UI/UX agent's workspace. **§3 below preserves that anchor** — it is the one section of
> this document that is still forward-looking rather than historical.
>
> **This is a port, not a transcript.** Re-measured against `a59b869`; corrections struck inline.

---

## 0. Status — read this first

The caps decision **shipped** (PR #116, 2026-08-26). Most of this document is therefore a decision
record rather than an instruction. **The one live part is §3 — the colour gate.**

| Section | State at `a59b869` |
|---|---|
| §1 decision — de-shout both sites, neither becomes an Overline badge | **Shipped.** No `uppercase` or `.toUpperCase()` remains in `JobFitAnalysis.tsx`. |
| §2 implementation spec (label maps, two render sites) | **Shipped, then superseded** — see §4. Both local maps were deleted; the file now reads shared constants. |
| **§3 — the fit-quality colour ramp gate** | **OPEN and in force.** This is what `DESIGN_SYSTEM.md` cites. |
| §5 line numbers | **Stale by construction** — re-measured in §6. |
| §7 spotted-not-fixed — three disagreeing severity ramps | **Closed for the Gaps card** (WIC-1146). **One raw value survives elsewhere on the same screen** — new finding, §7.1. |

---

## 1. The decision

| Site | Verdict |
|---|---|
| overall fit | **De-shout, and promote out of the sentence using the existing type scale.** |
| gap severity | **De-shout. No structural change.** |

Neither site gets the Overline token. Both `<span className="uppercase">` wrappers added by PR #90
are removed.

### 1.1 Why not promote to a real Overline badge

The overall fit recommendation is the headline answer of the screen and deserves to render as a
result rather than as shouted prose. That instinct is right; the Overline token is the wrong
instrument for it.

- **Overline is 10px/600.** The confidence caption directly below the recommendation is `text-sm` —
  **14px**. Rendering the headline answer as an Overline badge makes the primary result *smaller
  than its own metadata*. That inverts the hierarchy rather than fixing it.
- **The precedent doesn't transfer.** `CatalogBrowseTable` (`text-xs` caps) is table column headers;
  `GapMitigationPanel`'s severity chip sits *beside* a larger skill name. In both, the caps string is
  secondary metadata qualifying a larger primary string. The overall fit value **is** the primary
  string. Same visual treatment, opposite role.
- **A correctly-sized result badge is a token that does not exist.** A 14–16px caps pill would need
  a new type-scale entry plus an audit of where else it applies — disproportionate to one render
  site, and introducing a token to justify keeping caps is backwards.

So the badge option is rejected on its own terms: at the tokens that actually exist it is a
regression.

### 1.2 Why promote rather than merely de-shout

Plain de-shouting leaves `Overall Fit: Moderate fit` — label and value both `text-xl font-semibold`,
visually indistinguishable. Today the caps are the only thing separating the answer from its label,
so removing them without replacement genuinely loses hierarchy. The fix is the ordinary one: a small
quiet label over a large emphatic value, using type-scale steps that already exist.

The gap-severity site needs none of this. The severity there is a genuine sentence fragment
qualifying the line below the requirement, already secondary by position and size, and it reads
correctly as prose. De-shout and stop.

### 1.3 Consistency check

All-caps is a *rendering style* carried by the Overline token, never a casing decision, and no string
is spelled in caps in source (`CONTENT_STYLE.md`). Neither site is an Overline surface, so neither
renders caps. **This decision is that rule applied, not an exception to it.**

---

## 2. Implementation spec *(shipped — see §4 for what survived)*

**Site A — overall fit.** Replace the `text-xl font-semibold` line containing
`Overall Fit: <span className="uppercase">…</span>` with a label-over-value pair:

```tsx
<div className="mb-2">
  <div className="text-sm text-neutral-500">Overall fit</div>
  <div className="text-2xl font-bold text-neutral-900">
    {/* label looked up from a typed map, not .toUpperCase().replace() */}
  </div>
</div>
```

- `text-2xl` / `font-bold` is an existing type-scale step, one up from the 20px this line used.
  `text-sm text-neutral-500` for the label matches the `Confidence:` caption already in the same
  card, so the card reads caption → answer → summary → caption.
- Label spelled **"Overall fit"**, sentence case, per the casing standard.

**Site B — gap severity.** Drop the `uppercase` span; render the label from a typed map. The ` - `
separator is **deliberately unchanged** — swapping it for an en dash is a typographic nit that
belongs in a copy pass, and keeping it holds the diff to the caps question.

**Why typed maps rather than `.toUpperCase().replace('_', ' ')`.** That is a correctness win, not
tidiness: `.replace('_', ' ')` swaps only the **first** underscore, so a future two-underscore enum
member would render a raw key fragment on screen. A `Record` keyed on the union makes an added
member a **compile error** instead. Note `Recommendation` includes `null` in its union, so the map
must be keyed on `NonNullable<Recommendation>`.

---

## 3. Colour verdict — the standing gate *(WIC-1142, 2026-08-19 — STILL OPEN)*

> **This is the section `DESIGN_SYSTEM.md` cites.** Re-measured at `a59b869`: the verdict below
> still describes the shipped tree, and the gate has not been cleared.

**Question:** should the overall fit value be colour-coded by `recommendation`? WIC-1123 proposed
`strong_fit`→`text-success-700`, `moderate_fit`→`text-info-700`, `stretch`→`text-warning-700`,
`low_fit`→`text-error-700`, `null`→`text-neutral-500`.

**Verdict: no colour. The value stays `text-neutral-900`.** ✅ *Confirmed still true at `a59b869` —
`JobFitAnalysis.tsx:155`.*

The a11y arithmetic in WIC-1123 was correct and is **not** the reason — all five tokens clear 4.5:1
on `bg-white`, and 1.4.1 is satisfied because the word carries the meaning. This is refused on
semantics and sequencing:

1. **Structure already did the job colour was being asked to do.** Colour was attractive when the
   verdict was a shouted fragment buried mid-sentence at 20px with nothing separating it from its
   label. §2 removes that problem structurally: the value is now 24px bold, alone on its own line,
   centred — the visual peak of the screen. Colour on top reinforces something that no longer
   competes for attention.
2. **The tokens mean something else.** `success` / `warning` / `error` are system-state semantics
   used elsewhere for validation and alerts. A `low_fit` is a finding about a job, not an error
   condition — rendering it in `error-700` both overstates it and dilutes the token where it does
   mean "something went wrong". Fit quality is a different axis from severity and must not borrow
   the severity ramp.
3. **This screen's colour semantics were already incoherent.** At the time, the Gaps section carried
   two ramps that disagreed with each other, and `GapMitigationPanel` rendered the same values a
   third way. Adding a fourth — on a different meaning axis, at the top of the same screen — before
   those were reconciled would make the page harder to read.

### 3.1 What would change this

A graded visual for the fit verdict is a legitimate want. The right instrument is a **purpose-built
result treatment designed on its own axis**, which means a `DESIGN_SYSTEM.md` entry — the same bar
that sank the Overline badge in §1.1, and it should clear that bar the same way.

**Two preconditions, and the second has since been raised:**

1. ~~The three-way severity-colour mismatch is reconciled first (WIC-1146).~~
   > **Satisfied for the Gaps card.** WIC-1146 shipped `constants/gapSeverity.ts` as the canonical
   > and only rendering of `GapSeverity`, read by both render sites. ✅ Verified at `a59b869`.
   > **But see §7.1 — a raw ramp value still survives elsewhere on this screen.**
2. **The CVD finding applies with equal force to a four-step `recommendation` ramp.** WIC-1146
   established that no red→orange→yellow three-step scale is legible under colour-vision
   deficiency — at a uniform `-700` step, `moderate` and `minor` render as `#7a7a00` and `#797900`
   under deuteranopia, a separation of **1.01:1**. A four-step fit ramp has the same problem, and
   `strong_fit` in green would reintroduce precisely the green-means-good confusion WIC-1146
   removed from the gap cards.
3. **The vocabulary guard must be extended first.** `DESIGN_SYSTEM.md` § Enforcement requires it:
   `constants/fitLevel.ts` derives reserved vocabulary from the `GapSeverity` and `Confidence`
   unions and fails `npm run typecheck` if a fit label reuses one. **Extend that guard before
   introducing a third scale to this screen** — a colour ramp designed against labels that have not
   passed it is designed against the wrong labels.

**Until all three, `text-neutral-900`.**

---

## 4. As built, and what survived *(PR #116, merged 2026-08-26)*

**The layout change survives.** The overall-fit result is a 14px "Overall fit" label over a 24px
bold value, and both `uppercase` spans are gone. Nothing on the Job Fit Analysis screen shouts.

**Both label maps this decision specified are gone.** `GAP_SEVERITY_LABELS` was superseded by
WIC-1146's `constants/gapSeverity.ts` (which carries colour tokens as well as the label) and
`FIT_RECOMMENDATION_LABELS` by WIC-1288's `constants/fitLevel.ts` (which carries the typecheck
vocabulary guard). Both were deleted during the reconciliation merges, **deliberately**: a second
local enum-to-string map in this file is precisely the mechanism that produced the
three-disagreeing-ramps bug. `JobFitAnalysis.tsx` now holds no enum mapping of its own.

> So §2's instruction to "keep both maps local to this file; do not merge them with
> `GapMitigationPanel`'s map" was **right for the sequencing and wrong as an end state.** It bought
> a narrow, conflict-free diff while PR #90 was still open, and was unwound the moment the tickets
> owning those two fields landed. Recorded because the reasoning reads as a durable rule and is not
> one — a sequencing constraint written in the imperative mood is indistinguishable from an
> architectural one six days later.

**A skipped assertion is not a passing one.** PR #116's body listed a `getByText('CRITICAL')`
assertion as evidence the change was safe. It sits inside a `test.skip` block and never executed.
The correction matters only so the line is not later cited as proof a skipped assertion was
exercised.

---

## 5. Line numbers — *do not trust the ones in the history*

This document and its predecessors cite `:148`, `:270`, `:271`, `:151`, `:273`, `:462`, `:144` for
the two render sites at various points. **Every one of those is stale.** They were measured across
four different branch heads while PR #90 was open, and the sites have moved again since.

**Anchor on the surrounding code, not on line numbers.** §6 gives the current positions with the
explicit warning that they too will move.

---

## 6. Verification — *this port, 2026-08-27 (WIC-1626)*

Re-measured against `a59b869`:

| Claim | Verified |
|---|---|
| No `uppercase` / `.toUpperCase()` anywhere in `JobFitAnalysis.tsx` (§1 shipped) | ✅ |
| "Overall fit" label, `text-sm text-neutral-500` | ✅ `JobFitAnalysis.tsx:154` |
| Fit value, `text-2xl font-bold text-neutral-900` — **no colour** (§3) | ✅ `JobFitAnalysis.tsx:155` |
| Value read from a shared constant, not a local map (§4) | ✅ `FIT_LEVEL_LABELS` / `NO_FIT_LEVEL_LABEL` imported at `:7`, used `:157–158` |
| `constants/fitLevel.ts` and `constants/gapSeverity.ts` both exist | ✅ |
| `JobFitAnalysis.tsx` holds no enum→string map of its own (§4) | ✅ no `FIT_RECOMMENDATION_LABELS` / `GAP_SEVERITY_LABELS` |
| Gaps card reads `GAP_SEVERITY[gap.severity]` rather than an inline ramp (§3.1 precondition 1) | ✅ `JobFitAnalysis.tsx:259` |
| Severity emoji (🔴/🟡/🟢) removed from the gap cards | ✅ none present |
| **Partial Matches card still uses a raw `border-yellow-500`** | ⚠️ `JobFitAnalysis.tsx:238` — **new finding, §7.1** |

---

## 7. Spotted, not fixed

The original §4 recorded that `JobFitAnalysis` and `GapMitigationPanel` rendered the same
`GapSeverity` values as three disagreeing colour ramps, one leg of which contradicted itself inside a
single card (`minor` yellow by border, green by emoji). **That is closed** — WIC-1146 shipped
`constants/gapSeverity.ts` as the single source, both sites read it, and the emoji are gone.

### 7.1 One raw ramp value survives on the same screen — *new, WIC-1626* ⚠️

`JobFitAnalysis.tsx:238` renders the **Partial Matches** card with
`className="border-l-4 border-yellow-500"` — a raw Tailwind palette value, not a design token, on
the same screen whose severity ramp was just tokenised.

This is not a `GapSeverity` render site, so WIC-1146's reconciliation did not cover it. Two reasons
it still matters:

1. **It is very likely a live contrast defect.** `gapSeverity.ts` documents `mark` — "the left border
   / any non-text graphical indicator" — as needing to meet **3:1** (WCAG 1.4.11), and the WIC-1146
   analysis measured `border-yellow-500` at **1.92:1**. The Partial Matches border is the same
   Tailwind value in the same structural role (`border-l-4`), so on the same white surface it
   carries the same ratio. It is the exact value WIC-1146 replaced *in the card immediately below
   it*, left in place one card up.
2. **It re-opens the §3 sequencing argument in miniature.** §3 reason 3 refused a fit-colour ramp
   partly because this screen's colour semantics were incoherent. Reconciling the Gaps card while
   leaving a raw yellow border on the sibling card above it means the screen still carries an
   untokenised colour on a meaning axis nobody has designed.

**Not fixed here** — this is a docs port, and changing a rendered border is a visual change needing
its own diff, its own contrast measurement, and a decision about whether Partial Matches deserves a
scale at all or should simply use a neutral border. **Filed as a child of WIC-1626.**

Flagging it rather than absorbing it, for the same reason the original §4 flagged the three-way
mismatch: quietly folding an unrelated visual change into a diff about something else is how the
three ramps got there.

---

## 8. Related

- `docs/design/DESIGN_SYSTEM.md` — § Gap Severity Scale (`:104`), § Fit Level Labels (`:222`), and
  § Enforcement (`:459`), which cites §3 of this document as the standing gate.
- `packages/web/src/constants/gapSeverity.ts` — the canonical `GapSeverity` rendering (WIC-1146).
- `packages/web/src/constants/fitLevel.ts` — fit labels plus the reserved-vocabulary typecheck guard
  (WIC-1288).
- `docs/design/CONTENT_STYLE.md` — the casing rule §1.3 applies.
