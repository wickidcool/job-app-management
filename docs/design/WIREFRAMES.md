# Wireframes — Job Application Manager

## 1. Dashboard View (Kanban Mode)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Job Application Manager                                     [@] Profile ▼   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Dashboard                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  📊 Quick Stats                                                       │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                │  │
│  │  │   24     │ │    8     │ │   33%    │ │    3     │                │  │
│  │  │  Total   │ │This Week │ │ Response │ │In Review │                │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘                │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  [+ Add Application]  [🔍 Search...]  [Filter ▼]  [ Kanban | Table ]      │
│                                                                              │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │  Saved   │ Applied  │  Phone   │Interview │  Offer   │ Rejected │      │
│  │   (5)    │   (8)    │  Screen  │   (3)    │   (2)    │   (4)    │      │
│  │          │          │   (2)    │          │          │          │      │
│  ├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤      │
│  │┌────────┐│┌────────┐│┌────────┐│┌────────┐│┌────────┐│┌────────┐│      │
│  ││ 💼     ││││ 💼     ││││ 💼     ││││ 💼     ││││ 💼     ││││ 💼     ││      │
│  ││Sr. Dev ││││Frontend││││Backend ││││ Full  ││││  CTO  ││││Junior ││      │
│  ││        ││││Engineer││││  Dev  ││││ Stack ││││       ││││  Dev  ││      │
│  ││TechCo  ││││StartupX││││BigCorp││││WebCo  ││││SaaSCo ││││Shop123││      │
│  ││        ││││        ││││       ││││       ││││       ││││       ││      │
│  ││Remote  ││││NYC     ││││SF     ││││Hybrid ││││Remote ││││Local  ││      │
│  ││$150k   ││││$120k   ││││$180k  ││││$140k  ││││$250k  ││││$80k   ││      │
│  ││        ││││        ││││       ││││       ││││       ││││       ││      │
│  ││📎 Cover││││📎 Cover││││       ││││📎 Cover││││📎 Cover││││       ││      │
│  ││        ││││        ││││       ││││       ││││       ││││       ││      │
│  ││2d ago  ││││5d ago  ││││1w ago ││││3d ago ││││1d ago ││││2w ago ││      │
│  │└────────┘││└────────┘││└────────┘││└────────┘││└────────┘││└────────┘│      │
│  │          ││┌────────┐││┌────────┐││          ││          ││┌────────┐│      │
│  │          ││││ 💼     ││││ 💼     ││││          ││          ││││ 💼     ││      │
│  │          ││││React   ││││...     ││││          ││          ││││...     ││      │
│  │          │││...     ││││        ││││          ││          ││││        ││      │
│  │          ││└────────┘││└────────┘││          ││          ││└────────┘│      │
│  │  [+Add] ││  [+Add]  ││  [+Add]  ││  [+Add]  ││  [+Add]  ││  [+Add]  │      │
│  └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- **Drag & Drop:** Cards can be dragged between columns to update status
- **Click Card:** Opens application detail view
- **Hover Card:** Shows quick action menu (edit, delete, view details)
- **Column Headers:** Show count, click to sort within column
- **Search:** Live filtering by job title or company name
- **Filter Dropdown:** Filter by date range, salary range, location

---

