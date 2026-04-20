# Navigation & Information Architecture

## Application Structure

```
Job Application Manager
│
├── Dashboard (/)
│   ├── Stats Overview
│   ├── Recent Activity
│   ├── Quick Actions
│   └── Resume Widget (new)
│
├── Applications (/applications)
│   ├── Kanban View (default)
│   ├── List View
│   └── Application Detail (/applications/:id)
│
├── Resume Manager (/resumes) ← NEW
│   ├── Upload Resume
│   ├── Master Resumes List
│   ├── Resume Exports List
│   └── Export Editor (/resumes/exports/:id)
│
└── Settings (/settings)
    ├── Profile
    ├── Preferences
    └── Integrations
```

---

## Primary Navigation

### Top Navigation Bar

```
┌─────────────────────────────────────────────────────────────────┐
│  📋 Job App Manager                                    👤 User  │
├─────────────────────────────────────────────────────────────────┤
│  [Dashboard]  [Applications]  [Resume Manager]  [Settings]      │
└─────────────────────────────────────────────────────────────────┘
```

### Navigation States

| Tab | Route | Active State | Badge |
|-----|-------|--------------|-------|
| Dashboard | `/` | Underline + bold | - |
| Applications | `/applications` | Underline + bold | Count of in-progress |
| Resume Manager | `/resumes` | Underline + bold | Count of exports |
| Settings | `/settings` | Underline + bold | - |

---

## Resume Manager Navigation

### Entry Points to Resume Manager

#### 1. From Dashboard
**Widget: "Your Resumes"**
```
┌─────────────────────────────────┐
│  📄 Your Resumes            [→] │
├─────────────────────────────────┤
│  Master resumes: 1              │
│  Exports: 3                     │
│                                 │
│  [Upload New Resume]            │
└─────────────────────────────────┘
```
- Click widget → Navigate to `/resumes`
- Click "Upload New Resume" → Navigate to `/resumes/upload`

#### 2. From Top Navigation
- Click "Resume Manager" tab → Navigate to `/resumes`

#### 3. From Application Form
**When creating/editing an application:**
```
┌─────────────────────────────────┐
│  Link Resume Version (optional) │
│  ┌─────────────────────────────┐│
│  │ Select resume...        ▼   ││
│  └─────────────────────────────┘│
│  [Create New Export]            │
└─────────────────────────────────┘
```
- Click "Create New Export" → Modal OR navigate to `/resumes/exports/new?returnTo=/applications/new`

#### 4. From ApplicationCard Quick Actions
- Hover over card → Click 📎 icon → Dropdown menu:
  - "Link Resume Version" (opens picker modal)
  - "View Linked Resume" (if already linked)
  - "Create New Export" (navigates to builder)

---

## Navigation Flows

### Flow 1: Upload Resume from Dashboard

```
Dashboard (/)
    │
    ├─ Click "Your Resumes" widget
    │     OR
    └─ Click "Resume Manager" in nav
    │
    v
Resume Manager (/resumes)
    │
    ├─ Click "Upload New Resume" button
    │
    v
Resume Upload View (/resumes/upload)
    │
    ├─ Upload & parse complete
    │
    v
Master Resume Editor (/resumes/:id/edit)
    │
    ├─ Click "Save" or "Cancel"
    │
    v
Resume Manager (/resumes)
    │
    └─ Breadcrumb: "← Back to Dashboard"
```

### Flow 2: Create Export for Existing Application

```
Applications Kanban (/applications)
    │
    ├─ Click ApplicationCard
    │
    v
Application Detail (/applications/:id)
    │
    ├─ Click "Link Resume" button
    │
    v
Resume Export Picker (Modal)
    │
    ├─ Select existing export
    │   OR
    └─ Click "Create New Export"
    │
    v
Export Builder (/resumes/exports/new?appId=:id)
    │
    ├─ Select experiences, customize
    │
    v
Save & Link
    │
    └─ Return to Application Detail
```

### Flow 3: Manage Existing Exports

```
Dashboard (/)
    │
    v
Resume Manager (/resumes)
    │
    ├─ Tab: "Exports"
    │
    v
Exports List View (/resumes/exports)
    │
    ├─ Click export card
    │
    v
Export Preview (Modal)
    │
    ├─ [Download] → Download file
    ├─ [Edit] → Navigate to editor
    └─ [Close] → Stay on Exports List
```

