# Modal focus management — design spec

**Author:** UI/UX Developer · **Original date:** 2026-08-19 · **Amended:** 2026-08-25 (WIC-1295,
WIC-1320), 2026-08-26 (WIC-1467)
**Ported into the repo and re-measured against `a59b869`:** 2026-08-27 (WIC-1626, part 2 of WIC-1582)

> **Why this file exists.** `docs/design/ACCESSIBILITY.md` cites *"`MODAL_FOCUS_MANAGEMENT_SPEC.md`
> → **Rule — app-level live regions belong outside `#root`**"* as the rationale of record for a
> normative rule it states in summary form. Until this port that citation pointed at a document
> living only in the UI/UX agent's workspace. The section it names is preserved verbatim below,
> under the same heading, so the cross-reference resolves.
>
> **This is a port, not a transcript.** Every claim was re-measured against `a59b869`. Corrections
> are struck inline, never silently rewritten.

---

## 0. Status — read this first

> ### ⚠️ The original document's status line was false, and this port corrects it
>
> The workspace copy headed the hook section **"`useDialogFocusRestore` (shipped, PR #97)"** and
> described the hook in the present tense throughout. **Re-measured at `a59b869`:**
>
> - `packages/web/src/hooks/useDialogFocusRestore.ts` — **does not exist.**
> - `grep -rn "useDialogFocusRestore\|fallbackRef\|RESTORE_WATCH_MS" packages/web/src/` — **no
>   matches anywhere in the tree.**
> - **PR #97 is OPEN.** So are **PR #95** (the `ConfirmationModal` fix) and **PR #115**
>   (the `ResumeManager` fallback).
>
> Nothing in this specification has shipped. The section is retitled **"Hook contract —
> `useDialogFocusRestore` (specified; PR #97 open, not merged)"** and its tense corrected.
>
> **Do not write a bare PR state into a design document.** "(shipped, PR #97)" was written when #97
> looked imminent and rotted the moment it did not merge. Cite a **commit** for anything claimed as
> shipped; a PR number is a claim about the future. This is the same failure mode the WIC-1582 audit
> was filed to find, caught here in this document's own header.

| Part of this spec | State at `a59b869` |
|---|---|
| §2 audit — all six hand-rolled dialogs non-compliant | **Still entirely accurate.** Zero of the six import `@radix-ui/react-dialog`; zero handle `Escape`. |
| §4 decision — migrate to Radix rather than write a trap | **Unimplemented.** PR #95 / #97 open. |
| §5 hook contract — `useDialogFocusRestore` | **Unimplemented.** File absent; PR #97 open. |
| §6 **Rule — app-level live regions belong outside `#root`** | **Normative and in force.** Also stated in `ACCESSIBILITY.md` §Live Regions. |
| §6.2 the `EmptyState` consequence | **Closed** — fixed on `main` by WIC-1155. |
| §9 docs follow-up — the checked box in `ACCESSIBILITY.md` | ~~**Still outstanding.**~~ **Closed at `0e5d97a` (2026-08-29):** the box now reads `- [ ]` and cites §5. Re-measuring it found **all six** Phase 1 boxes wrong; all six are now unchecked with their measurement inline. |

---

## 1. Summary

`docs/design/ACCESSIBILITY.md` **already specifies** modal behaviour — focus trap, `Escape` to
close, focus moved in on open, focus restored to the trigger on close (§Modals, and §Focus
Management Patterns at `:290`). **Zero of the six hand-rolled dialogs in `packages/web` implement
any of it.** That same document marks `- [x] Focus management in modals` as shipped
(`ACCESSIBILITY.md:640`). It is not shipped.

This is **compliance with a rule that already exists** — it does not depend on any pending board or
design call, and there is already a correct in-repo precedent to copy.

## 2. Audit result — all six hand-rolled dialogs

Measured by grep for `'Escape'`, `focus()`/focus-trap, `document.body.style` (scroll lock), and
`role="dialog"`. **Re-measured at `a59b869`: unchanged — all six rows still hold.**

| File | `role="dialog"` | `Escape` | Focus trap | Focus restore | Scroll lock |
|---|---|---|---|---|---|
| `components/ConfirmationModal.tsx` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `components/QuickReferenceExport.tsx` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `pages/ProjectsList.tsx` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `components/onboarding/OnboardingModal.tsx` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `components/wizard/WizardContainer.tsx` | ⚠️ on backdrop | ❌ | ❌ | ❌ | ❌ |
| `components/CatalogDiff/DiffReviewModal.tsx` | ⚠️ on backdrop | ❌ | ❌ | ❌ | ❌ |

> **Line numbers deliberately dropped from this table in the port.** The workspace copy pinned each
> row to a line (`ConfirmationModal.tsx:31`, and so on) measured on 2026-08-19. Those files have
> since moved. The *file-level* finding is what is load-bearing and it re-measures cleanly; the line
> numbers do not, and a table of stale anchors is worse than none.

The three ❌ rows render a plain `<div className="fixed inset-0 …">`. To assistive tech that is a
`<div>`. **Nothing announces that a dialog opened**, nothing scopes the reading order to it, and the
page behind stays fully reachable by `Tab` and by the screen-reader virtual cursor.

⚠️ = `aria-modal="true"` sits on the full-viewport backdrop rather than the panel, so the "dialog"
nominally includes the backdrop. Cosmetic next to the missing behaviour; the migration fixes it for
free.

## 3. Worst case: the destructive-delete confirmation

`ConfirmationModal` is the app's **only** destructive-action gate — `ResumeManager` uses it for
*"Are you sure you want to delete … This action cannot be undone."*

A keyboard or screen-reader user who activates 🗑️ Delete gets:

1. **No announcement.** Focus never leaves the Delete button. A screen-reader user hears nothing —
   the irreversible-action warning is never read.
2. **No way to reach the buttons but blind `Tab`-walking**, because the page behind the overlay is
   still in the tab order.
3. **No `Escape`.** The conventional cancel gesture does nothing, and there is no backdrop-click
   dismissal either. The only exit is finding "Cancel" by tabbing.
4. Confirm and Cancel have no programmatic grouping, so a mis-tab lands on **Delete** with no
   context that it is destructive.

This is the failure mode a confirmation dialog exists to prevent, on the one action in the app that
cannot be undone.

## 4. Decision — migrate to Radix Dialog, do not write a hand-rolled trap

`@radix-ui/react-dialog` is **already a dependency** and is **already used correctly** in
`components/ApplicationForm.tsx`, `components/CommandPalette.tsx` and `pages/ApplicationNew.tsx`.

`Dialog.Root` + `Portal` + `Overlay` + `Content` supplies focus trap, focus-in-on-open, `Escape`,
outside-click dismiss, body scroll lock, `role="dialog"` and `aria-modal` — with `Dialog.Title` /
`Dialog.Description` wiring the accessible name and description automatically.

**Rejected:** a bespoke `useFocusTrap` hook. It would re-implement six behaviours already shipped,
when the correct primitive is installed with three working call sites to copy.

> **Scope note.** That rejection still stands and is **not** contradicted by `useDialogFocusRestore`
> (§5). Radix keeps ownership of the trap, `Escape`, scroll lock, outside-click and ARIA wiring. The
> hook covers only the one behaviour Radix genuinely does not supply for *controlled* dialogs —
> restore — at roughly 40 lines against Radix's six behaviours.

### 4.1 Correction, 2026-08-19 — "focus-restore-on-close" is WRONG for our dialogs

Raised by the implementer on PR #95 and **confirmed** against `@radix-ui/react-dialog@1.1.15` as
installed. Radix supplies focus restore **only for dialogs that render a `Dialog.Trigger`.** Every
dialog in this spec is *controlled* via an `isOpen` prop with its trigger in the parent, so none
qualify.

The chain, all three links verified in the installed sources:

1. `react-dialog` — `DialogContentModal` wires
   `onCloseAutoFocus: composeEventHandlers(props.onCloseAutoFocus, (e) => { e.preventDefault(); context.triggerRef.current?.focus(); })`.
2. `@radix-ui/primitive` — `composeEventHandlers` defaults to `checkForDefaultPrevented = true`: it
   runs the consumer handler first and skips its own only if the consumer called `preventDefault()`.
3. `react-focus-scope` — `if (!unmountEvent.defaultPrevented) focus(previouslyFocusedElement ?? document.body)`.

So modal `Content` **unconditionally cancels** the FocusScope restore and focuses `triggerRef`
instead. With no `Dialog.Trigger` rendered that ref is permanently `null`, and focus silently lands
on `<body>` — the very failure this spec was written to fix.

**Required pattern for every controlled dialog here:** capture `document.activeElement` into a ref
in `onOpenAutoFocus` (which fires before focus moves in, so it is still the trigger), then in
`onCloseAutoFocus` call `event.preventDefault()` — suppressing Radix's broken restore via link 2 —
and focus the captured ref yourself.

**Testing note:** assert focus restore on *confirm*-shaped exits, not only cancel-shaped ones. A
suite that tests only Escape and Cancel stays green while the confirm path is broken.

#### 4.2 Correction, 2026-08-25 (WIC-1295) — the "trigger destroyed by its own action" mechanism was wrong

~~"the captured node is detached and `.focus()` on a disconnected element is a no-op, so focus ends
on `<body>` anyway."~~ That is **not** what happens, and the error propagated — the PR #97 review
repeated it and prescribed an `isConnected` guard that cannot work. Measured in Chromium and
corroborated against the installed sources.

**The restore succeeds, and is then undone.** `react-focus-scope` dispatches its unmount restore
inside `setTimeout(…, 0)` — a *macrotask after the dialog unmounts*. The refetch commit that removes
the trigger can land on either side of it. On the create-success path it lands *after*:

```
focusin  active=BUTTON[Create Your First Project]  emptyBtn=present  dialog=closed
focusout active=BODY                               emptyBtn=present
t+0      active=BODY                               emptyBtn=GONE
```

Consequences:

1. **An `isConnected` guard at restore time cannot see it** — the element is still connected when
   the guard runs. It passes, focus is restored, and *then* the node is removed.
2. **Declining to `preventDefault()` does not recover it either.** `composeEventHandlers` defaults
   to `checkForDefaultPrevented: true`, so falling through just runs Radix's own handler, which
   `preventDefault()`s regardless and focuses its always-`null` `triggerRef` — which also cancels
   FocusScope's `focus(previouslyFocusedElement ?? document.body)` fallback. **Every route ends on
   `<body>`.**

Because the damage happens *after* any single-shot decision point, the restore must be **watched**,
not merely guarded.

## 5. Hook contract — `useDialogFocusRestore` *(specified; PR #97 open, not merged)*

> **Not shipped.** `packages/web/src/hooks/useDialogFocusRestore.ts` does not exist at `a59b869` and
> no symbol named `useDialogFocusRestore`, `fallbackRef` or `RESTORE_WATCH_MS` appears anywhere
> under `packages/web/src/`. This section is a **specification of intended behaviour**, written
> against PR #97's implementation. See §0.

Intended usage — spread the result onto `Dialog.Content`:

```tsx
const focusRestore = useDialogFocusRestore({ fallbackRef });   // fallbackRef optional
<Dialog.Content {...focusRestore}>
```

It captures the trigger by **two** mechanisms, because each has a blind spot and the two do not
overlap:

| Mechanism | Covers | Blind spot |
|---|---|---|
| `onOpenAutoFocus` (`activeElement` at dispatch) | the ordinary case; **a dialog opened from inside another dialog** | never dispatched when the panel contains an `autoFocus` field — FocusScope guards on `hasFocusedCandidate = container.contains(previouslyFocusedElement)`, and React's `autoFocus` runs in the commit phase ahead of that passive effect |
| a document-level `focusin` note, ignored while any `[role="dialog"],[role="alertdialog"]` is mounted | the `autoFocus` dialogs (`WizardContainer`) | a trigger *inside* another dialog — which is exactly what mechanism 1 catches |

### 5.1 `fallbackRef` — for a trigger the dialog's own action destroys

After restoring, the hook watches the element it restored to for up to `RESTORE_WATCH_MS`
(**1000 ms**). If that element leaves the document *while still holding focus*, focus moves to
`fallbackRef`. The watch self-cancels on the first `focusin` elsewhere, so a user who has moved on is
never yanked.

Three rules for call sites:

1. **The fallback must be structurally stable.** It has to render on *both* sides of whatever branch
   the dialog's action flips. `ProjectsList` is the model: the header **Create Project** button sits
   above the `projects.length === 0 ? <EmptyState/> : <list/>` ternary, so it is mounted whichever
   arm renders.
2. **The fallback is captured once, at close time.** A `fallbackRef` that is `null` at
   `onCloseAutoFocus` disables the watch entirely — rule 1 restated as a failure mode.
3. **Prefer the surviving control for the *same action*.** It keeps the ACCESSIBILITY.md contract
   ("focus returns to the trigger") semantically intact when the literal trigger is gone, and does
   not require the hook to know anything about the mutation's result. Focusing the newly created
   item instead would navigate-by-surprise and depends on list sort order.

### 5.2 Amended 2026-08-25 (WIC-1320) — rule 3 is a *ladder*, and rung 1 is often empty

Rule 3 as written names a preference but no alternative, so it reads as a requirement. On
`ResumeManager` rung 1 does not exist: the action is **delete**, and the only delete affordance is
the per-row button the action destroys. Rules 1 and 3 have no common solution there. The full
ladder:

1. **A surviving control for the same action** — `ProjectsList`'s header **Create Project** button.
   Best: keeps the "focus returns to the trigger" contract semantically intact.
2. **The stable container wrapping the region the action changed** — `tabIndex={-1}` plus
   `role="region"` and an `aria-label`. Use when rung 1 is empty.
3. **The page `<h1>`.** Last resort only.

**Rung 2 is approved and rung 3 is explicitly rejected for the delete case.** Sending focus to the
`<h1>` throws the user to the top of the page and makes them re-traverse breadcrumb, tabs and
heading to get back to the list they were working in — a 2.4.3 Focus Order regression on every
delete. The wrapper keeps them where they were.

Two constraints on rung 2:

- **The container must be named.** A `role="region"` with no accessible name is not exposed as a
  landmark, and a bare `<div tabIndex={-1}>` announces nothing on focus.
- **It must wrap *every* arm of the branch,** including loading and error arms — not just the two
  the ticket happens to name. Otherwise rule 1 fails on a path nobody tested.

**Announce the outcome.** Moving focus to a control the user did not press is a context change they
cannot see. A polite live region on the create/delete-success path is required. Read §6 before
adding one anywhere.

## 6. Rule — app-level live regions belong **outside `#root`**

**Adopted 2026-08-25 (WIC-1320), from a finding on PR #115. Ratified 2026-08-26 (WIC-1467) as the
decision on WIC-1181 question 3 (`live-region-rule`).** Normative for this app.

**Also stated in `docs/design/ACCESSIBILITY.md` → §Live Regions → *Where app-level live regions must
be mounted*** (`ACCESSIBILITY.md:187`), phrased for authors adding a new announcer or toast host,
with a matching item in that document's keyboard-testing checklist. That is the copy an implementer
will hit first; **this section is the rationale of record.** Keep the two in step.

> **Any `[aria-live]` element inside `#root` defeats `#root`-level background hiding — whether or
> not it wraps a control.** An app-level announcer must therefore be portalled to `<body>` as a
> sibling of `#root`, never rendered in place.

Verified against `aria-hidden@1.2` as installed (`dist/es2015/index.js`), the package Radix uses to
hide the background behind a modal — not inferred from behaviour:

- `hideOthers` appends **every** `[aria-live]` element under the parent node to its `targets` list,
  alongside the dialog itself (upstream issue #10, "we should not hide aria-live elements").
- `keep` then walks each target **up its whole `parentNode` chain**, adding every ancestor to
  `elementsToKeep`.
- `deep` skips anything in `elementsToKeep` and hides everything else.

So a live region at `#root > … > div[aria-live]` puts `#root` itself into `elementsToKeep`, and
`#root` never receives `aria-hidden`. This surfaced as a *real* regression: PR #115's in-place
announcer broke PR #95's existing `#root[aria-hidden]` assertion on the first test run. Portalling
it to `<body>` fixes it — there it is exempted on its own account and hides nothing.

### 6.1 This sharpens the WIC-1155 discriminator — it does not restate it

The two failures are different sizes and must not be conflated:

| | Cause | Damage |
|---|---|---|
| **WIC-1155** | a live region that **wraps a control** | that control stays operable behind every dialog — a real focus-trap escape |
| **This rule** | **any** in-page live region | the ancestor chain up to and including `#root` loses `aria-hidden` |

Because `deep` still recurses *into* kept nodes and hides their non-ancestor children, the second
failure leaks no interactive content by itself — sibling subtrees are still hidden correctly. Its
cost is that the `#root[aria-hidden]` invariant silently stops holding, which is what makes it worth
a rule: it is the check most likely to be used as proof that the background *is* hidden.

### 6.2 Consequence that was live — now closed

`components/EmptyState.tsx` used to carry `role="region" aria-live="polite"` on the container that
wrapped its action `<button>`. It was therefore **both failures at once**: on any page rendering an
`EmptyState`, `#root` did not get `aria-hidden` when a dialog opened, *and* the empty state's action
button stayed reachable behind it. On `ResumeManager` that is exactly the state a user reaches by
deleting their last resume. The existing `#root[aria-hidden]` test passed only because its fixture
always returned one resume, so `EmptyState` never rendered — the invariant was **fixture-dependent,
not held**.

**Resolved on `main` by WIC-1155** (`6435d79`, then `3f12bb0`, which also removed the
`role="region"` landmark). **Re-confirmed at `a59b869`:** the wrapper is a plain `<div>` with no
ARIA (`EmptyState.tsx:92`), and the file carries comments at `:71–74` and `:82–90` recording why
neither attribute may come back.

Retained here as the *worked example* of the second failure mode, not because it is outstanding. The
general lesson survives the fix: **an empty-state path is where a fixture-chosen `#root[aria-hidden]`
assertion goes unsound**, so any new background-hiding test should carry an empty-list variant.

### 6.3 For implementers

- App-level / page-level announcer → `createPortal(…, document.body)`. Mount it **permanently** and
  change only its **text**: assistive tech announces updates to a region already in the
  accessibility tree, so a region that mounts at the same moment its message appears may not be
  announced at all.
- Component-local live regions (`ProgressIndicator`, `KanbanBoard`) can stay in place — they are
  content, not app chrome. They still cost the `#root` attribute while mounted, so do not use
  `#root[aria-hidden]` as a background-hiding assertion on a page that renders one. Assert on the
  specific background subtree instead.
- Never put a focusable element inside a live region (WIC-1155).

## 7. Reference implementation and per-file migration notes

> The workspace copy carried a complete rewritten `ConfirmationModal.tsx` plus a table pinning each
> of the other five dialogs to the line of its title element and close handler. **Both are omitted
> from this port**, because neither re-measures: the line anchors are from 2026-08-19, and PR #95 /
> #97 carry the actual migration diffs, which are the reviewable artefact. Reproducing a stale copy
> here would create a second, diverging source of truth for code that is mid-review.
>
> The **design constraints** that survive independent of any line number:

- **Drop `if (!isOpen) return null;`.** `Dialog.Root open=` handles mounting; the early return breaks
  Radix's close transition and focus restore.
- **`onOpenChange` must call the parent's cancel handler,** not merely close — that is what wires
  `Escape`, outside-click and `Dialog.Close` to the existing state cleanup. Without it the parent's
  state desyncs from the dialog.
- **Radix focuses the first tabbable child on open** — for a destructive gate that is Cancel, which
  is the right default. Do **not** add `autoFocus` to Confirm.
- `type="button"` on both actions: neither is inside a `<form>` today, but the component is generic
  and a future in-form caller would get an accidental submit.
- Drop the now-redundant `role` / `aria-modal` / `aria-labelledby` and the manual `id`s —
  `Dialog.Title` supplies the accessible name. Keep every className verbatim except moving
  positioning onto `Dialog.Content`. **This is a semantics change, not a visual redesign, and no
  pixel should move.**

### 7.1 Two that need one extra beat

- **`OnboardingModal.tsx`** stacks a second dialog (dismiss-confirm) over the first. Nest a second
  `Dialog.Root` **inside** the outer `Dialog.Content` rather than returning early; Radix stacks
  correctly, and dismissing the inner one must return focus to the outer panel, not the page. The
  inner dialog is controlled too, so it needs the same capture-and-restore treatment — here the
  captured `activeElement` is inside the outer panel, which is what we want.
- **`WizardContainer.tsx`** has an `autoFocus` on a step input. Keep it.
  ~~Pass `onOpenAutoFocus={(e) => e.preventDefault()}` on `Dialog.Content` so Radix does not steal
  focus back to the first tabbable element.~~
  > **Struck — superseded 2026-08-25 (WIC-1295).** The `hasFocusedCandidate` branch is not a "may",
  > it is unconditional. `container.contains(previouslyFocusedElement)` is `true` here, so FocusScope
  > skips the *entire* mount block and `onOpenAutoFocus` is **never dispatched** for this dialog.
  > The prescribed handler would have been dead code, and no capture-then-prevent ordering is
  > needed. Spread the bare hook here and let the `focusin` mechanism supply the trigger.
  > **Do not re-add the handler.**

## 8. Sequencing and verification

Suggested split — two PRs, so the destructive-action fix is not held up by the long tail:

1. **PR 1:** `ConfirmationModal.tsx` alone. Highest severity, smallest diff, zero caller changes.
   *(This is PR #95 — open.)*
2. **PR 2:** the other five. *(This is PR #97 — open.)*

> **The original sequencing note is spent.** It said `QuickReferenceExport.tsx` and
> `ConfirmationModal.tsx` had "uncommitted edits in the shared working tree right now (the WIC-1127
> residual-caps work)" and to land those first. That was a statement about one machine on one
> afternoon; the tree is clean at `a59b869`. Struck — and a caution against ever putting a working-
> tree observation in a durable document.

Verify per dialog:

1. Open the dialog **by keyboard only** (`Tab` to trigger, `Enter`).
2. Focus is inside the dialog. `Tab` cycles within it and never reaches page content behind.
3. `Escape` closes it, and the parent's cancel state runs.
4. Focus returns to the trigger that opened it — **including on confirm-shaped exits**, per §4.1.
5. Background does not scroll while open.
6. Screen reader announces the dialog and reads title + message on open. For the `ResumeManager`
   delete, confirm *"This action cannot be undone"* is spoken.

> The original text gated items 1–5 on "no unit-test harness on `packages/web` until WIC-1037 /
> PR #85 lands". **That harness has since landed** — `packages/web` has Vitest + Testing Library, and
> `EmptyState.test.tsx` and `NotFound.test.tsx` are in the tree. Items 1–5 are RTL-testable **now**
> and should ship as regression tests with PR #95 / #97 rather than as a manual pass.

## 9. Docs follow-up — ~~still outstanding~~ **closed 2026-08-29**

~~`docs/design/ACCESSIBILITY.md:640` marks `- [x] Focus management in modals` complete.~~ **It should
be `- [ ]` until this ships.** A checked box on an unimplemented a11y requirement is why this went
six dialogs deep before anyone looked.

~~**Re-measured at `a59b869`: still `- [x]`, still wrong.** The original spec cited this at `:566`;
it is now `:640`. Not fixed in this PR — flipping it is a claim about `ACCESSIBILITY.md`'s checklist
semantics and belongs with the PR that actually lands the behaviour. Tracked in §10.~~

> **Closed at `0e5d97a` (2026-08-29).** The box is now `- [ ]` and points here, at §5, for its
> authority. Line number deliberately dropped — this item has already moved twice (`:566` → `:640`)
> and the anchor rotted both times; cite *§Implementation Priority → Phase 1* instead.
>
> The flip did **not** wait for the behaviour after all. Re-measuring that one box prompted
> re-measuring all six in that checklist, and **all six were wrong** — contrast validation was
> checked here while `DESIGN_SYSTEM.md` carried the identical item unchecked, and "screen reader
> testing (basic)" had no recorded result anywhere in the repo. That made the flip a correction of
> fact, not a claim about checklist semantics, so it no longer belonged with the behaviour PR.
> Each box now carries its measurement inline.

## 10. Follow-ups

- **Land PR #95 and PR #97.** Both open, both blocking every row of §2.
- ~~**Flip `ACCESSIBILITY.md:640`** to `- [ ]`, or land the behaviour that makes it true.~~
  **Done at `0e5d97a`, 2026-08-29** — see §9. All six Phase 1 boxes were re-measured and unchecked,
  not just this one.
- **Convert §8's manual checklist to RTL regression tests** — the harness gap it was written around
  has closed.

## 11. Related

- `docs/design/ACCESSIBILITY.md` — §Modals, §Focus Management (`:246`), §Live Regions (`:149`) and
  *Where app-level live regions must be mounted* (`:187`), which cites §6 of this document.
- `docs/design/NOTFOUND_PAGE_DESIGN_SPEC.md` — the WIC-1155 `EmptyState` defect from the other side.
- `docs/design/COMPONENT_SPECS.md` — `EmptyState`'s `headingLevel` contract.
