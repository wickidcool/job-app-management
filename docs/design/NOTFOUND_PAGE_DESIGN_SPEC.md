# NotFound (404) page — design spec

**Owner:** UI/UX Developer · **Originally for:** WIC-1036 item 1 ("needs a real design pass") ·
**Responds to:** WIC-1042 (BA spec)
**Original date:** 2026-08-19 · **Rev 2:** 2026-08-19 (WIC-1105)
**Ported into the repo and re-measured against `a59b869`:** 2026-08-27 (WIC-1626, part 2 of WIC-1582)

> **Why this file exists.** `docs/design/COMPONENT_SPECS.md` cites *"`NOTFOUND_PAGE_DESIGN_SPEC.md`
> §1, D2"* as the authority for why `EmptyStateHeadingLevel` excludes `1`. Until this port that
> citation pointed at a document that lived only in the UI/UX agent's workspace — unopenable by
> the implementer being asked to obey it. That is the defect WIC-1582 was filed about.
>
> **This is a port, not a transcript.** Every code claim below was re-measured against `a59b869`.
> Claims that no longer hold are **struck inline and annotated**, never silently rewritten, so the
> drift stays auditable. Read §9 before trusting any line reference.

---

## 0. Status — read this first

| Part of this spec | State at `a59b869` |
|---|---|
| §1 verdict — build a standalone page, do **not** add a `'not-found'` variant to `EmptyState` | **Shipped and still correct.** `pages/NotFound.tsx` exists; `EmptyState` was never given the variant. |
| §1.1 D1 / D2 / D3 — the three defects that blocked reuse | **All three have since been fixed *in `EmptyState`*** (WIC-1155, WIC-1417). The verdict survives on other grounds — see §1.3. |
| §1.1 D4 — icon `opacity-50`, wrapper `py-16` | **Still true** (`EmptyState.tsx:92`, `:94`). |
| §2 copy | **Superseded by WIC-1052.** The shipped strings are in `NotFound.tsx`'s `COPY` block. |
| §2 `document.title` addition | **Removed from the tree.** No file under `packages/web/src/` writes `document.title`. Now owned by `ROUTE_TITLE_CONVENTION.md`. |
| §2.2 decision — remove the secondary "Go back" button and its `canGoBack` gate | ~~**NOT IMPLEMENTED.** The button and the gate are still shipped. See §2.3 — this is the one live action item in this document.~~ **Shipped in `3a8b31a` (WIC-1107).** The button, the gate and the two inverted docstrings are gone; the two tests that pinned the gate now pin its absence. §2.3 is retained as the record of the eight-day divergence, since that divergence is WIC-1582's evidence. |
| §5 drop-in implementation | **Superseded** by the shipped file. Kept only as the record of what was specified. |

---

## 1. Verdict on the BA's reuse recommendation

The BA (WIC-1042) preferred **Option 1: add a `'not-found'` variant to `EmptyState`**, explicitly
inviting disagreement. This is that disagreement.

`EmptyState` is a **section-level** component. Every one of its call sites renders it *below* a page
`<h1>`, inside a page that already has a header. `NotFound` is a **page-level** view — it is the
*entire* contents of `<main>`. That difference is semantic, not cosmetic.

### 1.1 The four defects Option 1 would have imported

> **Re-measured 2026-08-27 (WIC-1626).** Three of these four described `EmptyState` as it stood on
> 2026-08-19. `EmptyState` has since been substantially rewritten by WIC-1155 and WIC-1417, and D1,
> D2 and D3 no longer describe the component. They are retained because they are the *reasoning of
> record* for a decision that shipped, and because D2 is cited by name from `COMPONENT_SPECS.md`.
> Do not cite D1–D3 as current descriptions of `EmptyState`.

~~**D1 — the landmark lies to screen readers.** `EmptyState.tsx:51-53` hardcodes `role="region"` +
`aria-label="Empty state"`, so a screen-reader user hitting a dead link would hear **"Empty state,
region"** as the first thing in `<main>`.~~
> **Struck — fixed.** `EmptyState` no longer sets `role` or `aria-label`. The wrapper
> (`EmptyState.tsx:92`) is a plain `<div>`, and `:82–90` now carries a comment explaining the
> removal. Fixed by WIC-1155 for a *different* reason (the live-region/focus-trap defect — see
> `MODAL_FOCUS_MANAGEMENT_SPEC.md`), which happens to also close D1.

