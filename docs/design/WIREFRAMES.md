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

## 8. Job Fit Analysis - Input Stage

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Dashboard                                          [@] Profile ▼  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Job Fit Analysis                                                            │
│                                                                              │
│  Analyze how well a job posting matches your experience, skills, and        │
│  achievements. We'll provide an honest assessment including any gaps.        │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Job Description                                                     │  │
│  │  ───────────────────────────────────────────────────────────────────│  │
│  │                                                                      │  │
│  │  Paste the full job description here...                             │  │
│  │                                                                      │  │
│  │  [Include requirements, qualifications, responsibilities,           │  │
│  │   tech stack, and any other relevant details]                       │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  │  [Textarea - 8 rows, expandable to 20 rows max]                     │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  Character count: 0 / 50,000     Min: 100 characters                        │
│                                                                              │
│  ─────────────── OR ────────────────                                         │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Job Posting URL                                                     │  │
│  │  https://example.com/careers/senior-full-stack-engineer             │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ⚠️ Note: This analysis will identify gaps in your profile. We provide      │
│     honest assessments to help you make informed decisions.                 │
│                                                                              │
│                                                                              │
│  [Cancel]                                              [Analyze Fit →]      │
│                                                          (disabled)          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Validation States:

**Valid Input (Analyze button enabled):**
```
│  Character count: 850 / 50,000  ✓ Ready to analyze                          │
│  [Cancel]                                              [Analyze Fit →]      │
│                                                          (enabled)           │
```

**Too Short:**
```
│  Character count: 45 / 50,000   ⚠️ Min 100 characters required              │
│  [Cancel]                                              [Analyze Fit →]      │
│                                                          (disabled)          │
```

**Invalid URL:**
```
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Job Posting URL                                                     │  │
│  │  not-a-valid-url                                                     │  │
│  │  ❌ Please enter a valid URL starting with http:// or https://       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
```

---

## 9. Job Fit Analysis - Analyzing State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                                                                              │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                                                                      │  │
│  │                             🔍                                       │  │
│  │                                                                      │  │
│  │                   Analyzing Job Fit...                               │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  │   ✓ Parsing job description                                         │  │
│  │   ⏳ Extracting requirements                                         │  │
│  │   ⏳ Comparing against your catalog                                  │  │
│  │   ⏳ Identifying matches and gaps                                    │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  │   ████████████████░░░░░░░░░░░░ 55%                                  │  │
│  │                                                                      │  │
│  │   Estimated time remaining: ~6 seconds                               │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Progressive Status Updates:

**Step 1 (0-20%):**
```
│   ⏳ Parsing job description                                         │
│   ⏳ Extracting requirements                                         │
```

**Step 2 (20-50%):**
```
│   ✓ Parsing job description                                         │
│   ⏳ Extracting requirements                                         │
│   ⏳ Comparing against your catalog                                  │
```

**Step 3 (50-80%):**
```
│   ✓ Parsing job description                                         │
│   ✓ Extracting requirements                                         │
│   ⏳ Comparing against your catalog                                  │
│   ⏳ Identifying matches and gaps                                    │
```

**Step 4 (80-100%):**
```
│   ✓ Parsing job description                                         │
│   ✓ Extracting requirements                                         │
│   ✓ Comparing against your catalog                                  │
│   ⏳ Finalizing analysis...                                          │
```

---

