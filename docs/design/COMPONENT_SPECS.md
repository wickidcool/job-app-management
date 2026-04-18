# Component Specifications — Job Application Manager

This document defines all reusable UI components with their states, variants, props, and behaviors.

---

## 1. ApplicationCard

### Purpose
Displays a job application in a compact, actionable card format. Used in Kanban columns and list views.

### Variants

#### Default (Kanban)
```tsx
interface ApplicationCardProps {
  application: Application
  variant?: 'kanban' | 'list'
  draggable?: boolean
  onCardClick?: (id: string) => void
  onStatusChange?: (id: string, newStatus: ApplicationStatus) => void
  onDelete?: (id: string) => void
}
```

### Visual States

| State | Trigger | Visual Changes |
|-------|---------|----------------|
| Default | - | Border: neutral-200, Shadow: sm |
| Hover | Mouse over | Border: primary-300, Shadow: md, Cursor: pointer |
| Dragging | Drag initiated | Opacity: 0.5, Rotate: 2deg, Shadow: lg |
| Selected | Click (multi-select mode) | Border: primary-500, Background: primary-50 |
| Disabled | Loading/Error | Opacity: 0.6, Cursor: not-allowed |

### Anatomy (Kanban Variant)

```
┌─────────────────────────┐
│ 💼 [Icon]               │  ← Company icon/avatar (optional)
│ [Job Title]             │  ← Text-lg, font-semibold, truncate
│ [Company Name]          │  ← Text-sm, color-neutral-600
│                         │
│ [Location] | [Salary]   │  ← Text-xs, color-neutral-500
│                         │
│ 📎 [Document Count]     │  ← Only if has linked docs
│                         │
│ [Relative Time]         │  ← Text-xs, color-neutral-400, right-aligned
└─────────────────────────┘
   ↓ Hover reveals
┌─────────────────────────┐
│ [Quick Actions Bar]     │  ← Edit | Change Status | Delete
└─────────────────────────┘
```

### Props Details

```typescript
interface ApplicationCardProps {
  application: {
    id: string
    jobTitle: string
    company: string
    location?: string
    salaryRange?: string
    status: ApplicationStatus
    hasDocuments: boolean
    createdAt: Date
    appliedAt?: Date
  }
  variant: 'kanban' | 'list'
  draggable: boolean
  showQuickActions: boolean
  onCardClick: (id: string) => void
  onStatusChange: (id: string, newStatus: ApplicationStatus) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}
```

### Behavior

- **Click:** Opens application detail page
- **Drag (Kanban):** Initiates drag operation, shows drop zones
- **Hover:** Shows quick action buttons (edit, status dropdown, delete)
- **Keyboard:** Focus with Tab, activate with Enter/Space, navigate actions with arrow keys

### Accessibility

- **ARIA Role:** `article`
- **ARIA Label:** "{jobTitle} at {company}, status: {status}"
- **Focus Indicator:** 2px outline, primary-500
- **Screen Reader:** Announces document count, application date

---

## 2. StatusBadge

### Purpose
Visual indicator for application status with consistent color coding.

### Variants

```tsx
type StatusBadgeSize = 'sm' | 'md' | 'lg'
type StatusBadgeVariant = 'filled' | 'outlined' | 'dot'

interface StatusBadgeProps {
  status: ApplicationStatus
  size?: StatusBadgeSize
  variant?: StatusBadgeVariant
  showIcon?: boolean
}
```

### Status Color Mapping

| Status | Color | Icon | Meaning |
|--------|-------|------|---------|
| saved | blue-500 | 🔵 | Not yet applied |
| applied | yellow-500 | 🟡 | Application submitted |
| phone_screen | orange-500 | 🟠 | Initial screening |
| interview | purple-500 | 🟣 | In-person/video interview |
| offer | green-500 | 🟢 | Offer received |
| rejected | red-500 | 🔴 | Application rejected |
| withdrawn | gray-500 | ⚪ | Candidate withdrew |

### Size Specifications

| Size | Padding | Font Size | Icon Size | Border Radius |
|------|---------|-----------|-----------|---------------|
| sm | 2px 8px | 12px | 12px | 12px |
| md | 4px 12px | 14px | 16px | 16px |
| lg | 6px 16px | 16px | 20px | 20px |

### Visual Examples

**Filled Variant (Default):**
```
┌────────────┐
│ 🟡 Applied │  Background: yellow-100, Text: yellow-800, Border: none
└────────────┘
```

