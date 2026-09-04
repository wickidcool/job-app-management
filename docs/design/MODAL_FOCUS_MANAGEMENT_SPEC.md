# Modal focus management — design spec

**Author:** UI/UX Developer · **Original date:** 2026-08-19 · **Amended:** 2026-08-25 (WIC-1295,
WIC-1320), 2026-08-26 (WIC-1467), 2026-08-29 (WIC-1670 — §5.3), **2026-08-31 (WIC-1902 — shipped;
§0, §1, §2, §5, §5.3, §8, §10 re-measured at `c74cd2f1`)**
**Ported into the repo and re-measured against `a59b869`:** 2026-08-27 (WIC-1626, part 2 of WIC-1582)
**This file is the canonical copy.** The UI/UX agent's workspace holds a frozen pre-port original;
amend here.

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

> ### ✅ This specification has now shipped in full (2026-08-31, WIC-1902)
>
> **Re-measured at `c74cd2f1`.** All three implementing PRs merged on 2026-08-30/31 and are
> ancestors of `main`:
>
> | PR | lands | merge commit |
> |---|---|---|
> | #95 | `ConfirmationModal` — the destructive-delete gate (§3) | `e45cb04` |
> | #97 | the other five dialogs, and `useDialogFocusRestore` itself (§5) | `ed71ed5` |
> | #115 | the `ResumeManager` fallback — `restoreFocusTo` (§5.3) | `bf8c8b3` |
>
> - `packages/web/src/hooks/useDialogFocusRestore.ts` — **exists**, added by `ed71ed5`.
> - `useDialogFocusRestore` / `fallbackRef` / `RESTORE_WATCH_MS` — **18 / 6 / 3** occurrences under
>   `packages/web/src`, against "no matches anywhere in the tree" before.
> - **All six dialogs of §2 are migrated** to `@radix-ui/react-dialog`, and there are **8**
>   `useDialogFocusRestore(` call sites across those six components.
>
> #### The correction the previous status block asked for, applied to itself
>
> That block was written to fix a header reading *"(shipped, PR #97)"* while nothing had shipped, and
> it drew the right rule: **cite a commit for anything claimed as shipped; a PR number is a claim
> about the future.** It then recorded its own finding as *"PR #97 is OPEN"* — a bare PR state, the
> very thing it had just prohibited — so it rotted the moment #97 merged, in the opposite direction.
>
> **A PR number is unstable in both directions.** "Open" decays into a denial of shipped behaviour
> exactly as fast as "shipped" decays into an overclaim, and the denial is the more expensive of the
> two: an overclaim invites a reader to check, while a denial tells them not to bother looking. Every
> shipped claim in this document is now pinned to a merge commit.

| Part of this spec | State at `c74cd2f1` |
|---|---|
| §2 audit — all six hand-rolled dialogs non-compliant | ~~Still entirely accurate.~~ **Closed at `ed71ed5`.** All six now import `@radix-ui/react-dialog` and mount `Root`+`Portal`+`Overlay`+`Content`+`Title`; `Escape`, focus trap, focus-in-on-open and scroll lock come with the primitive. The table is kept below as the **record of what was fixed**, not as a live finding. |
| §4 decision — migrate to Radix rather than write a trap | **Implemented** at `e45cb04` (`ConfirmationModal`) and `ed71ed5` (the other five). |
| §5 hook contract — `useDialogFocusRestore` | **Implemented** at `ed71ed5`. 8 call sites across the six components; `RESTORE_WATCH_MS` and the two-mechanism capture below are in the shipped hook. |
| §5.3 obligation — *when* `restoreFocusTo` is required | **Normative, in force, and now ARMED.** `docs/design/confirmation-modal-focus-audit.py` no longer prints its dormancy `NOTICE`: at `c74cd2f1` it reports `ConfirmationModal focus restore OK — 1 call site(s) declared`. The green check on this rule is load-bearing as of `bf8c8b3`. |
| §6 **Rule — app-level live regions belong outside `#root`** | **Normative and in force.** Also stated in `ACCESSIBILITY.md` §Live Regions. |
| §6.2 the `EmptyState` consequence | **Closed** — fixed on `main` by WIC-1155. |
| §9 docs follow-up — the checked box in `ACCESSIBILITY.md` | ~~**Still outstanding.**~~ **Closed at `0e5d97a` (2026-08-29):** the box was flipped to `- [ ]` and cites §5. Re-measuring it found **all six** Phase 1 boxes wrong. **Now `- [x]` again at `c74cd2f1` (WIC-1902)** — this time on a measurement, having met the two conditions that list's own gate note set. The other five remain unchecked. |