---

## Resume Manager Internal Navigation

### Tabbed Interface

```
┌─────────────────────────────────────────────────────────────────┐
│  Resume Manager                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [Master Resumes] [Exports] [Upload New]                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Content area based on active tab]                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Tab States

| Tab | Route | Content |
|-----|-------|---------|
| Master Resumes | `/resumes` (default) | List of uploaded master resumes |
| Exports | `/resumes/exports` | List of tailored resume exports |
| Upload New | `/resumes/upload` | Upload interface |

---

## Breadcrumb Navigation

### Breadcrumb Examples

```
Dashboard > Resume Manager
Dashboard > Resume Manager > Upload Resume
Dashboard > Resume Manager > Exports > Software Engineer - TechCo
Applications > Senior Developer at TechCo > Create Resume Export
```

### Breadcrumb Component

```tsx
interface BreadcrumbProps {
  trail: BreadcrumbItem[]
}

interface BreadcrumbItem {
  label: string
  href?: string  // Undefined for current page
  icon?: string
}

// Example usage:
<Breadcrumb trail={[
  { label: 'Dashboard', href: '/', icon: '🏠' },
  { label: 'Resume Manager', href: '/resumes' },
  { label: 'Upload Resume' }  // Current page, no href
]} />
```

---

## Return Navigation Patterns

### Context-Aware Returns

When navigating to Resume Manager from different contexts, preserve return path:

#### Pattern 1: Query Parameter
```
/resumes/exports/new?returnTo=/applications/123
```
- Show "Cancel" or "← Back to Application" button
- On save/cancel, navigate to `returnTo` path

#### Pattern 2: Browser History
```tsx
// Use browser back button behavior
<button onClick={() => navigate(-1)}>
  ← Back
</button>
```

#### Pattern 3: Breadcrumbs
- Always show breadcrumb trail
- Each item is clickable (except current page)

---

## Quick Actions & Shortcuts

### Dashboard Quick Actions Widget

```
┌─────────────────────────────────┐
│  Quick Actions                  │
├─────────────────────────────────┤
│  ➕ Add Application             │
│  📄 Upload Resume               │  ← Direct to /resumes/upload
│  📊 View Reports                │
└─────────────────────────────────┘
```

### Keyboard Shortcuts (Future Enhancement)

| Shortcut | Action | Context |
|----------|--------|---------|
| `g` + `d` | Go to Dashboard | Global |
| `g` + `a` | Go to Applications | Global |
| `g` + `r` | Go to Resume Manager | Global |
| `n` + `a` | New Application | Applications page |
| `n` + `r` | Upload Resume | Resume Manager |
| `Esc` | Close modal/return | Modal context |

---

## Mobile Navigation

### Mobile Nav Pattern (< 768px)

**Hamburger Menu:**
```
┌─────────────────────────────────┐
│  ☰  Job App Manager        👤   │
└─────────────────────────────────┘

