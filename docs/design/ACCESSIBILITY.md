# Accessibility Guidelines — Job Application Manager

This document outlines accessibility requirements and best practices to ensure the Job Application Manager is usable by everyone, including people with disabilities.

**Target Compliance:** WCAG 2.1 Level AA

> **Enforcement status: none. This target is not mechanically verified.** Checked against `main` @ `6911bcb` (2026-08-27): the repository carries no `eslint-plugin-jsx-a11y`, no `axe`/`vitest-axe`/`jest-axe`, no `pa11y` and no Lighthouse budget, and `packages/web/eslint.config.js` loads only `js`, `typescript-eslint`, `react-hooks`, `react-refresh` and `prettier`. Nothing in `.github/workflows/deploy.yml` fails when a page violates this document.
>
> The gap is measured, not theoretical. A heading-order scan that resolves component-rendered headings at their usage site — recursively, across every branch a view can render — found a **majority of pages skipping a heading level** (WCAG SC 1.3.1), several with no `<h1>` at all, including `Login`, the product's only pre-authentication page. Figures and the per-page breakdown are recorded on **WIC-1480**, measured 2026-08-26 at `8e19705`; they predate the fixes landed since and are not restated here, because a count in prose goes stale the day after it is taken.
>
> **Read every requirement below as guidance a reviewer checks by hand.** The [Testing Checklist](#testing-checklist) is the entire process today, and no box in it is automated.
>
> A mechanism is in progress under **WIC-1483**: `eslint-plugin-jsx-a11y` plus rendered per-render-branch heading-outline assertions, both hosted by the existing `lint-and-test` job. When it lands, this note is replaced by a citation naming that job and the command that fails the build — and the replacement must still state what remains unverified, because heading order plus a lint rule set is not WCAG 2.1 AA. Tracked for this document by **WIC-1584**.

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

#### Announcing an outcome: use the shared `Announcer` (WIC-1304)

> **Rule.** An **outcome** announcement — something happened, and the DOM change alone does
> not say so — uses `useAnnouncer` + `<Announcer>`. Do not hand-roll a sixth live region.

```tsx
import { Announcer } from '../components/Announcer';
import { useAnnouncer } from '../hooks/useAnnouncer';

const { message, announce, clear } = useAnnouncer();
// on the success path, after the mutation resolves:
announce(`Project ${createdName} created.`);

return <Announcer message={message} />;   // portals itself out of #root
```

`Announcer` handles the mounting rule below; `useAnnouncer` handles the repeat case — the
*second* of two identical outcomes is otherwise announced as nothing at all, because
assistive tech reacts to a **change** in the region and re-setting the same string is not one.

**When you need it.** The trigger is a *context change the user cannot see*. The canonical
case is the destroyed-trigger class in `MODAL_FOCUS_MANAGEMENT_SPEC.md`: the control the user
activated is unmounted by its own action, so focus is redirected to a different control.
Redirecting focus is necessary but not sufficient — a screen-reader user then hears only the
new control's label and is never told what happened. **Both halves are required; shipping the
focus half alone is what WIC-1304 was filed for.**

**When you do not.** A region whose text is **derived from render state** — `"Step 2 of 5"` in
`wizard/ProgressIndicator` and `OnboardingProgressIndicator`, `KanbanBoard`'s drag announcer —
is *content*, not outcome reporting. Those are already correct rendered in place and should
stay there; see the component-local carve-out at the end of the next section. This helper is
not a consolidation target for them.

**Never build the region out of the thing that changed.** `EmptyState` carried `aria-live` on
the container wrapping its own action button, and the exemption rule below turned that into a
live control behind every dialog (WIC-1155). The region announces *about* the change; it does
not contain it.

Covered by `packages/web/src/components/Announcer.test.tsx`, which drives the real
`aria-hidden` package rather than asserting on attributes.

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

**None of these is wired up.** These three boxes have been unchecked since this document was written; they describe tools someone could run, not a pipeline that runs them. An unchecked box here means "nobody has done this", not "this is queued" — see the enforcement-status note at the top of this document, and **WIC-1483**.

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
> mechanism — the mechanism is **WIC-1483** (`eslint-plugin-jsx-a11y` in the existing
> `lint-and-test` job). When it lands, boxes 2 and 4 become machine-checkable and these hand counts
> should be deleted rather than updated.
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
