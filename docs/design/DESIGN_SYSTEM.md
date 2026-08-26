# Design System — Job Application Manager

This design system provides a consistent visual language and reusable tokens for the Job Application Manager.

---

## Table of Contents

1. [Color Palette](#color-palette)
2. [Scale Vocabulary](#scale-vocabulary)
3. [Typography](#typography)
4. [Spacing & Layout](#spacing--layout)
5. [Shadows & Elevation](#shadows--elevation)
6. [Border Radius](#border-radius)
7. [Breakpoints](#breakpoints)
8. [Z-Index Scale](#z-index-scale)
9. [Transitions](#transitions)

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

  /* Caution (Orange) */
  --color-caution-50: #fff7ed;
  --color-caution-100: #ffedd5;
  --color-caution-500: #f97316;  /* Phone-screen status */
  --color-caution-700: #c2410c;
}
```

### Status-Specific Colors

```css
:root {
  /* Application Status Colors */
  --status-saved: var(--color-info-500);          /* Blue */
  --status-applied: var(--color-warning-500);     /* Yellow */
  --status-phone-screen: var(--color-caution-500); /* Orange */
  --status-interview: #a855f7;                    /* Purple */
  --status-offer: var(--color-success-500);       /* Green */
  --status-rejected: var(--color-error-500);      /* Red */
  --status-withdrawn: var(--color-neutral-400);   /* Gray */
}
```

### Gap Severity Scale

The canonical, and only, colour scale for the `GapSeverity` field (`critical` / `moderate` /
`minor`). Decided in WIC-1146; supersedes the three ad-hoc ramps previously inlined in
`JobFitAnalysis` and `GapMitigationPanel`.

> **Colour is never the sole carrier of severity.** A red→orange→yellow ramp is not
> distinguishable under colour-vision deficiency — at a uniform `-700` step, `moderate` and
> `minor` simulate to `#7a7a00` and `#797900` under deuteranopia, a separation of 1.01:1. The
> steps below are tuned to recover what ordering this hue range permits (worst case 1.41:1 across
> the three dichromacies), but the **text label is mandatory at every render site** and does the
> actual work (WCAG 1.4.1). Do not add a swatch, dot, chip, or emoji as an additional colour-only
> mark — emoji in particular cannot be tokenised, since the platform font owns their hue.

```css
:root {
  /* critical — highest severity */
  --gap-severity-critical-surface: var(--color-error-50);   /* #fef2f2 */
  --gap-severity-critical-mark: #7f1d1d;                    /* border / graphical mark */
  --gap-severity-critical-text: var(--color-error-700);     /* #b91c1c */

  /* moderate */
  --gap-severity-moderate-surface: var(--color-caution-50); /* #fff7ed */
  --gap-severity-moderate-mark: var(--color-caution-700);   /* #c2410c */
  --gap-severity-moderate-text: var(--color-caution-700);   /* #c2410c */

  /* minor — lowest severity, but still a gap: never green */
  --gap-severity-minor-surface: #fffbeb;                    /* amber-50 */
  --gap-severity-minor-mark: #d97706;                       /* amber-600 */
  --gap-severity-minor-text: #b45309;                       /* amber-700 */
}
```

`minor` is **amber, not yellow**: yellow-700 is the value that collapses against `moderate` under
deuteranopia, and yellow-500 is 1.92:1 on white — below the 3:1 non-text bar.

**Roles.** `surface` tints the card. `mark` is for the left border and any non-text graphical
indicator; it meets 3:1 (WCAG 1.4.11). `text` is for the severity label; it meets 4.5:1 (WCAG
1.4.3). Verified against both `#ffffff` and the level's own `surface`:

| Level | mark vs white | mark vs surface | text vs white | text vs surface |
|---|---|---|---|---|
| `critical` | 10.02:1 | 9.16:1 | 6.47:1 | 5.91:1 |
| `moderate` | 5.18:1 | 4.88:1 | 5.18:1 | 4.88:1 |
| `minor` | 3.19:1 | 3.07:1 | 5.02:1 | 4.84:1 |

**Never use `success` / green for any severity level.** Every gap is a shortfall; a low-severity
gap is still a gap, and green reads as "resolved".

Because the text label carries severity, it is also load-bearing *copy*: `critical` / `moderate` /
`minor` are words this scale owns and no other scale on the same screen may spell. See
[Scale Vocabulary](#scale-vocabulary).

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

## Scale Vocabulary

Colour tokens keep two scales from being drawn the same way. This section keeps them from being
*worded* the same way — the failure the Gap Severity Scale above cannot catch, because a colour
token has nothing to say about the word next to it.

### The rule

> **A word may not carry two meanings on one screen.**

Recurrence is fine when the meaning and the direction are identical: "Strong fit" alongside a
"Strong matches" section is the same claim about the same axis. It is not fine across axes. On
`JobFitAnalysis`, `recommendation: 'moderate_fit'` rendered "moderate" near the top of the results
and `GapSeverity: 'moderate'` rendered "moderate" on each gap card below — one a verdict about the
whole application, the other one shortfall's severity, pointing in opposite directions, separated
only by position on the page. Colour could not rescue it: gap severity's ramp is explicitly
demoted to reinforcement (see "Gap Severity Scale"), and the fit value carries no colour at all.

It surfaced as a Playwright strict-mode violation — `getByText('MODERATE')` resolved to two
elements. **If a locator cannot disambiguate two words, neither can a person skimming.** Treat that
class of test failure as a copy finding, not a test-scoping problem.

### Fit Level Labels

The canonical, and only, display labels for the overall fit level. Decided in WIC-1288; defined in
`packages/web/src/constants/fitLevel.ts`.

| Wire value (`recommendation`) | Label | Reads as |
|---|---|---|
| `strong_fit` | **Strong fit** | yes |
| `moderate_fit` | **Possible fit** | maybe |
| `stretch` | **Stretch** | reaching |
| `low_fit` | **Unlikely fit** | no |
| `null` | **No recommendation** | not scored — empty catalog, or no required skills found |

**Fit level is a verdict, not a magnitude.** That is what separates it from the two magnitude
scales it shares a screen with, and it is why "Possible fit" is the right shape of answer where
"Moderate fit" was not. The screen already spends its magnitude adjectives twice over — gap
severity owns `critical` / `moderate` / `minor`, analysis confidence owns `high` / `medium` /
`low` — so **any** magnitude adjective chosen for fit level is one refactor away from the same
collision. `low_fit` was renamed for that reason and not because it collides today: "Low fit" and
"Confidence: low" render two lines apart in the same card, and only an implementation detail of
the scoring service (a `low_fit` verdict requires a non-empty required stack, which forces
confidence to `medium` or `high`) keeps them from ever appearing together.

Rejected alternatives, for the same rule:

- **"Partial fit"** — collides with the "Partial matches" section on the same screen, where
  "partial" describes a *match type*, a different axis again.
- **"Weak fit"** — at the time, that string was the label of `FitTier: 'weak_fit'`, a different
  enum with a different wire value, in the by-fit-tier report. That collision no longer exists:
  WIC-1298 removed `weak_fit` and redefined `FitTier` as `Recommendation` plus its two no-verdict
  states, so nothing owns the string any more. The rejection stands on the rule above regardless —
  "weak" is a magnitude adjective, and fit level is a verdict scale.

**Labels are display strings; the wire values are unchanged.** `recommendation` is an API contract
value (`docs/architecture/API_CONTRACTS.md`, `POST /api/catalog/job-fit/analyze`), so the rename is
a presentation-layer remap and nothing crosses the network differently. Never render a
`Recommendation` or `FitTier` value directly.

#### The ladder is not ordinal in its words

The four labels do not rank themselves. "Stretch" is the only rung that is not `<adjective> fit`,
so a reader cannot order it by form and has to order it by meaning — and "stretch role" is
idiomatically *aspirational*, while "possible" is the weakest modality word in English. One reader
gets maybe → reaching; another gets hedged → go for it. Both readings are defensible.

That is survivable today **only because the ladder is never displayed.** One analysis renders one
rung: no legend, no sort, no filter, no adjacent tier. Each label only has to be self-sufficient in
isolation, and all four are.

> **Ordering becomes load-bearing the moment fit level becomes a sort key, a filter chip, or a
> grouped list.** If that ships, it must carry the order in position, rank, or count — not in the
> words. The typecheck guard below cannot catch this one; it checks disjointness, not sequence.

Until then the joint is repaired one line lower, in the summary sentence beneath the label — see
"Fit Level Summary" below. That was **WIC-1301**, sequenced after this change and now shipped.

Two distinctions worth protecting, both easy to mistake for redundancy:

- **"No recommendation" ≠ "Not analyzed."** The first means the analysis ran and could not score
  (`recommendation: null`, empty required stack); the second means it never ran. Do not unify them.
- **`FitTier` and `Recommendation` have started diverging in register**, not just in resolution:
  `FIT_TIER_LABELS` reads Strong fit / Possible fit / **Weak fit** / Not analyzed — two verdicts and
  a magnitude, with magnitude subtitles beneath. Defensible as title = verdict, subtitle =
  magnitude, but whoever reconciles the two enums is now facing a vocabulary question as well as a
  granularity one.

### Fit Level Summary

The sentence rendered directly beneath the fit level label. Generated server-side by
`computeSummary` (`packages/api/src/services/job-fit.service.ts`); decided in WIC-1301.

| Wire value | Summary |
|---|---|
| `strong_fit` | You match N of M required skills. |
| `moderate_fit` | You match N of M required skills. **This role is within reach.** |
| `stretch` | You match N of M required skills. **This role may be a stretch.** |
| `low_fit` | You match N of M required skills. **Consider building more experience before applying.** |
| `null` | Unable to compute fit score — no required skills found in the job description. |

A critical, required gap appends ` Gap(s) in X, Y and N more.` to any of the first four.

#### The summary never restates the verdict

The label is the only place the verdict is worded. `strong_fit` used to open **"Strong match — "**,
which broke that twice over. It duplicated the "Strong fit" label three lines above it, and it
borrowed **"match"** — the noun the per-skill sections own — to mean something else entirely:

```
label:    Strong fit                                    ← verdict, whole application
summary:  Strong match — you meet 5 of 6 required…      ← verdict, wearing the other axis's noun
heading:  ✅ Strong Matches (7)                          ← classification, one skill (MatchType)
```

> **The verdict axis owns "fit". The match-classification axis owns "match".**

This is the "Scale Vocabulary" rule applied to a noun rather than an adjective, and it is why
"Strong fit" beside "Strong matches" is *fine* while "Strong match" beside it was not: the first
recurrence keeps the word on one axis, the second moves it across two.

The numbers made it concrete. `matchCount` counts required strong **and** partial matches; the
heading counts every strong match **including nice-to-haves**. So "Strong match — you meet 5 of 6"
could render above "Strong Matches (7)". They agreed only in the e2e fixture (5 strong, 0 partial,
all required), which is what kept this invisible until WIC-1297 read the copy. With the verdict
prefix gone, the two lines no longer claim to be the same quantity — "required skills" against
"Strong Matches" — and the qualifier does the disambiguating. WIC-1528 then finished the job on the
other line: the heading names its own population too, so neither side leaves the reader to infer
one. See "Match and Gap Section Counts" below.

#### The trailing clause is a caveat, so the top rung has none

The ladder reads **nothing to add / within reach / a stretch / not yet.** `moderate_fit` previously
had no clause, which left the ladder's weakest joint — "Possible fit" vs "Stretch" — to be ordered
by two labels that demonstrably do not order themselves (see "The ladder is not ordinal in its
words"). "Within reach" and "a stretch" are the same distance metaphor at two settings, so they
order each other without needing the labels to.

Two constraints on any future clause:

- **State the verdict's stance, never a fact about the data.** `strong_fit` admits one critical
  required gap (`computeRecommendation`: `matchPct >= 0.8 && criticalGaps <= 1`), so a clause like
  *"your profile covers the core requirements"* would render immediately above " Gap in AWS." A
  stance stays true in every branch, including when `gaps` is empty.
- **No magnitude adjectives.** Gap severity owns `critical`/`moderate`/`minor` and confidence owns
  `high`/`medium`/`low`. This is the same reservation the labels are held to, but the typecheck
  guard below does not cover the summary — these strings live in the API package, and the guard
  derives from `fitLevel.ts`. Copy review is the only check here, which is why `computeSummary` is
  exported and unit-tested (`packages/api/test/job-fit.service.test.ts`) rather than asserted only
  through fixtures. Every other surface that pins these strings is a mock, and a mock cannot
  disagree with a generator loudly enough to be noticed.

### Match and Gap Section Counts

The parenthesised count in each per-skill section heading on `JobFitAnalysis`. Decided in WIC-1528;
formatted by `packages/web/src/constants/skillCount.ts`.

> **A count must say which skills it counts.**

All three sections — strong matches, partial matches, gaps — mix required and nice-to-have skills.
The fit summary a few rows above counts required skills only. A bare `list.length` therefore named
a number without naming its population, and the two lines could disagree with nothing on screen to
explain it:

```
summary:  You match 5 of 6 required skills.               ← required only
heading:  ✅ Strong Matches (7)                            ← required + nice-to-have, unlabelled
```

This is the residue of WIC-1301, not a regression from it. Before that change the summary opened
"Strong match — ", so the two lines shared a noun and read as **two statements of one quantity that
disagreed**. Removing the prefix left the fault **undisclosed** rather than contradictory. The
format closes the disclosure:

| Section shape | Heading |
|---|---|
| 5 required, 2 nice-to-have | `✅ Strong Matches (5 required, 2 nice-to-have)` |
| 1 required, 0 nice-to-have | `⚠️ Partial Matches (1 required)` |
| 0 required, 3 nice-to-have | `❌ Gaps (3 nice-to-have)` |

Required is always named first. **A zero term is omitted**, never rendered as "0 nice-to-have". The
noun is elided — the heading supplies it — so the subtotals do not pluralise.

#### Not a second fraction

`(7 of 9 skills)` was the rejected alternative. It would place a second `X of Y` beside the
summary's `5 of 6 required skills` with a different numerator **and** a different denominator: the
"one word, two meanings" collision restated in numerals, where the reader has no qualifier to tell
the two fractions apart. Two labelled subtotals cannot be misread as a restatement of the summary.

Splitting each section in two by `isRequired` was also rejected. It doubles the card chrome, and it
does not reconcile the numbers either — see below.

#### The subtotals are not meant to sum to the summary's numerator

`computeSummary` counts required strong **and** required partial matches against `totalRequired`.
`Strong Matches (5 required)` therefore equals the summary's `5 of 6` only when there happens to be
no required partial match. They are different populations and they now say so. **Do not "fix" them
into equality** — forcing the heading to agree would make it report something other than the rows
beneath it.

#### Fixtures must carry a mixed shape

Every mock pinning this screen was once all-`isRequired` — 5 strong / 0 partial / all required —
the single shape where "count of matches" and "count of required matches" coincide. That blind spot
is why `Strong Matches (7)` survived WIC-1288 and WIC-1301 unseen. `MOCK_ANALYSIS_RESPONSE` in
`packages/web/e2e/job-fit-analysis.spec.ts` now carries a nice-to-have strong match and a
nice-to-have gap. Because a fixture is a mock and can only disagree quietly, the format is also
unit-tested directly in `packages/web/src/constants/skillCount.test.ts`, which runs in
`npm run test`.

### Per-row required-ness

The qualifier on each individual row of the three per-skill sections. Decided in WIC-1534, closing
the residue left by WIC-1528 above; formatted by `packages/web/src/constants/requirementLabel.ts`.

> **Required-ness is stated on every row, in both branches. An absence is never the signal.**

The three sections used to disclose the same boolean three different ways:

| Section | Was | Now |
|---|---|---|
| Gaps | `Critical - Required skill` / `- Nice-to-have skill` | `Critical — Required skill` |
| Strong Matches | a red `Required` badge, **or nothing** | `Matches: graphql (exact) — Nice-to-have skill` |
| Partial Matches | nothing at all | `Partially matches: postgresql (alias) — Required skill` |

Two distinct faults, not one:

- **A negative was doing positive work.** On a strong-match row, no badge meant "nice-to-have" —
  indistinguishable from a row where the flag was simply not rendered. An absence of chrome cannot
  be read as a statement, and no fixture can catch it: a mock that renders nothing and a component
  that renders nothing agree.
- **Partial-match rows carried no signal.** The heading states the split, so the *counts* are known;
  but with more than one row of each kind, **which** row is which was unrecoverable.

#### A text qualifier, not a badge on every row

Extending the strong-match badge to all three sections was the rejected alternative. It fails twice:

- **Colour.** The badge was `bg-red-100 text-red-800` — red, on a green-bordered card that means
  good news, to mean "important" rather than "bad". Gap severity owns red on this screen
  (WIC-1146); this was already a cross-axis reuse, and copying it to two more sections would have
  spent the colour three times over. The badge is removed rather than propagated.
- **Density.** Three sections x N rows is a lot of chrome for one boolean.

The qualifier reuses the one pattern already proven here — gap rows have always named both branches
— so no new chrome is introduced. `REQUIREMENT_SEPARATOR` (a spaced em dash) is exported alongside
the labels and read by all three sections, so they cannot drift apart on punctuation the way they
drifted apart on disclosure. Gap rows moved from a hyphen onto it.

#### The noun is carried on the row and elided in the heading

`skillCount.ts` emits `2 required, 1 nice-to-have` with no noun, because the heading supplies it. A
row has no such supplier, so it carries "skill" itself. Same vocabulary at two altitudes, not two
vocabularies — and neither reaches for "fit", which the verdict axis owns (WIC-1301), nor for a
reserved scale word (WIC-1146). `requirementLabel.test.ts` asserts both formatters agree on which
word names which branch, so a re-wording of either fails rather than letting a section quietly
contradict the heading above it.

### Enforcement

`fitLevel.ts` derives the reserved vocabulary from the `GapSeverity` and `Confidence` unions and
fails `npm run typecheck` naming the offending word if a fit label ever reuses one. Adding a member
to either scale extends the guard automatically. Extend the same guard before introducing a third
scale to this screen — in particular, the fit-quality colour ramp still open in
`JOBFIT_CAPS_DECISION_WIC1122.md` §3a should not be designed against labels that have not passed
it.

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
      // Gap severity (WIC-1146) needs no custom colors — the scale maps onto
      // stock Tailwind shades. Consume it via the shared GAP_SEVERITY map, not
      // by writing these classes inline:
      //   critical -> bg-red-50    border-red-900    text-red-700
      //   moderate -> bg-orange-50 border-orange-700 text-orange-700
      //   minor    -> bg-amber-50  border-amber-600  text-amber-700
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