## 10. Job Fit Analysis - Results Display

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back                                                       [@] Profile ▼  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Job Fit Analysis Results                                                    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                                                                      │  │
│  │  Overall Fit: MODERATE FIT  ⚖️                                       │  │
│  │  ●●●○○  60% Match                                                    │  │
│  │                                                                      │  │
│  │  Senior Full Stack Engineer at TechCo                                │  │
│  │  San Francisco, CA • $150,000 - $200,000                             │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 📋 Parsed Requirements                                         [−]   │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │ Role: Senior Full Stack Engineer                                     │  │
│  │ Seniority: Senior (5+ years experience)                              │  │
│  │ Required Stack: React, Node.js, PostgreSQL, AWS, TypeScript          │  │
│  │ Nice-to-have: Docker, Kubernetes, GraphQL                            │  │
│  │ Domain: E-commerce / Fintech                                         │  │
│  │ Team Size: 8-10 engineers                                            │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ ✅ Strong Matches (5)                                          [−]   │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │ • React.js (Advanced) - 95% confidence                               │  │
│  │   Used extensively in 3 major projects. Led React migration at      │  │
│  │   previous company. Strong component architecture skills.            │  │
│  │   [View in Catalog →]                                                │  │
│  │                                                                      │  │
│  │ • Node.js (Expert) - 98% confidence                                  │  │
│  │   5 years backend experience. Built scalable APIs serving 1M+       │  │
│  │   users. Team lead for Node.js microservices architecture.          │  │
│  │   [View in Catalog →]                                                │  │
│  │                                                                      │  │
│  │ • PostgreSQL - 90% confidence                                        │  │
│  │   Database design and optimization experience. Query performance    │  │
│  │   tuning. Migration experience.                                     │  │
│  │   [View in Catalog →]                                                │  │
│  │                                                                      │  │
│  │ [+ Show 2 more matches]                                              │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ ⚠️ Partial Matches (2)                                         [−]   │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │ • AWS (Basic) - 60% confidence                                       │  │
│  │   Limited cloud deployment experience. Used EC2 and S3 in side      │  │
│  │   projects but not at production scale.                             │  │
│  │   💡 Recommendation: Highlight your EC2/S3 work; consider AWS       │  │
│  │      certification to strengthen this skill.                        │  │
│  │                                                                      │  │
│  │ • E-commerce Domain - 55% confidence                                 │  │
│  │   Adjacent experience in SaaS platforms. No direct e-commerce       │  │
│  │   background but transferable skills.                               │  │
│  │   💡 Recommendation: Emphasize SaaS platform work and discuss       │  │
│  │      how skills transfer to e-commerce context.                     │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ ❌ Gaps (2)                                                    [−]   │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │ ┌────────────────────────────────────────────────────────────────┐  │  │
│  │ │ 🔴 TypeScript (CRITICAL)                                       │  │  │
│  │ │                                                                │  │  │
│  │ │ Required skill not found in your catalog. This is listed as   │  │  │
│  │ │ a required qualification and may be a deal-breaker.            │  │  │
│  │ │                                                                │  │  │
│  │ │ 💡 Suggestion:                                                 │  │  │
│  │ │ • Take TypeScript course (Udemy, Frontend Masters)            │  │  │
│  │ │ • Migrate a React project to TypeScript                       │  │  │
│  │ │ • Add TypeScript to your portfolio                            │  │  │
│  │ │ • Be prepared to discuss learning plan in interview           │  │  │
│  │ └────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                      │  │
│  │ ┌────────────────────────────────────────────────────────────────┐  │  │
│  │ │ 🟡 Docker (MODERATE)                                           │  │  │
│  │ │                                                                │  │  │
│  │ │ Nice-to-have skill not demonstrated in your catalog.           │  │  │
│  │ │ Not required but would strengthen your application.            │  │  │
│  │ │                                                                │  │  │
│  │ │ 💡 Suggestion:                                                 │  │  │
│  │ │ • Complete Docker tutorial (1-2 days)                          │  │  │
│  │ │ • Containerize existing project for portfolio                 │  │  │
│  │ │ • Mention willingness to learn if asked                       │  │  │
│  │ └────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 💡 Recommended STAR Entries                                    [−]   │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │ Highlight these achievements in your cover letter and resume:        │  │
│  │                                                                      │  │
│  │ 1. [95%] Led React Migration from Angular (Q3 2024)                  │  │
│  │    → Directly demonstrates frontend leadership and React mastery    │  │
│  │    [View STAR Entry →]                                               │  │
│  │                                                                      │  │
│  │ 2. [90%] Scaled Node.js API to 1M+ Users (Q1 2025)                   │  │
│  │    → Shows backend expertise, performance optimization, and scale   │  │
│  │    [View STAR Entry →]                                               │  │
│  │                                                                      │  │
│  │ 3. [85%] Database Optimization: 10x Query Speed (Q2 2024)            │  │
│  │    → Proves PostgreSQL proficiency and performance focus            │  │
│  │    [View STAR Entry →]                                               │  │
│  │                                                                      │  │
│  │ [+ Show 2 more recommendations]                                      │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  [← Back]  [Save Analysis]  [Generate Cover Letter →]                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Collapsed Section View:

```
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 📋 Parsed Requirements                                         [+]   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ ✅ Strong Matches (5)                                          [+]   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
```

---

## 11. Job Fit Analysis - Empty Catalog State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back                                                       [@] Profile ▼  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Job Fit Analysis                                                            │
│                                                                              │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                                                                      │  │
│  │                             📋                                       │  │
│  │                                                                      │  │
│  │                   No Catalog Data Yet                                │  │
│  │                                                                      │  │
│  │   Upload a resume to build your professional catalog before          │  │
│  │   analyzing job fit.                                                 │  │
│  │                                                                      │  │
│  │   Your catalog will contain:                                         │  │
│  │   • Skills and technologies you've used                              │  │
│  │   • Work experiences and achievements                                │  │
│  │   • STAR-format accomplishments                                      │  │
│  │   • Education and certifications                                     │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  │                      [Upload Resume →]                               │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 12. Job Fit Analysis - Error State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Job Fit Analysis                                                            │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                                                                      │  │
│  │                             ⚠️                                       │  │
│  │                                                                      │  │
│  │                   Analysis Failed                                    │  │
│  │                                                                      │  │
│  │   Unable to analyze job fit. Please try again.                       │  │
│  │                                                                      │  │
│  │   Error: Network connection timeout                                  │  │
│  │                                                                      │  │
│  │   Your job description has been preserved.                           │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  │                      [← Back]  [Retry Analysis]                      │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 13. Job Fit Analysis - Mobile View (< 768px)

### Input Stage (Mobile)
```
┌───────────────────────┐
│ ← Job Fit Analysis [@]│
├───────────────────────┤
│ Analyze job fit       │
│ against your profile  │
│                       │
│ Job Description       │
│ ┌───────────────────┐ │
│ │ Paste JD here...  │ │
│ │                   │ │
│ │ [6 rows]          │ │
│ │                   │ │
│ │                   │ │
│ └───────────────────┘ │
│ 0 / 50,000            │
│                       │
│ ─── OR ───            │
│                       │
│ Job Posting URL       │
│ ┌───────────────────┐ │
│ │ https://...       │ │
│ └───────────────────┘ │
│                       │
│ ⚠️ Honest assessment  │
│ including gaps        │
│                       │
│ [Cancel]              │
│ [Analyze Fit →]       │
│                       │
└───────────────────────┘
```