**D2 — heading level skip.** ~~`EmptyState.tsx:61` hardcodes `<h3 className="text-h4">`.~~
> **Struck as written — the mechanism changed, the conclusion did not.** `EmptyState` no longer
> hardcodes a tag. `headingLevel` is a prop (`EmptyState.tsx:24`, default `2`, rendered via the
> `Heading` alias at `:65`), added by WIC-1417 — which cites this defect as its precedent.
>
> **The load-bearing half of D2 survives, and is now enforced by the type system.**
> `EmptyStateHeadingLevel` is `2 | 3 | 4 | 5 | 6` (`EmptyState.tsx:7`): **`1` is not a legal value.**
> So `EmptyState` still cannot open a document outline at `<h1>`, and a page whose top heading is an
> empty state's heading remains the defect this spec rejected. That is exactly what
> `COMPONENT_SPECS.md` cites D2 for, and the citation is now *stronger* than when it was written —
> what was a hardcoded tag is now a closed union.

Every routed page in this app opens with `<h1 className="text-3xl font-bold text-neutral-900">`.
Option 1 would have made `NotFound` the only route whose `<main>` contained no `<h1>` at all.

~~**D3 — `aria-live` is the wrong mechanism for a route change.** `EmptyState.tsx:52` sets
`aria-live="polite"`.~~
> **Struck — fixed.** `EmptyState` no longer sets `aria-live`; `:71–74` carries a comment explaining
> why it must not (the content is static per `variant` and never updates in place). Removed by
> WIC-1155. The *design* point stands independently and is still the reason `NotFound` uses focus
> management rather than a live region — see §3.

**D4 — the icon is styled to be ignored.** `EmptyState.tsx:94` applies `opacity-50` to the icon and
`:92` applies `py-16` to the wrapper. **Both still true at `a59b869`.** On a page that *is* the whole
of `<main>`, a 50%-opacity icon reads as a rendering failure on exactly the screen where the user is
already asking "is this broken?", and `py-16` top-hugs the nav with the rest of the viewport empty.

### 1.2 Why not "duplicate the markup" either

The BA framed the alternative as duplication that "will drift". The reframe: **these two components
should diverge.** A centred icon/heading/message/button column is a layout, not a shared
abstraction. `EmptyState` is a section that must *not* claim the page's `<h1>`; `NotFound` is a page
that *must*. What is shared and should stay shared is the **design tokens**.

### 1.3 Does the verdict still hold now that D1–D3 are fixed? — *new, WIC-1626*

**Yes, and the record should say why rather than leaving a reader to re-derive it.** Three of the
four original defects have been repaired in `EmptyState`, so a reader could reasonably ask whether
the reuse option is now viable. It is not:

1. **D2's core survives as a type constraint.** `EmptyStateHeadingLevel` excludes `1`. A page-level
   view needs an `<h1>`; `EmptyState` structurally cannot emit one.
2. **D4 is untouched** — the icon and spacing are still tuned for a section, not a page.
3. **The semantic argument in §1.2 never depended on the defects.** It is about what the two
   components *are*. The shipped `NotFound.tsx` has since grown an eyebrow, a path echo, an inline
   SVG and a keyboard hint — none of which belong in a section-level empty state, which is the
   divergence §1.2 predicted, arriving on schedule.

---

## 2. Copy

> **Superseded by WIC-1052 (`f5b7308`).** The table below is what this spec specified on
> 2026-08-19. The shipped strings are the `COPY` block at `NotFound.tsx:11–21` and are the source
> of truth. Retained for the two endorsements in the notes, which explain choices still visible in
> the shipped copy.

| Slot | As specified 2026-08-19 | Shipped at `a59b869` |
|---|---|---|
| Icon | `🧭` at full opacity | inline SVG (`NotFound.tsx:70–83`) — emoji rejected as OS-dependent |
| Eyebrow | *(none)* | `404` |
| Heading | `This page doesn't exist` | `That page couldn't be found` |
| Message | `The link may be out of date… Your data is safe — nothing was lost.` | `The link may be out of date… Everything you've saved is safe.` |
| Primary action | `Back to Dashboard` → `/` | `Back to dashboard` → `/` |
| Document title | `Page not found · Job Application Manager` | **not set** — see below |

