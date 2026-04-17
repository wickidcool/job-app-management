# Core UI Components

This directory contains the foundational presentational components for the Job Application Manager.

## Components

### StatusBadge

Visual indicator for application status with consistent color coding.

**Usage:**

```tsx
import { StatusBadge } from './components';

// Filled variant (default)
<StatusBadge status="applied" />

// Outlined variant
<StatusBadge status="interview" variant="outlined" />

// Dot variant
<StatusBadge status="offer" variant="dot" />

// With icon
<StatusBadge status="phone_screen" showIcon size="lg" />
```

**Props:**
- `status`: ApplicationStatus (required)
- `size`: 'sm' | 'md' | 'lg' (default: 'md')
- `variant`: 'filled' | 'outlined' | 'dot' (default: 'filled')
- `showIcon`: boolean (default: false)

---

### EmptyState

Friendly message when no data is available.

**Usage:**

```tsx
import { EmptyState } from './components';

// No applications variant
<EmptyState
  variant="no-applications"
  onAction={() => console.log('Add application')}
/>

// No results variant
<EmptyState
  variant="no-results"
  onAction={() => console.log('Clear filters')}
  actionLabel="Reset Filters"
/>

// No documents variant
<EmptyState variant="no-documents" />
```

**Props:**
- `variant`: 'no-applications' | 'no-results' | 'no-documents' (required)
- `onAction`: () => void (optional)
- `actionLabel`: string (optional, uses default if not provided)

---

### DashboardStats

Display key metrics at a glance.

**Usage:**

```tsx
import { DashboardStats } from './components';

const stats = {
  total: 24,
  appliedThisWeek: 8,
  responseRate: 33,
  inReview: 3,
};

// Normal state
<DashboardStats stats={stats} />

// Loading state
<DashboardStats stats={stats} loading />
```

**Props:**
- `stats`: Object with `total`, `appliedThisWeek`, `responseRate`, `inReview` (required)
- `loading`: boolean (default: false)

---

## Accessibility

All components follow accessibility best practices:

- **ARIA roles and labels** for screen readers
- **Keyboard navigation** support
- **Focus indicators** for interactive elements
- **Color is not the sole differentiator** (uses icons + text)

## Design Tokens

Components use design tokens from `tailwind.config.ts`:

- Colors: primary, neutral, success, warning, error, info, orange, purple
- Status colors: saved, applied, phone_screen, interview, offer, rejected, withdrawn
- Typography: defined font sizes and weights
- Spacing: consistent spacing scale
- Shadows and borders: standardized elevations

## Testing

Each component should be tested for:
- All states render correctly
- Props validation works
- Accessibility attributes present
- Keyboard navigation functional
- Screen reader announces correctly
- Responsive at all breakpoints