---

## 1. Summary

`docs/design/ACCESSIBILITY.md` **already specifies** modal behaviour — focus trap, `Escape` to
close, focus moved in on open, focus restored to the trigger on close (§Modals, and §Focus
Management Patterns). ~~**Zero of the six hand-rolled dialogs in `packages/web` implement any of
it.**~~ **All six implement it as of `ed71ed5` (2026-08-30).**

This was **compliance with a rule that already existed** — it did not depend on any pending board or
design call, and there was already a correct in-repo precedent to copy.

> **Status, 2026-08-31 (WIC-1902).** This section describes the *problem this document was written
> to solve*, in the tense it was written in, because §2's audit is the evidence for §4's decision and
> reads as nonsense in the past tense. **The problem is fixed** — see §0 for the merge commits. Read
> §§1–4 as the case for a migration that has since happened, and §§5–7 as the contract that governs
> the code now in the tree.

## 2. Audit result — all six hand-rolled dialogs

Measured by grep for `'Escape'`, `focus()`/focus-trap, `document.body.style` (scroll lock), and
`role="dialog"`. ~~**Re-measured at `a59b869`: unchanged — all six rows still hold.**~~
**⚠️ This table is a historical record — every row was closed at `e45cb04` / `ed71ed5`.**

The original finding, as it stood from 2026-08-19 to 2026-08-30:

| File | `role="dialog"` | `Escape` | Focus trap | Focus restore | Scroll lock |
|---|---|---|---|---|---|
| `components/ConfirmationModal.tsx` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `components/QuickReferenceExport.tsx` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `pages/ProjectsList.tsx` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `components/onboarding/OnboardingModal.tsx` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `components/wizard/WizardContainer.tsx` | ⚠️ on backdrop | ❌ | ❌ | ❌ | ❌ |
| `components/CatalogDiff/DiffReviewModal.tsx` | ⚠️ on backdrop | ❌ | ❌ | ❌ | ❌ |

**Re-measured at `c74cd2f1`: all six files now mount the full Radix stack** — `Dialog.Root`,
`Dialog.Portal`, `Dialog.Overlay`, `Dialog.Content` and `Dialog.Title` are present in every one, so
every ❌ above is supplied by the primitive (§4.1). All six also consume `useDialogFocusRestore`,
which is what carries the *restore* column beyond what Radix alone gives (§5).

> **The `fixed inset-0` className survives the migration and is not a leftover.** A grep for the
> hand-rolled overlay still hits all six files, but in every case it is now the `className` on
> `<Dialog.Overlay>` rather than a bare `<div>`. **Grepping for the old markup is not a valid check
> that the migration happened** — check which element carries the class.

> **Line numbers deliberately dropped from this table in the port.** The workspace copy pinned each
> row to a line (`ConfirmationModal.tsx:31`, and so on) measured on 2026-08-19. Those files have
> since moved. The *file-level* finding is what is load-bearing and it re-measures cleanly; the line
> numbers do not, and a table of stale anchors is worse than none.

The three ❌ rows rendered a plain `<div className="fixed inset-0 …">`. To assistive tech that is a
`<div>`. **Nothing announced that a dialog opened**, nothing scoped the reading order to it, and the
page behind stayed fully reachable by `Tab` and by the screen-reader virtual cursor.

⚠️ = `aria-modal="true"` sat on the full-viewport backdrop rather than the panel, so the "dialog"
nominally included the backdrop. Cosmetic next to the missing behaviour; the migration fixed it for
free — but **not** in the way this note originally implied.

> **The migration did not move `aria-modal` to the panel. It deleted the attribute.** There is no
> literal `aria-modal` anywhere in `packages/web/src` at `c74cd2f1`, and Radix does not add one:
> `@radix-ui/react-dialog` calls `hideOthers()` from the `aria-hidden` package and marks every
> sibling of the content `aria-hidden` instead, which its own source calls *"a better supported
> equivalent to setting `aria-modal`"*.
>
> **This is the mechanism §6 exists to protect**, and the connection is easy to miss: because
> modality is enforced by `aria-hidden` on everything outside the dialog, an `[aria-live]` region
> mounted *inside* `#root` is hidden along with it — which is precisely the failure §6 rules
> against. §6 is not an unrelated live-region convention that happens to sit in this document; it is
> **a direct consequence of how Radix implements modality.** Do not "simplify" one without the other.

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

