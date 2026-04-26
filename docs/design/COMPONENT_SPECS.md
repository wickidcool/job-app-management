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

## 11. ResumeUpload

### Purpose
Upload and parse resume files to automatically extract work experience, education, and skills.

### Props

```tsx
interface ResumeUploadProps {
  onUploadComplete: (resumeId: string, parsedData: ParsedResume) => void
  onUploadError: (error: Error) => void
  maxFileSizeMB?: number
  acceptedFormats?: string[]
  existingResumeId?: string
}

interface ParsedResume {
  id: string
  fileName: string
  uploadedAt: Date
  parsedExperiences: STARExperience[]
  education: Education[]
  skills: string[]
}

interface STARExperience {
  id: string
  company: string
  role: string
  startDate: Date
  endDate?: Date
  bullets: STARBullet[]
}

interface STARBullet {
  situation: string
  task: string
  action: string
  result: string
  originalText: string
}
```

### Variants

| Variant | Trigger | Use Case |
|---------|---------|----------|
| Empty | No file uploaded | Initial state, encourages upload |
| Uploading | File selected, upload in progress | Shows progress bar |
| Processing | Upload complete, parsing in progress | Shows spinner with "Analyzing..." |
| Complete | Parsing finished | Shows preview of extracted data |
| Error | Upload/parse failed | Shows error message with retry option |

### Visual States

#### Empty State
```
┌─────────────────────────────────────────┐
│                                         │
│            📄                           │
│                                         │
│    Drag & drop your resume here        │
│    or click to browse                   │
│                                         │
│    PDF, DOCX, TXT (Max 10MB)            │
│                                         │
└─────────────────────────────────────────┘
```

#### Uploading State
```
┌─────────────────────────────────────────┐
│  resume.pdf                         ✕   │
│  ████████████░░░░░░░░░░░░░  62%         │
│  1.2 MB / 1.9 MB                        │
└─────────────────────────────────────────┘
```

#### Processing State
```
┌─────────────────────────────────────────┐
│  🔄 Analyzing resume...                 │
│                                         │
│  Extracting work experience             │
│  Identifying STAR accomplishments       │
│                                         │
└─────────────────────────────────────────┘
```

#### Complete State
```
┌─────────────────────────────────────────┐
│  ✅ Resume parsed successfully!         │
│                                         │
│  📊 3 work experiences                  │
│  🎓 2 education entries                 │
│  💼 12 skills identified                │
│                                         │
│  [View Details]  [Upload New]          │
└─────────────────────────────────────────┘
```

### Behavior

| Action | Trigger | Response |
|--------|---------|----------|
| Drag Over | File dragged into zone | Border highlights (primary-500), background: primary-50 |
| Drop | File dropped | Validate → Start upload → Show progress |
| Click Zone | Click anywhere in drop zone | Open file picker dialog |
| Cancel Upload | Click ✕ during upload | Abort request, return to empty state |
| Invalid File Type | Drop .exe, .zip, etc. | Show error toast: "Please upload PDF, DOCX, or TXT" |
| File Too Large | Drop 15MB file (max 10MB) | Show error toast: "File must be under 10MB" |
| Parse Error | Server fails to extract data | Show error state with retry button |

### File Validation

```typescript
const validationRules = {
  maxFileSizeMB: 10,
  acceptedFormats: ['.pdf', '.docx', '.txt'],
  mimeTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
}
```

### Upload Flow

1. **File Selection** → Validate format and size
2. **Upload** → POST to `/api/resumes/upload` with multipart/form-data
3. **Server Processing** → Parse resume, extract STAR experiences
4. **Response** → Return parsed data + resume ID
5. **UI Update** → Show complete state, fire `onUploadComplete`

### Error Handling

| Error Type | User Message | Recovery Action |
|------------|--------------|-----------------|
| Network Error | "Upload failed. Check your connection." | [Retry] button |
| Parse Error | "Couldn't parse resume. Try a different format." | [Upload Different File] |
| Server Error | "Something went wrong. Please try again." | [Retry] + contact support link |
| Timeout | "Upload timed out. Try a smaller file." | Return to empty state |

### Accessibility

- **ARIA Role:** `region` with `aria-label="Resume upload area"`
- **Drag State:** Announce "Drop file to upload" to screen readers
- **Upload Progress:** `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- **Error Announcement:** `role="alert"` for error messages
- **Keyboard:** Tab to focus zone, Enter/Space to open file picker

### Responsive

- **Desktop (>768px):** Full-width drop zone, 200px min height
- **Mobile (<768px):** Smaller drop zone (150px height), hide drag text, show "Tap to upload"

---

## 12. ResumeExportList

### Purpose
Display and manage exported resume versions tailored to specific job applications.

### Props

```tsx
interface ResumeExportListProps {
  exports: ResumeExport[]
  onPreview: (exportId: string) => void
  onDownload: (exportId: string, format: ExportFormat) => void
  onDelete: (exportId: string) => void
  onCreateNew: () => void
  loading?: boolean
}

interface ResumeExport {
  id: string
  name: string
  createdAt: Date
  linkedApplicationId?: string
  linkedApplicationTitle?: string
  experienceIds: string[]
  format: ExportFormat
  fileSize: number
}

