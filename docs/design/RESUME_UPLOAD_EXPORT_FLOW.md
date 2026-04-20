# Resume Upload and Export User Flow

## Overview
This document outlines the complete user journey for uploading a master resume, parsing it for STAR-formatted experiences, and exporting tailored versions for specific job applications.

**Navigation:** See [NAVIGATION_STRUCTURE.md](./NAVIGATION_STRUCTURE.md) for complete navigation patterns between Dashboard, Applications, and Resume Manager.

---

## Quick Navigation Guide

### How to Access Resume Manager from Dashboard:
1. **Top Navigation Bar:** Click "Resume Manager" tab
2. **Dashboard Widget:** Click "Your Resumes" widget
3. **Quick Actions:** Click "Upload Resume" button

### How to Return to Dashboard:
1. **Top Navigation Bar:** Click "Dashboard" tab
2. **Breadcrumb:** Click "Dashboard" in breadcrumb trail
3. **Browser Back Button:** Use browser back navigation

---

## User Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RESUME UPLOAD & EXPORT FLOW                      │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┐
│  User lands  │
│  on Dashboard│
└──────┬───────┘
       │
       v
┌──────────────────┐
│ Navigate to      │     ┌──────────────────────────────┐
│ "Resume Manager" │────>│ First Time User?             │
│ section          │     │ • Yes → Show onboarding tip  │
└──────────────────┘     │ • No  → Show existing uploads│
                         └────────┬─────────────────────┘
                                  │
                 ┌────────────────┴────────────────┐
                 │                                 │
                 v                                 v
       ┌──────────────────┐              ┌──────────────────┐
       │ UPLOAD NEW RESUME│              │ VIEW EXISTING    │
       └────────┬─────────┘              │ RESUMES          │
                │                        └────────┬─────────┘
                v                                 │
       ┌──────────────────┐                       │
       │ 1. File Selection│                       │
       │ • Drag & drop    │                       │
       │ • File picker    │                       │
       └────────┬─────────┘                       │
                │                                 │
                v                                 │
       ┌──────────────────┐                       │
       │ 2. Validation    │                       │
       │ • Format check   │                       │
       │ • Size check     │                       │
       └────────┬─────────┘                       │
                │                                 │
        ┌───────┴────────┐                        │
        │ Valid?         │                        │
        │ No  → Show error                        │
        │ Yes → Continue │                        │
        └───────┬────────┘                        │
                │                                 │
                v                                 │
       ┌──────────────────┐                       │
       │ 3. Upload        │                       │
       │ • Show progress  │                       │
       │ • Allow cancel   │                       │
       └────────┬─────────┘                       │
                │                                 │
                v                                 │
       ┌──────────────────┐                       │
       │ 4. Parse Resume  │                       │
       │ • Extract info   │                       │
       │ • Identify STAR  │                       │
       │ • Structure data │                       │
       └────────┬─────────┘                       │
                │                                 │
        ┌───────┴────────┐                        │
        │ Success?       │                        │
        │ No → Retry/Edit│                        │
        │ Yes → Continue │                        │
        └───────┬────────┘                        │
                │                                 │
                v                                 │
       ┌──────────────────┐                       │
       │ 5. Review Parsed │                       │
       │    Data          │                       │
       │ • Experiences    │                       │
       │ • Education      │<──────────────────────┘
       │ • Skills         │
       └────────┬─────────┘
                │
                v
       ┌──────────────────┐
       │ Edit/Confirm?    │
       │ • Edit → Manual  │
       │   adjustments    │
       │ • Confirm → Save │
       └────────┬─────────┘
                │
                v
       ┌──────────────────────────────────────────┐
       │      MASTER RESUME STORED                │
       │  Ready for tailored exports              │
       └────────┬─────────────────────────────────┘
                │
                │
┌───────────────┴────────────────┐
│                                │
v                                v
┌──────────────────┐    ┌──────────────────┐
│ CREATE EXPORT    │    │ LINK TO          │
│ FROM MASTER      │    │ APPLICATION      │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         v                       │
┌──────────────────┐             │
│ 1. Select        │             │
│    Experiences   │             │
│ • Check relevant │             │
│   jobs           │             │
│ • Reorder        │             │
└────────┬─────────┘             │
         │                       │
         v                       │