## 5. Hook contract — `useDialogFocusRestore` *(shipped at `ed71ed5`)*

> **Shipped.** `packages/web/src/hooks/useDialogFocusRestore.ts` exists as of `ed71ed5`
> (2026-08-30), and `useDialogFocusRestore` / `fallbackRef` / `RESTORE_WATCH_MS` resolve to
> **18 / 6 / 3** occurrences under `packages/web/src` — against "no matches anywhere in the tree"
> when this section was written. There are **8** `useDialogFocusRestore(` call sites across the six
> components of §2 (`OnboardingModal` accounts for three of them, one per dialog it hosts).
>
> ⚠️ **8 call sites, not 9.** A ninth `useDialogFocusRestore(` occurrence is the usage example inside
> the hook's own docstring. **A symbol mention is not a call site** — grep `useDialogFocusRestore(`
> and then subtract the definition's own documentation.
>
> This section is therefore a **description of code in the tree**, not a specification of intended
> behaviour. It is still the contract of record: if the hook and this section disagree, that is a bug
> in one of them, not a gap awaiting an implementation. See §0.

Usage — spread the result onto `Dialog.Content`:

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

> **Use the shared helper — `useAnnouncer` + `<Announcer>`** (`ACCESSIBILITY.md` → *Announcing an
> outcome*). It portals itself to `<body>` per §6, and it handles the repeat case a hand-rolled
> region gets wrong: announcing the *same* string twice is silent, because assistive tech reacts to
> a change in the region and re-setting an identical string is not one.
>
> **Shipping the focus half alone does not satisfy this rule.** This clause has been normative
> since 2026-08-19, and `ProjectsList`'s create-success path satisfied only its focus half — a
> screen-reader user who created their first project heard "Create Project, button" and was never
> told the project existed (WIC-1304). Landing a `fallbackRef` or a `restoreFocusTo` without an
> announcement is half a fix; the two ship together.

### 5.3 When a fallback is **obligatory** — adopted 2026-08-29 (WIC-1670)

**Normative.** §5.1 and §5.2 both answer *which* element to pass once you have already decided you
need to pass one. Neither states the obligation, and `restoreFocusTo` is an optional prop — so a
call site that needs it and omits it produces **no type error, no lint error and no failing test.**
This section is the missing half. Raised by the Code Reviewer on PR #115 and adopted as written,
with the sharpenings below.

