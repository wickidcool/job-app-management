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

### Boundary cases, ruled

These four come up repeatedly and pull in opposite directions. The ruling is the same each
time: **a screen you can navigate to is not thereby a proper noun.**

| String | Ruling | Why |
|---|---|---|
| `Back to dashboard` | lowercase `d` | A destination, not a name. Being linkable confers nothing. |
| `Analyze job fit` | lowercase | An action. Uncontroversial. |
| `Job fit analysis` | lowercase | A named *feature*, and feature names are not proper nouns (above). |
| `Add applications as you apply to jobs` | lowercase | Common nouns. Uncontroversial. |

Rows 1 and 3 are the ones under genuine pressure — "it's *the* Dashboard," "it's the name
of the screen." Both arguments are the feature-name loophole wearing a hat. If capitalizing
a string requires an argument, the answer is no.

When a string is ambiguous on grounds other than casing — whether it should say
"dashboard" or "overview" at all — that is a copy question, not a casing question, and it
routes to the Copywriter / Editor.

---

## Casing by slot

The rule above is one sentence; this table is where it lands in practice. It is the
authority for "what casing does *this* element take."

| Slot | Casing | Notes |
|---|---|---|
| Button / link label | Sentence | Includes destructive and secondary |
| Page title (`h1`) | Sentence | |
| Section / card heading (`h2`–`h4`) | Sentence | |
| Nav item, tab label | Sentence | Usually one word — no change |
| Breadcrumb segment | Sentence | Matches the destination's own page title |
| Form field label | Sentence | |
| Placeholder text | Sentence | |
| Helper / hint / validation text | Sentence | Already de-facto |
| Empty-state heading + body | Sentence | Already de-facto |
| Toast / banner | Sentence | |
| Modal title | Sentence | |
| Table column header | Sentence **in the DOM** | Rendered as caps by the Overline token |
| Status / severity badge | Sentence **in the DOM** | Same — token, not baked caps |
| Nav section label | Sentence **in the DOM** | Same |

**One rule, one exception mechanism.** The table deliberately has no "all caps" row. Every
visually-uppercase surface is the Overline token, which is CSS — see below. All caps is a
rendering style; it is never a casing decision.

*Matrix contributed by the UI/UX Developer (WIC-1090). The casing column is uniform by
construction: if a future board call declared title case instead, only that column would
flip and every other ruling in this document would stand.*

---

## ALL CAPS is a typographic treatment, not casing

> **This rule governs how caps are *applied*, not where caps *belong*.** For the sizing rule —
> caps on a primary result must not be rendered in Overline, which is the smallest step in the
> scale — see `DESIGN_SYSTEM.md` § *Overline is the wrong instrument for a primary result*.

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

The treatment already has a token: **Overline** in `DESIGN_SYSTEM.md` §Typography
(10px / 600 / "All-caps labels"). Use it. `MobileNavigation.tsx` and `CatalogBrowseTable.tsx`
are the reference implementations.

Status chips and badges keep their uppercase *look*; their source strings become sentence
case (`Critical`, `Moderate`, `Minor`, `Create`, `Update`, `Delete`, `Ambiguous tag`).
Where a badge label is derived at runtime, drop the `.toUpperCase()` call and let CSS do it.

**This is why uppercase cannot be a casing rule at all.** Two of the six offending sites
apply `.toUpperCase()` to strings the *API* supplies — `JobFitAnalysis.tsx:151`
(`results.recommendation`) and `:271` (`gap.severity`). No prose style guide can govern a
string it never authored. Uppercase has to be a rendering decision because at those two
sites there is no source string to rule on.

Genuinely-uppercase *content* is a different thing and stays uppercase under the acronym
exception — `selectedFormat.toUpperCase()` rendering `PDF` / `DOCX` is correct as written.
The test is whether the capitals carry meaning or carry styling.

Baked-caps cleanup is tracked in WIC-1069 (implementation corrections in WIC-1086) and runs
independently of the board call.

### Enforcement (WIC-1209)

The ❌ form above is enforced in CI by a local ESLint rule,
`local/no-literal-caps-jsx-text` (`packages/web/eslint-rules/no-literal-caps-jsx-text.js`).
It flags literal all-caps JSX **text nodes** and passes the ✅ form, including when the
`uppercase` class sits on an ancestor element or arrives through an interpolated
`className`. Acronyms (`PDF`, `DOCX`, `AWS`, `STAR`, `URL`, …) are allowlisted.

This exists because the cleanup above was driven by hand-enumerated site lists across six
tickets (WIC-1069 → WIC-1127 → WIC-1184 → WIC-1187 → WIC-1195 → WIC-1205, plus WIC-1228),
and hand enumeration has no completion criterion. The rule supplies one.

**What the rule cannot see**, by construction — a text-node rule reads text nodes only:

- Runtime `.toUpperCase()` on API-supplied strings — the `JobFitAnalysis.tsx` case argued
  two paragraphs above. Tracked in WIC-1122 / WIC-1146.
- Caps inside attribute values, e.g. an `aria-label` built by template literal —
  unreachable from CSS and invisible here. This was `ChangeActionBadge`'s worst instance
  (WIC-1185).
- Caps reaching JSX through a variable or config object.

Those remain review-time concerns. `eslint-plugin-jsx-a11y` does not cover any of this —
measured under WIC-1185: strict config, 0 findings against a 4-error positive control.

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

## Writing tests against UI copy

**Match user-visible copy with a case-insensitive regex, never a bare string.**

