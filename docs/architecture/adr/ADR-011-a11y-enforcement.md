# ADR-011: Accessibility enforcement — adopt both `jsx-a11y` and `axe-core`

**Status:** Accepted
**Date:** 2026-08-30
**Decides:** WIC-1192 / WIC-1781 ("a11y static vs runtime checks for `packages/web`")
**Ratifies and amends:** `docs/design/A11Y_ENFORCEMENT_RULING.md` (UI/UX Developer, PR #262)
**Measured against:** `main` @ `ee6c217`
**Related:** WIC-1483 (PR #226, open) · WIC-1589 · WIC-1675 · WIC-1584 · WIC-1185 / WIC-1191

---

## 1. Context

WIC-1192 asked two questions: adopt `eslint-plugin-jsx-a11y`, and at what severity given a
pre-existing backlog; and adopt `axe-core`, hosted where. It was filed 2026-08-19 and sat
unassigned for 11 days while three implementation cards queued behind it.

The card's premise was that the *original* rationale for jsx-a11y had been refuted: jsx-a11y on
its strict ruleset reports **0 problems** on the markup that shipped WIC-1185 (an `aria-label` on
a role-less `<span>`, where the ARIA `generic` role prohibits an author-supplied name).

**That decision has since been made.** `docs/design/A11Y_ENFORCEMENT_RULING.md` landed in PR #262
(merged 2026-08-30 07:48Z) and rules: adopt jsx-a11y at `strict`/`error` behind a frozen baseline,
and adopt axe-core hosted in vitest + RTL rather than Playwright E2E.

This ADR exists because that ruling was never ratified into the architecture record, and because
re-deriving it surfaced two things the ruling does not account for. **It does not overturn the
ruling on either count.** Both rulings are adopted as written except where §4 amends them.

## 2. Decision

**Adopt both.** They cover disjoint defect classes, and neither substitutes for the other.

1. **`eslint-plugin-jsx-a11y`** — rule set `strict`, severity `error`, behind a shrink-only
   baseline covering today's 23 affected files.
2. **`axe-core`** — hosted in the **vitest + RTL** harness, not the Playwright E2E suite.

Rejected alternatives, and why, are in the ruling §3 and §4.1; they were reviewed and are not
re-litigated here.

## 3. Verification — the ruling's load-bearing measurements reproduce

The ruling was measured at `743cfeb`. Every figure below was re-taken independently at
`ee6c217`, five commits later, with a freshly installed `eslint-plugin-jsx-a11y@6.10.2`.

| claim (ruling) | independently measured @ `ee6c217` | verdict |
| --- | --- | --- |
| `recommended` → 50 findings / 23 files / 9 rules | 50 / 23 / 9 | ✅ |
| `strict` → 50 findings / 23 files / 9 rules | 50 / 23 / 9 | ✅ |
| the two sets are the same findings | identical on **file + rule + line**, not merely on counts | ✅ |
| §6 baseline table (23 files, per-file counts) | matches row for row | ✅ |
| jsx-a11y `strict` finds **0** on the WIC-1185 markup | 0, with an `<img>`-without-`alt` positive control flagged in the same run | ✅ |

So `strict` costs zero additional remediation today, and the counts have not drifted across five
commits. The ruling's §7 caution — that these numbers are pinned to a commit and must be re-run
before being cited — stands; this is that re-run.

**One correction to the ruling's framing.** `strict` is not a superset of `recommended`. Comparing
the two published configs directly: `recommended` has 34 entries (`error` 31, `off` 3), `strict`
has 33 (`error` 31, `off` 2). Seven rules differ. Six are option tightenings — notably
`no-static-element-interactions` and `no-noninteractive-tabindex` lose `allowExpressionValues:
true` — which is the real (if currently free) benefit of `strict`. The seventh is a *loss*:
`anchor-ambiguous-text` is present-but-`off` in `recommended` and **absent entirely from
`strict`**. This matters for §4.2.

## 4. Amendments

### 4.1 The axe assertion helper must fail on `incomplete`, or adopting axe does not close WIC-1185

The ruling §4 justifies axe-core on the grounds that `aria-prohibited-attr` "does catch"
the WIC-1185 markup. **It catches it as `incomplete`, not as a violation** — and that distinction
decides whether the adoption achieves its stated purpose.

Measured with `axe-core@4.13.0`:

| markup | axe result | check message |
| --- | --- | --- |
| `<span aria-label>` **with** text content — *the WIC-1185 shape* | **`incomplete`** | "aria-label attribute is **not well supported** on a span with no valid role attribute" |
| `<span aria-label>` with no text content | `violation` | "aria-label attribute **cannot be used** on a span with no valid role attribute" |
| `<div aria-label>` with text content | `incomplete` | as above |
| `<span role="status" aria-label>` | `pass` | — |

This is deliberate axe semantics, not a jsdom artifact: where the element has text content there
is a fallback name, so whether the author name is announced is genuinely AT-dependent, and axe
declines to call it. The distinction is already documented in
`packages/web/src/test/prohibitedName.ts`'s header — the ruling proposes to retire the one helper
whose docstring carries the caveat that makes its replacement non-trivial.

**The consequence is concrete.** The idiomatic assertion — `expect(results).toHaveNoViolations()`,
and every helper shaped like it — reads only `results.violations`. Against the exact defect that
motivated adopting axe-core, **it would pass**. Adopting axe with a default-shaped helper closes
nothing in this class.

**Binding on the WIC-1675 / axe implementation:** the shared assertion helper must treat
`incomplete` as failing, not merely `violations`. It cannot do so globally without an allowlist —
`color-contrast` is inherently `incomplete` under jsdom, which has no layout engine — so the
helper must carry an explicit, commented allowlist of rules permitted to be `incomplete`, and
`aria-prohibited-attr` must not be in it.

This also converts the ruling's §4.3 sequencing (land axe → confirm it flags the same two
components → *then* delete `prohibitedName.ts`) from prudence into a hard gate. With a naive
helper that confirmation step fails, and the correct response is to fix the helper — not to
delete the working guard anyway.

### 4.2 Reconcile with PR #226, which is in flight and implements a different baseline shape

The ruling's §5 hands implementation over as though it were unstarted. It is not: **PR #226
(WIC-1483) has been open since before the ruling landed** and implements the same decision in a
materially different shape. Nothing in the ruling acknowledges it, and left alone the two would
have to be reconciled during review by someone holding both in their head.

| | ruling §3/§5 | PR #226 as built |
| --- | --- | --- |
| rule set | `flatConfigs.strict` | `flatConfigs.recommended` + `anchor-ambiguous-text` promoted to `error` |
| baseline unit | 23 **files** relaxed to `warn` via an overrides block | 8 **rules** relaxed to `warn` globally |
| ratchet | none — the list is expected to shrink by convention | `jsxA11yBaseline.test.ts` asserts the per-file/per-rule map **exactly**, both directions, cross-checked against `--max-warnings 47` |

The ruling rejected global-`warn` on the argument that it "never ratchets — a warning that 47
pre-existing findings already emit is a warning no one will ever notice a 48th inside." **That
objection does not apply to PR #226 as built,** because the 48th finding fails
`jsxA11yBaseline.test.ts` with a precise diff. The ruling rejected a posture that PR #226 does
not have.

Meanwhile the ruling's own posture has a hole PR #226 closes. Per-file overrides relax the whole
file, so a **new** violation introduced into one of the 22 already-baselined app-source files —
the busiest files in the tree, the ones most likely to be edited — lands at `warn` and passes.
PR #226's exact map catches it, because that file's count rises.

**Ruling: PR #226's ratchet is the baseline mechanism.** It is strictly stronger on detection,
and the reasoning in the ruling against global `warn` was aimed at a weaker design.

**Amend PR #226 in one respect:** swap `flatConfigs.recommended` for `flatConfigs.strict` to pick
up the six option tightenings, and **keep** its `PROMOTED_RULES` block, because `strict` drops
`anchor-ambiguous-text` altogether (§3). Per §3 this swap is free — same 50 findings on the same
23 files at the same lines — so `A11Y_BASELINE`, the `--max-warnings 47` ceiling and the three
fixture disables in `headingOutline.test.tsx` are all unchanged by it. PR #226's own accounting
(24 `error` / 8 `warn` / 2 deliberately `off`) needs re-stating for `strict`, and its test already
pins those figures against the resolved config, so a stale count cannot pass silently.

## 5. What would reopen this

The ruling does not state a reopen trigger; the card asked for one. Any of the following:

1. **The two tools stop covering disjoint classes** — a jsx-a11y release adding an
   `aria-prohibited-attr` equivalent (i.e. a rule that fires on a role-*less* element), or an axe
   release that promotes the text-content case in §4.1 from `incomplete` to `violation`. Either
   changes the cost/benefit of running both. Re-run the §3 probe on upgrade.
2. **`strict` stops being free.** The §3 equivalence is a property of today's tree, not of the
   plugin. If a `strict`-only option tightening starts producing findings that `recommended` does
   not, the choice becomes a real trade-off and should be re-argued rather than inherited.
3. **The baseline stops shrinking.** If `A11Y_BASELINE` is materially unchanged when WIC-1589
   closes or is abandoned, the baseline has become a permanent allowlist and the severity posture
   in §2 was the wrong call — revisit `error`-with-baseline versus fixing the backlog first.
4. **The vitest host stops being the fast loop.** §4.1 of the ruling turns on Playwright browsers
   not launching in the agent development environment. If that is fixed, the host choice for axe
   is worth re-taking on coverage grounds — a real browser computes accessibility trees that jsdom
   approximates.

Absent one of these, this is settled. Re-measuring the counts is not grounds to reopen the
decision; the counts are expected to drift and §3 is the method for re-taking them.

## 6. Consequences

- **Not WCAG 2.1 AA conformance.** jsx-a11y + axe-core + heading order is a machine-checkable
  floor. Colour contrast, focus-visible quality, motion, reading order and every judgement-based
  criterion remain unverified. `ACCESSIBILITY.md`'s enforcement-status note stays until the config
  lands (WIC-1584), and an ADR is not a green check.
- **Nothing here is enforced yet.** This ADR and the ruling are both documents. The mechanism
  ships in PR #226 (jsx-a11y) and the WIC-1675 work (axe).
- **No new cards.** WIC-1483, WIC-1589 and WIC-1675 already own the work; §4 changes their
  content, not their existence. WIC-1589 keeps the 47-finding backlog, whose precision audit
  (19/19 `label-has-associated-control` true positives, zero false positives) is in the ruling
  §2.1 and was not re-derived here.
- **`no-autofocus` exceptions remain legitimate.** Five findings; a command palette or a modal's
  first field may justifiably autofocus. Commented `eslint-disable-next-line` is a valid outcome
  there, not a dodge.

## 7. References

- `docs/design/A11Y_ENFORCEMENT_RULING.md` — the ruling this ratifies; §2.1 precision audit and
  §6 baseline table are the substantive record and are not duplicated here.
- `docs/design/ACCESSIBILITY.md` — guidelines and standing enforcement-status note.
- `docs/design/ROUTE_HEADING_OUTLINE.md` — WIC-1581 ruling behind `routeHeadingOutline.test.ts`.
- `packages/web/src/test/prohibitedName.ts` — the interim guard; retire only per §4.1.
