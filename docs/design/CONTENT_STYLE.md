# Content Style — UI Strings

**Project:** Job Application Manager
**Owner:** Copywriter / Editor, with UI/UX Developer
**Status:** 🟡 Proposed — pending board sign-off (WIC-1066)
**Created:** August 19, 2026

---

## The rule

**Sentence case for every UI string.** Capitalize the first character and anything that
would be capitalized mid-sentence in ordinary prose. Nothing else.

```
✅ Analyze fit →              ❌ Analyze Fit →
✅ Job fit analysis           ❌ Job Fit Analysis
✅ Generate resume variant    ❌ Generate Resume Variant
✅ Back to dashboard          ❌ Back to Dashboard
✅ Try again                  ❌ Try Again
```

This applies to buttons, links, headings, form labels, placeholders, empty states,
toasts, validation messages, tooltips, menu items, tab labels, table column headers,
modal titles, and page titles. There is no string class that opts out.

### Why sentence case

- It is the specified standard in Apple HIG, Material, Shopify Polaris, Atlassian, and
  GOV.UK. Adopting it means inheriting their edge-case rulings instead of inventing ours.
- Title case requires a judgment call this codebase already makes inconsistently — whether
  `to` / `for` / `with` capitalizes. `Next: Select Experiences →` and `Prepare for Interviews`
  are both title case under incompatible rules.
- It scales to long labels and to translation. Title case has no well-defined meaning in
  most non-English locales.
- Our non-chrome copy is already sentence case — every validation message and empty state
  in the tree. The migration makes buttons and headings match the copy around them, rather
  than the reverse.

---

## Exceptions

The exception list is closed. If a string is not covered below, it is sentence case.

**1. Proper nouns and brand names** — written as their owner writes them.

> `Sign in with Google` · `Import from LinkedIn` · `Powered by Cloudflare`

**2. Acronyms and initialisms** — keep their established casing.

> `Recommended STAR entries` · `Export as PDF` · `Must be a valid URL` · `Remote (US/EU)`

**3. User and API data** — rendered as stored, never re-cased by us.

> A job title of `Senior Full Stack Engineer` displays exactly that. A company name,
> a filename, a salary range, a location string: all pass through untouched.

### What is *not* an exception

**Feature names are not proper nouns.** `Job fit analysis`, `Cover letter`,
`Application workflow`, and `Tailored resume` are things the product does, not things it
is called. Only the product's own name is a proper noun. Treating feature names as proper
nouns is the loophole that reintroduces title case one screen at a time — it is closed
deliberately.

**Navigation labels are not an exception either**, though they can look like one. The nav
item `Dashboard` is capitalized because sentence case capitalizes the first word, not
because it is a destination. The same word mid-string is lowercase:

> Nav item: `Dashboard` · Button: `Back to dashboard` · Body: `Return to your dashboard.`

---

## ALL CAPS is a typographic treatment, not casing

Uppercase display is applied with CSS, never baked into the string:

```tsx
// ✅ correct — already the majority practice in this codebase
<h3 className="text-sm font-semibold uppercase tracking-wide">Summary</h3>
<p className="text-xs font-semibold uppercase text-neutral-500">Resumes</p>

// ❌ incorrect — casing baked into content
<h1>INTERVIEW QUICK REFERENCE</h1>
```

Three reasons, in order of weight:

1. **Accessibility.** Screen readers may spell literal all-caps strings letter by letter.
   CSS `text-transform` leaves the accessible name intact.
2. **Testability.** `getByRole('heading', { name: 'Summary' })` matches the accessible
   name — the source string, not the rendered glyphs. Baked-in caps force test selectors
   to encode a styling decision.
3. **Reversibility.** A design change to the badge treatment becomes a stylesheet edit
   rather than a find-and-replace across components.

Status chips and badges keep their uppercase *look*; their source strings become sentence
case (`Critical`, `Moderate`, `Minor`, `Create`, `Update`, `Delete`, `Ambiguous tag`).
Where a badge label is derived at runtime, drop the `.toUpperCase()` call and let CSS do it.

---

## Punctuation

| Element | Terminal punctuation |
|---|---|
| Buttons, links, labels, headings, menu items, tabs | **None** |
| Empty-state and body sentences | **Period** — `Upload a resume to extract your achievements first.` |
| Validation messages | **None** if a fragment (`Maximum 100 characters`); period if a full sentence |
| Toasts | **None** for one clause; periods if more than one sentence |
| In-progress states | **Ellipsis character `…`**, not three periods — `Analyzing job fit…` |

Never use exclamation marks in chrome. `All applications are up to date!` becomes
`All applications are up to date`.

---

## Applying this to a new string

1. Write it as you would in a sentence. Capitalize the first letter.
2. Lowercase everything else unless it hits an exception above.
3. If you want uppercase for visual emphasis, add the `uppercase` class — do not retype
   the string.
4. If you find yourself arguing that a feature name deserves capitals, it does not.

---

## Migration

The standard is being applied to the existing tree in stages, not one sweeping PR.
Scope, per-area ordering, and the e2e selector audit live in **WIC-1066**.

Until an area is migrated it will contain title-case strings. That is expected. Do not
match the surrounding convention in an unmigrated area — write new strings to this
standard, and let the migration close the gap.

---

## Related

- `docs/design/DESIGN_SYSTEM.md` — typography, color, spacing tokens
- `docs/design/ACCESSIBILITY.md` — accessible name requirements
- WIC-1063 — the arbitration that surfaced the standards gap
- WIC-1052 — the 404 copy pass, written to this standard before it was written down
