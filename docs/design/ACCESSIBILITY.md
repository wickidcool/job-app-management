# Accessibility Guidelines — Job Application Manager

This document outlines accessibility requirements and best practices to ensure the Job Application Manager is usable by everyone, including people with disabilities.

**Target Compliance:** WCAG 2.1 Level AA

> **Enforcement status: partial, and far narrower than this document's scope.** Measured against `main` @ `9ec6309` (2026-08-30; the tree outside `docs/` is byte-identical to the `6f91a56` this note was first taken at, so no source-derived figure below moved). Three checks fail the build, all of them steps in the **`Lint & Test`** job of `.github/workflows/deploy.yml`:
>
> | check | the command that fails the build | what it actually covers |
> | --- | --- | --- |
> | `src/test/routeHeadingOutline.test.ts` (WIC-1581) | `npm run test` | No string is rendered as both an `<h1>` and an `<h2>`. A **static source** sweep — it reads literal heading text only. |
> | `findOutlineSkips` / `getOutline` (`src/test/headingOutline.ts`, WIC-1571) | `npm run test` | **Rendered** heading-outline skip assertions. Asserted against exactly **two application components** — `KanbanBoard.test.tsx` and `CoverLetterPreview.test.tsx`. It has a third importer, `src/test/headingOutline.test.tsx`, but that is the helper's own unit test against deliberate fixtures and so enforces nothing about the app. |
> | `docs/design/confirmation-modal-focus-audit.py` (WIC-1670) | `python3 docs/design/confirmation-modal-focus-audit.py` | Every `ConfirmationModal` call site either passes `restoreFocusTo` or declares a `focus-restore-exempt` reason (SC 2.4.3, the WIC-1181 class). |
>
> **Everything else in this document is still guidance a reviewer checks by hand.** `npm run lint` carries **no accessibility rules at all**: at `9ec6309`, `packages/web/eslint.config.js` loads only `js`, `typescript-eslint`, `react-hooks`, `react-refresh` and `prettier`, and none of `eslint-plugin-jsx-a11y`, `axe-core`, `pa11y` or a Lighthouse budget is a dependency. The [Testing Checklist](#testing-checklist) remains the whole process for every criterion outside the table above, and no box in it is automated.
>
> **SC 1.3.1 is not covered site-wide, and the lint layer will not cover it when it lands.** Heading order is a property of the *composition* of a page and the components it mounts, so it is structurally invisible to any per-file rule — WIC-1483 measured that `eslint-plugin-jsx-a11y` would have caught **none** of the 16 heading skips it found, and `A11Y_ENFORCEMENT_RULING.md` §4.2 records the same limit independently. **Do not credit `jsx-a11y` with SC 1.3.1.** Of the two heading checks that do exist, the first is blind to expression-built headings (**11 of 33 `<h1>` and 11 of 42 `<h2>`** were already invisible to it at `6911bcb`), and the second covers 2 components against **29 page components and 32 distinct route paths**. Take those two denominators from the source, not from a raw glob: `packages/web/src/pages/*.tsx` is 33 files, but four of them are tests (`ApplicationsList.statusParam`, `CoverLetterNew`, `NotFound`, `OutreachNew`), and `App.tsx` declares 34 `<Route>` elements that resolve to 32 distinct `path=` values, two of which (`*`, `/*`) are catch-alls.
>
> **Four `h1` → `h3` skips are live on `main` right now** (re-measured at `3a649e1`), none of them visible to any check above. Three share one shape: `pages/ProjectsList.tsx` (`<h1>` `:59`, `<h3>` `:96`), `pages/ResumeManager.tsx` (`:94`, `:135`) and `pages/ProjectDetail.tsx` (`:40`, `:66`) each skip in the *populated* render branch, while the *empty* branch of all three is correct because `EmptyState` gained a `headingLevel` prop under WIC-1417. That asymmetry is the argument for per-render-branch enforcement specifically — a per-route check that rendered a single branch would report all three clean.
>
> **The fourth should change how the table above is read, because it is the page the rendered-outline check was written for.** `pages/ApplicationsList.tsx` skips in *every* branch: `<h1>` "Applications" at `:136`, then `SavedFilterShortcuts` — mounted unconditionally at `:165`, under a comment reading "always visible" — renders `<h3>` "Filter Shortcuts" at `SavedFilterShortcuts.tsx:113`. `KanbanBoard`'s `<h2>` column headings do not arrive until `:195`, after it. The check stays green because `KanbanBoard.test.tsx:49-55` renders a hand-written approximation of the page — a literal `<h1>Applications</h1>` followed by `<KanbanBoard>` — and that fixture never mounts the sibling that causes the skip. **A rendered-outline assertion certifies the composition it renders, not the route it is named after.** The fixture is the thing that has to match the page, and nothing checks that it does. Its sibling check is the control that shows this is a fixture problem rather than a method problem: `CoverLetterPreview.test.tsx` builds its fixture the same way, and there the real page does agree — `CoverLetterDetail.tsx` goes `<h1>` `:104` → `<h2>` from `CoverLetterPreview`, with no skip. Filed as WIC-1834.
>
> The wider gap is measured, not theoretical: a scan resolving component-rendered headings at their usage site, recursively across every branch a view can render, found a **majority of pages skipping a heading level**, several with no `<h1>` at all, including `Login`, the product's only pre-authentication page. Figures and the per-page breakdown are on **WIC-1480** (2026-08-26 at `8e19705`); they predate the fixes landed since and are not restated here, because a count in prose goes stale the day after it is taken.
>
> **Spec-side coverage: all seven accepted feature specs assert this criterion, and not one of them cites a mechanism.** Measured 2026-08-30 against the specification documents themselves rather than a summary of them: **7 of 7** carry an accessibility acceptance criterion — `AC-Q3` in UC-1 (WIC-94), UC-2 (WIC-101), UC-3 (WIC-113), UC-4 (WIC-127), the resume spec (WIC-47) and onboarding (WIC-238), and the same criterion under the name `AC-N7` in UC-5 (WIC-143). All seven state it in the same words: one `<h1>` per rendered view, no level skipped, in every branch the view can render, including levels contributed by shared components — which is SC 1.3.1. **The "only 1 of 7 specs carries an accessibility criterion" figure is superseded and should not be requoted**; it was true before the WIC-1480 decomposition landed, and it is still being restated in write-ups taken from those older notes. Six of the seven record their own status as NOT MET; UC-1 is the only one whose surfaces pass.
>
> **Two of the seven now state the opposite of what is true.** UC-3's AC-Q3 says "nothing in the repository could have failed it, because there is no accessibility tooling at all", and UC-5's AC-N7 says "Nothing in the repository can fail AC-N7 automatically". Both were correct when written and both are now wrong in the narrow way that matters — the three checks in the table above do fail the build. The figure they should carry instead is the one this section already gives from the other direction: the rendered-outline check reaches components inside **two** of the seven specs (UC-4's `CoverLetterPreview`, UC-5's `KanbanBoard`), and for UC-5 it reaches a fixture rather than the route. Amending the specs themselves is a Business Analyst edit and is routed as WIC-1833; this note is the repository-side flag required by **WIC-1584 AC-3**, and WIC-15 §8-A is its specification-side counterpart.
>
> **The full mechanism is decided but not landed — do not cite the ruling as enforcement.** WIC-1192 ruled on 2026-08-30 (`A11Y_ENFORCEMENT_RULING.md`, merged `ee6c217`) that the repo adopts `jsx-a11y` at `strict`/`error` behind a frozen 23-file baseline, plus `axe-core` hosted in the vitest + RTL harness rather than in Playwright E2E; the measured backlog is **47 findings across 22 app-source files** at `743cfeb`, every `label-has-associated-control` hit hand-verified as a true positive. That document states in its own opening note that it is a decision rather than a shipped mechanism, and neither dependency is installed at `9ec6309`. **WIC-1483 is closed and no config is on `main` — but read that as "built and unmerged", not "not built".** PR #226 (`8845a5e`, opened 2026-08-29) carries `packages/web/eslint.config.js`, `packages/web/package.json` and `src/test/jsxA11yBaseline.test.ts`; measured 2026-08-30 it is `OPEN`, unmerged, `MERGEABLE`, every check `SUCCESS` (Deploy Production skipped) and **zero reviews**, which is the whole of why it is `BLOCKED`. The remaining work after it lands is **WIC-1589** (the 47 baselined findings) and **WIC-1675** (rendered per-route, per-render-branch outline). This note is replaced when `packages/web/eslint.config.js` carries the config, and the replacement must still state what remains unverified, because heading order plus a lint rule set is not WCAG 2.1 AA. Citation written under **WIC-1584**.

---

## Table of Contents

1. [Keyboard Navigation](#keyboard-navigation)
2. [Screen Reader Support](#screen-reader-support)
3. [Focus Management](#focus-management)
4. [Color & Contrast](#color--contrast)
5. [Interactive Elements](#interactive-elements)
6. [Forms & Validation](#forms--validation)
7. [Dynamic Content](#dynamic-content)
8. [Testing Checklist](#testing-checklist)

---

## Keyboard Navigation

### General Principles

All functionality must be accessible via keyboard alone. No mouse required.

### Global Keyboard Shortcuts

| Key(s) | Action | Context |
|--------|--------|---------|
| `Tab` | Move focus forward | Global |
| `Shift + Tab` | Move focus backward | Global |
| `Enter` or `Space` | Activate focused element | Buttons, links, checkboxes |
| `Escape` | Close modal/dropdown | Modals, dropdowns, pickers |
| `Arrow Keys` | Navigate within components | Dropdowns, kanban columns |
| `/` | Focus search field | Dashboard |
| `?` | Open keyboard shortcuts help | Dashboard |

### Component-Specific Navigation

#### Dashboard (Kanban View)

| Key(s) | Action |
|--------|--------|
| `Tab` | Move between cards and columns |
| `Enter` | Open focused card |
| `Arrow Left/Right` | Move card to adjacent column (keyboard drag) |
| `Delete` | Delete focused card (with confirmation) |
| `e` | Edit focused card |

**Implementation Note:** Use `roving tabindex` pattern for kanban cards — only one card is in tab order at a time, arrow keys navigate within the board.

#### Modals

| Key(s) | Action |
|--------|--------|
| `Tab` | Cycle through focusable elements (trapped) |
| `Escape` | Close modal |
| `Enter` | Submit form (if applicable) |

**Focus Trap:** When modal opens, focus must stay within modal until closed.

#### Dropdowns

| Key(s) | Action |
|--------|--------|
| `Enter` or `Space` | Open dropdown |
| `Arrow Up/Down` | Navigate options |
| `Enter` | Select highlighted option |
| `Escape` | Close without selecting |
| `Home` | Jump to first option |
| `End` | Jump to last option |

---

## Screen Reader Support

### ARIA Labels & Roles

#### Application Cards

```html
<article 
  role="article"
  aria-label="Senior Developer at TechCo, status: Applied, created 2 days ago"
  tabindex="0"
>
  <!-- Card content -->
</article>
```

#### Status Badges

```html
<span 
  role="status" 
  aria-label="Application status: Applied"
  class="status-badge"
>
  🟡 Applied
</span>
```

#### Kanban Board

```html
<div role="region" aria-label="Application kanban board">
  <div role="list" aria-label="Saved applications, 5 items">
    <article role="listitem" aria-label="...">...</article>
    <article role="listitem" aria-label="...">...</article>
  </div>
  <div role="list" aria-label="Applied applications, 8 items">
    <!-- ... -->
  </div>
</div>
```

#### Forms

```html
<form aria-labelledby="form-title">
  <h2 id="form-title">Add New Application</h2>
  
  <label for="job-title">
    Job Title <span aria-label="required">*</span>
  </label>
  <input 
    id="job-title"
    type="text"
    aria-required="true"
    aria-invalid="false"
    aria-describedby="job-title-error"
  />
  <div id="job-title-error" role="alert" aria-live="polite">
    <!-- Error message appears here -->
  </div>
</form>
```

#### Dialogs — every `Dialog.Content` needs a `Dialog.Title`, and the id must be Radix's own

A dialog with no title has **no accessible name at all**: a screen reader announces "dialog"
and stops, so the user has no idea what just took their focus. SC 4.1.2. It is the cheapest
a11y defect in the codebase to create, because nothing about the rendered page looks wrong.

Radix does say so, on every mount, in the console:

```
`DialogContent` requires a `DialogTitle` for the component to be accessible for screen reader users.
Warning: Missing `Description` or `aria-describedby={undefined}` for {DialogContent}.
```

So the rule is: **render `Dialog.Title` and `Dialog.Description`, and let Radix assign both
ids.** Where the design has no room for a visible title — `CommandPalette` opens with nothing
above its search field — make the title `sr-only` rather than omitting it.

```tsx
<Dialog.Content>
  <Dialog.Title className="sr-only">Quick search</Dialog.Title>
  <Dialog.Description className="sr-only">
    Type to search applications, companies, and statuses. Use the up and down arrow keys to
    move between results, and Enter to open one.
  </Dialog.Description>
```

**⛔ Do not pass your own `id` to either one, and do not hand-write `aria-describedby` on
`Dialog.Content`.** The warnings resolve `context.titleId` / `context.descriptionId` through
`getElementById` (`@radix-ui/react-dialog` 1.1.15, `dist/index.mjs:295` and `:308`), so an
overridden id leaves that lookup empty and **the warning fires against markup that is
actually correct** — which trains everyone to ignore it.

`ApplicationForm.tsx` was the worked example of this: genuinely named and described, and
warning on every mount for no reason but the id override. Fixed in WIC-1854 — as of that
commit all three `Dialog.Content` call sites in `packages/web/src` (`ApplicationForm`,
`CommandPalette`, `ApplicationNew`) render a `Dialog.Title` and let Radix assign both ids,
so any of them is safe to copy. Re-sweep with `grep -rn 'Dialog.Content' packages/web/src`
rather than trusting that count; it was 3 when written.

Reusing existing visible copy as the description, via `aria-describedby` pointed at a node
already on screen, is the textbook move and was tried on `CommandPalette` and rejected: the
node in question was the keyboard-hint footer, which is written to be *glanced at* and reads
as a stutter aloud. Prefer it when the visible text is a sentence; write a `sr-only`
description when it is a row of hints.

**Verification.** Assert the **exact** accessible name and description, and in the same file
spy on `console.error` / `console.warn` and assert neither Radix message fires — with a
positive control that mounts a deliberately unnamed dialog, or the guard passes just as
happily against a broken spy. See `packages/web/src/components/CommandPalette.test.tsx`
(WIC-1851) and `ApplicationForm.test.tsx` (WIC-1854).

**The console guard is not redundant with the name assertions — for the id-override defect it
is the only thing that catches it.** Measured on WIC-1854: against the pre-fix component the
accessible name and description assertions **passed**, because the markup really was correct;
only the console guard and an assertion that `aria-describedby` resolves to Radix's *generated*
id failed. So write both, and prefer asserting the id is the generated one over asserting the
attribute merely exists.

### Live Regions

Use ARIA live regions to announce dynamic changes without moving focus.

#### Success/Error Toasts

```html
<div 
  role="status" 
  aria-live="polite" 
  aria-atomic="true"
  class="toast-container"
>
  <!-- Toast messages injected here -->
</div>
```

> A toast host is an **app-level** live region, so *where* you mount it matters as much as
> what you put in it. See [Where app-level live regions must be mounted](#where-app-level-live-regions-must-be-mounted)
> before adding one.

**Announcement Examples:**
- "Application saved successfully"
- "Status changed to Interview"
- "Error: Unable to save application. Please try again."

#### Status Changes (Drag & Drop)

```html
<div aria-live="assertive" aria-atomic="true" class="sr-only">
  <!-- Announces: "Frontend Developer at StartupX moved from Saved to Applied" -->
</div>
```

**Politeness Levels:**
- `polite`: Non-urgent updates (success messages, status changes)
- `assertive`: Urgent updates (errors, warnings)

#### Where app-level live regions must be mounted

> **Rule.** An app-level live region — a toast host, a route-change announcer, a save-status
> region, anything that outlives one screen — must be **portalled to `document.body` as a
> sibling of `#root`**, never rendered in place inside the tree.

**Why.** `aria-hidden` (the package Radix uses to hide the background behind a modal) treats
every `[aria-live]` element as something it must *not* hide — and it exempts that element's
**entire ancestor chain** along with it. A live region rendered at `#root > … > div[aria-live]`
therefore puts `#root` itself on the keep-list, and `#root` never receives `aria-hidden` when a
dialog opens. Verified in `aria-hidden@1.2.6` (`dist/es2015/index.js`): `:133` collects every
`[aria-live]` under the parent node into `targets`, and `:48–52` walks each target up its whole
`parentNode` chain into `elementsToKeep`.

This is not a warning about a control leaking — an in-place announcer that wraps nothing
focusable leaks nothing, because sibling subtrees are still hidden correctly. The cost is that
**`#root[aria-hidden]` silently stops being true**, and that is the check most people reach for
to prove the background *is* hidden. The dialog still opens, focus still traps, and nothing
looks wrong.

**Worked example — this has already cost a test run.** PR #115 added a post-delete announcer to
`ResumeManager` and rendered it in place. It immediately broke the existing `#root[aria-hidden]`
assertion shipped in **PR #95**, on the first run. The fix was to portal the announcer to
`<body>`; there it is exempted on its own account and hides nothing.

```tsx
import { createPortal } from 'react-dom';

// ✅ App-level announcer — outside #root
return createPortal(
  <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
    {message}
  </div>,
  document.body,
);

// ❌ Same markup rendered in place inside #root
//    → #root never gets aria-hidden behind any dialog, app-wide
```

**Two things authors get wrong:**

- **Mount it permanently and change only its text.** Assistive tech announces *updates* to a
  region already in the accessibility tree. A region that mounts at the same moment its message
  appears may not be announced at all.
- **Never put a focusable element inside a live region.** That is a separate and worse failure —
  the control stays operable behind every dialog, which is a real focus-trap escape. It cost us
  `EmptyState` once (WIC-1155).

**Component-local** live regions (a progress indicator, a board's drag announcer) may stay in
place — they are content, not app chrome. But they still suppress the `#root` attribute while
mounted, so on a page that renders one, do not use `#root[aria-hidden]` as your
background-hiding assertion; assert on the specific background subtree instead.

Full rationale, including the discriminator against the WIC-1155 failure, lives in
`MODAL_FOCUS_MANAGEMENT_SPEC.md` → *Rule — app-level live regions belong outside `#root`*.

---

## Focus Management

### Focus Indicators

All interactive elements must have a visible focus indicator.

```css
*:focus {
  outline: 2px solid var(--color-primary-500);
  outline-offset: 2px;
}

/* Never use outline: none without providing an alternative */
button:focus {
  outline: 2px solid var(--color-primary-500);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2);
}
```

**Minimum Requirements:**
- Contrast ratio: 3:1 against adjacent colors
- Thickness: 2px minimum
- Visible on all backgrounds

### Focus Order (Tab Index)

Logical reading order: top → bottom, left → right.

**Good Tab Order Example (Application Form):**
1. Job Title field
2. Company field
3. URL field
4. Location field
5. Salary field
6. Status dropdown
7. Link cover letter checkbox
8. Cancel button
9. Save button

**Never:**
- Use positive `tabindex` values (e.g., `tabindex="1"`)
- Skip logical order
- Trap focus outside modals

### Focus Management Patterns

#### Modal Opens

```javascript
// Before opening modal
const previousFocus = document.activeElement;

// Open modal
openModal();

// Focus first interactive element
modalElement.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])').focus();

// On modal close
closeModal();
previousFocus.focus(); // Return focus to trigger element
```

#### Dynamic Content Loaded

```javascript
// After loading new applications
const firstCard = document.querySelector('.application-card');
if (firstCard) {
  firstCard.focus();
  // Screen reader announces: "Loaded 10 new applications"
}
```

---

## Color & Contrast

### WCAG AA Requirements

- **Normal text (< 18px):** 4.5:1 contrast ratio
- **Large text (≥ 18px or 14px bold):** 3:1 contrast ratio
- **UI components & graphics:** 3:1 contrast ratio

### Color Contrast Validation

| Element | Foreground | Background | Ratio | Pass |
|---------|------------|------------|-------|------|
| Body text | `#1f2937` | `#ffffff` | 16.1:1 | ✅ AA |
| Secondary text | `#6b7280` | `#ffffff` | 5.1:1 | ✅ AA |
| Primary button | `#ffffff` | `#3b82f6` | 4.9:1 | ✅ AA |
| Status: Applied | `#a16207` | `#fef9c3` | 4.7:1 | ✅ AA |
| Link text | `#2563eb` | `#ffffff` | 7.3:1 | ✅ AA |

**Tool:** Use [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) to validate.

### Color is Not the Sole Indicator

Status must be communicated through:
1. ✅ **Color** (Blue for Saved)
2. ✅ **Icon** (🔵 emoji or SVG icon)
3. ✅ **Text Label** ("Saved")

**Bad Example:**
```html
<!-- Color only, no text -->
<div style="background-color: blue; width: 20px; height: 20px;"></div>
```

**Good Example:**
```html
<span class="status-badge status-saved">
  <svg aria-hidden="true">...</svg>
  Saved
</span>
```

### An Emoji Is Not the Sole Indicator Either — Check Before You `aria-hidden` It

The rule above has a mirror image that is easy to get wrong, because the wrong fix looks
exactly like the right one. A bare emoji inside an interactive element joins that element's
**accessible name**, so the glyph's Unicode name is announced in front of the label —
"sparkles Interviewing, button", "briefcase Senior Engineer, button". The reflex is
`aria-hidden="true"`, and on a decoration that is correct and complete.

**But `aria-hidden` on a glyph that is the only carrier of a distinction is not a fix — it is
a silent removal.** It converts a noisy announcement into a missing one, which is worse:
nothing in the rendered output looks different, and no test that only asserts the label
catches it. Before hiding a glyph, name the distinction it draws and find where else that
distinction lives:

| the glyph distinguishes | conveyed elsewhere non-visually? | correct fix |
| --- | --- | --- |
| nothing — it repeats adjacent text | yes, by that text | `aria-hidden` alone |
| a state with another non-visual signal | yes, by that signal | `aria-hidden` alone |
| a category with no other signal | **no** | `aria-hidden` **plus** an `sr-only` label |

Both branches are live in this repo and the pair is the worked example:

- **`SavedFilterShortcuts`** (WIC-1846) — the ✨ marks `isPredefined`, which is already
  conveyed by the absence of a delete control next to the button. Decorative. `aria-hidden`
  alone.
- **`CommandPalette`** (WIC-1850) — the 💼 / 🏢 / 🕐 / ✨ mark the *result type*, and nothing
  else does. The background colour is purely visual, and `subtitle` carries no type at all
  for two of the four types. So the glyph is hidden **and** replaced:

  ```tsx
  <div aria-hidden="true" className="...">{getResultIcon(result)}</div>
  <span className="sr-only">{getResultTypeLabel(result)}:</span>
  ```

  announcing "Application: Senior Engineer Acme Corp" rather than either the glyph's name or
  a bare title. Emit both halves from **one** shared component, not repeated per call site —
  `CommandPalette` renders result rows at four sites, and split across four the two halves
  can drift apart one site at a time.

**There is a third row the table above does not cover: a glyph that is not a signal about
the content but *is* the content.** A `<kbd>` holding `↑↓` or `↵` is the whole instruction —
delete it and the sentence reads "to navigate … to select" — so neither `aria-hidden` alone
nor "it's decorative" applies. Bare, it is announced by Unicode name, and `↵` is **"downwards
arrow with corner leftwards"**, which is not a key anyone can go and press. Take the same
hidden-plus-`sr-only` shape, and put the *key's name* in the replacement, not a description
of the arrow (WIC-1851):

```tsx
<kbd className="…">
  <span aria-hidden="true">↵</span>
  <span className="sr-only">Enter</span>
</kbd>
```

Do not sweep this over every `<kbd>` in a file. The `ESC` hint in the same footer already
spells its key in letters and needs no treatment; giving it one is noise, and the sweep is
how it gets one.

**Verification.** Assert the **exact** accessible name — `toHaveAccessibleName('…')` or an
exact `getByRole` name — and in the same test assert the decoration is *still rendered* and
*still hidden*. Each half alone admits the regression the other catches: a substring matcher
passes with the emoji still in the name, and a name-only assertion passes for a "fix" that
deleted the glyph and took the sighted user's signal with it. See
`packages/web/src/components/CommandPalette.test.tsx`.

Nothing enforces this automatically. `jsx-a11y` cannot: whether a glyph is decorative is a
fact about the *rest of the row*, not about the element the rule sees.

---

## Interactive Elements

### Buttons

```html
<!-- Primary button -->
<button 
  type="button"
  aria-label="Add new application"
  class="btn-primary"
>
  <svg aria-hidden="true">...</svg>
  Add Application
</button>

<!-- Icon-only button (requires aria-label) -->
<button 
  type="button"
  aria-label="Delete application"
  class="btn-icon"
>
  <svg aria-hidden="true">
    <use href="#trash-icon"></use>
  </svg>
</button>
```

**Requirements:**
- Minimum touch target: 44x44px (WCAG 2.1 AAA) or 24x24px (AA)
- Clear hover/focus states
- Disabled buttons use `aria-disabled="true"` and `disabled` attribute

### Links vs Buttons

| Element | Use When | Example |
|---------|----------|---------|
| `<button>` | Triggers action (modal, status change) | "Add Application" |
| `<a>` | Navigates to URL | "View Application Detail" |

**Never:**
```html
<!-- Don't use div/span as button -->
<div onclick="...">Click me</div>
```

**Always:**
```html
<button type="button" onclick="...">Click me</button>
```

### Custom Controls

For custom dropdowns, date pickers, etc., follow ARIA Authoring Practices:
- [Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Listbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)

---

## Forms & Validation

### Form Labels

Every input must have an associated label.

```html
<!-- Explicit label -->
<label for="company-name">Company Name</label>
<input id="company-name" type="text" />

<!-- Implicit label (not recommended for complex forms) -->
<label>
  Company Name
  <input type="text" />
</label>
```

### Required Fields

```html
<label for="job-title">
  Job Title <span aria-label="required">*</span>
</label>
<input 
  id="job-title"
  type="text"
  required
  aria-required="true"
/>
```

**Visual Indicator:** Asterisk (*) or "(required)" text  
**Programmatic:** `aria-required="true"` and `required` attribute

### Error Messages

```html
<label for="email">Email</label>
<input 
  id="email"
  type="email"
  aria-invalid="true"
  aria-describedby="email-error"
/>
<div id="email-error" role="alert">
  Please enter a valid email address.
</div>
```

**Requirements:**
- Associate error with field using `aria-describedby`
- Use `role="alert"` for screen reader announcement
- Show error visually (red border, error icon, message)
- Error text has sufficient contrast (4.5:1)

### Fieldset & Legend (for grouped inputs)

```html
<fieldset>
  <legend>Application Status</legend>
  <label>
    <input type="radio" name="status" value="saved" /> Saved
  </label>
  <label>
    <input type="radio" name="status" value="applied" /> Applied
  </label>
</fieldset>
```

---

## Dynamic Content

### Loading States

```html
<!-- Loading spinner -->
<div role="status" aria-live="polite" aria-label="Loading applications">
  <svg aria-hidden="true" class="spinner">...</svg>
  <span class="sr-only">Loading...</span>
</div>
```

### Skeleton Screens

Prefer skeleton screens over spinners for better perceived performance.

```html
<div aria-busy="true" aria-label="Loading application list">
  <!-- Skeleton cards -->
  <div class="skeleton-card" aria-hidden="true"></div>
  <div class="skeleton-card" aria-hidden="true"></div>
</div>
```

Once loaded:
```html
<div aria-busy="false" aria-label="Application list loaded">
  <!-- Real content -->
</div>
```

### Infinite Scroll / Pagination

Announce new content when loaded:

```html
<div aria-live="polite" aria-atomic="true">
  Loaded 10 more applications. Showing 30 of 45.
</div>
```

Provide "Load More" button as alternative to infinite scroll for keyboard/screen reader users.

---

## Testing Checklist

### Automated Testing

**None of these is wired up.** These three boxes have been unchecked since this document was written; they describe tools someone could run, not a pipeline that runs them. An unchecked box here means "nobody has done this", not "this is queued" — see the enforcement-status note at the top of this document, and **PR #226** (WIC-1483), which is open and unmerged.

- [ ] Run [axe DevTools](https://www.deque.com/axe/devtools/) in browser — manual, per-session; no CI equivalent installed
- [ ] Run [Pa11y](https://pa11y.org/) or [Lighthouse](https://developers.google.com/web/tools/lighthouse) in CI — **not installed**; `deploy.yml` has no accessibility step
- [ ] Check HTML validation (W3C Validator) — manual

### Manual Testing

#### Keyboard Navigation
- [ ] Tab through entire page in logical order
- [ ] All interactive elements reachable
- [ ] Focus indicator always visible
- [ ] Modals trap focus correctly
- [ ] Escape closes modals/dropdowns
- [ ] No keyboard traps
- [ ] With a dialog open, `#root` actually carries `aria-hidden` — an app-level live region
      left inside `#root` silently removes it ([rule](#where-app-level-live-regions-must-be-mounted)).
      Check this on an **empty-list** state too, not just a populated fixture

#### Screen Reader Testing

Test with:
- **macOS:** VoiceOver (Safari)
- **Windows:** NVDA (Firefox) or JAWS (Chrome)
- **Linux:** Orca (Firefox)

Checklist:
- [ ] Page title announced on load
- [ ] Headings structure is logical (H1 → H2 → H3)
- [ ] Form labels read correctly
- [ ] Errors announced when shown
- [ ] Status changes announced (live regions)
- [ ] Image alt text is descriptive
- [ ] Icon-only buttons have aria-labels
- [ ] Landmarks used (`<nav>`, `<main>`, `<aside>`)

#### Color Contrast
- [ ] All text meets 4.5:1 ratio (or 3:1 for large text)
- [ ] Interactive elements meet 3:1 ratio
- [ ] Focus indicators meet 3:1 ratio
- [ ] Color not sole indicator of meaning

#### Touch Targets (Mobile)
- [ ] All interactive elements ≥ 44x44px
- [ ] Sufficient spacing between targets (8px minimum)

#### Zoom & Magnification
- [ ] Page usable at 200% zoom
- [ ] No horizontal scrolling at 400% zoom (reflow)
- [ ] Text spacing adjustable without breaking layout

---

## ARIA Patterns Reference

Common patterns used in this project:

| Component | ARIA Pattern | Documentation |
|-----------|--------------|---------------|
| Modal Dialog | Dialog (Modal) | [Link](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) |
| Dropdown Menu | Menu Button | [Link](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) |
| Status Dropdown | Combobox | [Link](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) |
| Application Card | Article | Native HTML |
| Kanban Board | Custom (Drag & Drop) | Requires keyboard alternative |
| Toast Notification | Alert | [Link](https://www.w3.org/WAI/ARIA/apg/patterns/alert/) |

---

## Resources

### Tools
- [axe DevTools](https://www.deque.com/axe/devtools/) — Browser extension for automated testing
- [WAVE](https://wave.webaim.org/) — Web accessibility evaluation tool
- [Lighthouse](https://developers.google.com/web/tools/lighthouse) — Built into Chrome DevTools
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Accessible Color Palette Builder](https://toolness.github.io/accessible-color-matrix/)

### Guidelines
- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices Guide (APG)](https://www.w3.org/WAI/ARIA/apg/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [A11y Project Checklist](https://www.a11yproject.com/checklist/)

### Screen Readers
- [VoiceOver User Guide](https://support.apple.com/guide/voiceover/welcome/mac) (macOS)
- [NVDA](https://www.nvaccess.org/) (Windows, free)
- [JAWS](https://www.freedomscientific.com/products/software/jaws/) (Windows, paid)

---

## Implementation Priority

**Phase 1 (MVP):**

> **All six boxes below were checked, and all six were wrong.** Re-measured against `main` @
> `0e5d97a` on 2026-08-29 — every one of the six, not just the one that prompted the check. The
> claims are restated underneath each box so the next reader can re-run the measurement instead of
> trusting the tick. **No box here may be re-checked without a fresh measurement and the commit it
> was taken at**; a PR number is a claim about the future and rots the day it is typed, which is how
> this list came to assert six things that were not true.
>
> The counts below are counts in prose and will go stale, exactly as the enforcement note at the top
> of this document warns. They are pinned to `0e5d97a` for that reason, and they are **not** the
> mechanism — the mechanism is `eslint-plugin-jsx-a11y` in the existing `lint-and-test` job, written
> under **WIC-1483** and, measured 2026-08-30, sitting unmerged in **PR #226**. Per the warning
> directly above, treat that as a measurement and not a promise: the card is closed, so its status
> field will never tell you whether the config shipped. Boxes 2 and 4 become machine-checkable only
> once `packages/web/eslint.config.js` **on `main`** carries the config, and at that point these hand
> counts should be deleted rather than updated.
>
> **Boxes 1 and 3 quantify the modal dialogs, and that is the count actively moving.** The Radix
> `Dialog` migration lands dialog-by-dialog rather than in one commit, so "all six hand-rolled
> dialogs" in box 1 and the symbol-absence claim in box 3 are readings of `0e5d97a` and of nothing
> else. Re-measure before quoting either — `grep -rl '@radix-ui/react-dialog' packages/web/src`
> is the whole measurement. Neither box becomes tickable on that migration alone: box 1 also covers
> keyboard access outside dialogs, and box 3 is held open by **WIC-1181** — a confirm action that
> unmounts its own trigger still drops focus on `<body>` — independently of how many dialogs have
> moved.

- [ ] Keyboard navigation for all features — **partial.** Kanban drag-and-drop *is* keyboard
      operable (`KanbanBoard.tsx` wires `KeyboardSensor` with `sortableKeyboardCoordinates`). But
      all six hand-rolled dialogs handle **zero** `Escape` keypresses and have no focus trap, so a
      keyboard user who opens one cannot leave it. See `MODAL_FOCUS_MANAGEMENT_SPEC.md` §2.
- [ ] Proper form labels and validation — **validation yes, labels no.** Validation is real
      (`react-hook-form` + `zod`). **28 of 98** form controls in `packages/web/src` expose no
      programmatic accessible name: 11 sit beside a visible `<label>` that carries no `htmlFor`
      (assistive tech reads these as unlabelled), and 17 have no label at all.
- [ ] Focus management in modals — **not shipped.** `packages/web/src/hooks/useDialogFocusRestore.ts`
      does not exist and no `useDialogFocusRestore` / `fallbackRef` / `RESTORE_WATCH_MS` symbol
      appears anywhere under `packages/web/src`. Authority for this item is
      **`MODAL_FOCUS_MANAGEMENT_SPEC.md` §5** (hook contract, *specified, not implemented*); §2 of
      that document audits all six dialogs and every row still holds at `0e5d97a`.
- [ ] ARIA labels for interactive elements — **partial.** Two controls have no accessible name at
      all: the `role="switch"` toggle in `FilterPanel.tsx` and the icon-only back button in
      `InterviewPrepPage.tsx`. The 17 unlabelled form controls above are additional to those.
- [ ] Color contrast validation — **never performed.** `DESIGN_SYSTEM.md` carries this same item
      *unchecked* under its Implementation Checklist (`- [ ] Test color contrast ratios (WCAG AA
      minimum)`), and the repo has no `axe`, `pa11y`, Lighthouse budget or contrast assertion in any
      `package.json` or in `.github/workflows/`. Nothing has measured this, by hand or in CI.
- [ ] Screen reader testing (basic) — **no evidence it happened.** The only screen-reader artifact in
      the repo is `docs/qa/WIC-186-QA-GUIDE.md`, which *instructs* a tester to enable NVDA, JAWS or
      VoiceOver. That is a procedure, not a result; no outcome is recorded anywhere.

**Phase 2 (Post-MVP):**
- [ ] Advanced ARIA patterns for custom widgets
- [ ] Comprehensive screen reader testing across platforms
- [ ] User testing with people with disabilities
- [ ] Accessibility statement page
- [ ] WCAG 2.1 AAA compliance (stretch goal)

---

## Sign-Off

Before launching, the Frontend Developer should:
1. Run automated accessibility tests (axe, Lighthouse)
2. Complete manual keyboard navigation test
3. Test with at least one screen reader (VoiceOver or NVDA)
4. Validate color contrast for all components
5. Document any known accessibility issues for post-MVP fix

**Accessibility is not optional.** It's a requirement for all features.
