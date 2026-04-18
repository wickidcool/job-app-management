# UI/UX Design Specifications

**Project:** Job Application Manager  
**Phase:** MVP (Phase 1)  
**Created:** April 15, 2026  
**Designer:** UI/UX Developer  
**Status:** ✅ Complete — Ready for Frontend Development

---

## Overview

This directory contains comprehensive UI/UX design specifications for the Job Application Manager's application tracking features. These documents provide everything the Frontend Developer needs to implement the user interface.

---

## Documents

### 1. [User Flows](./USER_FLOWS.md)
**Purpose:** Visualize how users navigate the application and complete key tasks.

**Contents:**
- Primary user flows (Add application, Update status, View dashboard, Link documents)
- Navigation maps
- Error handling flows
- Accessibility-aware keyboard navigation flows

**Key Diagrams:**
- Add New Job Application (mermaid flowchart)
- Update Application Status (with valid transitions)
- Dashboard interaction flow (Kanban & Table views)
- Cover letter linking flow

---

### 2. [Wireframes](./WIREFRAMES.md)
**Purpose:** Visual blueprints for all core screens and components.

**Contents:**
- Dashboard (Kanban and Table modes)
- Application Detail page
- Add/Edit Application modal
- Cover Letter Picker
- Empty states
- Mobile responsive layouts (< 768px)

**Wireframe Format:** ASCII art with detailed annotations for interaction patterns.

**Responsive Breakpoints:**
- Mobile: < 768px (single column, bottom sheets)
- Tablet: 768-1024px (2-3 columns)
- Desktop: > 1024px (6-column kanban)

---

### 3. [Component Specifications](./COMPONENT_SPECS.md)
**Purpose:** Detailed technical specs for all reusable UI components.

**Contents:**
- 10 core components with props, states, and variants
- Visual state definitions (default, hover, dragging, disabled)
- Behavior specifications (drag & drop, keyboard navigation)
- Accessibility requirements per component
- Animation guidelines
- Testing checklist

**Components Defined:**
1. ApplicationCard (kanban & list variants)
2. StatusBadge (filled, outlined, dot)
3. ApplicationForm (create & edit modes)
4. KanbanBoard (drag & drop)
5. DashboardStats (metric cards)
6. FilterPanel (search, filters, active chips)
7. StatusDropdown (with valid transitions)
8. DocumentLinker (cover letters, resumes)
9. StatusTimeline (chronological history)
10. EmptyState (no data scenarios)

---

### 4. [Design System](./DESIGN_SYSTEM.md)
**Purpose:** Centralized design tokens for consistent styling across the application.

**Contents:**
- **Color Palette:** Primary, neutral, semantic, status-specific colors
- **Typography:** Font families (Inter), type scale, weights
- **Spacing:** 8px grid system, layout guidelines
- **Shadows:** 6-level elevation system
- **Border Radius:** Component-specific radius mapping
- **Breakpoints:** Responsive design breakpoints
- **Z-Index Scale:** Layering hierarchy
- **Transitions:** Animation tokens and easing functions

**Export Formats:**
- CSS Custom Properties (`:root`)
- Tailwind CSS config
- CSS-in-JS theme object

---

### 5. [Accessibility](./ACCESSIBILITY.md)
**Purpose:** Ensure WCAG 2.1 Level AA compliance for inclusive design.

**Contents:**
- Keyboard navigation patterns (global & component-specific)
- Screen reader support (ARIA labels, roles, live regions)
- Focus management (indicators, tab order, modal traps)
- Color contrast validation (4.5:1 for text, 3:1 for UI)
- Form accessibility (labels, validation, errors)
- Testing checklist (automated & manual)

**Key Requirements:**
- All features keyboard-accessible
- Minimum 44x44px touch targets
- Focus indicators visible at 3:1 contrast
- Color never sole indicator of meaning
- ARIA patterns for custom widgets

---

## Quick Start for Frontend Developer

### 1. Read Documents in This Order
1. **USER_FLOWS.md** — Understand user journeys
2. **DESIGN_SYSTEM.md** — Set up tokens/variables
3. **WIREFRAMES.md** — See screen layouts
4. **COMPONENT_SPECS.md** — Build components
5. **ACCESSIBILITY.md** — Test compliance

### 2. Setup Design Tokens

Install Inter font:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Configure Tailwind with tokens from `DESIGN_SYSTEM.md`:
```bash
# Update tailwind.config.js with color palette, spacing, etc.
```