## 2. Dashboard View (Table Mode)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Job Application Manager                                     [@] Profile ▼   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Dashboard                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  📊 Quick Stats                                                       │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                │  │
│  │  │   24     │ │    8     │ │   33%    │ │    3     │                │  │
│  │  │  Total   │ │This Week │ │ Response │ │In Review │                │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘                │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  [+ Add Application]  [🔍 Search...]  [Filter ▼]  [ Kanban | Table ]      │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ Job Title ▲  │ Company  │ Location │ Status      │ Applied │ Docs │    │
│  ├────────────────────────────────────────────────────────────────────┤    │
│  │ Sr. Developer│ TechCo   │ Remote   │ 🔵 Saved    │ 2d ago  │ 📎   │    │
│  ├────────────────────────────────────────────────────────────────────┤    │
│  │ Frontend Eng │ StartupX │ NYC      │ 🟡 Applied  │ 5d ago  │ 📎   │    │
│  ├────────────────────────────────────────────────────────────────────┤    │
│  │ React Dev    │ WebFlow  │ Remote   │ 🟡 Applied  │ 1w ago  │ 📎   │    │
│  ├────────────────────────────────────────────────────────────────────┤    │
│  │ Backend Dev  │ BigCorp  │ SF       │ 🟠 Phone    │ 1w ago  │      │    │
│  ├────────────────────────────────────────────────────────────────────┤    │
│  │ Full Stack   │ WebCo    │ Hybrid   │ 🟣 Interview│ 3d ago  │ 📎   │    │
│  ├────────────────────────────────────────────────────────────────────┤    │
│  │ CTO          │ SaaSCo   │ Remote   │ 🟢 Offer    │ 1d ago  │ 📎   │    │
│  ├────────────────────────────────────────────────────────────────────┤    │
│  │ Junior Dev   │ Shop123  │ Local    │ 🔴 Rejected │ 2w ago  │      │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  Showing 1-7 of 24 applications          [< Prev]  [1] 2 3 4  [Next >]     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- **Column Headers:** Click to sort (ascending/descending)
- **Row Click:** Opens application detail
- **Status Column:** Dropdown for quick status change
- **Docs Column:** Indicates linked documents (hover for preview)
- **Pagination:** 10 items per page (configurable)

---

## 3. Application Detail Page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Dashboard                                          [@] Profile ▼  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 💼 Senior Frontend Developer                                        │   │
│  │    TechCo Inc.                                                      │   │
│  │                                                                     │   │
│  │    Status: 🟡 Applied                          [Edit] [Delete]     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌───────────────────────────────┬────────────────────────────────────┐    │
│  │ DETAILS                       │ LINKED DOCUMENTS                   │    │
│  ├───────────────────────────────┼────────────────────────────────────┤    │
│  │ 📍 Location: Remote           │ 📎 Cover Letter                    │    │
│  │                               │    ┌─────────────────────────┐     │    │
│  │ 💰 Salary: $140k - $160k      │    │ Senior Frontend Role    │     │    │
│  │                               │    │ at TechCo               │     │    │
│  │ 🔗 URL:                       │    │                         │     │    │
│  │    techco.com/careers/123     │    │ Generated: Apr 13, 2026 │     │    │
│  │                               │    │                         │     │    │
│  │ 📅 Applied: Apr 13, 2026      │    │ [View] [Unlink]         │     │    │
│  │    (2 days ago)               │    └─────────────────────────┘     │    │
│  │                               │                                    │    │
│  │ 📅 Created: Apr 10, 2026      │ [+ Link Cover Letter]              │    │
│  │                               │ [+ Link Resume Version]            │    │
│  └───────────────────────────────┴────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ JOB DESCRIPTION                                           [View Full]│  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ We're seeking a Senior Frontend Developer to join our platform      │  │
│  │ team. You'll work with React, TypeScript, and modern web tech...    │  │
│  │                                                                      │  │
│  │ [Collapsed preview - click "View Full" for complete description]    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ STATUS HISTORY                                                       │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ ┌────┬─────────────────────────────────────────────────────────┐    │  │
│  │ │ ●  │ Applied                                                 │    │  │
│  │ │ │  │ Apr 13, 2026 at 2:30 PM                                 │    │  │
│  │ │ │  │                                                          │    │  │
│  │ │ ●  │ Saved                                                   │    │  │
│  │ │    │ Apr 10, 2026 at 9:15 AM                                 │    │  │
│  │ └────┴─────────────────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ NOTES                                                     [+ Add Note]│  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ No notes yet. Add your first note to track progress.                 │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- **Edit Button:** Opens inline edit mode for all fields
- **Delete Button:** Confirms before deletion
- **Status:** Click to open status change dropdown
- **Documents:** Preview on hover, click to view full
- **Timeline:** Auto-scrolls to most recent entry
- **Notes:** Rich text editor (future phase)

---