type ExportFormat = 'markdown' | 'pdf' | 'docx'
```

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  Resume Exports                      [+ Create New]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌────────────────────────────────────────────────┐    │
│  │  📄 Software Engineer - TechCo                 │    │
│  │  Linked to: TechCo Senior Developer           │    │
│  │  Created: Apr 15, 2026 • 3 experiences        │    │
│  │                                                │    │
│  │  [👁 Preview]  [⬇ Download]  [🗑 Delete]       │    │
│  └────────────────────────────────────────────────┘    │
│                                                         │
│  ┌────────────────────────────────────────────────┐    │
│  │  📄 Product Manager - StartupX                 │    │
│  │  Not linked to application                     │    │
│  │  Created: Apr 12, 2026 • 5 experiences        │    │
│  │                                                │    │
│  │  [👁 Preview]  [⬇ Download]  [🗑 Delete]       │    │
│  └────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Export Card States

| State | Visual | Available Actions |
|-------|--------|-------------------|
| Default | Border: neutral-200, Shadow: sm | Preview, Download, Delete |
| Hover | Border: primary-300, Shadow: md | All actions visible |
| Loading | Skeleton with shimmer | No actions |
| Error | Border: red-300, background: red-50 | Retry download, Delete |

### Behavior

| Action | Trigger | Response |
|--------|---------|----------|
| Preview | Click Preview button | Open modal with markdown preview |
| Download | Click Download | Show format picker (MD/PDF/DOCX) → Download file |
| Delete | Click Delete | Confirm dialog → DELETE `/api/resumes/exports/{id}` |
| Create New | Click + Create New button | Navigate to resume builder/editor |
| Link to Application | Drag export onto ApplicationCard | Link export to that application |

### Download Format Picker

When user clicks Download, show dropdown:

```
┌──────────────┐
│ ⬇ Download as│
├──────────────┤
│ ○ Markdown   │
│ ○ PDF        │
│ ○ Word (DOCX)│
└──────────────┘
```

### Empty State

```
┌─────────────────────────────────────────┐
│                                         │
│            📄                           │
│                                         │
│    No resume exports yet                │
│                                         │
│    Create a tailored resume for each    │
│    job application                      │
│                                         │
│    [+ Create Your First Export]        │
│                                         │
└─────────────────────────────────────────┘
```

### Preview Modal

Opens full-screen modal showing:
- **Left Panel:** Markdown editor (if editable)
- **Right Panel:** Live preview rendering
- **Header:** Export name, format selector, close button
- **Footer:** [Save Changes] [Download] [Cancel]

### Accessibility

- **ARIA Role:** `list` for export list, `listitem` for each card
- **Card Label:** "{exportName}, created {date}, {count} experiences"
- **Button Labels:** Clear action labels (not just icons)
- **Focus Management:** Focus trap in preview modal
- **Keyboard:** Tab through actions, Enter to activate, Escape to close modal

### Sorting & Filtering

| Filter | Options | Default |
|--------|---------|---------|
| Sort By | Recent, Oldest, Name (A-Z) | Recent |
| Linked | All, Linked to App, Standalone | All |
| Format | All, Markdown, PDF, DOCX | All |

### Responsive

- **Desktop (>1024px):** 2-column grid layout
- **Tablet (768-1024px):** Single column, cards full width
- **Mobile (<768px):** Compact cards, action buttons as icon-only

---

## 13. JobFitAnalysis

### Purpose
Analyze a job description against the user's catalog of skills, experiences, and achievements to provide an honest fit assessment with specific recommendations.

### Props

```tsx
interface JobFitAnalysisProps {
  onAnalysisComplete?: (result: FitAnalysisResult) => void
  linkedApplicationId?: string  // If analyzing for a specific application
  initialJobDescription?: string
}

interface FitAnalysisResult {
  id: string
  jobDescription: string
  parsedJD: ParsedJobDescription
  fitAssessment: FitAssessment
  recommendations: STARRecommendation[]
  overallFit: FitLevel
  analyzedAt: Date
}

interface ParsedJobDescription {
  roleTitle: string
  seniority?: string
  requiredStack: TechTag[]
  niceToHaveStack: TechTag[]
  domain?: string
  industry?: string
  teamScope?: string
  location?: string
  compSignals?: string
}

interface FitAssessment {
  strongMatches: CatalogMatch[]
  partialMatches: CatalogMatch[]
  gaps: Gap[]
}

interface CatalogMatch {
  type: 'skill' | 'experience' | 'achievement'
  catalogItemId: string
  title: string
  matchConfidence: number  // 0-100
  reasoning: string
}

interface Gap {
  requirement: string
  severity: 'critical' | 'moderate' | 'minor'
  suggestion?: string
}

interface STARRecommendation {
  experienceId: string
  relevanceScore: number  // 0-100
  reasoning: string
}

type FitLevel = 'strong' | 'moderate' | 'stretch' | 'low'
```

### Page Layout

The Job Fit Analysis is a full-page view with three distinct stages: Input, Analyzing, and Results.

#### Stage 1: Input Form

```
┌─────────────────────────────────────────────────────────┐
│  Job Fit Analysis                                       │
│                                                         │
│  Analyze how well a job posting matches your           │
│  experience, skills, and achievements.                  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │  Job Description                                  │ │
│  │  ─────────────────────────────────────────────────│ │
│  │  Paste the full job description here...          │ │
│  │                                                   │ │
│  │                                                   │ │
│  │  [Textarea - min 8 rows]                         │ │
│  │                                                   │ │
│  │                                                   │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ─── OR ───                                             │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │  Job Posting URL                                  │ │
│  │  https://example.com/careers/senior-dev          │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ⚠️ Analysis provides honest assessment including gaps │
│                                                         │
│  [Cancel]                        [Analyze Fit →]      │
└─────────────────────────────────────────────────────────┘
```

#### Stage 2: Analyzing State

```
┌─────────────────────────────────────────────────────────┐
│  Analyzing Job Fit...                                   │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │                                                   │ │
│  │           🔍                                       │ │
│  │                                                   │ │
│  │   Analyzing job requirements                      │ │
│  │                                                   │ │
│  │   ✓ Parsing job description                       │ │
│  │   ⏳ Extracting requirements                      │ │
│  │   ⏳ Comparing against your catalog               │ │
│  │   ⏳ Identifying matches and gaps                 │ │
│  │                                                   │ │
│  │   [Progress Bar: 40%]                             │ │
│  │                                                   │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

#### Stage 3: Results Display

```
┌─────────────────────────────────────────────────────────┐
│  Job Fit Analysis Results                               │
│                                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │ Overall Fit: MODERATE FIT                   │       │
│  │ ●●●○○  60% Match                            │       │
│  │                                             │       │
│  │ Senior Full Stack Engineer at TechCo        │       │
│  │ San Francisco, CA • $150k-200k              │       │
│  └─────────────────────────────────────────────┘       │
│                                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │ 📋 Parsed Requirements                      │       │
│  │ ───────────────────────────────────────────│       │
│  │ Role: Senior Full Stack Engineer            │       │
│  │ Seniority: Senior (5+ years)                │       │
│  │ Stack: React, Node.js, PostgreSQL, AWS      │       │
│  │ Nice-to-have: TypeScript, Docker            │       │
│  │ Domain: E-commerce                          │       │
│  └─────────────────────────────────────────────┘       │
│                                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │ ✅ Strong Matches (5)                       │       │
│  │ ───────────────────────────────────────────│       │
│  │ • React.js (Advanced) - 95% confidence      │       │
│  │   Used in 3 major projects                  │       │
│  │                                             │       │
│  │ • Node.js (Expert) - 98% confidence         │       │
│  │   5 years experience, led backend team      │       │
│  │                                             │       │
│  │ • PostgreSQL - 90% confidence               │       │
│  │   Database design & optimization experience │       │
│  │                                             │       │
│  │ [View All →]                                │       │
│  └─────────────────────────────────────────────┘       │
│                                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │ ⚠️ Partial Matches (2)                      │       │
│  │ ───────────────────────────────────────────│       │
│  │ • AWS (Basic) - 60% confidence              │       │
│  │   Limited cloud deployment experience       │       │
│  │   Recommendation: Highlight your EC2/S3 work│       │
│  │                                             │       │
│  │ • E-commerce Domain - 55% confidence        │       │
│  │   Adjacent experience in SaaS platforms     │       │
│  └─────────────────────────────────────────────┘       │
│                                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │ ❌ Gaps (2)                                 │       │
│  │ ───────────────────────────────────────────│       │
│  │ 🔴 TypeScript (Critical)                    │       │
│  │   Required skill not found in catalog       │       │
│  │   Suggestion: Take online course or add     │       │
│  │   TypeScript project to portfolio           │       │
│  │                                             │       │
│  │ 🟡 Docker (Moderate)                        │       │
│  │   Nice-to-have skill not demonstrated       │       │
│  │   Suggestion: Consider Docker tutorial      │       │
│  └─────────────────────────────────────────────┘       │
│                                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │ 💡 Recommended STAR Entries                 │       │
│  │ ───────────────────────────────────────────│       │
│  │ Highlight these achievements in your cover  │       │
│  │ letter and resume:                          │       │
│  │                                             │       │
│  │ 1. [95%] Led React migration (Q3 2024)      │       │
│  │    → Directly demonstrates frontend lead    │       │
│  │                                             │       │
│  │ 2. [90%] Scaled Node.js API (Q1 2025)       │       │
│  │    → Shows backend expertise & performance  │       │
│  │                                             │       │
│  │ 3. [85%] Database optimization (Q2 2024)    │       │
│  │    → Proves PostgreSQL proficiency          │       │
│  │                                             │       │
│  │ [View All Recommendations →]                │       │
│  └─────────────────────────────────────────────┘       │
│                                                         │
│  [← Back]  [Save Analysis]  [Generate Cover Letter]   │
└─────────────────────────────────────────────────────────┘
```