### 3. Component Development Order

**Phase 1 (Foundation):**
1. Design tokens (colors, typography, spacing)
2. StatusBadge
3. ApplicationCard
4. DashboardStats
5. EmptyState

**Phase 2 (Core Features):**
6. ApplicationForm
7. StatusDropdown
8. FilterPanel
9. KanbanBoard (or Table view)

**Phase 3 (Advanced):**
10. DocumentLinker
11. StatusTimeline
12. Drag & Drop interactions

### 4. Testing Checklist

Before marking a component complete:
- [ ] All states implemented (default, hover, focus, disabled, error)
- [ ] Responsive at all breakpoints (mobile, tablet, desktop)
- [ ] Keyboard navigation works
- [ ] Screen reader tested (VoiceOver or NVDA)
- [ ] Color contrast validated (4.5:1 minimum)
- [ ] Focus indicators visible
- [ ] Animations smooth (60fps)

---

## Dependencies & Recommendations

Based on the design specs, consider these libraries:

| Library | Purpose | Reason |
|---------|---------|--------|
| [Tailwind CSS](https://tailwindcss.com/) | Utility-first CSS | Matches design token structure |
| [Headless UI](https://headlessui.com/) | Accessible primitives | Pre-built ARIA patterns |
| [React Hook Form](https://react-hook-form.com/) | Form state | Performance + validation |
| [Zod](https://zod.dev/) | Schema validation | Type-safe form validation |
| [dnd-kit](https://dndkit.com/) | Drag & Drop | Accessible, keyboard-friendly |
| [Radix UI](https://www.radix-ui.com/) | Advanced components | Dropdowns, modals, tooltips |
| [date-fns](https://date-fns.org/) | Date formatting | Relative timestamps ("2d ago") |

---

## Design Decisions & Rationale

### Why Kanban as Primary View?
- Visual workflow management is intuitive for job application stages
- Drag & drop provides quick status updates
- Column layout naturally maps to application lifecycle
- Alternative table view available for detail-oriented users

### Why 8px Spacing Grid?
- Aligns with Tailwind CSS defaults
- Divisible by common viewport widths
- Provides enough granularity without excessive options

### Why Inter Font?
- Open-source, professionally designed
- Excellent readability at all sizes
- Wide language support
- Optimized for UI design (tight tracking, clear numerals)

### Why These Status Colors?
- Industry-standard traffic light metaphor (green = good, red = stopped)
- Each status has distinct hue (blue, yellow, orange, purple, green, red)
- Paired with icons/text so color-blind users not excluded
- All pass WCAG AA contrast requirements

---

## Known Limitations & Future Enhancements

### MVP Scope (Current)
- ✅ Kanban and Table views
- ✅ Basic filtering (status, company, search)
- ✅ Keyboard navigation
- ✅ Mobile responsive

### Post-MVP (Phase 2+)
- ⏳ Dark mode support (tokens prepared, not implemented)
- ⏳ Advanced filters (salary range, date range sliders)
- ⏳ Customizable kanban columns
- ⏳ Bulk actions (multi-select cards)
- ⏳ Export data (CSV, PDF)
- ⏳ Calendar view for deadlines
- ⏳ Email templates for follow-ups

---

## Questions or Clarifications?

If any design spec is unclear or requires adjustment during implementation:

1. **Small tweaks** (e.g., padding adjustment): Frontend Developer can make judgment calls
2. **Behavior questions** (e.g., error handling): Check USER_FLOWS.md or ask UI/UX Developer
3. **Accessibility concerns**: Refer to ACCESSIBILITY.md or consult WCAG guidelines
4. **New features not in scope**: Flag for Product Owner / Client Engagement Manager

---

## Approval & Handoff

- [x] User flows documented
- [x] Wireframes for all core screens
- [x] Component specs ready for implementation
- [x] Design system tokens defined
- [x] Accessibility guidelines provided

**Ready for handoff to Frontend Developer** ([WIC-18](/WIC/issues/WIC-18))

**Next Steps:**
1. Frontend Developer reviews all docs
2. Sets up project with design tokens
3. Implements components per spec
4. Architect provides API contracts ([WIC-17](/WIC/issues/WIC-17)) for data integration
5. QA validates against these design specs

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | Apr 15, 2026 | Initial design specifications | UI/UX Developer |

---

**End of Design Specs**