### Results Stage (Mobile)
```
┌───────────────────────┐
│ ← Results         [@] │
├───────────────────────┤
│ ┌───────────────────┐ │
│ │ MODERATE FIT ⚖️   │ │
│ │ ●●●○○  60%        │ │
│ │                   │ │
│ │ Sr. Full Stack    │ │
│ │ TechCo            │ │
│ │ SF • $150k-200k   │ │
│ └───────────────────┘ │
│                       │
│ 📋 Parsed Reqs   [+] │
│                       │
│ ✅ Strong (5)     [−] │
│ • React - 95%         │
│ • Node.js - 98%       │
│ • PostgreSQL - 90%    │
│ [+2 more]             │
│                       │
│ ⚠️ Partial (2)    [+] │
│                       │
│ ❌ Gaps (2)       [−] │
│ ┌───────────────────┐ │
│ │🔴 TypeScript      │ │
│ │  (CRITICAL)       │ │
│ │                   │ │
│ │ Required skill    │ │
│ │ not found         │ │
│ │                   │ │
│ │💡 Take course     │ │
│ └───────────────────┘ │
│ ┌───────────────────┐ │
│ │🟡 Docker          │ │
│ │  (MODERATE)       │ │
│ │ [collapsed]       │ │
│ └───────────────────┘ │
│                       │
│ 💡 Recommended    [+] │
│                       │
│ [Save]                │
│ [Generate CL →]       │
│                       │
└───────────────────────┘
```

### Mobile Adaptations:
- **Sticky Header:** Overall fit rating sticky at top
- **Collapsed Sections:** All sections collapsed by default
- **Tap to Expand:** Accordion behavior for all sections
- **Bottom Actions:** Sticky action buttons at bottom
- **Swipe Navigation:** Swipe between sections
- **Simplified Gaps:** Critical gaps shown first, others collapsed

---

## Design Tokens Reference

See `DESIGN_SYSTEM.md` for:
- Color palette with status mappings
- Typography scale
- Spacing grid
- Component dimensions

---

## 14. Resume Variant Generator - Step 1: Configure Target

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Resumes                                            [@] Profile ▼  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Generate Targeted Resume Variant                              [Step 1/5]   │
│  ━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  Configure  Score   Select  Generate  Export                                │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Target Role Configuration                                            │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │ Target Job Title *                                                   │  │
│  │ ┌────────────────────────────────────────────────────────────────┐   │  │
│  │ │ e.g., Senior Full Stack Engineer                               │   │  │
│  │ └────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                      │  │
│  │ Seniority Level                                                      │  │
│  │ ○ Junior (0-2 years)    ● Mid-Level (3-5 years)                     │  │
│  │ ○ Senior (6-10 years)   ○ Lead/Staff (10+ years)                    │  │
│  │                                                                      │  │
│  │ Key Skills to Emphasize (Select 3-5)                                 │  │
│  │ ┌────────────────────────────────────────────────────────────────┐   │  │
│  │ │ ☑️ React.js        ☑️ Node.js        ☐ TypeScript            │   │  │
│  │ │ ☑️ PostgreSQL      ☐ AWS             ☐ Docker                 │   │  │
│  │ │ ☑️ Team Leadership ☐ Microservices   ☐ Performance Tuning    │   │  │
│  │ │                                                                │   │  │
│  │ │ [+ Add Custom Skill]                                           │   │  │
│  │ └────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                      │  │
│  │ ☑️ Use Job Fit Analysis: Moderate Fit · 60% match                   │  │
│  │    (Pre-fills target role and key skills from analysis)             │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Resume Constraints                                                   │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │ Maximum Pages                                                        │  │
│  │ ○ 1 page    ● 2 pages    ○ No limit                                 │  │
│  │                                                                      │  │
│  │ Target Word Count                                                    │  │
│  │ ┌──────────────────────────────────────────────────┐                │  │
│  │ │                        ◆                          │                │  │
│  │ │ ├───────────────────────────────────────────────┤ │                │  │
│  │ │ 300        500        700        900       1100  │                │  │
│  │ └──────────────────────────────────────────────────┘                │  │
│  │ Target: 700 words (approximately 1.5 pages)                          │  │
│  │                                                                      │  │
│  │ Bullet Count Range                                                   │  │
│  │ Min: [15 ▾]    Max: [25 ▾]    (Recommended: 15-25)                  │  │
│  │                                                                      │  │
│  │ Companies to Include                                                 │  │
│  │ Min: [5 ▾]     Max: [7 ▾]     (Recommended: 5-7)                    │  │
│  │                                                                      │  │
│  │ ⚠️ Note: Constraints help ensure focused, relevant content          │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│                                                                              │
│  [Cancel]                                  [Next: Score Bullets →]          │
│                                            (enabled when role filled)        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- **Job Fit Analysis Checkbox:** If checked, pre-fills target role, seniority, skills from linked fit analysis
- **Skill Tags:** Max 5 selections, show count indicator "4/5 selected"
- **Word Count Slider:** Updates target page estimate in real-time
- **Validation:** Next button disabled until job title filled

---

## 15. Resume Variant Generator - Step 2: Bullet Scoring Progress

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Generate Targeted Resume Variant                              [Step 2/5]   │
│  ━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  Configure  Score   Select  Generate  Export                                │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                                                                      │  │
│  │                           🎯                                         │  │
│  │                                                                      │  │
│  │               Scoring Catalog Bullets...                             │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  │   Analyzing relevance for: Senior Full Stack Engineer               │  │
│  │                                                                      │  │
│  │   ✓ React.js expertise                                              │  │
│  │   ✓ Node.js proficiency                                             │  │
│  │   ⏳ PostgreSQL experience                                           │  │
│  │   ⏳ Team leadership                                                 │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  │   ████████████████████░░░░░░░░░░  67%                               │  │
│  │                                                                      │  │
│  │   Scored 30 of 45 bullets                                            │  │
│  │   Estimated time remaining: ~4 seconds                               │  │
│  │                                                                      │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- Progress updates every 500ms
- Shows which skill criteria are being evaluated
- Estimated time based on remaining bullets
- Cannot cancel once scoring starts