### Visual States

| State | Trigger | Visual Changes |
|-------|---------|----------------|
| Input | Page loads | Input form visible, Analyze button disabled until text entered |
| Validating | Text entered or URL pasted | Analyze button enabled, character count shown |
| Analyzing | Submit clicked | Loading animation, progress indicators, estimated time |
| Results | Analysis complete | Full results display with collapsible sections |
| Error | Analysis failed | Error message with retry button |
| Empty Catalog | Analysis attempted with empty catalog | Warning + link to resume upload |

### Fit Level Visual Indicators

```typescript
const fitLevelConfig = {
  strong: {
    label: 'Strong Fit',
    color: 'green-600',
    icon: '🎯',
    dots: '●●●●●',
    percentage: '80-100%'
  },
  moderate: {
    label: 'Moderate Fit',
    color: 'yellow-600',
    icon: '⚖️',
    dots: '●●●○○',
    percentage: '60-79%'
  },
  stretch: {
    label: 'Stretch Role',
    color: 'orange-600',
    icon: '📈',
    dots: '●●○○○',
    percentage: '40-59%'
  },
  low: {
    label: 'Low Fit',
    color: 'red-600',
    icon: '⚠️',
    dots: '●○○○○',
    percentage: '0-39%'
  }
}
```

### Gap Severity Styling

**Critical Gaps** (Required skills missing):
- Background: `red-50`
- Border: `red-500` (2px solid)
- Icon: 🔴
- Text: `red-900`

**Moderate Gaps** (Nice-to-have missing):
- Background: `orange-50`
- Border: `orange-400` (1px solid)
- Icon: 🟡
- Text: `orange-900`

**Minor Gaps** (Adjacent skills):
- Background: `yellow-50`
- Border: `yellow-300` (1px dashed)
- Icon: 🟡
- Text: `yellow-900`

### Input Validation

```typescript
const validationRules = {
  jobDescription: {
    minLength: 100,
    maxLength: 50000,
    message: 'Job description must be 100-50,000 characters'
  },
  jobUrl: {
    pattern: /^https?:\/\/.+/,
    message: 'Must be a valid URL'
  }
}
```

**Validation behavior**:
- Either text OR URL required (not both)
- If both provided, URL takes precedence
- Character counter shows below textarea
- URL validation on blur

### Behavior

| Action | Trigger | Response |
|--------|---------|----------|
| Paste text | User pastes into textarea | Enable Analyze button if > 100 chars |
| Paste URL | User pastes into URL field | Validate URL format, clear textarea |
| Toggle sections | Click section header | Expand/collapse section (accordion) |
| View match details | Click match item | Expand to show full reasoning |
| Save analysis | Click Save button | Save to application record, show toast |
| Generate cover letter | Click Generate button | Navigate to cover letter generator with prefilled context |
| Retry | Error state → click Retry | Return to input form with preserved text |

### Loading State Progression

```typescript
const analysisSteps = [
  { label: 'Parsing job description', duration: 2000 },
  { label: 'Extracting requirements', duration: 3000 },
  { label: 'Comparing against your catalog', duration: 4000 },
  { label: 'Identifying matches and gaps', duration: 3000 }
]
```

Total estimated time: 10-15 seconds

### Empty States

**No Catalog Data**:
```
┌─────────────────────────────────────────┐
│                                         │
│            📋                           │
│                                         │
│    No catalog data yet                  │
│                                         │
│    Upload a resume to build your        │
│    catalog before analyzing job fit     │
│                                         │
│    [Upload Resume]                      │
│                                         │
└─────────────────────────────────────────┘
```

**No Matches**:
```
┌─────────────────────────────────────────┐
│  ❌ No Strong Matches                   │
│                                         │
│  This role requires skills not yet in   │
│  your catalog. Consider:                │
│  • Adding relevant projects             │
│  • Updating your resume                 │
│  • Exploring adjacent roles             │
└─────────────────────────────────────────┘
```

### Accessibility

- **ARIA Landmarks:** `role="main"` for results, `role="form"` for input
- **Progress Announcement:** Screen reader announces each analysis step
- **Focus Management:** Focus moves to results header when analysis completes
- **Keyboard Navigation:**
  - Tab through sections
  - Enter/Space to expand/collapse
  - Arrow keys to navigate within lists
- **ARIA Labels:**
  - Overall fit indicator: "Overall fit level: Moderate, 60% match"
  - Gap severity: "Critical gap: TypeScript required but not found"
- **Color Independence:** Icons and text labels supplement all color coding

### Responsive Behavior

- **Desktop (>1024px):**
  - Full 3-column results layout
  - Side-by-side comparison sections
  
- **Tablet (768-1024px):**
  - 2-column layout, stacked sections
  - Collapsible sections default to collapsed
  
- **Mobile (<768px):**
  - Single column, full width
  - Input textarea 6 rows (vs 8 on desktop)
  - Sticky header with fit level
  - Sections collapsed by default

### Error Handling

| Error Type | User Message | Recovery Action |
|------------|--------------|-----------------|
| Network Error | "Unable to analyze. Check your connection." | [Retry] preserves input |
| Empty Input | "Please enter a job description or URL." | Disable submit until valid |
| URL Fetch Failed | "Couldn't load job posting from URL. Try pasting text." | Switch to textarea mode |
| Analysis Timeout | "Analysis took too long. Try a shorter description." | [Retry] with shortened text |
| API Error | "Analysis failed. Our team has been notified." | [Contact Support] link |

### Integration Points