## 4. Add/Edit Application Modal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│     ┌───────────────────────────────────────────────────────────────┐       │
│     │ Add New Application                                      [✕]  │       │
│     ├───────────────────────────────────────────────────────────────┤       │
│     │                                                               │       │
│     │  Job Title *                                                  │       │
│     │  ┌─────────────────────────────────────────────────────────┐ │       │
│     │  │ e.g. Senior Frontend Developer                         │ │       │
│     │  └─────────────────────────────────────────────────────────┘ │       │
│     │                                                               │       │
│     │  Company Name *                                               │       │
│     │  ┌─────────────────────────────────────────────────────────┐ │       │
│     │  │ e.g. TechCo Inc.                                        │ │       │
│     │  └─────────────────────────────────────────────────────────┘ │       │
│     │                                                               │       │
│     │  Job URL (optional)                                           │       │
│     │  ┌─────────────────────────────────────────────────────────┐ │       │
│     │  │ https://company.com/careers/job-id                      │ │       │
│     │  └─────────────────────────────────────────────────────────┘ │       │
│     │                                                               │       │
│     │  Location (optional)                                          │       │
│     │  ┌─────────────────────────────────────────────────────────┐ │       │
│     │  │ e.g. Remote, NYC, Hybrid                                │ │       │
│     │  └─────────────────────────────────────────────────────────┘ │       │
│     │                                                               │       │
│     │  Salary Range (optional)                                      │       │
│     │  ┌─────────────────────────────────────────────────────────┐ │       │
│     │  │ e.g. $120k - $150k                                      │ │       │
│     │  └─────────────────────────────────────────────────────────┘ │       │
│     │                                                               │       │
│     │  Job Description (optional)                                   │       │
│     │  ┌─────────────────────────────────────────────────────────┐ │       │
│     │  │ Paste the job description from the posting...           │ │       │
│     │  │                                                         │ │       │
│     │  │ [Expandable textarea - 4 rows default, auto-expand]     │ │       │
│     │  │                                                         │ │       │
│     │  └─────────────────────────────────────────────────────────┘ │       │
│     │                                                               │       │
│     │  Initial Status                                               │       │
│     │  ┌─────────────────────────────────────────────────────────┐ │       │
│     │  │ Saved                                              ▼    │ │       │
│     │  └─────────────────────────────────────────────────────────┘ │       │
│     │                                                               │       │
│     │  ┌─────────────────────────────────────────────────────────┐ │       │
│     │  │ ☐ Link an existing cover letter                        │ │       │
│     │  └─────────────────────────────────────────────────────────┘ │       │
│     │                                                               │       │
│     │                                                               │       │
│     │                              [Cancel]  [Save Application]    │       │
│     │                                                               │       │
│     └───────────────────────────────────────────────────────────────┘       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Validation Rules:
- **Job Title:** Required, min 2 characters
- **Company Name:** Required, min 2 characters
- **URL:** Optional, must be valid URL format
- **Salary Range:** Optional, free text (no strict format)
- **Status:** Dropdown with valid initial states only (Saved, Applied)

### Interaction Notes:
- **Checkbox "Link cover letter":** Expands to show cover letter picker
- **Save Button:** Disabled until required fields valid
- **Cancel Button:** Closes modal, discards changes (confirm if dirty)
- **Escape Key:** Same as Cancel
- **Tab Order:** Top to bottom, Save button last

---