**"Back to…" not "Go to…"** — endorsed then, shipped now, and the reason is preserved in a comment
at `NotFound.tsx:15–17`: the final onboarding CTA reads "Go to Dashboard", and a 404-recovery click
and a completed-onboarding click are opposite signals that must stay tellable apart in analytics and
in `getByRole(…, { name })` selectors.

~~**Addition — `document.title`.** Set it on mount…~~
> **Struck — the effect was removed and the premise inverted.** This spec noted the app had "no
> `document.title` convention today" and proposed the 404 be the first page to set one. The effect
> shipped and was later removed: at `a59b869`, `grep -rn "document.title" packages/web/src/` returns
> **nothing**. Per-route titles are now owned by **`ROUTE_TITLE_CONVENTION.md`**, which supersedes
> this paragraph entirely. Do not re-add a one-off here.

### 2.1 Considered and rejected: a secondary "Go back" action

*Revised 2026-08-19 per WIC-1105.*

A second affordance calling `navigate(-1)` is the obvious addition, and it's a trap. **Single
primary action. Do not add it.** Three reasons, covering *both* arrival paths:

1. **It duplicates a control the user already has.** Every context this page renders in ships a Back
   control that does exactly `navigate(-1)`: desktop browser chrome, iOS back-swipe, Android system
   back. An in-page copy adds no capability — it adds a second button competing with the primary
   one, for a user who has just been disoriented, and it is the button with the worse expected
   outcome.
2. **On the dominant path it returns the user to the broken link.** The dominant path here is
   *clicking a bad link on another page*, so "back" lands on the page holding the dead link, where
   the most likely next action is clicking it again. That is a loop, and a loop reads as "the app is
   broken".
3. **On the cold path it ejects the user out of the app.** Arriving from a bookmark, a typed URL, or
   a link in email/Slack, the previous history entry is whatever the user was in *before* the app.
   `navigate(-1)` there doesn't no-op — it leaves.

### 2.2 Decision record — the shipped gate (WIC-1105, 2026-08-19)

**Correction 1 — the original parenthetical was wrong.** §2.1 once closed with "(The exception —
arriving from a bookmark or a typed URL — has no meaningful 'back' anyway.)" That is false. There is
a previous entry; it is outside the app. Reason 3 above replaces it, and it *strengthens* the
rejection rather than qualifying it.

**Correction 2 — the shipped gate is inverted relative to the objection.** WIC-1051 shipped the
button gated on `location.key !== 'default'`: shown after an in-app navigation, hidden on a cold
deep-link. That suppresses the button in case 3 and offers it in case 2. It is a faithful
implementation of the *incorrect* parenthetical and no implementation at all of the objection — the
objection was the **loop**, and ejection is an *additional* reason against the button.

**Decision: §2.1 wins as written.** Remove the secondary button, the `canGoBack` gate, and the two
tests that pin it. Rejected the alternative of blessing the gate, because the ejection argument that
motivates it argues against the button existing at all; rejected inverting the gate, because that
offers "back" only where back leaves the product.

Reason 1 settles it independently of both: even on the most generous reading, the button's best case
is redundancy with a control the platform already provides, on the one screen where a single
unambiguous next step is worth more than an extra option.

### 2.3 §2.2 was never implemented — *new, WIC-1626* ⚠️ — **discharged in `3a8b31a` (WIC-1107)**

**Measured at `a59b869`.** ~~This is the one live action item in this document.~~ Everything this
section reports was still true at `a59b869` and is no longer true: `3a8b31a` removed the button, the
`canGoBack` gate and both inverted docstrings, and re-pointed the two tests. The measurement is kept
verbatim rather than deleted, because the eight-day gap between decision and implementation is the
evidence WIC-1582 rests on, and a deleted finding cannot be audited.

The §2.2 decision was recorded on 2026-08-19 and routed to Frontend Developer. It never shipped:

| §2.2 said remove | State at `a59b869` |
|---|---|
| the secondary "Go back" button | **present** — `NotFound.tsx:110–121` |
| the `canGoBack` gate | **present** — `NotFound.tsx:58`, `const canGoBack = location.key !== 'default'` |
| the two tests that pin the gate | **present** — `NotFound.test.tsx:154` (`hides "Go back" on a cold deep-link`) and `:160` (`offers "Go back" once there is an in-app history entry`) |

