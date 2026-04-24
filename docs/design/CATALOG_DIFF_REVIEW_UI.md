# Catalog Diff Review UI — Design Specification

## Overview

This document specifies the UI/UX design for the Master Catalog Index Diff Review feature (UC-2). The interface enables users to review and approve catalog changes detected after processing new resumes, cover letters, or applications.

**Related:** [BA Spec WIC-101#document-plan](/WIC/issues/WIC-101#document-plan)

---

## Table of Contents

1. [Design Principles](#design-principles)
2. [Diff Review Modal](#diff-review-modal)
3. [Ambiguity Resolution UI](#ambiguity-resolution-ui)
4. [Catalog Browse View](#catalog-browse-view)
5. [Component Specifications](#component-specifications)
6. [Interaction States](#interaction-states)
7. [Responsive Behavior](#responsive-behavior)
8. [Accessibility](#accessibility)

---

## Design Principles

### Primary Goals

1. **Transparency** — User sees exactly what will change before committing
2. **Control** — User can approve all, reject all, or selectively apply changes
3. **Clarity** — Changes are grouped logically and presented with before/after context
4. **Efficiency** — Common flows (approve all, skip ambiguities) are one-click

### Visual Hierarchy

- **Summary Header** — High-level overview (what changed, how many items)
- **Change List** — Grouped by entity type (companies, tags, bullets)
- **Detail View** — Before/after comparison for updates
- **Actions** — Primary CTA is "Apply All", secondary is "Review Individual Changes"

---

## 1. Diff Review Modal

### Trigger Points

The Diff Review modal appears after:
- Resume upload completes and parsing generates catalog changes
- Application is created/updated and triggers catalog sync
- User manually triggers "Sync Catalog" from dashboard

### Layout — Full-Page Modal

```
┌─────────────────────────────────────────────────────────────────────┐
│  ╳ Close                               Catalog Change Review         │
│─────────────────────────────────────────────────────────────────────│
│                                                                       │
│  📊 Summary                                                           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  3 new companies • 5 updated tags • 12 quantified bullets     │  │
│  │  2 pending reviews (ambiguous tags)                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  [Apply All] [Review Individual Changes] [Reject All]       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  📦 Changes by Category                          [Expand All/Collapse]│
│  ─────────────────────────────────────────────────────────────────  │
│                                                                       │
│  ▼ Companies (3 new, 2 updated)                                      │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │ ✅ CREATE  NewCorp                                       │     │
│     │    normalized: newcorp                                   │     │
│     │    source: Resume_2024_v3.pdf                            │     │
│     │    [View Details] [Skip]                                 │     │
│     ├─────────────────────────────────────────────────────────┤     │
│     │ ✅ UPDATE  Acme Corp                                     │     │
│     │    application_count: 2 → 3                              │     │
│     │    latest_status: applied → interview                    │     │
│     │    [View Before/After] [Skip]                            │     │
│     └─────────────────────────────────────────────────────────┘     │
│                                                                       │
│  ▼ Tags — Tech Stack (5 updated)                                     │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │ ✅ UPDATE  react (React)                                 │     │
│     │    mention_count: 3 → 4                                  │     │
│     │    source_ids: +Resume_2024_v3.pdf                       │     │
│     │    [View Details] [Skip]                                 │     │
│     └─────────────────────────────────────────────────────────┘     │
│                                                                       │
│  ▼ Tags — Job Fit (0 changes)                                        │
│     No changes detected                                              │
│                                                                       │
│  ⚠️  Pending Review (2 items)                                        │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │ AMBIGUOUS TAG  "PM"                                      │     │
│     │    Options: Product Manager | Project Manager            │     │
│     │    Context: "5 years as PM leading teams"                │     │
│     │    [Select Product Manager] [Select Project Manager]     │     │
│     │    [Skip]                                                │     │
│     └─────────────────────────────────────────────────────────┘     │
│                                                                       │
│  ▼ Quantified Bullets (12 new)                                       │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │ ✅ CREATE  Increased conversion rate by 25% resulting    │     │
│     │           in $1.2M additional revenue                    │     │
│     │    action_verb: Increased                                │     │
│     │    metric_type: percentage                               │     │
│     │    metric_value: 25                                      │     │
│     │    impact_category: revenue                              │     │
│     │    [View Full Analysis] [Skip]                           │     │
│     └─────────────────────────────────────────────────────────┘     │
│                                                                       │
│─────────────────────────────────────────────────────────────────────│
│  [Cancel]                              [Apply Selected Changes (18)] │
└─────────────────────────────────────────────────────────────────────┘
```

### Visual Design

- **Modal Container**
  - Background: `var(--bg-primary)` (#ffffff)
  - Border Radius: `var(--radius-2xl)` (16px)
  - Shadow: `var(--shadow-xl)`
  - Max Width: 960px (desktop), 100% (mobile)
  - Padding: `var(--space-6)` (24px)

- **Summary Box**
  - Background: `var(--color-info-50)` (#ecfeff)
  - Border: 1px solid `var(--color-info-200)`
  - Border Radius: `var(--radius-lg)` (8px)
  - Padding: `var(--space-4)` (16px)
  - Icon: 📊 (or SVG chart icon)

- **Change Items**
  - Background: `var(--bg-secondary)` (#f9fafb)
  - Border: 1px solid `var(--border-default)` (#e5e7eb)
  - Border Radius: `var(--radius-lg)` (8px)
  - Padding: `var(--space-4)` (16px)
  - Margin Bottom: `var(--space-3)` (12px)

### Change Item Anatomy

Each change item includes:

1. **Action Badge** — CREATE | UPDATE | DELETE
   - CREATE: Green background (`var(--color-success-50)`), green text (`var(--color-success-700)`)
   - UPDATE: Blue background (`var(--color-info-50)`), blue text (`var(--color-info-700)`)
   - DELETE: Red background (`var(--color-error-50)`), red text (`var(--color-error-700)`)

2. **Entity Name/Title** — Bold, `text-body-lg`

3. **Change Details** — Key-value pairs showing what changed

4. **Action Buttons** — View Details, Skip (removes checkmark)

5. **Checkbox State** — Default: checked (✅), clicking Skip unchecks

---

## 2. Ambiguity Resolution UI

### Ambiguous Tag Disambiguation

**Context:** Tag extraction identifies "PM" but cannot determine if it means "Product Manager" or "Project Manager"

#### Inline Resolution (Preferred)

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️  AMBIGUOUS TAG  "PM"                                     │
│                                                              │
│  Context: "5 years as PM leading teams"                     │
│  Source: Resume_2024_v3.pdf, line 24                        │
│                                                              │
│  Which meaning did you intend?                              │
│                                                              │
│  ○  Product Manager                                         │
│     (Technical product ownership)                           │
│                                                              │
│  ○  Project Manager                                         │
│     (Project planning and execution)                        │
│                                                              │
│  ○  Skip (I'll resolve this later)                          │
│                                                              │
│  [Confirm]                                                  │
└─────────────────────────────────────────────────────────────┘
```

**Visual Design:**
- Warning icon: ⚠️ (or SVG)
- Background: `var(--color-warning-50)` (#fefce8)
- Border: 1px solid `var(--color-warning-300)`
- Radio buttons: Large touch targets (44x44px minimum)
- Confirm button: Disabled until selection made

#### Batch Resolution Modal (For Multiple Ambiguities)

If >3 ambiguities detected, show all in a wizard-style modal:

```
┌─────────────────────────────────────────────────────────────┐
│  Resolve Ambiguous Tags                         Step 1 of 3  │
│─────────────────────────────────────────────────────────────│
│                                                              │
│  Tag: "PM" (found in 2 locations)                           │
│                                                              │
│  Context 1: "5 years as PM leading teams"                   │
│  Context 2: "Worked as a PM at Acme Corp"                   │
│                                                              │
│  ○  Product Manager                                         │
│  ○  Project Manager                                         │
│  ○  Apply to all instances of "PM"                          │
│                                                              │
│  [Skip] [Back] [Next]                                       │
│                                                              │
│  Progress: ●○○                                              │
└─────────────────────────────────────────────────────────────┘
```

### Wikilink Resolution

**Context:** User wrote `[[Unknown Entity]]` in a document, system has no match

```
┌─────────────────────────────────────────────────────────────┐
│ 🔗 UNRESOLVED WIKILINK  [[Docker Advanced]]                 │
│                                                              │
│  No match found in catalog.                                 │
│                                                              │
│  Did you mean one of these?                                 │
│                                                              │
│  ○  Docker (85% match)                                      │
│     Tech Stack → DevOps                                     │
│                                                              │
│  ○  Kubernetes (60% match)                                  │
│     Tech Stack → DevOps                                     │
│                                                              │
│  ○  Create new tag "Docker Advanced"                        │
│     Category: [Tech Stack ▼]                                │
│                                                              │
│  ○  Skip (leave unresolved)                                 │
│                                                              │
│  [Confirm]                                                  │
└─────────────────────────────────────────────────────────────┘
```

**Visual Design:**
- Link icon: 🔗 (or SVG)
- Background: `var(--color-neutral-50)`
- Fuzzy match confidence shown as percentage
- Dropdown for category selection if "Create new tag" selected

---

## 3. Catalog Browse View

### Entry Point

**Navigation:** Dashboard → "View Catalog" button

**Purpose:** Allow user to browse and filter the full master catalog index outside of the diff review flow

### Layout — Tabbed Interface

```
┌─────────────────────────────────────────────────────────────────────┐
│  Master Catalog Index                                               │
│─────────────────────────────────────────────────────────────────────│
│                                                                       │
│  [Companies] [Tech Stack Tags] [Job Fit Tags] [Quantified Bullets]  │
│  ═══════════                                                         │
│                                                                       │
│  Companies (47 total)                       [Search...] [Filter ▼]  │
│  ──────────────────────────────────────────────────────────────────  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Name              Applications  Latest Status  First Seen   │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  Acme Corp         3             interview      2024-01-15   │    │
│  │  NewCorp           1             saved          2024-04-20   │    │
│  │  Startup Inc       2             rejected       2024-02-10   │    │
│  │  ...                                                          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  Showing 47 of 47 • Sort by: [Most Recent ▼]                        │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Tab: Tech Stack Tags

```
┌─────────────────────────────────────────────────────────────────────┐
│  Tech Stack Tags (124 total)               [Search...] [Filter ▼]  │
│  ──────────────────────────────────────────────────────────────────  │
│                                                                       │
│  Category: [All ▼] [Frontend] [Backend] [Database] [Cloud] [DevOps] │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Tag            Category    Mentions  Years    Sources      │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  React          Frontend    12        5        3 resumes    │    │
│  │  TypeScript     Language    10        4        3 resumes    │    │
│  │  Node.js        Backend     8         5        2 resumes    │    │
│  │  PostgreSQL     Database    6         3        2 resumes    │    │
│  │  Docker         DevOps      5         2        1 resume     │    │
│  │  ...                                                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  Tag cloud view: [Grid] ○ [Cloud]                                   │
│                                                                       │
│  React¹² TypeScript¹⁰ Node.js⁸ PostgreSQL⁶ Docker⁵ AWS³ ...        │
│  (Size indicates mention count)                                      │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Tab: Quantified Bullets

```
┌─────────────────────────────────────────────────────────────────────┐
│  Quantified Bullets (38 total)             [Search...] [Filter ▼]  │
│  ──────────────────────────────────────────────────────────────────  │
│                                                                       │
│  Impact: [All ▼] [Revenue] [Efficiency] [Team Leadership] [Growth]  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Bullet                                  Impact     Source   │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  Increased conversion rate by 25%       Revenue    Resume_v3│    │
│  │  resulting in $1.2M additional revenue                       │    │
│  │  • Metric: +25% conversion                                   │    │
│  │  • Secondary: $1.2M revenue                                  │    │
│  │  [View Full] [Reuse in Application]                          │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  Led team of 5 engineers to ship       Team Lead  Resume_v2│    │
│  │  product 2 months ahead of schedule                          │    │
│  │  • Team size: 5                                              │    │
│  │  • Timeline: -2 months                                       │    │
│  │  [View Full] [Reuse in Application]                          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Visual Design (Browse View)

- **Table Headers:** Bold, `text-body-sm`, color `var(--text-secondary)`
- **Table Rows:** Hover background `var(--bg-secondary)`, cursor pointer
- **Sort Indicators:** Arrow icons (▲▼) next to column headers
- **Tag Cloud:** Font size scales from `text-xs` (low mentions) to `text-h3` (high mentions)
- **Filter Pills:** When filters applied, show as dismissible pills below search bar

---

## 4. Component Specifications

### 4.1. DiffReviewModal Component

```typescript
interface DiffReviewModalProps {
  isOpen: boolean
  onClose: () => void
  diffSummary: DiffSummary
  changes: CatalogChange[]
  pendingReviews: AmbiguityItem[]
  onApplyAll: () => Promise<void>
  onApplySelected: (changeIds: string[]) => Promise<void>
  onRejectAll: () => void
  onResolveAmbiguity: (itemId: string, resolution: Resolution) => void
}

interface DiffSummary {
  summary: string  // "3 new companies, 5 updated tags..."
  totalChanges: number
  newCount: number
  updatedCount: number
  deletedCount: number
  pendingReviewCount: number
}

interface CatalogChange {
  id: string
  entity: 'company_catalog' | 'tech_stack_tags' | 'job_fit_tags' | 'quantified_bullets'
  action: 'create' | 'update' | 'delete'
  data: Record<string, unknown>
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  sourceId: string
  sourceName: string
  selected: boolean  // Checkbox state
}

interface AmbiguityItem {
  id: string
  type: 'ambiguous_tag' | 'unresolved_wikilink' | 'fuzzy_match'
  value: string
  context: string
  options: AmbiguityOption[]
  sourceId: string
  sourceName: string
}

interface AmbiguityOption {
  id: string
  label: string
  description?: string
  confidence?: number  // For fuzzy matches (0-1)
}
```

### Behavior

- **Default State:** All changes selected (checked)
- **Apply All:** Commits all selected changes atomically via `/api/catalog/apply-diff`
- **Review Individual:** Scrolls to change list, allows selective unchecking
- **Reject All:** Closes modal, discards all changes (confirmation prompt)
- **Keyboard:** Esc to close, Tab navigation, Space to toggle checkboxes

### 4.2. ChangeListItem Component

```typescript
interface ChangeListItemProps {
  change: CatalogChange
  onToggle: (id: string) => void
  onViewDetails: (id: string) => void
  onSkip: (id: string) => void
}
```

**Visual States:**
- Default: Border `neutral-200`, background `neutral-50`
- Selected (checked): Border `success-300`, checkmark visible
- Unselected (skipped): Border `neutral-100`, opacity 0.6, strikethrough on title
- Hover: Border `primary-300`, shadow `md`

### 4.3. AmbiguityResolver Component

```typescript
interface AmbiguityResolverProps {
  item: AmbiguityItem
  onResolve: (itemId: string, selectedOptionId: string) => void
  onSkip: (itemId: string) => void
}
```

**States:**
- Unresolved: Warning background, radio buttons enabled
- Resolved: Success background, selected option shown, checkmark icon
- Skipped: Neutral background, collapsed view

### 4.4. CatalogBrowseTable Component

```typescript
interface CatalogBrowseTableProps {
  catalogType: 'companies' | 'tech_stack_tags' | 'job_fit_tags' | 'quantified_bullets'
  data: CatalogEntry[]
  onSort: (column: string, direction: 'asc' | 'desc') => void
  onFilter: (filters: FilterCriteria) => void
  onSearch: (query: string) => void
  onRowClick: (id: string) => void
}

interface CatalogEntry {
  id: string
  [key: string]: unknown  // Entity-specific fields
}
```

### 4.5. ChangeActionBadge Component

```typescript
interface ChangeActionBadgeProps {
  action: 'create' | 'update' | 'delete'
  size?: 'sm' | 'md' | 'lg'
}
```

**Visual Design:**

| Action | Background | Text Color | Icon |
|--------|------------|------------|------|
| CREATE | `success-50` | `success-700` | ➕ |
| UPDATE | `info-50` | `info-700` | ✏️ |
| DELETE | `error-50` | `error-700` | 🗑️ |

**Sizes:**
- sm: 20px height, `text-xs`, 4px padding
- md: 24px height, `text-sm`, 6px padding
- lg: 28px height, `text-body`, 8px padding

---

## 5. Interaction States

### Loading States

#### Initial Load (Diff Generation)

```
┌─────────────────────────────────────────┐
│  Analyzing changes...                   │
│  ┌───────────────────────────────────┐  │
│  │  ████████████░░░░░░░░░░░░ 60%    │  │
│  └───────────────────────────────────┘  │
│  Extracting tags from Resume_v3.pdf     │
└─────────────────────────────────────────┘
```

#### Applying Changes

```
┌─────────────────────────────────────────┐
│  Applying changes...                    │
│  ┌───────────────────────────────────┐  │
│  │  ████████████████████████ 100%   │  │
│  └───────────────────────────────────┘  │
│  18 changes committed successfully      │
│  [Close]                                │
└─────────────────────────────────────────┘
```

### Error States

#### Conflict Detected

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️  Conflict Detected                                  │
│  ───────────────────────────────────────────────────    │
│                                                          │
│  A previous diff is still pending review.               │
│                                                          │
│  You have 14 uncommitted changes from 2024-04-20.       │
│                                                          │
│  [Review Pending Changes] [Discard & Start New]         │
└─────────────────────────────────────────────────────────┘
```

#### Apply Failed

```
┌─────────────────────────────────────────────────────────┐
│  ❌ Failed to Apply Changes                             │
│  ───────────────────────────────────────────────────    │
│                                                          │
│  Error: Database constraint violation                   │
│  Duplicate company name "Acme Corp" already exists.     │
│                                                          │
│  [Retry] [Cancel]                                       │
└─────────────────────────────────────────────────────────┘
```

### Success States

#### Changes Applied

```
┌─────────────────────────────────────────────────────────┐
│  ✅ Changes Applied Successfully                        │
│  ───────────────────────────────────────────────────    │
│                                                          │
│  18 changes committed to catalog                        │
│  • 3 companies created                                  │
│  • 5 tags updated                                       │
│  • 12 quantified bullets added                          │
│                                                          │
│  [View Catalog] [Close]                                 │
└─────────────────────────────────────────────────────────┘
```

### Empty States

#### No Changes Detected

```
┌─────────────────────────────────────────────────────────┐
│  ℹ️  No Changes Detected                                │
│  ───────────────────────────────────────────────────    │
│                                                          │
│  Parsing completed, but no new catalog entries were     │
│  found. All entities already exist in your catalog.     │
│                                                          │
│  [Close]                                                │
└─────────────────────────────────────────────────────────┘
```

#### Empty Catalog (First Time)

```
┌─────────────────────────────────────────────────────────┐
│  📚 Your Catalog is Empty                               │
│  ───────────────────────────────────────────────────    │
│                                                          │
│  Upload a resume to start building your catalog.        │
│                                                          │
│  The catalog tracks:                                    │
│  • Companies you've applied to                          │
│  • Your tech stack and skills                           │
│  • Quantified achievements                              │
│                                                          │
│  [Upload Resume]                                        │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Responsive Behavior

### Desktop (≥ 1024px)

- Modal: 960px max-width, centered
- Change list: 2-column grid (large diffs)
- Tables: Full-width, all columns visible
- Actions: Inline buttons (View Details, Skip)

### Tablet (768px - 1023px)

- Modal: 90% viewport width
- Change list: Single column
- Tables: Hide secondary columns (keep Name, Count, Status)
- Actions: Icon-only buttons (space-saving)

### Mobile (< 768px)

- Modal: Full-screen overlay (100% viewport)
- Change list: Vertical stack, expanded by default
- Tables: Card view (no table layout)
  ```
  ┌─────────────────────────┐
  │  Acme Corp              │
  │  3 applications         │
  │  Status: Interview      │
  │  First seen: 2024-01-15 │
  └─────────────────────────┘
  ```
- Actions: Bottom sheet for bulk actions (Apply All, Reject All)

### Breakpoint-Specific Classes

```css
/* Desktop */
.diff-modal-desktop {
  max-width: 960px;
  padding: var(--space-6);
}

/* Tablet */
@media (max-width: 1023px) {
  .diff-modal-tablet {
    max-width: 90vw;
    padding: var(--space-5);
  }
  .change-list-grid {
    grid-template-columns: 1fr;
  }
}

/* Mobile */
@media (max-width: 767px) {
  .diff-modal-mobile {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
    padding: var(--space-4);
  }
  .catalog-table-mobile {
    display: none;  /* Switch to card view */
  }
  .catalog-cards-mobile {
    display: block;
  }
}
```

---

## 7. Accessibility

### ARIA Roles and Labels

```html
<!-- Diff Review Modal -->
<div
  role="dialog"
  aria-labelledby="diff-modal-title"
  aria-describedby="diff-modal-summary"
  aria-modal="true"
>
  <h2 id="diff-modal-title">Catalog Change Review</h2>
  <div id="diff-modal-summary">
    3 new companies, 5 updated tags, 12 quantified bullets extracted
  </div>
  
  <!-- Change List -->
  <ul role="list" aria-label="Catalog changes">
    <li role="listitem">
      <label>
        <input
          type="checkbox"
          checked
          aria-label="Include new company NewCorp"
        />
        <span>CREATE NewCorp</span>
      </label>
    </li>
  </ul>
  
  <!-- Ambiguity Resolver -->
  <fieldset aria-labelledby="ambiguity-legend">
    <legend id="ambiguity-legend">
      Resolve ambiguous tag "PM"
    </legend>
    <label>
      <input type="radio" name="pm-meaning" value="product-manager" />
      Product Manager
    </label>
    <label>
      <input type="radio" name="pm-meaning" value="project-manager" />
      Project Manager
    </label>
  </fieldset>
</div>
```

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Esc | Close modal (with confirmation if changes pending) |
| Tab | Move focus through interactive elements |
| Shift+Tab | Move focus backward |
| Space | Toggle checkbox / Select radio button |
| Enter | Activate focused button |
| Arrow Up/Down | Navigate within radio button groups |

### Focus Management

- **Modal Open:** Focus moves to "Apply All" button (primary action)
- **Modal Close:** Focus returns to trigger element (e.g., "Review Changes" button)
- **Focus Indicator:** 2px solid outline, `var(--color-primary-500)`, 2px offset
- **Skip Links:** "Skip to change list" for keyboard users

### Screen Reader Announcements

```html
<!-- Live region for dynamic updates -->
<div aria-live="polite" aria-atomic="true" class="sr-only">
  <!-- Announced when changes applied -->
  18 changes applied successfully
</div>

<div aria-live="assertive" aria-atomic="true" class="sr-only">
  <!-- Announced on error -->
  Error: Failed to apply changes. Database constraint violation.
</div>
```

### Color Contrast

All text meets WCAG AA minimum contrast ratios (4.5:1 for normal text, 3:1 for large text):

| Foreground | Background | Ratio | Pass |
|------------|------------|-------|------|
| `neutral-900` | `#ffffff` | 16.5:1 | ✅ AAA |
| `neutral-600` | `neutral-50` | 7.2:1 | ✅ AAA |
| `success-700` | `success-50` | 6.1:1 | ✅ AA |
| `error-700` | `error-50` | 5.8:1 | ✅ AA |

---

## 8. Implementation Handoff Notes

### API Endpoints Required

```typescript
// Generate diff after resume upload
POST /api/catalog/generate-diff
{
  sourceType: 'resume' | 'application'
  sourceId: string
}
Response: DiffSummary + CatalogChange[]

// Apply selected changes
POST /api/catalog/apply-diff
{
  changeIds: string[]
  resolutions: { [ambiguityId: string]: string }  // Resolved ambiguities
}
Response: { success: boolean, appliedCount: number }

// Discard pending diff
DELETE /api/catalog/pending-diff/{diffId}

// Get catalog entries (browse view)
GET /api/catalog/companies?search=...&sort=...
GET /api/catalog/tags/tech-stack?category=...
GET /api/catalog/quantified-bullets?impact=...
```

### Component File Structure

```
packages/web/src/
  components/
    CatalogDiff/
      DiffReviewModal.tsx
      ChangeListItem.tsx
      AmbiguityResolver.tsx
      ChangeActionBadge.tsx
      BeforeAfterComparison.tsx
      index.ts
    CatalogBrowse/
      CatalogBrowseView.tsx
      CatalogTable.tsx
      CatalogCard.tsx  (mobile)
      TagCloud.tsx
      index.ts
  pages/
    CatalogPage.tsx
  hooks/
    useCatalogDiff.ts
    useCatalogBrowse.ts
  services/api/
    catalog.service.ts
```

### Styling Approach

- Use Tailwind utility classes for layout and spacing
- Extract reusable component styles to CSS modules or Tailwind `@apply`
- Use design tokens from `DESIGN_SYSTEM.md` for colors, shadows, radii
- Animations: `transition-all duration-250 ease-in-out` for hovers

### Testing Scenarios

1. **Happy Path:** Upload resume → Generate diff → Review changes → Apply all → See success
2. **Ambiguity Resolution:** Tag extraction finds "PM" → User selects "Product Manager" → Apply
3. **Selective Apply:** User unchecks 3 changes → Applies only 15 → Verify database state
4. **Conflict:** Pending diff exists → Warn user → Allow discard or review
5. **Empty Diff:** Upload resume with no new entities → Show "No changes" message
6. **Error Handling:** Network failure during apply → Show error → Allow retry
7. **Keyboard Navigation:** Tab through all interactive elements, Space to toggle checkboxes
8. **Screen Reader:** VoiceOver/NVDA announces all changes, counts, and state updates

---

## Definition of Done

- [x] Wireframes for diff review flow
- [x] Component specs for new UI elements (DiffReviewModal, ChangeListItem, AmbiguityResolver, etc.)
- [x] Interaction states documented (loading, error, success, empty)
- [x] Responsive behavior specified (desktop, tablet, mobile)
- [x] Accessibility requirements defined (ARIA, keyboard, screen reader)
- [x] API endpoint contracts outlined
- [x] Component file structure proposed
- [x] Testing scenarios identified

**Next Step:** Hand off to Frontend Developer for implementation (WIC-104 or similar issue)
