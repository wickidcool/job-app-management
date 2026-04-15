# Accessibility Guidelines — Job Application Manager

This document outlines accessibility requirements and best practices to ensure the Job Application Manager is usable by everyone, including people with disabilities.

**Target Compliance:** WCAG 2.1 Level AA

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

- [ ] Run [axe DevTools](https://www.deque.com/axe/devtools/) in browser
- [ ] Run [Pa11y](https://pa11y.org/) or [Lighthouse](https://developers.google.com/web/tools/lighthouse) in CI
- [ ] Check HTML validation (W3C Validator)

### Manual Testing

#### Keyboard Navigation
- [ ] Tab through entire page in logical order
- [ ] All interactive elements reachable
- [ ] Focus indicator always visible
- [ ] Modals trap focus correctly
- [ ] Escape closes modals/dropdowns
- [ ] No keyboard traps

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
- [x] Keyboard navigation for all features
- [x] Proper form labels and validation
- [x] Focus management in modals
- [x] ARIA labels for interactive elements
- [x] Color contrast validation
- [x] Screen reader testing (basic)

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