> **The rule.** If the dialog's confirm action can remove the trigger's own DOM node — directly, or
> by changing a list or branch the trigger renders inside — `restoreFocusTo` is **required**, not
> optional.
>
> **The test is a structural one about the render tree, not a judgement about the trigger.** Do not
> ask *"is the trigger detached when the dialog closes?"* — it usually is **not** (§4.2: the restore
> succeeds and is undone a macrotask later). Ask:
>
> > **Does the trigger render inside anything the action's refetch re-renders?**
>
> Two answers are mechanical, and between them cover every case in this app today:
>
> - **A per-row control inside a `.map()` over the mutated collection** — always **yes**.
>   (`ResumeManager`'s `🗑️ Delete`. This is WIC-1181 exactly.)
> - **A control inside one arm of a branch whose predicate the action can flip** — `list.length === 0
>   ? <EmptyState/> : <list/>`, or the loading/error arms — also **yes**, including when the arm it
>   sits in is not the one that changes.
>
> If the answer is no, **say so on the record** at the call site (below). Do not leave it silent:
> "no fallback needed" and "nobody considered it" are indistinguishable in a diff, and the second is
> what shipped WIC-1181.

**Three things that do *not* discharge the obligation.** All three were tried and measured:

1. **An `isConnected` guard at restore time.** The node is still connected when the guard runs; it
   passes, focus is restored, and *then* the node is removed (§4.2, measured in Chromium on PR #97).
2. **Declining to `preventDefault()`** in `onCloseAutoFocus`. `composeEventHandlers` defaults to
   `checkForDefaultPrevented: true`, so falling through runs Radix's own handler, which
   `preventDefault()`s regardless and focuses its always-`null` `triggerRef` — every route ends on
   `<body>` (§4.1, §4.2).
3. **A manual pass that looked fine.** The damage lands after the decision point, in a `setTimeout(…,
   0)` the mutation's commit can straddle in either order. A tester who does not tab immediately
   after confirming sees nothing wrong.

**Why the prop stays optional, and why there is no lint rule.** Making it required would be wrong for
a cancel-only dialog whose trigger survives, and worse than the status quo in practice: authors would
satisfy the type by passing a throwaway ref, which converts a *visible omission* into an *invisible
dead ref* — §5.1 rule 2's failure mode, on purpose. A lint rule would have to decide whether a given
dialog's `onConfirm` unmounts its own trigger, which is a data-flow question across a mutation, a
query invalidation and a conditional render, and is not statically decidable in the general case. So
the enforcement is a **declaration**, not an inference.

#### Verification — every call site declares, one way or the other

Every `<ConfirmationModal …>` call site must **either** pass `restoreFocusTo`, **or** carry a
`focus-restore-exempt` comment saying why its trigger survives the confirm:

```tsx
{/* focus-restore-exempt: the Filters button sits in the toolbar above the ternary
    this action flips, so no confirm outcome can unmount it. */}
<ConfirmationModal … />
```

Enforced by **`docs/design/confirmation-modal-focus-audit.py`**, wired into `Lint & Test` in
`.github/workflows/deploy.yml` alongside the other three design audits. A reason under 40 characters
is rejected — the exemption has to be a sentence a reviewer can disagree with.

**What a green check from that script does not mean**, stated so it is not over-read:

- **It does not check that the ref you passed is any good.** §5.1 rule 1 (the fallback must render on
  *both* arms of the branch the action flips) and rule 2 (a `fallbackRef` still `null` at
  `onCloseAutoFocus` disables the watch silently) remain structural judgements no grep can make.
  Passing a throwaway ref satisfies the audit and ships the bug — which is the whole reason the prop
  is not simply made required.
- **It covers `ConfirmationModal` call sites only.** The rule above is normative for **every** dialog
  in this app; the script mechanises the one component with a uniform prop to grep for. The other
  five dialogs (§7) are on the author.
- **It skips `*.test.tsx` / `*.spec.tsx` and `test/` and `e2e/` directories.**
- ~~**It is dormant until `restoreFocusTo` exists on the component.**~~ **It is ARMED as of
  `bf8c8b3`.** The prop is now declared, so the script no longer prints its dormancy `NOTICE`:
  it reports `ConfirmationModal focus restore OK — 1 call site(s) declared` and exits 0.
  ⚠️ **The old text said "today's green check on this rule proves nothing, by construction and on
  the record." That is no longer true, and leaving it would have taught a reader to discount a
  signal that now carries real weight.**

> **State at `c74cd2f1` (2026-08-31), re-measured for this amendment.** `restoreFocusTo` is declared
> at `ConfirmationModal.tsx:27` and passed at `ResumeManager.tsx:239`; `ConfirmationModal` is on
> Radix and consumes `useDialogFocusRestore({ fallbackRef: restoreFocusTo })`. There is still
> exactly **one** `<ConfirmationModal` call site in the tree — `pages/ResumeManager.tsx`, the one
> whose trigger the action destroys — and it is the one the audit now enforces.
>
> ~~This section is a rule written *ahead* of the mechanism it governs.~~ **The rule and the
> mechanism are now in step.**
>
> **The self-arming design worked exactly as specified, and that is worth recording.** §10 predicted
> that after #115 the audit would print `ConfirmationModal focus restore OK — 1 call site(s)
> declared`, and that *any other output* would mean "the prop landed under a different name and the
> audit is watching nothing." It prints that string verbatim. A dormant check that names its own
> arming condition, and a follow-up that writes down what the armed output must look like, together
> turned "did the fix actually connect to the rule?" into a single command rather than a judgement
> call — **nobody had to remember this document exists.**

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

- App-level / page-level announcer → **`<Announcer>` + `useAnnouncer`** (WIC-1304), which is this
  bullet already implemented. It does the `createPortal(…, document.body)` for you, mounts
  **permanently** and changes only its **text** — assistive tech announces updates to a region
  already in the accessibility tree, so a region that mounts at the same moment its message appears
  may not be announced at all. Reach for it before writing `createPortal` by hand.
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

Suggested split — two PRs, so the destructive-action fix is not held up by the long tail. **Both
landed; the split is recorded here because §5.3 and §6 cite the two halves separately.**

1. **PR 1:** `ConfirmationModal.tsx` alone. Highest severity, smallest diff, zero caller changes.
   *(This was PR #95 — merged at `e45cb04`.)*
2. **PR 2:** the other five. *(This was PR #97 — merged at `ed71ed5`.)*

The `ResumeManager` fallback that §5.3 governs followed as PR #115, merged at `bf8c8b3`.

> **Added 2026-08-29 (WIC-1715) — PR 2 now gates a feature, not just an audit item.**
> `OnboardingModal` is one of PR 2's five. The WIC-1715 ruling
> (`ONBOARDING_FLOW.md` §Step 4) puts an **inline form with text inputs** on onboarding
> step 5, and explicitly sequences it behind PR 2 for the focus trap this section
> installs. So PR #97 is a dependency of PR #146, not merely a parallel a11y fix:
> merging #146 first would ship the §2 hazard in its sharpest form — a partially
> completed form a keyboard user can `Tab` straight out of, into a page this dialog's
> `aria-modal="true"` has already told assistive tech does not exist.
>
> Stated here because the dependency runs the *other* way from where anyone would look
> for it: nothing in #146 mentions focus management, and nothing in the audit table in
> §2 suggests a feature is waiting on the `OnboardingModal` row.
>
> ✅ **The constraint held.** #97 merged 2026-08-30T20:58Z, #146 merged 2026-08-31T21:20Z — about
> 24 hours apart, and `ed71ed5` is an ancestor of #146's merge commit `2513309d`. The onboarding
> form never existed on `main` without the focus trap, so the hazard this note was written to
> prevent did not ship. Kept as the record of a dependency that was correctly ordered, since
> nothing in either PR's own diff would show it.

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
>
> ✅ **Automated — as Playwright E2E, not RTL.** `packages/web/e2e/modal-focus.spec.ts` and
> `modal-focus-projects.spec.ts` cover all six items above, including the screen-reader ones this
> checklist assumed a human would have to do: dialog announcement, `Tab` trapping, `Escape`, scroll
> lock, background hidden from the virtual cursor, and the confirm-shaped restore of §4.1. **E2E was
> the right level and the RTL prediction was wrong** — items 3 and 5 (`Escape` reaching the parent's
> state, real scroll lock) depend on browser behaviour jsdom does not implement.
>
> ⚠️ **They cover 2 of the 6 dialogs** — `ConfirmationModal` (via `ResumeManager`) and
> `ProjectsList`. The remaining four rely on the shared hook being shared, which is an argument from
> construction, not a measurement. Widening the sweep is the open item in §10.

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

> **Re-checked `- [x]` at `c74cd2f1` (2026-08-31, WIC-1902) — the behaviour landed.** The box has
> now been `- [x]` (wrongly), `- [ ]` (correctly), and `- [x]` again (correctly), which makes it a
> useful worked example: **the tick mark carries no information, and only the measurement beside it
> does.** It is checked now for the same reason it was unchecked then — someone read the tree.
>
> That round trip is also why the flip was cheap and safe the second time. `ACCESSIBILITY.md`'s
> Phase-1 gate note had written down, *in advance*, the two conditions under which this box becomes
> tickable — the Radix migration, and WIC-1181 separately — so re-checking it was a matter of
> verifying two stated conditions rather than re-litigating what the box means. **A checklist item
> that records what would make it true is worth several that merely record whether it is.**

## 10. Follow-ups

- ~~**Land PR #95 and PR #97.** Both open, both blocking every row of §2.~~
  **Done** — `e45cb04` and `ed71ed5`. PR #115 followed at `bf8c8b3`.
- ~~**Flip `ACCESSIBILITY.md:640`** to `- [ ]`, or land the behaviour that makes it true.~~
  **Done at `0e5d97a`, 2026-08-29** — see §9. All six Phase 1 boxes were re-measured and unchecked,
  not just this one. **The behaviour then landed too, so that box is now `- [x]` on its merits**
  (2026-08-31, WIC-1902) — the first checked box in that list to be earned rather than assumed.
- ~~**Convert §8's manual checklist to RTL regression tests**~~ **Done as Playwright E2E**
  (`modal-focus.spec.ts`, `modal-focus-projects.spec.ts`) — see §8. RTL was the wrong level for
  three of the six items.
- ~~**Confirm `confirmation-modal-focus-audit.py` armed** on the commit that lands PR #115.~~
  ✅ **Confirmed at `c74cd2f1`.** It prints `ConfirmationModal focus restore OK — 1 call site(s)
  declared` — the exact string this follow-up specified as the pass condition, so the prop did not
  land under a different name and the audit is watching the thing it was built to watch.

- ~~**Extend the focus E2E sweep to the four uncovered dialogs**~~ **Done 2026-09-01 (WIC-1925)** —
  `modal-focus-onboarding.spec.ts` (20), `modal-focus-quick-reference.spec.ts` (9),
  `modal-focus-wizard.spec.ts` (10), `modal-focus-diff-review.spec.ts` (9). All six dialogs in §2 now
  have E2E focus coverage; 47 new tests, 72 across the six files.

  **This follow-up predicted its own answer wrong, and that is the result worth keeping.** It said
  "all four consume the same hook, so the expected result is that they already pass." Three do.
  **`WizardContainer` does not** — its `useDialogFocusRestore` is inert, and closing the wizard
  strands focus on `<body>`. Filed as **WIC-1931**, pinned `test.fail()` in
  `modal-focus-wizard.spec.ts`. The argument from construction was load-bearing and it was false, on
  1 of 4. Do not retire a coverage gap on the strength of a shared dependency again.

  Measured with a **deletion control** on each dialog — removing `{...focusRestore}` from the
  component and re-running its spec. `QuickReferenceExport`, `DiffReviewModal` and `OnboardingModal`
  each lose exactly 4 tests; `WizardContainer` loses **0**, which is the measurement that the hook
  does nothing there. A spec that stays green when the thing it tests is deleted is not coverage,
  and that control is what separated the two cases.

  **The WIC-1868 tripwire fired as designed, and this branch is where it was collected.** This
  sweep wrote two honest assertions against `OnboardingModal`'s nested confirms — exactly one
  `role="dialog"` exposed at a time — and pinned them `test.fail()` rather than weakening them to
  pass, because WIC-1868 was open at the time. WIC-1868 then **shipped on `main` 2026-09-01**
  (§11, `aria-hidden={confirmationOpen}` at `OnboardingModal.tsx:309`), which turned both pinned
  tests RED — a `test.fail()` that passes is a Playwright failure. Merging `main` in is the moment
  that surfaced, so **the two `test.fail()` lines were deleted here and the assertion bodies kept
  unchanged**, which is what the pin's own docstring instructed. Both now pass on their merits.
  Note what this cost if it had been missed: the four specs do not textually conflict with `main`,
  so nothing in the merge flagged it — the branch was green, `main` was green, and the *merge*
  was red. A pin is a dependency on another card's state, and merging is when that dependency is
  settled.

**Still open:**

- **`WizardContainer` focus restore is inert — WIC-1931.** Third instance of the WIC-1181 /
  WIC-1222 class (`.focus()` on a detached trigger is a silent no-op). The wizard is entered by
  `navigate()` from `ProjectsList`, so the captured trigger unmounts on the way in and is detached
  by close time; there is no `fallbackRef`, so nothing is focused and focus falls to `<body>`. Per
  §5.3 this dialog meets the bar where a fallback is **obligatory**. Pinned `test.fail()` rather
  than asserted away — it turns RED when fixed, which is the signal to delete the pin.
- **Pin `outerFocusRestore` on `OnboardingModal`.** Of its three hook instances, two are now
  guarded — `resumeSkipFocusRestore` by WIC-1711, `dismissFocusRestore` by WIC-1868 (§11). The
  panel's own binding still kills **zero** tests: delete `{...outerFocusRestore}` and the suite stays
  green. It is the awkward one to test, which is why it is last — the panel is opened by the
  onboarding flow rather than by a trigger inside the page, so there is no obvious element to assert
  focus returns *to*. That is a reason to think about what the right target is, not a reason to skip
  it; §5's fallback-target rule is what should decide it.

## 11. Rule — a nested confirmation must hide the panel behind it

**Shipped 2026-09-01 (WIC-1868).** Applies to any dialog that renders a confirmation as a nested
`Dialog.Root` *inside* its own `Dialog.Content`. Today that is `OnboardingModal` and only
`OnboardingModal` — its dismiss confirmation (WIC-1141) and its resume-skip warning (WIC-1383).

### The rule

> A dialog that nests another dialog inside its own content **must** set `aria-hidden` on its own
> `Dialog.Content` for exactly as long as the nested one is open. Radix will not do it for you.

In `OnboardingModal` that is one derived boolean and one attribute:

```tsx
const confirmationOpen = showDismissConfirm || showResumeSkipConfirm;
// ...
<Dialog.Content aria-hidden={confirmationOpen || undefined} {...outerFocusRestore}>
```

It is safe to drive straight off state: while a confirmation is open, focus is inside *it* — a DOM
sibling under `<body>`, via its own portal — so this never hides the focused element. Use
`|| undefined` rather than `aria-hidden={false}`, so the attribute is absent when the panel is live.

### Why Radix leaves this to you

`Dialog.Content` applies `hideOthers` to everything **outside** the topmost content. A dialog nested
inside that content is not "outside" it, so the outer panel is never a candidate for hiding.

### What the defect actually was — measured, because the difference decides the fix

Measured against the pre-fix component under vitest/jsdom, resume step, warning open:

| | measured |
|---|---|
| `[role="dialog"]` in the DOM | **2** — both direct children of `<body>` (each nested dialog has its own `Dialog.Portal`) |
| panel's **content subtree** | already `aria-hidden="true"`, one wrapper below the dialog node |
| panel's controls reachable? | **No** — `queryAllByRole('button')` returned only `Go Back` / `Skip Anyway` |
| panel's **own `role="dialog"` node** | **not hidden**, and still computed a name off `onboarding-title` |

⚠️ **WIC-1868 as filed said the panel's "controls stay reachable" and that a screen-reader user
"can navigate back out into the wizard underneath it." That is not what happens** — Radix had
already hidden the content subtree. The real symptom was narrower: an **empty second dialog** in the
a11y tree, carrying a name (`aria-labelledby` resolves into hidden subtrees by spec, so the name
survived the hiding of the element it points at). A user browsing dialogs found two and the first
had nothing in it. Confusing, and worth fixing — but not a focus-trap escape.

### Ruling on the two options WIC-1868 offered

The card offered **(1)** re-portal the confirmations as siblings so Radix hides the panel itself, or
**(2)** keep the nesting and hide the panel explicitly — and asked for a UI/UX decision because (1)
changes focus behaviour WIC-1141 chose deliberately.

**Ruled: option 2.** Option 1 was the right instinct for the defect as described, and the wrong one
for the defect as measured. Since Radix already hides everything a user could reach, the entire
remaining gap is one attribute on one node — and option 1 pays for it by giving up
focus-return-to-panel, which is the reason the confirmations were nested in the first place (§7),
and which for the resume-skip warning is load-bearing for a second reason: the parent holds live
upload state (`uploadedResume`, possibly a request in flight) that must stay mounted. Trading a
deliberate focus decision and a state-preservation constraint for an attribute is not a trade.

**Do not read this as a general preference for nesting.** For a *new* dialog, prefer siblings — the
platform does the work and there is nothing to keep in sync. This rule governs the case where
nesting has already been chosen for a reason.

### Verification

`OnboardingModal.step-actions.test.tsx`, describe block *"nested confirmations hide the panel behind
them (WIC-1868)"*. Four tests, and each is there for a distinct reason:

1. resume-skip warning open ⇒ exactly one dialog exposed, and the panel is `aria-hidden` **and still
   in the DOM** — both directions, so "fixing" it by unmounting the panel fails.
2. dismiss confirmation open ⇒ same. This is the **control**: it is pure WIC-1141 code, so a fix
   reaching only the WIC-1383 warning passes (1) and fails (2). It also had no test of any kind
   before this.
3. confirmation closed ⇒ panel exposed again, attribute gone. Guards the failure mode a static
   `aria-hidden` would introduce, which is worse than the bug and invisible to (1) and (2).
4. focus returns to the ✕ when the dismiss confirmation is cancelled.

(1) and (2) fail on the pre-fix component; (4) fails against a mutant with `{...dismissFocusRestore}`
deleted. WIC-1868 measured that binding, and `outerFocusRestore`, as killing **zero** tests —
(4) closes the dismiss half. **`outerFocusRestore` is still unguarded**; see §10.

## 12. Related

- `docs/design/ACCESSIBILITY.md` — §Modals, §Focus Management (`:246`), §Live Regions (`:149`) and
  *Where app-level live regions must be mounted* (`:187`), which cites §6 of this document.
- `docs/design/NOTFOUND_PAGE_DESIGN_SPEC.md` — the WIC-1155 `EmptyState` defect from the other side.
- `docs/design/COMPONENT_SPECS.md` — `EmptyState`'s `headingLevel` contract.