**Outlined Variant:**
```
┌────────────┐
│ 🟡 Applied │  Background: transparent, Text: yellow-600, Border: yellow-600
└────────────┘
```

**Dot Variant:**
```
● Applied     Dot: yellow-500, Text: neutral-700
```

### Accessibility

- **ARIA Role:** `status`
- **ARIA Label:** "Application status: {status}"
- **Color:** Not sole differentiator (uses icons + text)

---

## 3. ApplicationForm

### Purpose
Modal form for creating or editing job applications.

### Variants
- **Create Mode:** Empty form, title "Add New Application"
- **Edit Mode:** Pre-filled form, title "Edit Application"

### Form Fields

```typescript
interface ApplicationFormData {
  jobTitle: string           // Required, min 2 chars
  company: string            // Required, min 2 chars
  url?: string               // Optional, URL validation
  location?: string          // Optional, free text
  salaryRange?: string       // Optional, free text
  jobDescription?: string    // Optional, textarea, for job description matching
  status: ApplicationStatus  // Required, dropdown
  linkCoverLetter?: boolean  // Checkbox toggle
  coverLetterId?: string     // Selected from picker
}
```

### States

| State | Trigger | Visual Feedback |
|-------|---------|-----------------|
| Pristine | Form opened | Save button disabled |
| Dirty | Any field changed | Save button enabled (if valid) |
| Validating | Blur on field | Show field-level errors |
| Submitting | Save clicked | Loading spinner, buttons disabled |
| Success | Server responds 200 | Close modal, show toast |
| Error | Server error | Show error message, enable retry |

### Validation Rules

```typescript
const validationSchema = {
  jobTitle: {
    required: true,
    minLength: 2,
    maxLength: 200,
    message: 'Job title must be between 2-200 characters'
  },
  company: {
    required: true,
    minLength: 2,
    maxLength: 100,
    message: 'Company name must be between 2-100 characters'
  },
  url: {
    required: false,
    pattern: /^https?:\/\/.+/,
    message: 'Must be a valid URL starting with http:// or https://'
  },
  jobDescription: {
    required: false,
    maxLength: 10000,
    message: 'Job description must be less than 10,000 characters'
  },
  status: {
    required: true,
    enum: ['saved', 'applied', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn']
  }
}
```

### Behavior

- **Auto-save Draft:** Save to localStorage every 30s (prevent data loss)
- **Dirty Check on Close:** Confirm "Discard changes?" if form modified
- **Cover Letter Checkbox:** Expands to show `CoverLetterPicker` component
- **Tab Order:** Top to bottom, Save button last
- **Escape Key:** Trigger Cancel button
- **Enter Key:** Submit form if valid (except in textarea)

### Accessibility

- **Focus Management:** First field receives focus on open
- **Error Announcement:** Screen reader announces validation errors
- **Required Fields:** Marked with * and `aria-required="true"`
- **Error Association:** `aria-describedby` links errors to fields

---

## 4. KanbanBoard

### Purpose
Drag-and-drop board for visualizing applications by status.

### Structure

```tsx
interface KanbanBoardProps {
  applications: Application[]
  onStatusChange: (appId: string, newStatus: ApplicationStatus) => void
  onCardClick: (appId: string) => void
  loading?: boolean
}
```

### Column Configuration

```typescript
const columns: KanbanColumn[] = [
  { id: 'saved', title: 'Saved', color: 'blue', icon: '📥' },
  { id: 'applied', title: 'Applied', color: 'yellow', icon: '📤' },
  { id: 'phone_screen', title: 'Phone Screen', color: 'orange', icon: '📞' },
  { id: 'interview', title: 'Interview', color: 'purple', icon: '🤝' },
  { id: 'offer', title: 'Offer', color: 'green', icon: '🎉' },
  { id: 'rejected', title: 'Rejected', color: 'red', icon: '❌' }
]
```

### Drag & Drop Behavior

| Action | Feedback | Validation |
|--------|----------|------------|
| Pick up card | Card lifts with shadow, other columns highlight | - |
| Drag over valid column | Column background: primary-50, border: dashed | Check valid transition |
| Drag over invalid column | Column background: red-50, cursor: not-allowed | Show error toast |
| Drop in valid column | Animate card to position, update status | Server request |
| Drop in invalid column | Card returns to origin with bounce animation | - |