- **From:** Application detail page ("Analyze Fit" button)
- **From:** Dashboard ("New Analysis" action)
- **To:** Cover letter generator (pre-filled with fit data)
- **To:** Application update (link analysis to application)

### Performance Considerations

- **Debounce:** URL validation debounced 500ms
- **Lazy Load:** Recommendation details loaded on expand
- **Cache:** Analysis results cached for 24 hours (same JD)
- **Streaming:** Display parsed JD immediately, then matches/gaps as they arrive

---

## 14. CoverLetterGenerator

### Purpose
AI-powered cover letter generation wizard that guides users through creating personalized cover letters using their catalog STAR entries and job fit analysis results.

### Props

```tsx
interface CoverLetterGeneratorProps {
  fitAnalysisId?: string         // Pre-load from existing fit analysis
  applicationId?: string          // Link to specific application
  onComplete?: (result: CoverLetterResult) => void
  onCancel?: () => void
}

interface CoverLetterResult {
  id: string
  content: string                 // Markdown format
  variant: CoverLetterVariant
  selectedSTARs: string[]         // STAR entry IDs
  generatedAt: Date
  applicationId?: string
}

interface CoverLetterVariant {
  tone: 'professional' | 'conversational' | 'enthusiastic'
  length: 'concise' | 'standard' | 'detailed'
  emphasis: 'technical' | 'leadership' | 'balanced'
}
```

### Wizard Flow (4 Steps)

#### Step 1: Confirm Target

```
┌─────────────────────────────────────────────────────────┐
│  Generate Cover Letter                        [Step 1/4]│
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Target Position                                   │ │
│  │                                                   │ │
│  │ Company Name *                                    │ │
│  │ ┌─────────────────────────────────────────────┐   │ │
│  │ │ TechCorp Inc.                               │   │ │
│  │ └─────────────────────────────────────────────┘   │ │
│  │                                                   │ │
│  │ Job Title *                                       │ │
│  │ ┌─────────────────────────────────────────────┐   │ │
│  │ │ Senior Full Stack Engineer                  │   │ │
│  │ └─────────────────────────────────────────────┘   │ │
│  │                                                   │ │
│  │ Hiring Contact (Optional)                         │ │
│  │ ┌─────────────────────────────────────────────┐   │ │
│  │ │ Jane Smith, Engineering Manager             │   │ │
│  │ └─────────────────────────────────────────────┘   │ │
│  │                                                   │ │
│  │ ☑️ Use job fit analysis results                  │ │
│  │   [Moderate Fit · 60% match]                      │ │
│  │                                                   │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  [Cancel]                               [Next: Select  │
│                                          Experiences →]│
└─────────────────────────────────────────────────────────┘
```

**Validation:**
- Company name: required, 2-100 chars
- Job title: required, 2-100 chars
- Hiring contact: optional, 2-100 chars
- If fit analysis selected: loads recommended STARs for Step 2

#### Step 2: Select STAR Entries

```
┌─────────────────────────────────────────────────────────┐
│  Generate Cover Letter                        [Step 2/4]│
│                                                         │
│  Select experiences to highlight (3-5 recommended)      │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 🎯 Recommended (from fit analysis)                │ │
│  │                                                   │ │
│  │ ☑️ [95%] Led React migration for client portal   │ │
│  │    Q3 2024 • Frontend, Technical Leadership       │ │
│  │    → Directly demonstrates frontend expertise     │ │
│  │                                                   │ │
│  │ ☑️ [90%] Scaled Node.js API to 10k req/sec       │ │
│  │    Q1 2025 • Backend, Performance                 │ │
│  │    → Proves backend proficiency & scaling skills  │ │
│  │                                                   │ │
│  │ ☐ [85%] PostgreSQL query optimization            │ │
│  │    Q2 2024 • Database, Performance                │ │
│  │    → Shows database expertise                     │ │
│  │                                                   │ │
│  │ [Show 2 more recommended →]                       │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 📋 All Catalog Entries                            │ │
│  │                                                   │ │
│  │ ☐ Built CI/CD pipeline (Q4 2024)                 │ │
│  │ ☐ Mentored 3 junior developers (Q1 2024)         │ │
│  │ ☐ Implemented OAuth 2.0 (Q3 2023)                │ │
│  │                                                   │ │
│  │ [Load More...]                                    │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ⚠️ Select 3-5 entries for best results               │
│  Currently selected: 2                                  │
│                                                         │
│  [← Back]                       [Next: Choose Style →] │
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Recommended entries at top (from fit analysis) with relevance scores
- All catalog entries below, searchable/filterable
- Visual indication of selected count (3-5 sweet spot)
- Entry preview shows: title, timeframe, tags, relevance reasoning

#### Step 3: Choose Tone & Length

```
┌─────────────────────────────────────────────────────────┐
│  Generate Cover Letter                        [Step 3/4]│
│                                                         │
│  Choose tone and length                                 │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Tone                                              │ │
│  │                                                   │ │
│  │ ● Professional      (Recommended for this role)   │ │
│  │   Formal, direct, results-focused                 │ │
│  │                                                   │ │
│  │ ○ Conversational                                  │ │
│  │   Approachable, clear, warm but professional      │ │
│  │                                                   │ │
│  │ ○ Enthusiastic                                    │ │
│  │   Energetic, passionate, forward-looking          │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Length                                            │ │
│  │                                                   │ │
│  │ ○ Concise (250-350 words)                         │ │
│  │   Quick read, highlights only                     │ │
│  │                                                   │ │
│  │ ● Standard (400-550 words)    (Recommended)       │ │
│  │   Balanced depth and brevity                      │ │
│  │                                                   │ │
│  │ ○ Detailed (600-800 words)                        │ │
│  │   Comprehensive, includes context                 │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Emphasis                                          │ │
│  │                                                   │ │
│  │ ● Balanced          (Recommended)                 │ │
│  │   Mix of technical and leadership                 │ │
│  │                                                   │ │
│  │ ○ Technical                                       │ │
│  │   Focus on stack, architecture, problem-solving   │ │
│  │                                                   │ │
│  │ ○ Leadership                                      │ │
│  │   Emphasize team impact, mentoring, strategy      │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  [← Back]                          [Generate Letter →] │
└─────────────────────────────────────────────────────────┘
```

**Defaults:**
- Tone: `professional`
- Length: `standard`
- Emphasis: `balanced`

**Smart Recommendations:**
- Tone suggested based on company type (startup vs enterprise)
- Emphasis suggested based on selected STARs and job requirements

#### Step 4: Review & Edit

```
┌─────────────────────────────────────────────────────────┐
│  Generate Cover Letter                        [Step 4/4]│
│                                                         │
│  ┌─────────────────┬─────────────────────────────────┐ │
│  │ 📝 Editor       │ 👁️ Preview                     │ │
│  │ ──────────────  │ ──────────────────────────────  │ │
│  │                 │                                 │ │
│  │ Dear Jane Smith,│ Dear Jane Smith,                │ │
│  │                 │                                 │ │
│  │ I am writing to │ I am writing to express my      │ │
│  │ express my      │ interest in the Senior Full     │ │
│  │ interest in the │ Stack Engineer position at      │ │
│  │ Senior Full     │ TechCorp Inc.                   │ │
│  │ Stack Engineer  │                                 │ │
│  │ position at     │ With over 5 years of experience │ │
│  │ TechCorp Inc.   │ in full-stack development, I    │ │
│  │                 │ have led...                     │ │
│  │ [Textarea with  │ [Formatted preview with proper  │ │
│  │  markdown]      │  typography and spacing]        │ │
│  │                 │                                 │ │
│  │                 │                                 │ │
│  │ ✅ 487 words    │ ───────────────────────────────│ │
│  │ ✅ Professional │ [Copy Text] [Download .docx]    │ │
│  │ ✅ No gaps      │                                 │ │
│  │ ⚠️ Contains AI  │                                 │ │
│  │    tool mention │                                 │ │
│  │    (verified)   │                                 │ │
│  └─────────────────┴─────────────────────────────────┘ │
│                                                         │
│  [← Back]     [Regenerate]     [Save & Close]          │
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Split-pane editor/preview
- Live markdown rendering
- Validation checks:
  - Word count in target range
  - No fabricated metrics (AI-scanned)
  - AI tool attributions are specific (Claude vs generic AI)