The last commit to `NotFound.tsx` is `b601e42` (WIC-1054), which predates the WIC-1105 decision.

**The inverted docstrings Correction 2 called out are also still in the tree**, now asserting the
inverted rationale to anyone reading the code:

- `NotFound.tsx:54–57` — explains the gate purely in terms of the ejection case.
- `NotFound.test.tsx:149–151` — *"§2.1 — the spec rejects a secondary 'Go back' outright; this
  branch ships it gated on having somewhere in-app to go back to. The gate is the part that must
  not [regress]."* This docstring cites §2.1 while pinning the behaviour §2.1 rejects.

**Why it never shipped is the point of WIC-1582.** The decision lived in a document the implementer
could not open. A ruling that is not in the repo is not a ruling. That this port surfaced an
eight-day-old unimplemented decision is the strongest available evidence for the rule.

**Tracked as a follow-up card** (see §10). Not fixed in this PR: this is a docs port, and removing a
shipped control plus two tests is a behaviour change that deserves its own diff and its own review.

---

## 3. Accessibility spec

1. **`<h1>`**, not `<h3>`. Matches every other routed page. — *shipped* (`NotFound.tsx:89`).
2. **No `role="region"`, no `aria-label`.** The content is already inside the existing `<main>`
   landmark. — *shipped* (no region on the page).
3. **No `aria-live`.** Replaced with focus management: on mount, move focus to the `<h1>`
   (`tabIndex={-1}` + `ref.focus()`). This is the standard SPA route-change pattern. — *shipped*
   (`NotFound.tsx:46`, `:50–52`, `:90–91`).
4. **`focus:outline-none` on the `<h1>`.** The programmatic focus is for announcement, not a visible
   target. — *shipped* (`NotFound.tsx:92`). The *button* keeps its visible ring.
5. **Icon `aria-hidden="true"`.** Never encode the meaning in the graphic. — *shipped*
   (`NotFound.tsx:75`).
6. **Primary action is keyboard-reachable with a visible focus ring.** — *shipped* as a router
   `<Link>` (`NotFound.tsx:100–108`); the spec allowed either a `<button>` or a `<Link>`.

---

## 4. Layout

- Wrapper matches the app's page shell so the page sits on the same grid as every other route.
  *Shipped as `mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8` (`NotFound.tsx:61`) — narrower than the
  `max-w-7xl` this spec proposed, which is correct for a single centred column.*
- Inner column `min-h-[60vh] flex flex-col items-center justify-center text-center` —
  **optically centred in the viewport** rather than `py-16` top-hugging the nav (D4). *Shipped
  verbatim* (`NotFound.tsx:62`).
- Message capped at `max-w-md`. *Shipped* (`NotFound.tsx:97`).
- `BottomTabBar` clearance is handled by `<main className="pb-20 md:pb-0">`.

---

## 5. Drop-in implementation *(superseded — historical)*

> The original spec carried a complete `NotFound.tsx` here. It has been **removed from this port**
> rather than reproduced: the file shipped, then diverged through WIC-1051, WIC-1052 and WIC-1054,
> and a stale copy of a component that exists in the tree is precisely the kind of rot this port is
> meant to eliminate. Read `packages/web/src/pages/NotFound.tsx`.
>
> The route wiring it specified did ship: `<Route path="/dashboard" element={<Navigate to="/" replace />} />`
> above `<Route path="*" element={<NotFound />} />`, with the catch-all last.

---

## 6. Agreements with the rest of WIC-1042

- **AC1/AC2** (catch-all last, chrome preserved) — correct as written.
- **AC3** (client-side nav, not `<a href>`) — correct; shipped as a router `<Link>`.
- **AC4** (`/dashboard` → `/` redirect, `replace`) — **strongly agree**, including that it does not
  make WIC-1041 unnecessary. The redirect is a net for links already in the wild; WIC-1041 stops
  minting new ones. Both are needed.
- **AC6** (no server-side status coupling) — correct. Client render only.
- **Outer `<Routes>`** — `NotFound` is only reachable while signed in, which is what makes "Back to
  dashboard" safe as an unconditional CTA.

---

## 7. Testing