### States

- **Loading:** Skeleton columns with shimmer effect
- **Empty Column:** Show "No {status} applications" with muted style
- **Overflow:** Scroll within column if > 10 cards

### Responsive Behavior

- **Desktop (>1024px):** 6 columns horizontal
- **Tablet (768-1024px):** 3 columns, scrollable horizontal
- **Mobile (<768px):** Switch to list view (no drag-and-drop)

### Accessibility

- **Keyboard Drag:** Arrow keys to move cards between columns
- **Focus Management:** Focus follows dragged card
- **Screen Reader:** Announces "Moved {jobTitle} from {oldStatus} to {newStatus}"
- **ARIA Live Region:** Status changes announced

---

## 5. DashboardStats

### Purpose
Display key metrics at a glance.

### Props

```tsx
interface DashboardStatsProps {
  stats: {
    total: number
    appliedThisWeek: number
    responseRate: number      // 0-100
    inReview: number           // phone_screen + interview count
  }
  loading?: boolean
}
```

### Layout

```
┌──────────┬──────────┬──────────┬──────────┐
│   24     │    8     │   33%    │    3     │
│  Total   │This Week │ Response │In Review │
└──────────┴──────────┴──────────┴──────────┘
```

### Stat Card Anatomy

```
┌──────────┐
│   [VALUE] │  ← Text-3xl, font-bold, color-primary-600
│  [LABEL] │  ← Text-sm, color-neutral-600
└──────────┘
```

### States

- **Loading:** Show skeleton with pulsing animation
- **Zero State:** Display "0" with muted styling
- **Hover:** Subtle scale transform (1.02x) and shadow

### Responsive

- **Mobile (<768px):** 2x2 grid
- **Tablet/Desktop:** 1x4 horizontal

---

## 6. FilterPanel

### Purpose
Allow users to filter and search applications.

### Props

```tsx
interface FilterPanelProps {
  onFilterChange: (filters: FilterOptions) => void
  activeFilters: FilterOptions
  availableCompanies: string[]
  availableStatuses: ApplicationStatus[]
}

interface FilterOptions {
  search?: string
  status?: ApplicationStatus[]
  company?: string[]
  dateRange?: { start: Date; end: Date }
  salaryMin?: number
  salaryMax?: number
}
```

### UI Elements

| Element | Type | Behavior |
|---------|------|----------|
| Search | Text input | Debounced (300ms), searches title + company |
| Status | Multi-select checkboxes | Filter by one or more statuses |
| Company | Multi-select autocomplete | Filter by company name |
| Date Range | Date picker | Presets: This Week, This Month, Last 3 Months |
| Salary | Range slider | Min $0k, Max $500k, step $10k |

### Active Filter Chips

```
Applied Filters:  [Status: Applied ✕]  [Company: TechCo ✕]  [Clear All]
```

- **Click Chip:** Removes that filter
- **Clear All:** Resets to default (no filters)

### Accessibility

- **Focus Order:** Search → Status → Company → Date → Salary
- **Screen Reader:** Announces filter count changes
- **Keyboard:** Space/Enter to toggle checkboxes

---

## 7. StatusDropdown

### Purpose
Quick status change dropdown for cards and detail pages.

### Props

```tsx
interface StatusDropdownProps {
  currentStatus: ApplicationStatus
  onStatusChange: (newStatus: ApplicationStatus) => void
  allowedTransitions?: ApplicationStatus[]  // If undefined, show all
  size?: 'sm' | 'md'
}
```

### Behavior

- **Click Trigger:** Opens dropdown below button
- **Option Disabled:** If not in `allowedTransitions`, show with tooltip
- **Select Option:** Closes dropdown, fires `onStatusChange`
- **Outside Click:** Closes dropdown

### Dropdown Layout

```
┌────────────────────────────┐
│ ○ Saved                    │
│ ○ Applied                  │
│ ○ Phone Screen             │
│ ● Interview        [current]│
│ ○ Offer                    │
│ ⊘ Rejected        [disabled]│
│ ○ Withdrawn                │
└────────────────────────────┘
```

### Accessibility

- **ARIA Role:** `combobox`
- **Arrow Keys:** Navigate options
- **Enter/Space:** Select focused option
- **Escape:** Close dropdown
- **Disabled Tooltip:** "Cannot move from Interview to Rejected directly"

---

## 8. DocumentLinker

