# Design System — Job Application Manager

This design system provides a consistent visual language and reusable tokens for the Job Application Manager.

---

## Table of Contents

1. [Color Palette](#color-palette)
2. [Typography](#typography)
3. [Spacing & Layout](#spacing--layout)
4. [Shadows & Elevation](#shadows--elevation)
5. [Border Radius](#border-radius)
6. [Breakpoints](#breakpoints)
7. [Z-Index Scale](#z-index-scale)
8. [Transitions](#transitions)

---

## Color Palette

### Brand Colors

```css
:root {
  /* Primary (Blue) - Main brand color, CTAs, links */
  --color-primary-50: #eff6ff;
  --color-primary-100: #dbeafe;
  --color-primary-200: #bfdbfe;
  --color-primary-300: #93c5fd;
  --color-primary-400: #60a5fa;
  --color-primary-500: #3b82f6;  /* Primary */
  --color-primary-600: #2563eb;
  --color-primary-700: #1d4ed8;
  --color-primary-800: #1e40af;
  --color-primary-900: #1e3a8a;

  /* Neutral (Gray) - Text, backgrounds, borders */
  --color-neutral-50: #f9fafb;
  --color-neutral-100: #f3f4f6;
  --color-neutral-200: #e5e7eb;
  --color-neutral-300: #d1d5db;
  --color-neutral-400: #9ca3af;
  --color-neutral-500: #6b7280;
  --color-neutral-600: #4b5563;
  --color-neutral-700: #374151;
  --color-neutral-800: #1f2937;
  --color-neutral-900: #111827;
}
```

### Semantic Colors

```css
:root {
  /* Success (Green) */
  --color-success-50: #f0fdf4;
  --color-success-100: #dcfce7;
  --color-success-500: #22c55e;  /* Offer status */
  --color-success-700: #15803d;

  /* Warning (Yellow) */
  --color-warning-50: #fefce8;
  --color-warning-100: #fef9c3;
  --color-warning-500: #eab308;  /* Applied status */
  --color-warning-700: #a16207;

  /* Error (Red) */
  --color-error-50: #fef2f2;
  --color-error-100: #fee2e2;
  --color-error-500: #ef4444;    /* Rejected status */
  --color-error-700: #b91c1c;

  /* Info (Cyan) */
  --color-info-50: #ecfeff;
  --color-info-100: #cffafe;
  --color-info-500: #06b6d4;     /* Saved status */
  --color-info-700: #0e7490;
}
```

### Status-Specific Colors

```css
:root {
  /* Application Status Colors */
  --status-saved: var(--color-info-500);          /* Blue */
  --status-applied: var(--color-warning-500);     /* Yellow */
  --status-phone-screen: #f97316;                 /* Orange */
  --status-interview: #a855f7;                    /* Purple */
  --status-offer: var(--color-success-500);       /* Green */
  --status-rejected: var(--color-error-500);      /* Red */
  --status-withdrawn: var(--color-neutral-400);   /* Gray */
}
```

### Background & Surface Colors

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: var(--color-neutral-50);
  --bg-tertiary: var(--color-neutral-100);
  
  --surface-raised: #ffffff;
  --surface-sunken: var(--color-neutral-50);
  
  --overlay-backdrop: rgba(0, 0, 0, 0.5);
}
```

### Text Colors

```css
:root {
  --text-primary: var(--color-neutral-900);
  --text-secondary: var(--color-neutral-600);
  --text-tertiary: var(--color-neutral-500);
  --text-disabled: var(--color-neutral-400);
  --text-inverse: #ffffff;
  
  --text-link: var(--color-primary-600);
  --text-link-hover: var(--color-primary-700);
}
```

### Border Colors

```css
:root {
  --border-default: var(--color-neutral-200);
  --border-strong: var(--color-neutral-300);
  --border-focus: var(--color-primary-500);
  --border-error: var(--color-error-500);
}
```

---

## Typography

### Font Families

```css
:root {
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 
               'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
}
```

**Recommendation:** Import [Inter](https://fonts.google.com/specimen/Inter) from Google Fonts for a modern, readable sans-serif.

### Type Scale

| Name | Size | Line Height | Weight | Use Case |
|------|------|-------------|--------|----------|
| Display | 48px | 1.2 | 700 | Hero headings (rare) |
| H1 | 36px | 1.25 | 700 | Page titles |
| H2 | 30px | 1.3 | 600 | Section headings |
| H3 | 24px | 1.4 | 600 | Subsection headings |
| H4 | 20px | 1.4 | 600 | Card titles |
| Body-lg | 18px | 1.6 | 400 | Large body text |
| Body | 16px | 1.5 | 400 | Default body text |
| Body-sm | 14px | 1.5 | 400 | Secondary text, labels |
| Caption | 12px | 1.4 | 400 | Timestamps, meta info |
| Overline | 10px | 1.4 | 600 | All-caps labels |

### CSS Custom Properties

```css
:root {
  /* Font Sizes */
  --text-display: 3rem;      /* 48px */
  --text-h1: 2.25rem;        /* 36px */
  --text-h2: 1.875rem;       /* 30px */
  --text-h3: 1.5rem;         /* 24px */
  --text-h4: 1.25rem;        /* 20px */
  --text-lg: 1.125rem;       /* 18px */
  --text-base: 1rem;         /* 16px */
  --text-sm: 0.875rem;       /* 14px */
  --text-xs: 0.75rem;        /* 12px */
  --text-overline: 0.625rem; /* 10px */

  /* Font Weights */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;

  /* Line Heights */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;
}
```

### Utility Classes (Tailwind)

```css
/* Headings */
.text-display { font-size: 3rem; font-weight: 700; line-height: 1.2; }
.text-h1 { font-size: 2.25rem; font-weight: 700; line-height: 1.25; }
.text-h2 { font-size: 1.875rem; font-weight: 600; line-height: 1.3; }
.text-h3 { font-size: 1.5rem; font-weight: 600; line-height: 1.4; }
.text-h4 { font-size: 1.25rem; font-weight: 600; line-height: 1.4; }

/* Body */
.text-body-lg { font-size: 1.125rem; line-height: 1.6; }
.text-body { font-size: 1rem; line-height: 1.5; }
.text-body-sm { font-size: 0.875rem; line-height: 1.5; }
.text-caption { font-size: 0.75rem; line-height: 1.4; }
```

---

## Spacing & Layout

### Spacing Scale (8px base grid)

```css
:root {
  --space-0: 0;
  --space-1: 0.25rem;   /*  4px */
  --space-2: 0.5rem;    /*  8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
  --space-16: 4rem;     /* 64px */
  --space-20: 5rem;     /* 80px */
  --space-24: 6rem;     /* 96px */
}
```

### Layout Guidelines

| Element | Padding | Margin | Gap |
|---------|---------|--------|-----|
| Container (max-width) | - | auto | - |
| Section | 48px vertical | 24px bottom | - |
| Card | 16px all sides | 12px between cards | - |
| Form Field | 12px vertical | 16px bottom | - |
| Button | 8px vertical, 16px horizontal | - | 8px between buttons |
| Grid | - | - | 16px (desktop), 12px (mobile) |

### Container Widths

```css
.container {
  width: 100%;
  margin: 0 auto;
  padding: 0 var(--space-4);
}

@media (min-width: 640px) {
  .container { max-width: 640px; }
}
@media (min-width: 768px) {
  .container { max-width: 768px; }
}
@media (min-width: 1024px) {
  .container { max-width: 1024px; }
}
@media (min-width: 1280px) {
  .container { max-width: 1280px; }
}
```

---

## Shadows & Elevation

```css
:root {
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-base: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 
                 0 1px 2px 0 rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 
               0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 
               0 4px 6px -2px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 
               0 10px 10px -5px rgba(0, 0, 0, 0.04);
  --shadow-2xl: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
}
```

### Usage Guidelines

| Elevation Level | Shadow | Use Case |
|-----------------|--------|----------|
| 0 (Flat) | none | Inline elements, disabled states |
| 1 (Raised) | sm | Subtle borders, input fields |
| 2 (Card) | base | Application cards (default) |
| 3 (Hover) | md | Application cards (hover), dropdowns |
| 4 (Modal) | lg | Modal dialogs, popovers |
| 5 (Overlay) | xl | Dragging cards |
| 6 (Top) | 2xl | Toast notifications |

---

## Border Radius

```css
:root {
  --radius-none: 0;
  --radius-sm: 0.125rem;   /* 2px */
  --radius-base: 0.25rem;  /* 4px */
  --radius-md: 0.375rem;   /* 6px */
  --radius-lg: 0.5rem;     /* 8px */
  --radius-xl: 0.75rem;    /* 12px */
  --radius-2xl: 1rem;      /* 16px */
  --radius-full: 9999px;   /* Circular */
}
```

### Component Radius Mapping

| Component | Border Radius | Reasoning |
|-----------|---------------|-----------|
| Buttons | lg (8px) | Friendly, modern |
| Input Fields | md (6px) | Subtle, approachable |
| Cards | xl (12px) | Distinct, premium feel |
| Modals | 2xl (16px) | High-level containers |
| Status Badges | full (circular) | Pill-shaped |
| Dropdowns | lg (8px) | Consistent with buttons |
| Avatars/Icons | full (circular) | Standard circular |

---

## Breakpoints

```css
:root {
  --breakpoint-sm: 640px;   /* Mobile landscape, small tablets */
  --breakpoint-md: 768px;   /* Tablets */
  --breakpoint-lg: 1024px;  /* Small desktops, large tablets */
  --breakpoint-xl: 1280px;  /* Desktops */
  --breakpoint-2xl: 1536px; /* Large desktops */
}
```

### Media Query Helpers

```css
/* Mobile-first approach (default: < 640px) */
@media (min-width: 640px) {  /* sm */
  /* Tablet portrait */
}
@media (min-width: 768px) {  /* md */
  /* Tablet landscape */
}
@media (min-width: 1024px) { /* lg */
  /* Desktop */
}
@media (min-width: 1280px) { /* xl */
  /* Large desktop */
}
```

### Responsive Design Decisions

| Breakpoint | Layout | Kanban | Stats | Navigation |
|------------|--------|--------|-------|------------|
| < 640px | Single column | List view only | 2x2 grid | Hamburger |
| 640-768px | 2 columns | 2-column kanban | 2x2 grid | Hamburger |
| 768-1024px | 3 columns | 3-column kanban | 1x4 row | Side drawer |
| 1024px+ | 4+ columns | 6-column kanban | 1x4 row | Full nav bar |

---

## Z-Index Scale

```css
:root {
  --z-base: 0;
  --z-dropdown: 1000;
  --z-sticky: 1100;
  --z-modal-backdrop: 1200;
  --z-modal: 1300;
  --z-popover: 1400;
  --z-toast: 1500;
  --z-tooltip: 1600;
}
```

### Usage Guidelines

- **Base (0):** Default document flow
- **Dropdown (1000):** Status dropdowns, filter panels
- **Sticky (1100):** Sticky headers, pinned columns
- **Modal Backdrop (1200):** Semi-transparent overlay
- **Modal (1300):** Modal dialogs
- **Popover (1400):** Context menus, date pickers
- **Toast (1500):** Success/error notifications
- **Tooltip (1600):** Hover tooltips (highest layer)

---

## Transitions

```css
:root {
  /* Durations */
  --transition-fast: 150ms;
  --transition-base: 250ms;
  --transition-slow: 350ms;
  
  /* Easings */
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

### Animation Tokens

```css
:root {
  /* Common transitions */
  --transition-colors: color var(--transition-base) var(--ease-in-out),
                       background-color var(--transition-base) var(--ease-in-out),
                       border-color var(--transition-base) var(--ease-in-out);
  
  --transition-transform: transform var(--transition-base) var(--ease-out);
  
  --transition-opacity: opacity var(--transition-base) var(--ease-in-out);
  
  --transition-shadow: box-shadow var(--transition-base) var(--ease-out);
  
  --transition-all: all var(--transition-base) var(--ease-in-out);
}
```

### Usage Examples

```css
/* Button hover */
.button {
  transition: var(--transition-colors), var(--transition-shadow);
}

/* Card drag */
.application-card {
  transition: var(--transition-transform), var(--transition-shadow);
}
.application-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

/* Modal enter/exit */
.modal-backdrop {
  transition: var(--transition-opacity);
}
.modal-content {
  transition: transform var(--transition-base) var(--ease-out),
              opacity var(--transition-base) var(--ease-out);
}
```

---

## Dark Mode (Future Consideration)

While not in the MVP scope, the design system is prepared for dark mode:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: var(--color-neutral-900);
    --bg-secondary: var(--color-neutral-800);
    --text-primary: var(--color-neutral-50);
    --text-secondary: var(--color-neutral-300);
    --border-default: var(--color-neutral-700);
    /* ... additional overrides */
  }
}
```

**Implementation Note:** Use CSS custom properties throughout components so toggling dark mode only requires updating the `:root` variables.

---

## Design Tokens Export

### For Tailwind CSS

Create `tailwind.config.js`:

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          // ... full palette
        },
        status: {
          saved: '#06b6d4',
          applied: '#eab308',
          'phone-screen': '#f97316',
          interview: '#a855f7',
          offer: '#22c55e',
          rejected: '#ef4444',
          withdrawn: '#9ca3af',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      spacing: {
        // 8px grid
      },
      boxShadow: {
        // Custom shadows
      },
      borderRadius: {
        // Custom radii
      }
    }
  }
}
```

### For CSS-in-JS (Styled Components / Emotion)

```typescript
export const theme = {
  colors: {
    primary: {
      50: '#eff6ff',
      500: '#3b82f6',
      // ...
    },
    // ...
  },
  space: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96],
  fontSizes: [10, 12, 14, 16, 18, 20, 24, 30, 36, 48],
  // ...
}
```

---

## Implementation Checklist

- [ ] Install Inter font from Google Fonts
- [ ] Configure Tailwind with custom theme
- [ ] Create CSS custom properties in `:root`
- [ ] Set up typography utility classes
- [ ] Define component-specific tokens
- [ ] Test color contrast ratios (WCAG AA minimum)
- [ ] Validate responsive breakpoints across devices
- [ ] Document any deviations from this spec

---

## Resources

- [Inter Font](https://fonts.google.com/specimen/Inter)
- [Tailwind CSS](https://tailwindcss.com/)
- [WCAG Color Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Coolors Palette Generator](https://coolors.co/)