When ☰ clicked:
┌─────────────────────────────────┐
│  📋 Dashboard                   │
│  💼 Applications                │
│  📄 Resume Manager         NEW  │
│  ⚙️  Settings                   │
│                                 │
│  ─────────────────────────      │
│  Upload Resume                  │
│  Add Application                │
└─────────────────────────────────┘
```

### Mobile Tab Bar (Alternative)

```
┌─────────────────────────────────┐
│                                 │
│  [Main content area]            │
│                                 │
└─────────────────────────────────┘
┌───┬────────┬────────┬──────────┐
│ 🏠│ 💼     │ 📄     │ ⚙️       │
│Dash│Apps   │Resumes │Settings  │
└───┴────────┴────────┴──────────┘
```

---

## Modal Navigation

### Resume Export Picker Modal

Opened from Application Form/Detail:

```
┌─────────────────────────────────────────┐
│  Link Resume Version              [✕]   │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐    │
│  │ 📄 Software Engineer - TechCo  │ ○  │
│  │ Created: Apr 15, 2026          │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 📄 Product Manager - StartupX  │ ○  │
│  │ Created: Apr 12, 2026          │    │
│  └─────────────────────────────────┘    │
│                                         │
│  [Create New Export]                    │
│                                         │
│  [Cancel]              [Link Selected] │
└─────────────────────────────────────────┘
```

**Modal Navigation:**
- Click "Create New Export" → Close modal → Navigate to `/resumes/exports/new?returnTo=/applications/:id`
- Select + "Link Selected" → Close modal → Update application → Stay on page
- Click [✕] or "Cancel" → Close modal → Stay on page

---

## Empty States with Navigation CTAs

### Dashboard - No Resumes Yet

```
┌─────────────────────────────────┐
│  📄 Your Resumes                │
├─────────────────────────────────┤
│                                 │
│  📋 No resumes yet              │
│                                 │
│  Upload your resume to create   │
│  tailored versions for each job │
│                                 │
│  [Upload Your First Resume]     │
│                                 │
└─────────────────────────────────┘
```
Click button → Navigate to `/resumes/upload`

### Application Form - No Exports Available

```
┌─────────────────────────────────┐
│  Link Resume Version (optional) │
│                                 │
│  📄 No resume exports yet       │
│                                 │
│  [Upload Resume] [Skip]         │
└─────────────────────────────────┘
```
- "Upload Resume" → Navigate to `/resumes/upload?returnTo=/applications/new`
- "Skip" → Continue without linking

---

## Navigation State Persistence

### Preserve User Context

When navigating away and returning:

**Resume Manager → Applications → Resume Manager**
- Remember active tab (Master Resumes vs Exports)
- Remember scroll position
- Remember applied filters/sort

**Implementation:**
```tsx
// Store in sessionStorage
sessionStorage.setItem('resumeManagerState', JSON.stringify({
  activeTab: 'exports',
  scrollY: 240,
  filters: { linkedOnly: true }
}))
```

---

## Notification-Driven Navigation

### After Upload Success

```
┌─────────────────────────────────────────┐
│  ✅ Resume uploaded successfully!       │
│                                         │
│  [View Master Resume] [Create Export]  │
└─────────────────────────────────────────┘
```

### After Export Created

```
┌─────────────────────────────────────────┐
│  ✅ Resume export created!              │
│                                         │
│  [Download Now] [Back to Applications] │
└─────────────────────────────────────────┘
```

---

## URL Structure Summary

| Route | Purpose | Access |
|-------|---------|--------|
| `/` | Dashboard home | All users |
| `/applications` | Kanban/list view | All users |
| `/applications/:id` | Application detail | All users |
| `/applications/new` | Create application form | All users |
| `/resumes` | Resume Manager home (Master Resumes tab) | All users |
| `/resumes/upload` | Upload new resume | All users |
| `/resumes/:id` | View master resume | All users |
| `/resumes/:id/edit` | Edit master resume | All users |
| `/resumes/exports` | Exports list tab | All users |
| `/resumes/exports/new` | Create new export | All users |
| `/resumes/exports/:id` | View/edit export | All users |

### Query Parameters

| Parameter | Purpose | Example |
|-----------|---------|---------|
| `returnTo` | Return path after action | `?returnTo=/applications/123` |
| `appId` | Pre-link export to application | `?appId=123` |
| `source` | Track navigation source | `?source=dashboard_widget` |

---

## Accessibility - Keyboard Navigation

### Focus Management

**Modal Opens:**
- Focus moves to modal close button or first interactive element
- Tab key cycles through modal elements only (focus trap)
- Escape key closes modal, returns focus to trigger element

**Navigation Between Pages:**
- Focus moves to main heading (`<h1>`) of new page
- Skip to main content link available
- Current page announced by screen reader

### ARIA Landmarks

```html
<nav aria-label="Primary navigation">
  <a href="/">Dashboard</a>
  <a href="/applications">Applications</a>
  <a href="/resumes" aria-current="page">Resume Manager</a>
  <a href="/settings">Settings</a>
</nav>

<main aria-label="Resume Manager">
  <!-- Page content -->
</main>
```

---

## Visual Navigation Indicators

### Current Location Cues

1. **Active tab:** Bold + underline + primary color
2. **Breadcrumbs:** Current page is not a link
3. **Page title:** Large heading matching nav item
4. **Icon highlighting:** Active nav icon uses solid variant

### Transition Animations

| Transition | Animation | Duration |
|------------|-----------|----------|
| Page to page | Fade in | 200ms |
| Modal open | Slide up + fade | 250ms |
| Tab change | Crossfade | 150ms |
| Breadcrumb update | No animation | 0ms |