> The harness gap this section was written around (WIC-1037, "no unit-test harness on
> `packages/web`") **has since closed.** `NotFound.test.tsx` exists and the cases below are
> automated. The manual list is retained as the statement of intent behind them.

1. Signed in, navigate to `/nope` → NotFound renders, top nav + bottom tab bar still visible.
2. Click **Back to dashboard** → lands on Dashboard at `/`, no full page reload.
3. Navigate to `/dashboard` → lands on Dashboard at `/`, **not** NotFound.
4. Tab from page load → first stop is the primary action with a visible ring.
5. Screen reader → hears the heading at level 1 on arrival; does **not** hear "Empty state".
6. **§2.1 regression guard.** The page renders exactly one action, on *both* arrival paths, so the
   button cannot come back gated. **Not currently satisfiable — the two tests in the tree assert the
   opposite. See §2.3.**

---

## 8. Verification of every code claim — *original pass, 2026-08-19* ~~superseded~~

> **Struck wholesale.** The original §8 was a table certifying ~14 line references against `main`
> @ `6a17b3d` (2026-08-18). At `a59b869` the majority no longer resolve: `EmptyState.tsx` was
> rewritten twice (WIC-1155, WIC-1417) and `NotFound.tsx` three times. Reproducing it would ship a
> table of confident, wrong citations — the exact failure WIC-1582 exists to stop. Replaced by §9.

---

## 9. Verification — *this port, 2026-08-27 (WIC-1626)*

Re-measured against `a59b869`. Every claim in this document that names a file or line was checked;
nothing here is carried over on trust.

| Claim | Verified at `a59b869` |
|---|---|
| `EmptyStateHeadingLevel = 2 \| 3 \| 4 \| 5 \| 6` — `1` excluded (D2, and the `COMPONENT_SPECS.md` citation) | ✅ `EmptyState.tsx:7` |
| `headingLevel` is an optional prop defaulting to `2` | ✅ `EmptyState.tsx:24`, `:31` |
| Heading tag built from the prop, not hardcoded | ✅ `EmptyState.tsx:65`, rendered `:104` |
| `EmptyState` sets **no** `role`, `aria-label` or `aria-live` (D1, D3 struck) | ✅ comments at `:71–74`, `:82–90`; wrapper `:92` is a bare `<div>` |
| Icon `opacity-50` and wrapper `py-16` (D4 — still live) | ✅ `EmptyState.tsx:94`, `:92` |
| `NotFound.tsx` renders an `<h1>` with `tabIndex={-1}`, focused on mount | ✅ `:89–95`, effect `:50–52` |
| Icon is an inline SVG with `aria-hidden="true"` | ✅ `:70–83` |
| **"Go back" button still shipped** (§2.3) | ✅ `:110–121` |
| **`canGoBack` gate still shipped** (§2.3) | ✅ `:58` |
| **Both gate tests still present** (§2.3) | ✅ `NotFound.test.tsx:154`, `:160` |
| Inverted docstrings still in the tree (§2.3) | ✅ `NotFound.tsx:54–57`, `NotFound.test.tsx:149–151` |
| Zero `document.title` writes under `packages/web/src/` | ✅ `grep -rn "document.title"` returns nothing |
| Last commit to `NotFound.tsx` predates the WIC-1105 decision | ✅ `b601e42` (WIC-1054) |

**Line numbers move.** Anchor on the surrounding code, not on these numbers — that is the failure
this port was commissioned to repair, and it applies to this table too.

---

## 10. Follow-ups

- ~~**The §2.3 divergence** — remove the "Go back" button, the `canGoBack` gate, the two tests that
  pin it, and correct the two inverted docstrings. Filed as a child of WIC-1626. Owner: Frontend
  Developer.~~ **Done in `3a8b31a` (WIC-1107).**
- **D4** — `EmptyState`'s `opacity-50` / `py-16` are unchanged. Not a defect *in `EmptyState`*; noted
  only because it is the last of the four original reuse objections still standing.

## 11. Related

- `docs/design/COMPONENT_SPECS.md` — cites §1 D2 for `EmptyStateHeadingLevel`'s exclusion of `1`.
- `docs/design/ROUTE_TITLE_CONVENTION.md` — owns per-route `document.title`; supersedes §2's addition.
- `docs/design/ACCESSIBILITY.md` — the heading-outline and focus-management rules this spec applies.
- `docs/design/MODAL_FOCUS_MANAGEMENT_SPEC.md` — the WIC-1155 live-region defect that closed D1/D3.