---

## 16. Resume Variant Generator - Step 3: Bullet Selection

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Generate Targeted Resume Variant                              [Step 3/5]   │
│  ━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  Configure  Score   Select  Generate  Export                                │
│                                                                              │
│  Select Experience Bullets                    [🔍 Search...]  [Filter: All ▾]│
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 📊 Selection Summary                                                 │  │
│  │ ──────────────────────────────────────────────────────────────────── │  │
│  │ Selected: 18 bullets across 6 companies                             │  │
│  │ ████████████████░░░░░  72% of target (15-25 bullets, 5-7 companies) │  │
│  │ ✅ Constraints met    Est. Length: 650 words (~1.3 pages)           │  │
│  │                                                                      │  │
│  │ [Auto-Select Top Bullets]  [Clear Selection]                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ─── Excellent Matches (90-100%) ────────────────────────────────────────  │
│                                                                              │
│  ☑️ [95%] Led React migration for client portal                            │
│     StartupCo · Q3 2024 · Frontend, Technical Leadership                    │
│     → Directly demonstrates React expertise and leadership                  │
│     [Preview Full STAR Entry]                                               │
│                                                                              │
│  ☑️ [92%] Scaled Node.js API to handle 10k requests/second                 │
│     BigCorp · Q1 2025 · Backend, Performance                                │
│     → Proves Node.js proficiency and performance optimization skills        │
│     [Preview Full STAR Entry]                                               │
│                                                                              │
│  ─── Great Matches (80-89%) ──────────────────────────────────────────────│
│                                                                              │
│  ☑️ [87%] Database query optimization reducing latency by 85%              │
│     TechCo · Q2 2024 · Database, Performance                                │
│     → Shows PostgreSQL expertise                                            │
│     [Preview Full STAR Entry]                                               │
│                                                                              │
│  ☐ [84%] Mentored 3 junior developers to mid-level                         │
│     StartupCo · Q1 2024 · Leadership, Mentoring                             │
│     → Demonstrates team leadership ability                                  │
│     [Preview Full STAR Entry]                                               │
│                                                                              │
│  ─── Good Matches (70-79%) ────────────────────────────────────────────── │
│                                                                              │
│  ☐ [76%] Implemented CI/CD pipeline with GitHub Actions                    │
│     WebCo · Q4 2023 · DevOps, Automation                                    │
│     → Relevant for modern development practices                             │
│     [Preview Full STAR Entry]                                               │
│                                                                              │
│  [Show 12 more bullets...]                                                  │
│                                                                              │
│  ─── Lower Relevance (< 70%) ─────────────────────────────────────────────│
│                                                                              │
│  [Show 15 bullets with relevance scores below 70%]                          │
│                                                                              │
│                                                                              │
│  [← Back]                                  [Next: Generate Preview →]       │
│                                            (enabled when 15+ bullets)        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- **Auto-Select:** Automatically selects top-scoring bullets to meet constraints
- **Constraint Indicators:** Real-time validation with color coding (green = valid, yellow = approaching, red = violated)
- **Preview Button:** Expands to show full STAR entry (Situation, Task, Action, Result)
- **Company Diversity:** Visual indicator shows bullet distribution across companies
- **Search:** Filters bullets by keywords in title, tags, or STAR content

---

## 17. Resume Variant Generator - Bullet Preview Modal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────┐     │
│  │ STAR Entry Preview                                            [✕] │     │
│  ├───────────────────────────────────────────────────────────────────┤     │
│  │                                                                   │     │
│  │ [95%] Led React migration for client portal                      │     │
│  │ StartupCo · Q3 2024 · Frontend, Technical Leadership             │     │
│  │                                                                   │     │
│  │ ─────────────────────────────────────────────────────────────────│     │
│  │                                                                   │     │
│  │ 📍 Situation                                                      │     │
│  │ Legacy Angular client portal was slow to load (8+ seconds) and   │     │
│  │ difficult to maintain. Team needed modern framework to improve   │     │
│  │ development velocity and user experience.                        │     │
│  │                                                                   │     │
│  │ 🎯 Task                                                           │     │
│  │ Lead migration to React without disrupting users or slowing      │     │
│  │ development. Ensure team was trained and comfortable with new    │     │
│  │ stack by end of quarter.                                         │     │
│  │                                                                   │     │
│  │ ⚡ Action                                                          │     │
│  │ Created incremental migration plan, set up React/Angular bridge, │     │
│  │ trained 5-person team through pair programming sessions,         │     │
│  │ migrated module-by-module over 3 months with feature flags.      │     │
│  │                                                                   │     │
│  │ 🏆 Result                                                          │     │
│  │ • 40% bundle size reduction (from 2.5MB to 1.5MB)                │     │
│  │ • 2 seconds faster initial load time                             │     │
│  │ • Zero downtime or user-facing bugs during migration             │     │
│  │ • Team fully proficient in React and modern tooling             │     │
│  │                                                                   │     │
│  │ ─────────────────────────────────────────────────────────────────│     │
│  │                                                                   │     │
│  │ 🎯 Why This Matches (95% relevance)                              │     │
│  │ • Target role requires React expertise ✓                         │     │
│  │ • Demonstrates technical leadership ✓                            │     │
│  │ • Shows measurable performance improvements ✓                    │     │
│  │ • Proves ability to manage complex migrations ✓                  │     │
│  │                                                                   │     │
│  │ ─────────────────────────────────────────────────────────────────│     │
│  │                                                                   │     │
│  │ ☑️ Include in Resume         [☐ Selected]                        │     │
│  │                                                                   │     │
│  │                                          [Close]                  │     │
│  │                                                                   │     │
│  └───────────────────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- Modal shows full STAR entry with formatting
- Relevance reasoning shows why bullet scored high/low
- Checkbox allows selecting/deselecting from modal
- Keyboard: Escape to close, Enter to toggle selection

