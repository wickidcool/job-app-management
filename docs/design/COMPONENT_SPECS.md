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