### Purpose
Component to link cover letters or resumes to applications.

### Props

```tsx
interface DocumentLinkerProps {
  type: 'cover-letter' | 'resume'
  linkedDocumentId?: string
  availableDocuments: Document[]
  onLink: (documentId: string) => void
  onUnlink: () => void
  onPreview: (documentId: string) => void
}
```

### States

| State | Visual | Actions Available |
|-------|--------|-------------------|
| No Document | "No {type} linked" (muted) | [Link {type}] button |
| Document Linked | Document preview card | [View] [Unlink] buttons |
| Picker Open | Modal with document list | [Select] [Cancel] |

### Document Picker

- **Search:** Filter by keywords
- **Sort:** Recent, Oldest, Alphabetical
- **Preview:** Inline preview on hover or click
- **Selection:** Radio buttons (single select)

---

## 9. StatusTimeline

### Purpose
Display chronological history of status changes.

### Props

```tsx
interface StatusTimelineProps {
  history: StatusChange[]
  compact?: boolean
}

interface StatusChange {
  status: ApplicationStatus
  timestamp: Date
  note?: string
}
```

### Visual Layout

```
┌────┬─────────────────────────────────┐
│ ●  │ Interview                       │  ← Most recent (bold)
│ │  │ Apr 15, 2026 at 10:30 AM        │
│ │  │                                 │
│ ●  │ Phone Screen                    │
│ │  │ Apr 12, 2026 at 2:00 PM         │
│ │  │ "Spoke with recruiter Sarah"    │  ← Optional note
│ │  │                                 │
│ ●  │ Applied                         │
│ │  │ Apr 10, 2026 at 9:15 AM         │
│ │  │                                 │
│ ●  │ Saved                           │  ← Oldest
│    │ Apr 8, 2026 at 4:30 PM          │
└────┴─────────────────────────────────┘
```

### States

- **Compact Mode:** Single line per entry, no notes
- **Loading:** Skeleton timeline
- **Empty:** "No history yet"

### Accessibility

- **ARIA Role:** `feed`
- **Time Format:** Relative (< 7 days) or absolute
- **Screen Reader:** "Timeline with {count} status changes"

---

## 10. EmptyState

### Purpose
Friendly message when no data is available.

### Variants

```tsx
type EmptyStateVariant = 
  | 'no-applications'
  | 'no-results'
  | 'no-documents'

interface EmptyStateProps {
  variant: EmptyStateVariant
  onAction?: () => void
  actionLabel?: string
}
```

### Variant Content

| Variant | Icon | Heading | Message | Action |
|---------|------|---------|---------|--------|
| no-applications | 📋 | "No applications yet!" | "Track your job applications in one place..." | "Add Your First Application" |
| no-results | 🔍 | "No matching results" | "Try adjusting your filters or search terms" | "Clear Filters" |
| no-documents | 📄 | "No documents found" | "Generate a cover letter to get started" | "Create Cover Letter" |

### Accessibility

- **Focus:** Action button receives focus
- **ARIA Live:** Announce when empty state appears (e.g., after filter)

---

## Component Library Recommendations

For implementation, consider using:
- **Headless UI** (Tailwind Labs) for accessible primitives
- **React DnD** or **dnd-kit** for drag-and-drop
- **React Hook Form** for form state
- **Zod** for validation schemas
- **Radix UI** for advanced components (dropdowns, modals)

---

## Animation Guidelines

| Interaction | Animation | Duration | Easing |
|-------------|-----------|----------|--------|
| Card hover | Scale 1.02, shadow increase | 200ms | ease-out |
| Status change | Color fade, badge morph | 300ms | ease-in-out |
| Modal open | Fade in + slide up | 250ms | ease-out |
| Modal close | Fade out + slide down | 200ms | ease-in |
| Drag card | Lift + rotate | 150ms | ease-out |
| Drop card | Snap to position | 250ms | spring |
| Toast notification | Slide in from top | 300ms | ease-out |
| Loading skeleton | Shimmer wave | 1500ms | linear infinite |

---

## Testing Checklist

For each component:
- [ ] All states render correctly
- [ ] Props validation works
- [ ] Accessibility attributes present
- [ ] Keyboard navigation functional
- [ ] Screen reader announces correctly
- [ ] Responsive at all breakpoints
- [ ] Animations perform smoothly (60fps)
- [ ] Error states handled gracefully