## 5. Cover Letter Picker (Sub-modal)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│     ┌───────────────────────────────────────────────────────────────┐       │
│     │ Link Cover Letter                                        [✕]  │       │
│     ├───────────────────────────────────────────────────────────────┤       │
│     │                                                               │       │
│     │  Search: [🔍 Search by keywords...]             Sort: Recent ▼│       │
│     │                                                               │       │
│     │  ┌─────────────────────────────────────────────────────────┐ │       │
│     │  │ ○ Senior Frontend Role at TechCo                        │ │       │
│     │  │   Generated: Apr 13, 2026                               │ │       │
│     │  │   Keywords: React, TypeScript, Leadership               │ │       │
│     │  │   [Preview]                                             │ │       │
│     │  ├─────────────────────────────────────────────────────────┤ │       │
│     │  │ ○ Full Stack Developer at StartupX                      │ │       │
│     │  │   Generated: Apr 10, 2026                               │ │       │
│     │  │   Keywords: Node.js, React, AWS                         │ │       │
│     │  │   [Preview]                                             │ │       │
│     │  ├─────────────────────────────────────────────────────────┤ │       │
│     │  │ ● Backend Engineer at BigCorp                           │ │       │
│     │  │   Generated: Apr 8, 2026                                │ │       │
│     │  │   Keywords: Python, Django, PostgreSQL                  │ │       │
│     │  │   [Preview]                                             │ │       │
│     │  ├─────────────────────────────────────────────────────────┤ │       │
│     │  │ ○ DevOps Role at CloudCo                                │ │       │
│     │  │   Generated: Apr 5, 2026                                │ │       │
│     │  │   Keywords: Kubernetes, CI/CD, AWS                      │ │       │
│     │  │   [Preview]                                             │ │       │
│     │  └─────────────────────────────────────────────────────────┘ │       │
│     │                                                               │       │
│     │  Showing 4 of 12 cover letters                                │       │
│     │                                                               │       │
│     │                              [Cancel]  [Link Selected]        │       │
│     │                                                               │       │
│     └───────────────────────────────────────────────────────────────┘       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- **Radio Buttons:** Single selection only
- **Preview Button:** Opens cover letter in read-only modal overlay
- **Search:** Live filtering by keywords in content
- **Sort Options:** Recent, Oldest, Alphabetical
- **Link Button:** Disabled until selection made

---

## 6. Empty State (No Applications)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Job Application Manager                                     [@] Profile ▼   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Dashboard                                                                   │
│                                                                              │
│                                                                              │
│                              📋                                              │
│                                                                              │
│                     No applications yet!                                     │
│                                                                              │
│               Track your job applications in one place.                      │
│            Add your first application to get started.                        │
│                                                                              │
│                                                                              │
│                      [+ Add Your First Application]                          │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Mobile Considerations (Responsive Wireframe - Phone Screen < 768px)

```
┌───────────────────────┐
│ ☰  Job App Manager [@]│
├───────────────────────┤
│ 📊 Stats              │
│ ┌───────┬───────┐     │
│ │  24   │   8   │     │
│ │ Total │ Week  │     │
│ └───────┴───────┘     │
│                       │
│ [+ Add] [🔍] [≡]     │
│                       │
│ Applications          │
│ ┌───────────────────┐ │
│ │ 💼 Sr. Developer  │ │
│ │ TechCo            │ │
│ │ Remote | $150k    │ │
│ │ 🟡 Applied • 2d   │ │
│ │ 📎                │ │
│ └───────────────────┘ │
│ ┌───────────────────┐ │
│ │ 💼 Frontend Eng   │ │
│ │ StartupX          │ │
│ │ NYC | $120k       │ │
│ │ 🟡 Applied • 5d   │ │
│ │ 📎                │ │
│ └───────────────────┘ │
│ ┌───────────────────┐ │
│ │ ...               │ │
│ └───────────────────┘ │
│                       │
└───────────────────────┘
```

### Mobile Adaptations:
- **Kanban → List View:** Single column stack instead of horizontal columns
- **Hamburger Menu:** Navigation and filters in slide-out drawer
- **Compact Stats:** 2-column grid instead of 4
- **Swipe Actions:** Swipe card left for delete, right for quick status
- **Bottom Sheet:** Modals become bottom sheets for better thumb reach

---

## Responsive Breakpoints

| Breakpoint | Width | Layout Changes |
|------------|-------|----------------|
| Mobile | < 768px | Single column, bottom sheets, hamburger nav |
| Tablet | 768px - 1024px | 2-3 column kanban, side drawer modals |
| Desktop | > 1024px | Full kanban (6 columns), centered modals |

---

## Design Tokens Reference

See `DESIGN_SYSTEM.md` for:
- Color palette with status mappings
- Typography scale
- Spacing grid
- Component dimensions