- Export options: Copy to clipboard, Download .docx
- Regenerate button (keeps same settings, new generation)

### Visual States

| State | Trigger | Visual Changes |
|-------|---------|----------------|
| Step 1 | Wizard loads | Target form visible, Next disabled until required fields filled |
| Step 2 | Next from Step 1 | STAR picker visible, recommended entries pre-selected if fit analysis exists |
| Step 3 | Next from Step 2 | Tone/length selector, smart defaults based on role |
| Generating | Generate clicked | Loading overlay, progress indicator (10-15s) |
| Step 4 | Generation complete | Split editor/preview, validation checks run |
| Regenerating | Regenerate clicked | Editor disabled, progress indicator, preserves edits option |
| Saving | Save clicked | Toast notification, adds to application if linked |
| Error | Generation fails | Error banner with retry button |

### Wizard Navigation

```typescript
interface WizardStep {
  id: number
  title: string
  isValid: boolean
  isComplete: boolean
}

const steps = [
  { id: 1, title: 'Confirm Target', isValid: false, isComplete: false },
  { id: 2, title: 'Select Experiences', isValid: false, isComplete: false },
  { id: 3, title: 'Choose Style', isValid: false, isComplete: false },
  { id: 4, title: 'Review & Edit', isValid: false, isComplete: false }
]
```

**Navigation Rules:**
- Can go back to any previous step
- Can only advance if current step is valid
- Progress indicator shows current step and completion status
- Keyboard: Ctrl/Cmd + Enter to advance to next step (when valid)

### Validation Rules

```typescript
const validationRules = {
  step1: {
    companyName: { required: true, minLength: 2, maxLength: 100 },
    jobTitle: { required: true, minLength: 2, maxLength: 100 },
    hiringContact: { required: false, maxLength: 100 }
  },
  step2: {
    selectedSTARs: { 
      minCount: 1, 
      maxCount: 8,
      recommended: { min: 3, max: 5 }
    }
  },
  step3: {
    tone: { required: true, enum: ['professional', 'conversational', 'enthusiastic'] },
    length: { required: true, enum: ['concise', 'standard', 'detailed'] },
    emphasis: { required: true, enum: ['technical', 'leadership', 'balanced'] }
  }
}
```

### Content Validation (Step 4)

AI-powered checks on generated content:

| Check | Pass Criteria | Failure Action |
|-------|---------------|----------------|
| Word count | Within ±10% of target length | Warning only, allow save |
| Fabricated metrics | No unsourced numbers/percentages | Error, block save |
| AI attribution | Specific tool names (Claude, GPT-4) not generic "AI" | Warning, suggest edit |
| Hallucinated projects | All projects exist in catalog | Error, block save |
| Gap honesty | Acknowledged gaps from fit analysis mentioned if critical | Warning only |

### Accessibility

- **ARIA Landmarks:** `role="region"` with `aria-label="Step {n} of 4: {title}"`
- **Progress Announcement:** Screen reader announces step changes
- **Focus Management:** 
  - Focus moves to step heading on step change
  - Focus moves to error message if validation fails
- **Keyboard Navigation:**
  - Tab through form fields
  - Ctrl/Cmd + Left/Right to navigate steps
  - Ctrl/Cmd + Enter to advance
  - Escape to cancel wizard
- **ARIA Labels:**
  - Step indicator: "Step 2 of 4: Select Experiences, currently active"
  - Validation messages: "Error: Company name is required"

### Responsive Behavior

- **Desktop (>1024px):**
  - Full wizard layout
  - Split-pane editor/preview in Step 4
  
- **Tablet (768-1024px):**
  - Single column wizard
  - Tabbed editor/preview in Step 4
  
- **Mobile (<768px):**
  - Compact wizard steps
  - Stacked editor then preview in Step 4
  - Bottom sheet for tone/length selection

### Integration Points

- **From:** Job Fit Analysis results page ("Generate Cover Letter" button)
- **From:** Application detail page ("New Cover Letter" action)
- **To:** Cover letter library (saves generated letter)
- **To:** Application record (links letter to application)

### Error Handling

| Error Type | User Message | Recovery Action |
|------------|--------------|-----------------|
| Network Error | "Unable to generate. Check your connection." | [Retry] preserves all inputs |
| Generation Timeout | "Generation took too long. Try fewer experiences." | [Edit Selection] returns to Step 2 |
| Empty Catalog | "No experiences found. Upload a resume first." | [Upload Resume] link |
| Validation Failed | "Content contains fabricated metrics. Please regenerate." | [Regenerate] or [Edit Manually] |
| API Error | "Generation failed. Our team has been notified." | [Contact Support] link |

---

## 15. CoverLetterPreview

### Purpose
Renders cover letter content with proper typography and formatting, provides export actions.

### Props

```tsx
interface CoverLetterPreviewProps {
  content: string                 // Markdown format
  variant?: CoverLetterVariant
  wordCount?: number
  showExportActions?: boolean
  onCopy?: () => void
  onDownload?: (format: 'docx' | 'pdf') => void
}
```

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  Cover Letter Preview                [Copy] [↓ .docx]   │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │                                                   │ │
│  │  Dear Jane Smith,                                 │ │
│  │                                                   │ │
│  │  I am writing to express my strong interest in    │ │
│  │  the Senior Full Stack Engineer position at       │ │
│  │  TechCorp Inc. With over five years of experience │ │
│  │  building scalable web applications using React,  │ │
│  │  Node.js, and PostgreSQL, I am confident I can    │ │
│  │  contribute immediately to your team.             │ │
│  │                                                   │ │
│  │  In my current role at StartupCo, I led the      │ │
│  │  migration of our client portal from Angular to   │ │
│  │  React, reducing bundle size by 40% and improving │ │
│  │  load times by 2 seconds...                       │ │
│  │                                                   │ │
│  │  [More paragraphs...]                             │ │
│  │                                                   │ │
│  │  Sincerely,                                       │ │
│  │  [Your Name]                                      │ │
│  │                                                   │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  📊 487 words • Professional tone • Standard length     │
└─────────────────────────────────────────────────────────┘
```

### Typography

```css
.cover-letter-preview {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 11pt;
  line-height: 1.6;
  color: #1a1a1a;
  max-width: 8.5in;
  padding: 1in;
  background: white;
}