```tsx
// ✅
screen.getByRole('button', { name: /back to dashboard/i })
page.getByRole('button', { name: /back to dashboard/i })

// ❌ — hard-codes a casing decision this document may change
screen.getByRole('button', { name: 'Back to Dashboard' })
```

The two harnesses have **opposite defaults**, which is why the convention has to be stated
rather than inferred:

| Harness | String `TextMatch` default |
|---|---|
| Playwright (`getByRole`/`getByText`/`getByLabel`/`getByPlaceholder`) | case-**insensitive**, substring |
| Testing Library / vitest (`getByRole` name, `getByText`) | case-**sensitive**, exact |

Playwright compiles a string name to an `i`-flagged matcher unless `exact: true` is passed
(verified against `playwright-core` 1.59.1: `internal:role=button[name="…"i]`, vs `…"s"`
with `exact: true`). So Playwright specs tolerate a casing migration by accident. RTL specs
do not — a bare string there breaks the moment this standard is applied to the component.

### Playwright is only insensitive by default — five mechanics opt back in

"A casing change breaks no Playwright selector" is true of this suite, but it is a fact about
which APIs it happens to use, not a property of Playwright. These are case-**sensitive**, and
none of them currently appears in `packages/web/e2e/`:

| Mechanic | Why it's sensitive | Uses in suite |
|---|---|---:|
| `{ exact: true }` on any `getBy*` | compiles to `…"s"` instead of `…"i"` | 0 |
| `toContainText('str')` / `toHaveText('str')` | `ignoreCase` defaults to unset | 2 / 0 |
| `:text-is("str")` | exact per-text-node compare, no `toLowerCase` | 0 |
| `text="str"` — *quoted* selector body | quoting sets the strict matcher | 0 |
| `locator('text=Str')` — unquoted | lax, insensitive — safe | 0 |

The two `toContainText` string calls are `multi-user-isolation.spec.ts:218–219`, asserting the
absence of the `undefined` and `[object Object]` sentinels. Not chrome copy, so not exposed.

The trap is that the safe and unsafe forms look alike. `:has-text("Add Application")` is
lax — it lowercases both sides — so `application-form-errors.spec.ts` survives a casing
migration despite hard-coding button labels. "Tightening" that to `:text-is("Add
Application")` would silently make it case-sensitive. Prefer a regex and the question
does not arise.

*Verified against `playwright-core` 1.59.1 by reading the compiled matchers, not the docs:
`hasTextEngine` and `textEngine` lowercase both operands; `textIsEngine` and the quoted
branch of `createTextMatcher` do not; `filter({ hasText })` hardcodes `exact: false`, so it
cannot be made sensitive even deliberately.*

---

## Migration

The standard is being applied to the existing tree in stages, not one sweeping PR.
Per-area ordering and tracking live in **WIC-1066**.

Staged so the highest-traffic surfaces land first:

1. **Standard + test convention** — this document. No source changes; everything after
   cites it.
2. **Overline token compliance** — the six baked-caps sites (WIC-1069, corrections in
   WIC-1086). Independent of the casing call; can run in parallel.
3. **Onboarding + Dashboard** — first-run path, highest traffic, already holds the
   existing sentence-case strings.
4. **Reports + Catalog** — the largest title-case concentration.
5. **Remaining pages**, then a lint rule if drift returns.
6. **Punctuation** — kept last and separate. See below.

### What the migration actually costs

**Casing changes break no tests today.** Every string selector in the e2e suite resolves to
a case-insensitive matcher: the suite uses none of the five sensitive mechanics listed under
*Writing tests against UI copy* against chrome copy. Steps 3–5 are copy-only diffs that
review by reading.

Note what that claim rests on: the *current* selector inventory, not a Playwright guarantee.
It has to be rechecked if a spec adds `exact: true`, `:text-is()`, or a `toContainText`
string against visible copy — which is the reason the regex convention is written down
rather than left as a happy accident.

**Punctuation changes do.** The `…` and exclamation-mark rules above are not casing rules,
and no case-insensitive matcher protects them. They are the only part of this standard with
a test cost:

- **58 source sites across 36 files** use a literal `...` where the rule specifies `…`
  (spread/rest operators, comments, and one bare truncation marker excluded)
- **2 e2e assertions** encode it — `job-fit-analysis.spec.ts:508` (`Analyzing Job Fit...`)
  and `workflow-prefill.spec.ts:179` (`Paste the full job description here...`). These are
  the only two ellipsis strings in the suite that address chrome; the other two hits are a
  comment and fixture data.
- **14 sites carry an exclamation mark**, in 14 files; none is referenced by any selector
  (checked each string against `e2e/` — zero hits)

Hence step 6 is sequenced last and shipped on its own: it is the one stage that touches
specs, and bundling it into a casing PR would give a copy-only diff a test diff to hide in.

Until an area is migrated it will contain title-case strings. That is expected. Do not
match the surrounding convention in an unmigrated area — write new strings to this
standard, and let the migration close the gap.

---

## Related

- `docs/design/DESIGN_SYSTEM.md` — typography, color, spacing tokens (Overline lives there)
- `docs/design/ACCESSIBILITY.md` — accessible name requirements
- WIC-1063 — the arbitration that surfaced the standards gap
- WIC-1052 — the 404 copy pass, written to this standard before it was written down
- WIC-1090 — UI/UX review: the slot matrix, and the selector audit behind the test section
- WIC-1069 / WIC-1086 — baked-caps cleanup