┌──────────────────┐             │
│ 2. Customize     │             │
│ • Edit bullets   │             │
│ • Adjust STAR    │             │
│ • Add keywords   │             │
└────────┬─────────┘             │
         │                       │
         v                       │
┌──────────────────┐             │
│ 3. Preview       │             │
│ • View markdown  │             │
│ • Check format   │             │
└────────┬─────────┘             │
         │                       │
         v                       │
┌──────────────────┐             │
│ 4. Save Export   │             │
│ • Name version   │<────────────┘
│ • Link to app?   │
└────────┬─────────┘
         │
         v
┌──────────────────────────────────────────┐
│      EXPORT SAVED TO LIST                │
│  Available for download/preview          │
└────────┬─────────────────────────────────┘
         │
         │
┌────────┴──────────┐
│                   │
v                   v
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Download as  │   │ Preview in   │   │ Edit and     │
│ • Markdown   │   │ modal        │   │ re-export    │
│ • PDF        │   │              │   │              │
│ • DOCX       │   │              │   │              │
└──────────────┘   └──────────────┘   └──────────────┘
```

---

## Detailed Flow Steps

### Phase 1: Upload Master Resume

#### Step 1.1: Access Resume Manager
- User clicks "Resume Manager" in navigation
- Or clicks "Upload Resume" from Application Form

#### Step 1.2: Upload Interface
- **Empty State:**
  - Large drag-and-drop zone
  - Instructions for accepted formats (PDF, DOCX, TXT)
  - Browse button as alternative
- **Existing Uploads:**
  - List of previously uploaded resumes
  - Option to upload new or select existing

#### Step 1.3: File Validation
- **Client-side checks:**
  - File type: .pdf, .docx, .txt only
  - File size: Max 10MB
  - Single file upload
- **Error States:**
  - Invalid format → "Please upload PDF, DOCX, or TXT"
  - Too large → "File must be under 10MB"

#### Step 1.4: Upload Progress
- Progress bar showing upload percentage
- File name and size display
- Cancel button during upload

#### Step 1.5: Server-side Parsing
- Spinner with status messages:
  - "Uploading..."
  - "Analyzing resume..."
  - "Extracting experiences..."
  - "Identifying STAR format..."
- Estimated time: 10-30 seconds

#### Step 1.6: Parse Results
- **Success:**
  - Show summary card:
    - X work experiences found
    - X education entries
    - X skills identified
  - [View Details] [Save] buttons
- **Partial Success:**
  - Show what was extracted
  - Warning about missing data
  - Option to manually add/edit
- **Failure:**
  - Error message with suggestion
  - [Try Different Format] [Contact Support]

---

### Phase 2: Review and Edit Parsed Data

#### Step 2.1: Master Resume Editor
- **Layout:**
  - Left: Section tabs (Experience, Education, Skills)
  - Right: Preview panel
- **Experience Section:**
  - List of jobs with company, role, dates
  - Expandable STAR bullets for each role
  - Edit, reorder, delete actions
- **Education Section:**
  - Degree, institution, dates
  - Honors, GPA (if relevant)
- **Skills Section:**
  - Categorized skill tags
  - Add/remove/edit

#### Step 2.2: STAR Format Editor
For each experience bullet:
```
┌─────────────────────────────────────┐
│ Original: "Led team of 5 engineers  │
│ to build authentication system"     │
│                                     │
│ Situation: [Auto-extracted or edit]│
│ Task:      [Auto-extracted or edit]│
│ Action:    [Auto-extracted or edit]│
│ Result:    [Auto-extracted or edit]│
│                                     │
│ [Save] [Revert] [Delete]            │
└─────────────────────────────────────┘
```

#### Step 2.3: Save Master Resume
- Prompt for resume name (default: "Master Resume [Date]")
- Confirmation: "Master resume saved!"
- Option to immediately create export or return to list

---

### Phase 3: Create Tailored Export

#### Step 3.1: Export Builder Entry Points
- From Resume Manager: [+ Create New Export]
- From Application Form: [Link Resume Version]
- From ApplicationCard: Drag export onto card

#### Step 3.2: Select Experiences
- Checkbox list of all experiences from master
- Filter/search by company, role, keywords
- Reorder selected items (drag handles)
- Summary: "3 of 7 experiences selected"

#### Step 3.3: Tailor Content
- **For each selected experience:**
  - Edit STAR bullets to match job description
  - Add/remove specific bullets
  - Adjust keywords for ATS optimization
- **Skills section:**
  - Highlight relevant skills for this role
  - Reorder by relevance

#### Step 3.4: Preview Export
- **Preview Panel:**
  - Left: Markdown source (editable)
  - Right: Rendered preview
  - Toggle between edit/view modes
- **Format Options:**
  - Font size, margins, spacing
  - Section order
  - Include/exclude sections

#### Step 3.5: Save Export
- **Export Metadata:**
  - Name: Default "{Job Title} - {Company}"
  - Link to application (optional)
  - Tags for organization
- **Save Actions:**
  - [Save Draft] — Save without finalizing
  - [Save & Download] — Save and download immediately
  - [Cancel] — Discard changes

---

### Phase 4: Manage Exports

#### Step 4.1: Export List View
- **List Display:**
  - Card for each export
  - Sort by: Recent, Name, Linked Apps
  - Filter by: Linked, Standalone, Format
- **Card Actions:**
  - Preview (opens modal)
  - Download (shows format picker)
  - Delete (with confirmation)
  - Duplicate (create copy to edit)

#### Step 4.2: Download Export
- **Format Selection:**
  - Markdown (.md) — For further editing
  - PDF (.pdf) — For direct submission
  - Word (.docx) — For ATS compatibility
- **Download Trigger:**
  - Browser download
  - Success toast: "Resume downloaded!"

#### Step 4.3: Link to Application
- **From Export List:**
  - Drag export card onto ApplicationCard
  - Or click "Link" → Select application from dropdown
- **From Application Form:**
  - Resume picker dropdown
  - Shows all exports, highlights matches
- **Visual Indicator:**
  - ApplicationCard shows 📎 icon when resume linked
  - Export card shows linked app name

---

## Integration Points

### Dashboard Integration
- Widget: "Resume Versions" with count and quick actions
- Recent exports shown in activity feed

### Application Form Integration
- New field: "Resume Version" (optional)
- Dropdown to select from existing exports
- Quick action: [Create New Export]

### ApplicationCard Integration
- Icon indicator for linked resume
- Hover tooltip: "Resume: {export name}"
- Click to preview linked resume

### Kanban Board Integration
- Bulk action: "Apply Resume Version" to multiple apps
- Filter applications by: "Has Resume" / "No Resume"

---

## Error Scenarios and Handling

### Upload Errors
| Error | Cause | User Action |
|-------|-------|-------------|
| Network timeout | Slow connection | Retry upload |
| Invalid file type | Wrong format | Upload different file |
| Parsing failure | Unreadable content | Manual entry or different format |
| Server error | Backend issue | Contact support |

### Export Errors
| Error | Cause | User Action |
|-------|-------|-------------|
| No experiences selected | User forgot to select | Prompt to select at least one |
| Generation failure | PDF/DOCX conversion issue | Download markdown instead |
| Save conflict | Duplicate name | Rename export |

---

## Success Metrics

### User Flow Completion
- **Upload Success Rate:** % of uploads that parse successfully
- **Export Creation Rate:** Avg exports per user
- **Link Rate:** % of applications with linked resumes
- **Time to First Export:** Time from upload to first download

### User Satisfaction
- **Parsing Accuracy:** % of correctly identified STAR bullets
- **Edit Frequency:** How often users edit parsed data
- **Format Preference:** Most downloaded format (MD/PDF/DOCX)

---

## Future Enhancements

### Phase 2 Features (Post-MVP)
- AI-powered keyword optimization
- Job description matching score
- Bulk export (multiple formats at once)
- Version comparison view
- Resume templates
- ATS compatibility checker

### Advanced Features
- Cover letter integration
- Skills gap analysis
- Interview prep from STAR bullets
- Resume analytics (views, downloads)
