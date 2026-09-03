# Accessibility enforcement ruling — which checkers, at what severity, in what order

**Decides:** WIC-1192 (filed by Frontend Developer, "Decide on a11y static/runtime checks for
`packages/web`"). **Ruled by:** UI/UX Developer, 2026-08-30.
**Measured against:** `main` @ `743cfeb`.

> **This document is a decision, not a shipped mechanism.** Nothing in it is enforced until the
> config in §5 lands. `ACCESSIBILITY.md`'s enforcement-status note stays accurate — and stays —
> until then. Do not read a ruling as a green check; see `ACCESSIBILITY.md` §"Enforcement status".

---

## 1. The question, and why it sat open for 11 days

WIC-1192 asked for two decisions:

1. Adopt `eslint-plugin-jsx-a11y`? At what severity, given a pre-existing backlog?
2. Adopt `axe-core`? Hosted where — Playwright E2E, or the vitest + RTL harness? And does it
   have to wait on the harness landing (PR #85 / WIC-1037)?

The card was filed 2026-08-19 and left unassigned. Three implementation cards (**WIC-1483**,
**WIC-1589**, **WIC-1675**) are queued behind these two answers, and `ACCESSIBILITY.md` has
carried an "enforcement status: none" banner throughout. The decision, not the work, was the
bottleneck.

**One premise in the card has since expired.** WIC-1192 said option (2) was "partly sequenced
behind" the vitest + RTL harness. That harness **has landed**: `packages/web/package.json` @
`743cfeb` carries `vitest@^4.1.11`, `@testing-library/react@^16.3.2`,
`@testing-library/jest-dom@^7.0.1` and `@testing-library/user-event@^14.6.5`, with 15 test files
under `packages/web/src`. **The sequencing question in the card is moot** — both options are
unblocked today.

---

## 2. What was measured (not inherited)

`eslint-plugin-jsx-a11y@6.10.2` was installed and run over `packages/web/src/**/*.tsx` at
`743cfeb`. Both published rule sets were run.

| rule set | findings | files |
| --- | ---: | ---: |
| `flatConfigs.recommended` | 50 | 23 |
| `flatConfigs.strict` | 50 | 23 |

**The two sets are byte-identical on this codebase** — same 50 findings, same 9 rules, same 23
files. Choosing `strict` therefore costs **zero** additional remediation today while giving a
tighter guard on future code. That is the whole argument for `strict`; there is no trade-off to
weigh.

Of the 50, **47 are in app source across 22 files**; the remaining 3 are
`role-has-required-aria-props` inside `src/test/headingOutline.test.tsx`, which are *deliberate
ARIA fixtures* for testing the heading-outline utility. Those must be disabled in place, not
"fixed" — fixing them would destroy the test's inputs.

47/22 **independently reproduces the count in WIC-1589**, which was measured separately. Two
independent measurements agreeing is the reason this ruling treats the number as solid.

### 2.1 Precision audit — all 19 label findings are true positives

`label-has-associated-control` is the rule most prone to false positives, and it is 19 of the 47.
A ruling that sets severity without checking precision is guessing, so every one of the 19 was
read in source and classified by remedy:

| class | n | what it actually is | remedy |
| --- | ---: | --- | --- |
| native, unassociated | 14 | `<label>` with no `htmlFor` over an `<input>`/`<textarea>` with no `id` | add `id` + `htmlFor` |
| group caption | 3 | `<label>` used as the caption of a radio/checkbox group | `<fieldset>` + `<legend>` |
| mislabelled custom component | 2 | see below | see below |

**Zero false positives.** The two custom-component cases were individually resolved rather than
assumed:

- `wizard/WizardContainer.tsx:306` — the visible label reads *"Technologies used (optional)"*, but
  the control inside `TechStackPicker.tsx:92` carries a hard-coded `aria-label="Technology input"`.
  The element is named, so it is not *unlabelled* — it is named **differently from its visible
  label**, which is a WCAG 2.5.3 (Label in Name) defect. Real, and arguably worse than the flat
  case, because it is invisible to a reviewer reading either file alone.
- `pages/ProjectFileEditor.tsx:154` — `<label>Preview</label>` sits over a read-only rendered
  markdown pane. **There is no control at all.** `<label>` is being used as a heading. Real.

The rule's *negative* behaviour was checked too, which is the part that would have exposed
over-firing: `OutreachComposer.tsx:140` wraps its `<input>` inside the `<label>` — valid
association by nesting — and the rule **correctly did not flag it**, while correctly flagging the
group caption three lines above it at `:137`.

**Consequence for the ruling:** the backlog is not lint noise to be suppressed. It is 47 real
defects. That settles severity (§3) on the merits rather than on taste.

---

## 3. Ruling 1 — adopt `jsx-a11y`, `strict`, at `error`, behind a frozen file baseline

**Adopt.** Rule set `strict` (free, per §2). Severity **`error`**, with the 23 currently-affected
files enumerated in an overrides block that relaxes them to `warn`.

The two obvious postures were both rejected, for stated reasons:

- **Global `warn`** — rejected. It never ratchets. A warning that 47 pre-existing findings already
  emit is a warning no one will ever notice a 48th inside, so new defects land silently. Since §2.1
  established these are real defects, `warn` also mislabels them.
- **Global `error` with no baseline** — rejected. It red-builds 22 source files on the landing
  commit and blocks every unrelated PR until WIC-1589 finishes.

The baseline posture gets the property that matters: **new and changed code is at `error` from the
first commit**, while existing debt stays visible and attributable. The baseline is a list that may
only ever **shrink**. Every entry cites WIC-1589, so an implementer who deletes a line knows what
they closed.

This is deliberately the same shape as the existing `docs/design/*.py` audits: a mechanism that
fails the build, not a document asking people to be careful.

### 3.1 Do not "fix" the test fixtures

`src/test/headingOutline.test.tsx` needs a file-scoped disable for
`jsx-a11y/role-has-required-aria-props`, with a comment saying the ARIA there is fixture input.
It is the one file in the baseline that should *never* leave it by remediation.

---

## 4. Ruling 2 — adopt `axe-core`, hosted in vitest + RTL, **not** in Playwright E2E

**Adopt, and host it in the vitest + RTL harness.** The prerequisite has landed (§1), so there is
nothing to wait for.

`axe-core` is not redundant with `jsx-a11y`. WIC-1192's original measurement stands and was not
re-litigated: jsx-a11y at `strict` returns **0 problems** on the `ChangeActionBadge` markup that
caused WIC-1185, because `role-supports-aria-props` only fires on an element that *has* a role, so
a role-less `<span>` never enters the rule. `axe-core`'s `aria-prohibited-attr` (impact *serious*,
`wcag2a`/`wcag412`) does catch it. **The two tools cover disjoint classes; adopting one is not a
reason to skip the other.**

### 4.1 Why vitest and not Playwright

Both hosts are wired into CI already — `deploy.yml` runs `npm run lint` and `npm run test` in
`Lint & Test`, and `npx playwright test` in `e2e-tests`. **Neither option needs new CI plumbing.**
So the choice turns on the feedback loop, and there the two are not close:

- The vitest harness runs in roughly a second locally and needs no browser.
- The `e2e-tests` job is *gated behind* `lint-and-test` (`needs: lint-and-test`), so an a11y
  regression hosted there is only ever discovered after a full lint/typecheck/build cycle passes.
- Playwright browsers do not launch in the agent development environment (missing system libraries,
  no privilege to install them), so an agent hosting assertions there **cannot run them locally at
  all** and must round-trip through CI to see a result. They do run correctly *in* CI; the defect is
  in the authoring loop, not the pipeline.

A checker that authors cannot run is a checker that gets worked around.

### 4.2 It also closes a blind spot the current guard documents about itself

`src/test/routeHeadingOutline.test.ts` is a **source** sweep, and its own header states the limit:
it sees only *static* heading text, and at `6911bcb` **11 of 33 `<h1>` (33%) and 11 of 42 `<h2>`
(26%)** were expression-built — `{variant.title}`, `{application.jobTitle}`, the `{title}` prop in
`ConfirmationModal`/`OnboardingStep`/`WizardStep` — and therefore invisible to it.

Rendered axe assertions see the **computed DOM**, so expression-built headings are exactly what
they do see. This is the mechanism **WIC-1675** ("rendered heading-outline enforcement per route,
across every render branch") is asking for, and it argues that WIC-1675 should be implemented *as*
an axe-core adoption rather than as a second bespoke utility.

> ⚠️ **Outcome note, 2026-09-01 (`22e60707`) — WIC-1675 shipped, and it shipped the way this
> subsection argued against.** Recorded here as fact, not as a ruling: `586712c2` (PR #299) landed
> `src/test/routeOutline.render.test.tsx`, which renders all 30 routes across 4 branches and
> asserts the outline using the **existing bespoke utility** `src/test/headingOutline.ts`
> (`findOutlineSkips`). **`axe-core` is still not a dependency** — it appears in no `package.json`
> and no workflow references it — so §4.3's precondition ("only after axe is green") has not been
> met either. The blind spot §4.2 identifies is nonetheless closed *in practice*: the sweep reads
> the computed DOM, so expression-built headings are visible to it. **What this note does not
> decide is whether Ruling 2 is thereby satisfied, superseded, or still outstanding** — that is an
> architectural call, not a documentation one, and it is routed to the Architect as **WIC-1945**.

### 4.3 Retire `prohibitedName.ts` — but only after axe is green

`src/test/prohibitedName.ts` is a hand-rolled stand-in for `aria-prohibited-attr`, written when
axe was unavailable. It is good code, but it is **per-component opt-in and imported by only 2 of
the 15 test files** (`STARInput.test.tsx`, `ChangeActionBadge.test.tsx`), so it protects only
components someone remembered to wire it into. A shared axe assertion inverts that default.

Sequence, and do not shorten it: land axe → confirm it flags the same two components → then delete
the helper. Deleting first trades a narrow working guard for an unproven one.

---

## 5. Implementation handoff

Owner: **Frontend Developer** (already assigned WIC-1483, WIC-1589, WIC-1675). Nothing here needs
a new card.

**Ruling 1** — in `packages/web/eslint.config.js`, add `jsxA11y.flatConfigs.strict` to the
`**/*.{ts,tsx}` block, then append one overrides entry listing the files in §6 with the named rules
set to `warn`. Landing commit must be config-only, so the baseline is reviewable as a list.

**Ruling 2** — add `axe-core`, expose one shared assertion helper next to `prohibitedName.ts`, and
call it from route-level render tests. Runs under the existing `npm run test`.

**Both are non-breaking on landing**, by construction. Neither requires a `deploy.yml` edit.

---

## 6. The frozen baseline — 23 files, 50 findings @ `743cfeb`

This list may only shrink. Remediation is tracked by **WIC-1589**.

> **Progress, 2026-08-30 (WIC-1589, slice 1 of 3).** The app-source count is **47 → 27,
> 22 files → 17, 8 rules → 6.** Two rules reached zero and are back at `error`:
> **`label-has-associated-control` (19 → 0)** and **`no-redundant-roles` (1 → 0)**.
> `--max-warnings` is `27`.
>
> The table below is **not** updated — it is the frozen `743cfeb` record this ruling was
> decided on, and rewriting it would destroy the thing §7 tells you it is. The live
> per-file map is `A11Y_BASELINE` in `packages/web/src/test/jsxA11yBaseline.test.ts`,
> which is asserted equal to a fresh lint run in both directions. **That file is the
> source of record; this table is history.**
>
> Still open: the 20 interaction findings (`click-events-have-key-events` 9,
> `no-static-element-interactions` 6, `no-noninteractive-element-interactions` 5) plus
> `no-autofocus` 5, `no-noninteractive-tabindex` 1 and
> `no-noninteractive-element-to-interactive-role` 1.

| file | n | rules |
| --- | ---: | --- |
| `src/components/ApplicationCard.tsx` | 3 | no-noninteractive-element-interactions, no-redundant-roles, no-noninteractive-tabindex |
| `src/components/CatalogBrowse/CatalogBrowseView.tsx` | 2 | click-events-have-key-events, no-static-element-interactions |
| `src/components/CatalogDiff/AmbiguityResolver.tsx` | 1 | label-has-associated-control |
| `src/components/CommandPalette.tsx` | 1 | no-autofocus |
| `src/components/CoverLetterGenerator.tsx` | 7 | label-has-associated-control ×7 |
| `src/components/FilterPanel.tsx` | 2 | click-events-have-key-events, no-noninteractive-element-interactions |
| `src/components/OutreachComposer.tsx` | 5 | label-has-associated-control ×5 |
| `src/components/ResumeUpload.tsx` | 2 | click-events-have-key-events, no-noninteractive-element-interactions |
| `src/components/ResumeVariantCard.tsx` | 1 | no-noninteractive-element-to-interactive-role |
| `src/components/STARStoryBank.tsx` | 2 | click-events-have-key-events, no-noninteractive-element-interactions |
| `src/components/SavedFilterShortcuts.tsx` | 1 | no-autofocus |
| `src/components/StarEntryPicker.tsx` | 2 | click-events-have-key-events, no-static-element-interactions |
| `src/components/wizard/WizardContainer.tsx` | 2 | no-autofocus, label-has-associated-control |
| `src/components/wizard/WizardStep.tsx` | 1 | no-noninteractive-element-interactions |
| `src/pages/OutreachNew.tsx` | 1 | label-has-associated-control |
| `src/pages/ProjectFileEditor.tsx` | 2 | label-has-associated-control ×2 |
| `src/pages/ProjectsList.tsx` | 3 | label-has-associated-control ×2, no-autofocus |
| `src/pages/ReportsClosedLoop.tsx` | 2 | click-events-have-key-events, no-static-element-interactions |
| `src/pages/ReportsNeedsAction.tsx` | 2 | click-events-have-key-events, no-static-element-interactions |
| `src/pages/ReportsPipeline.tsx` | 2 | click-events-have-key-events, no-static-element-interactions |
| `src/pages/ReportsStale.tsx` | 2 | click-events-have-key-events, no-static-element-interactions |
| `src/pages/ResumeVariantDetail.tsx` | 1 | no-autofocus |
| `src/test/headingOutline.test.tsx` | 3 | role-has-required-aria-props ×3 — **fixtures, disable in place (§3.1)** |

---

## 7. What this ruling does **not** claim

Stated explicitly, because the failure mode of an enforcement decision is being read as a
completion claim:

- **This is not WCAG 2.1 AA coverage.** jsx-a11y plus axe-core plus heading order is a
  meaningful floor, not conformance. Colour contrast, focus-visible quality, motion, reading
  order and every judgement-based criterion remain unverified by machine.
- **`no-autofocus` (5 findings) is a real rule with real exceptions.** A command palette or a
  modal's first field can legitimately autofocus. Those five should be reviewed individually and
  may end as permanent, commented `eslint-disable-next-line` entries rather than fixes — that is
  a valid outcome, not a dodge.
- **Counts in §2 and §6 are pinned to `743cfeb`** and will drift. Re-run the plugin before citing
  them anywhere else; do not copy these numbers forward on trust.

---

## Related

- `ACCESSIBILITY.md` — the guidelines this enforces, and the standing enforcement-status note.
- `ROUTE_HEADING_OUTLINE.md` — the WIC-1581 ruling that `routeHeadingOutline.test.ts` guards.
- WIC-1192 (this decision) · WIC-1483 (enforcement mechanism) · WIC-1589 (the 47 findings) ·
  WIC-1675 (rendered heading outline) · WIC-1584 (update `ACCESSIBILITY.md` once landed) ·
  WIC-1185 / WIC-1191 (the defect class that motivated axe-core).