.cover-letter-preview p {
  margin-bottom: 1em;
  text-align: left;
}

.cover-letter-preview h1, h2, h3 {
  font-family: inherit;
  font-weight: 600;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
```

### Export Formats

**Copy to Clipboard:**
- Plain text with preserved line breaks
- Success toast: "Cover letter copied to clipboard"

**Download .docx:**
- Uses `docx` library
- Page setup: Letter (8.5" x 11"), 1" margins
- Font: Times New Roman, 11pt
- Filename: `CoverLetter_{CompanyName}_{Date}.docx`

**Download .pdf (optional):**
- Same typography as .docx
- Filename: `CoverLetter_{CompanyName}_{Date}.pdf`

### Visual States

| State | Trigger | Visual Changes |
|-------|---------|----------------|
| Default | Content loaded | Rendered markdown, export buttons enabled |
| Copying | Copy clicked | Button shows "Copied!" for 2s, then reverts |
| Downloading | Download clicked | Loading spinner on button, disabled during generation |
| Empty | No content | Placeholder "No content to preview" |
| Error | Render failed | Error message with retry |

### Behavior

- **Markdown Rendering:** 
  - Supports: paragraphs, headings, bold, italic, lists
  - Does NOT support: images, code blocks, tables (warning if detected)
- **Print Styles:** 
  - Print button triggers browser print dialog
  - CSS print media query hides export buttons
- **Auto-Save:**
  - Edits auto-save every 5 seconds
  - Visual indicator "Saving..." / "Saved"

### Accessibility

- **Semantic HTML:** Proper heading hierarchy (h1 for title, h2 for sections)
- **ARIA Label:** "Cover letter preview for {jobTitle} at {company}"
- **Focus Management:** Focus on preview when content updates
- **Keyboard Actions:**
  - Ctrl/Cmd + C to copy
  - Ctrl/Cmd + P to print
  - Ctrl/Cmd + S to download

### Responsive Behavior

- **Desktop (>1024px):**
  - Full 8.5" page width simulation
  - Side-by-side with editor if in generator
  
- **Tablet (768-1024px):**
  - Reduced padding, full width
  - Tabbed view if with editor
  
- **Mobile (<768px):**
  - Single column, minimal padding
  - Stacked below editor
  - Export buttons as dropdown menu

---

## 16. OutreachComposer

### Purpose
Short-form message composer for LinkedIn InMail, email subject/body, or other outreach platforms. Part of UC-4b.

### Props

```tsx
interface OutreachComposerProps {
  platform: 'linkedin' | 'email' | 'twitter'
  applicationId?: string
  fitAnalysisId?: string
  prefillContext?: {
    company: string
    jobTitle: string
    hiringManager?: string
  }
  onComplete?: (result: OutreachMessage) => void
}

interface OutreachMessage {
  platform: 'linkedin' | 'email' | 'twitter'
  subject?: string               // Email only
  body: string
  characterCount: number
  generatedAt: Date
}
```

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  Compose Outreach Message                               │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Platform                                          │ │
│  │ ● LinkedIn InMail    ○ Email    ○ Twitter DM      │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Context                                           │ │
│  │                                                   │ │
│  │ Company: TechCorp Inc.                            │ │
│  │ Role: Senior Full Stack Engineer                  │ │
│  │ Contact: Jane Smith, Engineering Manager          │ │
│  │                                                   │ │
│  │ ☑️ Use fit analysis highlights                   │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Generated Message                                 │ │
│  │ ─────────────────────────────────────────────────│ │
│  │                                                   │ │
│  │ Hi Jane,                                          │ │
│  │                                                   │ │
│  │ I saw the Senior Full Stack Engineer opening at  │ │
│  │ TechCorp and wanted to reach out directly. I've  │ │
│  │ been leading React/Node.js teams for 5 years and │ │
│  │ recently scaled an API to 10k req/sec — work that│ │
│  │ aligns closely with this role's needs.            │ │
│  │                                                   │ │
│  │ Would you be open to a quick chat about the role?│ │
│  │                                                   │ │
│  │ Best,                                             │ │
│  │ [Your Name]                                       │ │
│  │                                                   │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  📊 147 characters (LinkedIn: 300 max recommended)      │
│  ✅ Concise   ✅ Specific   ✅ Clear CTA                │
│                                                         │
│  [Regenerate]    [Edit]    [Copy]    [Send via App]    │
└─────────────────────────────────────────────────────────┘
```

### Platform Constraints

```typescript
const platformLimits = {
  linkedin: {
    maxChars: 1900,           // Hard limit
    recommendedMax: 300,      // Best practice for InMail
    hasSubject: false
  },
  email: {
    maxChars: null,           // No hard limit
    recommendedMax: 500,      // Body only
    hasSubject: true,
    subjectMaxChars: 78       // Email subject best practice
  },
  twitter: {
    maxChars: 10000,          // DM limit
    recommendedMax: 280,      // Short, tweet-like
    hasSubject: false
  }
}
```

### Character Counter

```
LinkedIn: 147 / 300 recommended (1900 max)
           ████████░░░░░░░░░░░░ 49%
           ✅ Good length

Email: 487 characters
       ⚠️ Consider shortening for mobile readers

Twitter: 142 / 280
         ████████████░░░░░░░░ 51%
         ✅ Perfect
```

**Color Coding:**
- Green: Within recommended range
- Yellow: Exceeds recommended but under max
- Red: Exceeds maximum (send disabled)

### Email-Specific Fields

```
┌─────────────────────────────────────────────────────────┐
│  Platform: ● Email                                      │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Subject Line                                      │ │
│  │ ┌─────────────────────────────────────────────┐   │ │
│  │ │ Senior Full Stack Engineer opportunity      │   │ │
│  │ └─────────────────────────────────────────────┘   │ │
│  │ 38 / 78 characters  ✅                            │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Body                                              │ │
│  │ [Message content...]                              │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Generation Strategy

**LinkedIn InMail:**
- Focus: One standout achievement + clear ask
- Tone: Professional but personable
- Length: 150-250 words (recommended)
- Structure: Hook → Relevance → CTA

**Email:**
- Subject: Specific, role-focused, under 78 chars
- Focus: 2-3 key qualifications + clear next step
- Tone: Professional, respectful of recipient's time
- Length: 200-400 words
- Structure: Greeting → Context → Value → CTA → Signature

**Twitter DM:**
- Focus: Ultra-concise, single selling point
- Tone: Casual but professional
- Length: 100-200 characters
- Structure: Hook → Link to portfolio/LinkedIn

### Visual States

| State | Trigger | Visual Changes |
|-------|---------|----------------|
| Platform Selected | User clicks platform | Show platform-specific UI and limits |
| Generating | Generate clicked | Loading spinner, "Generating message..." |
| Generated | Generation complete | Message appears, character count shown, actions enabled |
| Editing | Edit clicked | Message becomes editable textarea |
| Copied | Copy clicked | "Copied!" toast, button shows checkmark for 2s |
| Over Limit | Character count exceeds max | Red counter, send disabled, "Reduce length" warning |
| Regenerating | Regenerate clicked | Preserves platform/context, new message |

### Validation Rules

```typescript
const validationRules = {
  context: {
    company: { required: true, minLength: 2 },
    jobTitle: { required: true, minLength: 2 },
    contact: { required: false }
  },
  message: {
    minLength: 50,
    maxLength: (platform) => platformLimits[platform].maxChars
  },
  email: {
    subject: { required: true, minLength: 5, maxLength: 78 },
    body: { required: true, minLength: 50 }
  }
}
```

### Quality Checks

AI-powered validation on generated messages:

| Check | Pass Criteria | Visual Indicator |
|-------|---------------|------------------|
| Specificity | Mentions 1+ concrete achievement | ✅ "Specific" |
| Brevity | Within recommended length | ✅ "Concise" |
| CTA | Clear call-to-action present | ✅ "Clear CTA" |
| Personalization | Uses contact name (if provided) | ✅ "Personalized" |
| No fluff | Avoids clichés ("passionate", "rockstar", etc.) | ✅ "Direct" |

### Behavior

| Action | Trigger | Response |
|--------|---------|----------|
| Switch platform | Click platform radio | Reset message, adjust UI for new platform |
| Generate | Click Generate button | Call AI service, show loading state, display result |
| Edit | Click Edit button | Convert to editable textarea, preserve formatting |
| Copy | Click Copy button | Copy to clipboard, show toast confirmation |
| Regenerate | Click Regenerate | Keep context, generate new message with different framing |
| Send via App | Click Send button | Open LinkedIn/email client with pre-filled message |

### Send via App Integration

**LinkedIn:**
- Copies message to clipboard
- Opens LinkedIn URL: `https://www.linkedin.com/messaging/compose`
- Toast: "Message copied. Paste into LinkedIn."

**Email:**
- Mailto link with subject and body pre-filled
- URL-encodes subject and body
- Example: `mailto:jane@techcorp.com?subject=...&body=...`

**Twitter:**
- Copies message to clipboard
- Opens Twitter DM URL if contact handle known
- Toast: "Message copied. Paste into Twitter DM."

### Accessibility

- **ARIA Labels:** 
  - Platform selector: "Choose outreach platform"
  - Character counter: "147 of 300 recommended characters"
- **Focus Management:** Focus moves to generated message after generation
- **Keyboard Actions:**
  - Ctrl/Cmd + Enter to generate
  - Ctrl/Cmd + C to copy
  - Tab through platform options
- **Screen Reader Announcements:**
  - "Message generated successfully"
  - "Character count: 147 of 300 recommended"

### Responsive Behavior

- **Desktop (>1024px):**
  - Full layout with platform selector horizontal
  - Side-by-side context and message
  
- **Tablet (768-1024px):**
  - Stacked layout
  - Platform selector as tabs
  
- **Mobile (<768px):**
  - Vertical stack
  - Platform selector as dropdown
  - Bottom action bar with Copy/Send buttons

### Error Handling

| Error Type | User Message | Recovery Action |
|------------|--------------|-----------------|
| Network Error | "Unable to generate. Check your connection." | [Retry] |
| Empty Context | "Please fill in company and role information." | Focus on first empty field |
| Generation Failed | "Generation failed. Try again or write manually." | [Retry] or [Write Manually] |
| Over Limit | "Message is {n} characters over the limit. Please shorten." | Highlight excess text |

### Integration Points

- **From:** Application detail page ("Reach Out" button)
- **From:** Cover letter generator ("Send LinkedIn message instead")
- **To:** Application timeline (saves sent message log)

---

## 17. StarEntryPicker

### Purpose
Multi-select component for choosing STAR entries (Situation, Task, Action, Result achievements) with relevance scoring and filtering.

### Props

```tsx
interface StarEntryPickerProps {
  entries: STAREntry[]
  recommendedIds?: string[]      // From fit analysis
  selectedIds?: string[]
  minSelection?: number
  maxSelection?: number
  showRelevanceScores?: boolean
  onSelectionChange: (selectedIds: string[]) => void
  onEntryPreview?: (entryId: string) => void
}

interface STAREntry {
  id: string
  title: string
  situation: string
  task: string
  action: string
  result: string
  tags: string[]
  timeframe: string              // e.g., "Q3 2024"
  relevanceScore?: number        // 0-100, from fit analysis
  relevanceReasoning?: string
}
```

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  Select STAR Entries                                    │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ [Search entries...]              [Filter: All ▾]  │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ─── Recommended (from fit analysis) ─────────────────  │
│                                                         │
│  ☑️ [95%] Led React migration for client portal        │
│     Q3 2024 • Frontend, Technical Leadership            │
│     → Directly demonstrates frontend expertise          │
│     [Preview]                                           │
│                                                         │
│  ☑️ [90%] Scaled Node.js API to 10k req/sec            │
│     Q1 2025 • Backend, Performance                      │
│     → Proves backend proficiency & scaling skills       │
│     [Preview]                                           │
│                                                         │
│  ☐ [85%] PostgreSQL query optimization                 │
│     Q2 2024 • Database, Performance                     │
│     → Shows database expertise                          │
│     [Preview]                                           │
│                                                         │
│  [Show 2 more recommended →]                            │
│                                                         │
│  ─── All Entries ──────────────────────────────────────│
│                                                         │
│  ☐ Built CI/CD pipeline with GitHub Actions            │
│     Q4 2024 • DevOps, Automation                        │
│     [Preview]                                           │
│                                                         │
│  ☐ Mentored 3 junior developers to senior level        │
│     Q1 2024 • Leadership, Mentoring                     │
│     [Preview]                                           │
│                                                         │
│  ☐ Implemented OAuth 2.0 authentication                │
│     Q3 2023 • Security, Backend                         │
│     [Preview]                                           │
│                                                         │
│  [Load More...]                                         │
│                                                         │
│  ──────────────────────────────────────────────────────│
│  Selected: 2 of 3-5 recommended                         │
└─────────────────────────────────────────────────────────┘
```

### Entry Card

```
┌─────────────────────────────────────────────────────────┐
│ ☑️ [95%] Led React migration for client portal         │
│    Q3 2024 • Frontend, Technical Leadership             │
│    → Directly demonstrates frontend expertise           │
│    [Preview]                                            │
└─────────────────────────────────────────────────────────┘
   ↓ Click Preview
┌─────────────────────────────────────────────────────────┐
│ ☑️ [95%] Led React migration for client portal         │
│    Q3 2024 • Frontend, Technical Leadership             │
│    → Directly demonstrates frontend expertise           │
│                                                         │
│    ┌──────────────────────────────────────────────┐    │
│    │ Situation: Legacy Angular app slow, hard to  │    │
│    │ maintain. Team needed modern framework.      │    │
│    │                                              │    │
│    │ Task: Lead migration to React without       │    │
│    │ disrupting users or development velocity.    │    │
│    │                                              │    │
│    │ Action: Created incremental migration plan, │    │
│    │ set up React/Angular bridge, trained team,  │    │
│    │ migrated module-by-module over 3 months.     │    │
│    │                                              │    │
│    │ Result: 40% bundle size reduction, 2s faster│    │
│    │ load time, zero downtime, team fully trained│    │
│    │ on React + modern tooling.                   │    │
│    └──────────────────────────────────────────────┘    │
│                                                         │
│    [Collapse]                                           │
└─────────────────────────────────────────────────────────┘
```

### Relevance Score Badge

```typescript
const relevanceConfig = {
  excellent: { range: [90, 100], color: 'green-600', label: 'Excellent match' },
  great: { range: [80, 89], color: 'green-500', label: 'Great match' },
  good: { range: [70, 79], color: 'yellow-600', label: 'Good match' },
  fair: { range: [60, 69], color: 'yellow-500', label: 'Fair match' },
  low: { range: [0, 59], color: 'gray-500', label: 'Low relevance' }
}
```

Visual representation:
- `[95%]` in green = Excellent match
- `[82%]` in green = Great match
- `[74%]` in yellow = Good match
- `[45%]` in gray = Low relevance

### Search & Filter

**Search:**
- Searches title, tags, situation, task, action, result
- Debounced 300ms
- Highlights matching text

**Filter Options:**
- All Entries
- Recommended Only
- Selected Only
- By Tag (Frontend, Backend, Leadership, etc.)
- By Timeframe (Last 6 months, Last year, All time)

```
┌───────────────────────────────────┐
│ Filter                            │
│ ─────────────────────────────────│
│ ● All Entries                     │
│ ○ Recommended Only                │
│ ○ Selected Only                   │
│ ─────────────────────────────────│
│ Tags:                             │
│ ☑️ Frontend                       │
│ ☑️ Backend                        │
│ ☐ Leadership                      │
│ ☐ DevOps                          │
│ ☐ Performance                     │
│ ─────────────────────────────────│
│ Timeframe:                        │
│ ● All Time                        │
│ ○ Last Year                       │
│ ○ Last 6 Months                   │
│ ─────────────────────────────────│
│ [Apply Filter]                    │
└───────────────────────────────────┘
```

### Selection Counter

```
Selected: 2 of 3-5 recommended
          ░░░░░░░░░░░░░░░░ 40%
          ⚠️ Select at least 1 more

Selected: 4 of 3-5 recommended
          ████████████████ 80%
          ✅ Good selection

Selected: 7 of 3-5 recommended
          ████████████████████ 140%
          ⚠️ Too many may dilute message
```

**Color Coding:**
- Red: Below minimum
- Yellow: Below recommended minimum
- Green: In recommended range (3-5)
- Yellow: Above recommended maximum
- Red: Above absolute maximum (8+)

### Visual States

| State | Trigger | Visual Changes |
|-------|---------|----------------|
| Default | Component loads | Recommended entries at top, all entries below |
| Empty | No entries | "No STAR entries yet. Upload a resume to populate." |
| Searching | User types in search | Filter entries in real-time, highlight matches |
| Filtered | Filter applied | Show only matching entries, count indicator |
| Selected | Entry checkbox clicked | Checkmark, update counter, re-sort if needed |
| Preview Expanded | Preview clicked | Expand to show full STAR details |
| Max Selected | Selection count hits max | Disable unchecked entries, show warning |

### Sorting

Default sort order:
1. Recommended entries first (by relevance score descending)
2. Selected entries next (chronological, newest first)
3. All other entries (chronological, newest first)

Optional sorts (dropdown):
- Relevance (high to low)
- Newest first
- Oldest first
- Alphabetical (by title)

### Behavior

| Action | Trigger | Response |
|--------|---------|----------|
| Select entry | Click checkbox | Add to selected list, update counter |
| Deselect entry | Click checked checkbox | Remove from selected list, update counter |
| Preview entry | Click Preview button | Expand to show full STAR, collapse button appears |
| Collapse entry | Click Collapse button | Return to compact card view |
| Search | Type in search field | Filter entries, highlight matches |
| Apply filter | Select filter options | Show only matching entries |
| Load more | Click Load More | Fetch and display next 10 entries |

### Accessibility

- **ARIA Labels:**
  - Checkbox: "Select {entry title}"
  - Counter: "2 entries selected out of recommended 3 to 5"
- **Focus Management:** 
  - Focus on first entry when list loads
  - Focus moves to preview when expanded
- **Keyboard Navigation:**
  - Space to toggle checkbox
  - Enter to preview/collapse
  - Arrow keys to navigate entries
  - Ctrl/Cmd + A to select all recommended
- **Screen Reader Announcements:**
  - "Entry selected, 3 of 5"
  - "Entry deselected, 2 of 5"

### Responsive Behavior

- **Desktop (>1024px):**
  - 2-column grid for entry cards
  - Side filter panel
  
- **Tablet (768-1024px):**
  - Single column cards
  - Collapsible filter panel
  
- **Mobile (<768px):**
  - Compact cards
  - Filter as bottom sheet
  - Sticky selection counter at bottom

### Empty States

**No Entries:**
```
┌─────────────────────────────────────────┐
│                                         │
│            📋                           │
│                                         │
│    No STAR entries yet                  │
│                                         │
│    Upload a resume to populate your     │
│    catalog with achievements            │
│                                         │
│    [Upload Resume]                      │
│                                         │
└─────────────────────────────────────────┘
```

**No Search Results:**
```
┌─────────────────────────────────────────┐
│    No entries match "kubernetes"        │
│                                         │
│    Try different search terms or        │
│    browse all entries                   │
│                                         │
│    [Clear Search]                       │
└─────────────────────────────────────────┘
```

### Performance Considerations

- **Virtualization:** Use virtual scrolling for 50+ entries
- **Lazy Load:** Load entries in batches of 10-20
- **Debounced Search:** 300ms debounce on search input
- **Memoization:** Memoize filtered/sorted entry lists

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