---

## 18. Resume Variant Generator - Step 4: Preview & Edit

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Generate Targeted Resume Variant                              [Step 4/5]   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  Configure  Score   Select  Generate  Export                                │
│                                                                              │
│  ┌─────────────────────────────────┬──────────────────────────────────────┐│
│  │ 📝 Resume Preview               │ 🔗 Traceability                      ││
│  │ [Edit Mode]  [View Mode]        │ [Show All Sources]                   ││
│  │ ───────────────────────────────│ ─────────────────────────────────────││
│  │                                 │                                      ││
│  │ YOUR NAME                       │ 📊 Content Summary                   ││
│  │ email@example.com · 555-1234    │ ────────────────────────────────     ││
│  │ linkedin.com/in/yourname        │ • 18 bullets from 6 companies        ││
│  │                                 │ • 687 words (~1.4 pages)             ││
│  │ PROFESSIONAL SUMMARY            │ • All constraints met ✅            ││
│  │                                 │                                      ││
│  │ Full Stack Engineer with 5 years│ 🏢 Companies Included                ││
│  │ building scalable React/Node.js │ ────────────────────────────────     ││
│  │ applications. Led frontend      │ ☑️ StartupCo (5 bullets)            ││
│  │ migration reducing load time by │ ☑️ BigCorp (4 bullets)              ││
│  │ 2s. Optimized APIs handling 10k │ ☑️ TechCo (3 bullets)               ││
│  │ req/sec.                        │ ☑️ WebCo (2 bullets)                ││
│  │                                 │ ☑️ CloudInc (2 bullets)             ││
│  │ EXPERIENCE                      │ ☑️ DataCorp (2 bullets)             ││
│  │                                 │                                      ││
│  │ Senior Engineer · StartupCo     │ 🎯 Active Bullet:                    ││
│  │ Mar 2024 - Present              │ [95%] Led React migration            ││
│  │                                 │                                      ││
│  │ • Led React migration for       │ 📍 Original STAR Entry               ││
│  │   client portal, reducing       │ ────────────────────────────────     ││
│  │   bundle size 40% and improving │ StartupCo · Q3 2024                  ││
│  │   load time by 2 seconds with   │ Frontend, Leadership                 ││
│  │   zero downtime                 │                                      ││
│  │   [Hover: from STAR #12, 95%]   │ Situation: Legacy Angular app...    ││
│  │                                 │                                      ││
│  │ • Built automated testing       │ Task: Lead migration without...     ││
│  │   framework achieving 85% code  │                                      ││
│  │   coverage and catching 20 bugs │ Action: Created incremental plan... ││
│  │   pre-deployment                │                                      ││
│  │   [Hover: from STAR #18, 82%]   │ Result: 40% bundle size reduction...││
│  │                                 │                                      ││
│  │ Engineer · BigCorp              │ [View Full Entry]                    ││
│  │ Jan 2022 - Mar 2024             │                                      ││
│  │                                 │ ──────────────────────────────────── ││
│  │ • Scaled Node.js API to 10k     │ 🔍 Skills Coverage                   ││
│  │   requests/second using Redis   │ ────────────────────────────────     ││
│  │   caching and database          │ React.js: 7 bullets ████████░░       ││
│  │   connection pooling            │ Node.js: 6 bullets ███████░░░        ││
│  │   [Hover: from STAR #7, 92%]    │ PostgreSQL: 4 bullets █████░░░       ││
│  │                                 │ Leadership: 3 bullets ████░░░░       ││
│  │ [Scroll for more...]            │                                      ││
│  │                                 │                                      ││
│  │ SKILLS                          │ ⚠️ Constraint Alerts                 ││
│  │ Frontend: React, TypeScript     │ ────────────────────────────────     ││
│  │ Backend: Node.js, PostgreSQL    │ None - all valid ✅                 ││
│  │ DevOps: Docker, AWS, CI/CD      │                                      ││
│  │                                 │                                      ││
│  │                                 │                                      ││
│  │ 📄 Page 1 of 1.4   687 words    │                                      ││
│  └─────────────────────────────────┴──────────────────────────────────────┘│
│                                                                              │
│  [← Reselect Bullets]  [Regenerate]  [Download .docx]  [Next: Export →]    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- **Split View:** Left = preview, Right = traceability panel
- **Hover Tooltips:** Hovering over bullet shows "[from STAR #X, Y% relevance]"
- **Bidirectional Highlighting:** 
  - Hover bullet in preview → highlights source in traceability
  - Click source in traceability → scrolls to and highlights bullet in preview
- **Edit Mode:** Inline markdown editing with live preview update
- **Constraint Indicators:** Real-time validation, warnings if edits violate constraints
- **Skills Coverage:** Visual bars show how many bullets cover each key skill

---

## 19. Resume Variant Generator - Constraint Violation Warning

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Resume Preview                                                              │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ ⚠️ Constraint Violations Detected                                    │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │ Your current selection exceeds the configured constraints:           │  │
│  │                                                                      │  │
│  │ 🔴 Bullet Count: 27 bullets (max: 25)                               │  │
│  │    → Remove 2 bullets to meet constraint                            │  │
│  │                                                                      │  │
│  │ 🔴 Page Length: 1.8 pages (max: 2 pages, target: 1.5)              │  │
│  │    → Consider removing 3-4 bullets or shortening content            │  │
│  │                                                                      │  │
│  │ ✅ Companies: 6 (target: 5-7)                                       │  │
│  │                                                                      │  │
│  │ ─────────────────────────────────────────────────────────────────── │  │
│  │                                                                      │  │
│  │ Options:                                                             │  │
│  │                                                                      │  │
│  │ [Auto-Remove Lowest-Scored Bullets]  (removes 2 bullets with scores │  │
│  │                                        <75%)                         │  │
│  │                                                                      │  │
│  │ [Manually Deselect Bullets]           (return to selection step)    │  │
│  │                                                                      │  │
│  │ [Adjust Constraints]                  (modify max bullets/pages)    │  │
│  │                                                                      │  │
│  │ [Proceed Anyway]                      (ignore warnings)             │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- Shows all constraint violations with severity (🔴 critical, 🟡 warning)
- Suggests specific actions to resolve each violation
- Auto-remove option intelligently selects lowest-value bullets to remove
- Proceed Anyway allows user to override (with confirmation dialog)

---

## 20. Resume Variant Generator - Step 5: Export Dialog

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Generate Targeted Resume Variant                              [Step 5/5]   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  Configure  Score   Select  Generate  Export                                │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Export Resume Variant                                                │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │ Variant Name *                                                       │  │
│  │ ┌────────────────────────────────────────────────────────────────┐   │  │
│  │ │ Senior Full Stack Engineer - TechCo                            │   │  │
│  │ └────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                      │  │
│  │ Export Formats (Select one or more)                                  │  │
│  │ ☑️ Markdown (.md)        - Editable, version control friendly       │  │
│  │ ☑️ Microsoft Word (.docx) - Standard format for applications        │  │
│  │ ☐ PDF (.pdf)             - Print-ready, non-editable                │  │
│  │                                                                      │  │
│  │ ─────────────────────────────────────────────────────────────────── │  │
│  │                                                                      │  │
│  │ Link to Application?                                                 │  │
│  │ ● Yes → [Select Application ▾]                                      │  │
│  │   ┌──────────────────────────────────────────────────────────────┐  │  │
│  │   │ TechCo - Senior Full Stack Engineer (Applied)              │  │  │
│  │   └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                                      │  │
│  │ ○ No, save as standalone variant                                    │  │
│  │                                                                      │  │
│  │ ─────────────────────────────────────────────────────────────────── │  │
│  │                                                                      │  │
│  │ 📊 Variant Summary                                                   │  │
│  │ • 18 bullets from 6 companies                                        │  │
│  │ • 687 words (~1.4 pages)                                             │  │
│  │ • Target role: Senior Full Stack Engineer                            │  │
│  │ • Top skills: React.js, Node.js, PostgreSQL, Leadership              │  │
│  │                                                                      │  │
│  │ ─────────────────────────────────────────────────────────────────── │  │
│  │                                                                      │  │
│  │ ⚠️ Note: All export formats will be saved to your Resumes Library   │  │
│  │          You can download them anytime from the variant detail page │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  [← Back to Preview]                      [Save & Export]                   │
│                                            (downloads selected formats)      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- **Variant Name:** Auto-populated from target role, editable
- **Multiple Formats:** Can export multiple formats at once
- **Application Linking:** If linked, variant appears in application detail page
- **Immediate Download:** Selected formats download immediately after save
- **Library Save:** Variant saved to resumes library regardless of download

---

## 21. Rebalance Resume Variant - Configuration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Variant Detail                                    [@] Profile ▼  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Rebalance Resume Variant                                                    │
│                                                                              │
│  Adjusting: "Senior Frontend Engineer - StartupX"                            │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Current Configuration                                                │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ • Target Role: Senior Frontend Engineer                             │  │
│  │ • Seniority: Senior (6-10 years)                                     │  │
│  │ • Key Skills: React.js, TypeScript, CSS, Performance                 │  │
│  │ • 20 bullets across 6 companies                                      │  │
│  │ • 724 words (~1.5 pages)                                             │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Rebalance Options                                                    │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │ What would you like to change?                                       │  │
│  │                                                                      │  │
│  │ ☑️ Change Target Role                                               │  │
│  │   ┌──────────────────────────────────────────────────────────────┐  │  │
│  │   │ New Role: Senior Full Stack Engineer                        │  │  │
│  │   └──────────────────────────────────────────────────────────────┘  │  │
│  │   (Will re-score all bullets for new role)                          │  │
│  │                                                                      │  │
│  │ ☑️ Adjust Skill Emphasis                                            │  │
│  │   Add: ☑️ Node.js  ☑️ PostgreSQL  ☐ AWS                            │  │
│  │   Keep: ☑️ React.js  ☐ TypeScript  ☐ CSS  ☐ Performance           │  │
│  │   (Changes bullet selection and order)                              │  │
│  │                                                                      │  │
│  │ ☐ Modify Constraints                                                │  │
│  │   Max Pages: [2 ▾]   Word Count: [700 words ▾]                     │  │
│  │                                                                      │  │
│  │ ─────────────────────────────────────────────────────────────────── │  │
│  │                                                                      │  │
│  │ Rebalance Strategy                                                   │  │
│  │ ● Keep current bullets, re-score and reorder                        │  │
│  │ ○ Allow new bullet selection (may add/remove bullets)               │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  [Cancel]                                     [Re-Score & Preview Changes]  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- Shows current configuration for context
- Checkboxes allow selective changes (role, skills, constraints)
- Strategy choice determines whether to keep same bullets or allow new selection
- "Keep current bullets" mode: re-scores existing bullets, adjusts order/emphasis
- "Allow new selection" mode: full re-scoring, may suggest adding/removing bullets

---

## 22. Rebalance Resume - Side-by-Side Diff View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Rebalance Preview                                                           │
│                                                                              │
│  ┌─────────────────────────────────┬──────────────────────────────────────┐│
│  │ 📄 Original Version             │ 📝 Rebalanced Version                ││
│  │ (Senior Frontend Engineer)      │ (Senior Full Stack Engineer)         ││
│  │ ───────────────────────────────│ ─────────────────────────────────────││
│  │                                 │                                      ││
│  │ PROFESSIONAL SUMMARY            │ PROFESSIONAL SUMMARY                 ││
│  │                                 │                                      ││
│  │ Frontend Engineer with 5 years  │ Full Stack Engineer with 5 years    ││
│  │ building responsive React apps. │ building scalable React/Node.js     ││
│  │ Expert in TypeScript, CSS, and  │ applications. Led frontend migration││
│  │ performance optimization.       │ and backend API scaling.            ││
│  │                                 │ [Changed]                            ││
│  │                                 │                                      ││
│  │ EXPERIENCE                      │ EXPERIENCE                           ││
│  │                                 │                                      ││
│  │ • Led React migration reducing  │ • Led React migration reducing      ││
│  │   load time by 2s               │   load time by 2s                   ││
│  │   [82% → 95%]                   │   [95% - Increased relevance]       ││
│  │                                 │                                      ││
│  │ • Built component library with  │ • Scaled Node.js API to 10k req/sec ││
│  │   50+ reusable components       │   [92% - New, high relevance]       ││
│  │   [78% → 65%]                   │   [Added]                            ││
│  │                                 │                                      ││
│  │ • Optimized CSS bundle reducing │ • Database optimization reducing    ││
│  │   size 30%                      │   latency 85%                       ││
│  │   [71% → 52%]                   │   [87% - Replaced lower-scoring]    ││
│  │   [Removed - lower relevance]   │   [Added]                            ││
│  │                                 │                                      ││
│  │ • Implemented responsive design │ • Built component library with      ││
│  │   system for mobile             │   50+ reusable components           ││
│  │   [69% → 61%]                   │   [65% - Kept but reordered]        ││
│  │                                 │   [Moved down]                       ││
│  │                                 │                                      ││
│  │ [Scroll for more...]            │ [Scroll for more...]                ││
│  │                                 │                                      ││
│  │                                 │                                      ││
│  │ 📊 Original: 724 words, 1.5 pg  │ 📊 Rebalanced: 698 words, 1.4 pg    ││
│  └─────────────────────────────────┴──────────────────────────────────────┘│
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 📊 Changes Summary                                                   │  │
│  │ ──────────────────────────────────────────────────────────────────── │  │
│  │ • 3 bullets added (Node.js, PostgreSQL focused)                      │  │
│  │ • 2 bullets removed (lower relevance for Full Stack role)            │  │
│  │ • 5 bullets reordered (higher backend emphasis)                      │  │
│  │ • Professional summary updated                                       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  [Reject Changes]  [Save as New Variant]  [Replace Original]               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- **Color Coding:**
  - Green: Added content
  - Red: Removed content  
  - Yellow: Changed/reordered content
  - Gray: Unchanged content
- **Score Changes:** Shows relevance score before → after (e.g., "[82% → 95%]")
- **Synchronized Scrolling:** Both panels scroll together
- **Three Save Options:**
  - Reject: Discard changes, keep original
  - Save as New: Create new variant, preserve original
  - Replace: Update existing variant

---

## 23. Compress to 1 Page - Compression Strategies

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Variant Detail                                    [@] Profile ▼  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Compress to 1 Page                                                          │
│                                                                              │
│  Current: "Senior Full Stack Engineer - TechCo" (1.8 pages)                 │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 📊 Current Status                                                    │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ • Length: 1.8 pages (~850 words)                                     │  │
│  │ • Target: 1 page (~475 words)                                        │  │
│  │ • Need to cut: ~375 words (44% reduction)                            │  │
│  │ • Current bullets: 22                                                │  │
│  │ • Companies: 7                                                       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Compression Strategies                                               │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │ ● Smart Trim (Recommended)                                           │  │
│  │   Automatically remove lowest-scoring bullets                        │  │
│  │                                                                      │  │
│  │   Estimate: Remove 7 bullets (scores < 75%)                          │  │
│  │   Result: 15 bullets, ~480 words, 1.0 pages                          │  │
│  │   Impact: Retains all excellent/great matches                        │  │
│  │                                                                      │  │
│  │   [Preview Smart Trim]                                               │  │
│  │                                                                      │  │
│  │ ○ Manual Selection                                                   │  │
│  │   Choose specific bullets to remove                                  │  │
│  │                                                                      │  │
│  │   You select which bullets to keep/remove                            │  │
│  │   Real-time page count as you adjust                                 │  │
│  │                                                                      │  │
│  │   [Choose Bullets Manually]                                          │  │
│  │                                                                      │  │
│  │ ○ Condense All                                                       │  │
│  │   Keep all bullets, shorten each by ~30%                             │  │
│  │                                                                      │  │
│  │   Estimate: 22 bullets, ~490 words, 1.0 pages                        │  │
│  │   Impact: More content, but less detail per bullet                   │  │
│  │   AI will condense while preserving key metrics                      │  │
│  │                                                                      │  │
│  │   [Preview Condensed Version]                                        │  │
│  │                                                                      │  │
│  │ ○ Hybrid Approach                                                    │  │
│  │   Remove some bullets + condense remaining                           │  │
│  │                                                                      │  │
│  │   Remove: [4 ▾] bullets   Condense by: [20% ▾]                      │  │
│  │   Estimate: 18 bullets, ~485 words, 1.0 pages                        │  │
│  │                                                                      │  │
│  │   [Preview Hybrid]                                                   │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  [Cancel]                                                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- Shows current status and target reduction needed
- Four compression strategies with trade-offs explained
- Estimates show predicted outcome (bullet count, word count, page count)
- Each strategy has preview button to see before committing
- Real-time calculations update as user adjusts hybrid approach settings

---

## 24. Compress to 1 Page - Real-Time Progress

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Compression Progress                                                        │
│                                                                              │
│  Strategy: Manual Selection                                                  │
│                                                                              │
│  ┌─────────────────────────────────┬──────────────────────────────────────┐│
│  │ 📝 Bullet Selection             │ 📊 Live Metrics                      ││
│  │ ───────────────────────────────│ ─────────────────────────────────────││
│  │                                 │                                      ││
│  │ Select bullets to KEEP:         │ 🎯 Target: 1 page                    ││
│  │                                 │                                      ││
│  │ ☑️ [95%] React migration        │ Current Status:                      ││
│  │ ☑️ [92%] Node API scaling       │ ████████████░░░░  1.2 pages         ││
│  │ ☑️ [87%] Database optimization  │                                      ││
│  │ ☑️ [84%] Team mentoring         │ Words: 567 / ~475 target             ││
│  │ ☑️ [82%] Testing framework      │ Over by: 92 words                    ││
│  │ ☑️ [78%] Code review process    │ ⚠️ Still too long                   ││
│  │ ☑️ [76%] CI/CD pipeline         │                                      ││
│  │ ☐ [74%] Mobile optimization     │ Bullets: 15 selected                 ││
│  │ ☐ [71%] Component library       │ Companies: 6                         ││
│  │ ☐ [69%] Accessibility features  │                                      ││
│  │ ☐ [67%] Performance monitoring  │ 💡 Suggestion:                       ││
│  │ ☐ [65%] Documentation system    │ Remove 2 more bullets                ││
│  │                                 │ OR condense selected bullets         ││
│  │ [Scroll for more...]            │                                      ││
│  │                                 │ [Auto-Condense to Fit]               ││
│  │                                 │                                      ││
│  └─────────────────────────────────┴──────────────────────────────────────┘│
│                                                                              │
│  [← Back to Strategies]                          [Preview Selected]         │
│                                                   (enabled when ≤1 page)     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Notes:
- **Real-Time Updates:** Page count and word count update instantly as bullets toggled
- **Visual Progress Bar:** Shows current length relative to 1-page target
- **Color Coding:**
  - Green: Fits 1 page
  - Yellow: Slightly over (1.0-1.1 pages)
  - Red: Significantly over (>1.1 pages)
- **Auto-Condense Button:** AI shortens selected bullets to fit exactly 1 page
- **Scrollable List:** All bullets visible with relevance scores

---

## Mobile Considerations for Resume Variant Generator

### Step 1: Configure Target (Mobile)

```
┌───────────────────────┐
│ ← Generate Variant [@]│
├───────────────────────┤
│ Step 1/5: Configure   │
│ ━●━━━━━━━━━━━━━━━━━━━│
│                       │
│ Target Role *         │
│ ┌───────────────────┐ │
│ │ Full Stack Eng.   │ │
│ └───────────────────┘ │
│                       │
│ Seniority Level       │
│ ○ Junior              │
│ ● Mid-Level           │
│ ○ Senior              │
│ ○ Lead/Staff          │
│                       │
│ Key Skills (3-5)      │
│ ☑ React.js            │
│ ☑ Node.js             │
│ ☑ PostgreSQL          │
│ [+Add Skill]          │
│                       │
│ Constraints           │
│ Pages: [2 ▾]          │
│ Words: [700 ▾]        │
│                       │
│ [Next: Score →]       │
│                       │
└───────────────────────┘
```

### Step 3: Bullet Selection (Mobile)

```
┌───────────────────────┐
│ ← Select Bullets  [@] │
├───────────────────────┤
│ Step 3/5: Select      │
│ ━━━━━━━━●━━━━━━━━━━━━│
│                       │
│ 📊 Selected: 12/25    │
│ ████████░░░░░░ 48%    │
│ ⚠️ Need 3 more        │
│                       │
│ [Auto-Select]         │
│                       │
│ ─── Excellent ─────   │
│                       │
│ ☑ [95%] React migr.   │
│   StartupCo · Q3 2024 │
│   [Preview]           │
│                       │
│ ☑ [92%] API scaling   │
│   BigCorp · Q1 2025   │
│   [Preview]           │
│                       │
│ ─── Great ─────────   │
│                       │
│ ☐ [87%] DB optim.     │
│   TechCo · Q2 2024    │
│   [Preview]           │
│                       │
│ [Load More...]        │
│                       │
│ [Next: Generate →]    │
│                       │
└───────────────────────┘
```

### Mobile Adaptations:
- **Vertical Stack:** All steps in single column
- **Sticky Progress:** Step indicator sticky at top
- **Collapsed Sections:** Bullets grouped by score range, collapsed by default
- **Bottom Actions:** Action buttons fixed at bottom
- **Swipe Navigation:** Swipe left/right between steps
- **Compact Preview:** Traceability panel as bottom sheet (not side-by-side)

---
