import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import packageJsonRaw from '../../package.json?raw';

/**
 * The `eslint-plugin-jsx-a11y` ratchet (WIC-1483, layer 1).
 *
 * WCAG 2.1 AA has been an accepted Board requirement since 2026-04-15 (WIC-15 §8) with
 * nothing in the repo enforcing it. Layer 1 is the plugin; this file is the part that
 * makes adopting it *enforcement* rather than a gesture.
 *
 * 31 of the 34 resolved rules are `error` on this tree, so `npm run lint` already fails
 * CI on a new violation of any of them. 1 is `warn` (see `BASELINED_RULES` in
 * `eslint.config.js`) purely so that adopting the plugin did not require fixing 47
 * pre-existing defects in the same change (WIC-1483) — 43 of those 47 have since been
 * retired (WIC-1589, WIC-1942, WIC-2062, WIC-2073, WIC-2077) — and 2 are deliberately `off` (see
 * `PROMOTED_RULES` for the measured cost of each).
 *
 * That 31 is asserted below against the RESOLVED config rather than restated in prose.
 * The first revision of this suite hand-computed it as `34 - 8 = 26`, which was wrong for
 * a different reason at the time: `recommended` ships 3 of its 34 entries `off`, so the
 * surface was 23, and the wrong figure sat in four files at once with nothing able to
 * contradict it. A count that only exists in a comment is precisely the unenforced claim
 * this card was filed about.
 *
 * The config extends `flatConfigs.strict`, and NONE of those counts can tell you so —
 * `strict` and `recommended` resolve to the same 34 entries and the same 31/1/2 histogram
 * once `PROMOTED_RULES` restores `anchor-ambiguous-text`, which `strict` drops entirely.
 * They also produce identical findings on this tree (1, over the same file, rule, line
 * and columns). The whole difference is in rule OPTIONS, so that is what the last test
 * asserts; without it, a silent revert to `recommended` passes every assertion here.
 *
 * A downgrade-to-warn with no counter-pressure is how an allowlist becomes a permanent
 * tree-wide hole, so the baseline is pinned in BOTH directions and per file:
 *
 *   - a NEW violation in any file fails, even in a `warn` rule;
 *   - a FIXED violation also fails, forcing the baseline down instead of letting it
 *     rot upward. `toEqual` on the whole map, not `toBeLessThanOrEqual` on a total;
 *   - it is keyed by file+rule, so fixing one file and breaking another — which leaves
 *     the total at 1 — is still a failure.
 *
 * The `--max-warnings` ceiling in `package.json` is cross-checked against the same
 * measurement, so the two numbers cannot silently disagree.
 *
 * Scope limit, stated so a green run is not over-read: `jsx-a11y` is a per-FILE lint.
 * It is structurally blind to a heading-order defect that exists only in the
 * composition of a page and the component it mounts (`/cover-letters/new` was exactly
 * that shape — neither file was defective alone). This suite does NOT cover WCAG
 * SC 1.3.1; the rendered-outline assertion is layer 2.
 */

/**
 * `packages/web`, as an absolute path, derived without any `node:` builtin.
 *
 * This package typechecks with `"types": ["vite/client"]` and no `@types/node`, so
 * `node:path`/`node:url`/`node:fs` are a TS2307 in CI's `typecheck` step while running
 * perfectly well under vitest — green locally, red in CI. String methods need no types,
 * and `?raw` is declared by vite/client, so both spellings used here are typed.
 *
 * Derived from this file's own location rather than `process.cwd()` so the suite lints
 * the same tree no matter which directory vitest was started from.
 *
 * Sliced off `import.meta.url` as a plain string on purpose. `new URL('../..',
 * import.meta.url)` is the obvious spelling and it does NOT work here: vite rewrites that
 * exact pattern at transform time and hands back `/@fs/…/packages/web`, a served-asset
 * path with no counterpart on disk. That value still ends in `/packages/web`, so it slips
 * past the shape check below; what makes it loud is ESLint erroring on a glob that matches
 * no files. Keep the string form.
 */
const webRoot = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '')).replace(
  /\/src\/test\/[^/]*$/,
  ''
);

type RuleCounts = Record<string, number>;

/**
 * Measured on this tree after WIC-2078. 1 finding, 1 file, 1 rule — down from the 47/22/8
 * at WIC-1483 adoption, now that `label-has-associated-control` (19 -> 0),
 * `no-redundant-roles` (1 -> 0), `no-noninteractive-element-to-interactive-role` (1 -> 0),
 * `no-static-element-interactions` (2 -> 0), `no-autofocus` (5 -> 0),
 * `click-events-have-key-events` (1 -> 0) and
 * `no-noninteractive-element-interactions` (3 -> 0) are fully retired. Owned by WIC-1589.
 *
 * ⚠️ One rule left, one finding, and it is the one this ratchet CANNOT drive to zero.
 * `no-noninteractive-tabindex` on `ApplicationCard`'s `<article>` is load-bearing: every
 * spelling that satisfies the rule — a real `<button>`, or `role="button"` on the article —
 * trips axe's `nested-interactive` instead, because `SortableApplicationCard` wraps each
 * card in a dnd-kit `div[role="button"][tabindex="0"]`. WIC-2077 measured that in both
 * directions and reverted its own fix over it. So do not read "1 remaining" as "nearly
 * done" and reach for the obvious change; the next move on this entry is a dnd-kit
 * wrapper question, not a jsx-a11y one, and the OTHER baseline is what would tell you.
 *
 * ⚠️ This header used to end "every entry here is a real defect, not an accepted
 * exception." WIC-2077 retired that sentence rather than let it stay false, and the
 * reason is worth keeping: at 10 findings it was untrue of HALF the map. The five
 * `no-autofocus` entries were not defects — every one was a user-initiated focus move
 * into a newly-revealed input, four of them inside a Radix dialog where WCAG 2.4.3
 * *requires* focus to enter. They are now `eslint-disable-next-line` directives carrying
 * a per-site rationale, and the rule is back at `error`.
 *
 * The sentence mattered because it is what makes the ratchet trustworthy: it is the
 * claim that a number going down means a defect was fixed. So the invariant is now
 * stated as something this file can actually keep, and it is narrower —
 *
 *   an entry here is a finding NOBODY HAS ADJUDICATED YET.
 *
 * A finding that has been reviewed leaves this map in one of two directions: fixed, or
 * exempted at the site with a stated reason. It does not sit here. "Reviewed and
 * accepted" has a spelling — a disable directive — and it is deliberately the one that
 * costs a line of justification at the point of use, where the next reader needs it,
 * rather than a row in a table nobody reads while editing a component.
 */
const A11Y_BASELINE: Record<string, RuleCounts> = {
  'src/components/ApplicationCard.tsx': {
    'no-noninteractive-tabindex': 1,
  },
  // `src/components/CatalogBrowse/CatalogBrowseView.tsx` used to sit here with
  // `click-events-have-key-events: 1` + `no-static-element-interactions: 1` — the pending-diff
  // card was a bare `<div onClick={…} className="cursor-pointer">`. WIC-2073 moved opening the
  // diff onto a real `<button>` inside the card's existing `<h2>`, per the precedents below,
  // and gave the nested "Review Changes" button its own handler (it had relied on bubbling to
  // the wrapper, which is now inert). Entry deleted rather than zeroed.
  // `src/components/CommandPalette.tsx` used to sit here with `no-autofocus: 1` — the
  // Cmd+K search input at `:359`, inside `Dialog.Content` (`:308`). Not a defect: WCAG
  // 2.4.3 requires focus to enter a dialog on open, and searching is the dialog's whole
  // purpose. WIC-2077 recorded it as a disable directive with that rationale at the line.
  // Entry deleted rather than zeroed. See the WIC-2077 block below.
  // `src/components/FilterPanel.tsx` used to sit here with `click-events-have-key-events: 1` +
  // `no-noninteractive-element-interactions: 1` — an `onClick` on the "Active Only" `<label>`.
  // This one was not a keyboard gap but a live functional bug, and WIC-2073 measured it rather
  // than assuming it: `<button>` is a labelable element, so `htmlFor` ALREADY forwarded the
  // click to the switch, and the label's own handler ran `handleActiveOnlyToggle` a second
  // time. On a stateful host one label click wrote `{activeOnly: true}` then `{}` — the
  // control did nothing at all. Deleting the `onClick` retires both findings and fixes the
  // toggle; no markup was restructured. Entry deleted rather than zeroed.
  // `click-events-have-key-events` retired here by WIC-2077 slice 2 (the dropzone's `onClick`
  // is now a real "browse files" `<button>`); `no-noninteractive-element-interactions` did NOT
  // retire — the `onDrop`/`onDragOver`/`onDragLeave` handlers trip it on their own.
  // `src/components/ResumeVariantCard.tsx` used to sit here with
  // `no-noninteractive-element-to-interactive-role: 1` — the `<article role="button">`.
  // WIC-1942 removed that role (it also tripped axe's `aria-allowed-role` and
  // `nested-interactive`), moving the card's navigation onto a real button inside the
  // heading, so the file now has no jsx-a11y finding at all and the entry is deleted
  // rather than zeroed. That drops BASELINE_TOTAL 27 -> 26; both `--max-warnings`
  // ceilings in package.json move with it.
  // `src/components/STARStoryBank.tsx` used to sit here with `click-events-have-key-events: 1`
  // + `no-noninteractive-element-interactions: 1` — an `<h3 className="cursor-pointer"
  // onClick={…}>` expand toggle, literally the shape WIC-2062 fixed. WIC-2073 moved the toggle
  // onto a real `<button>` inside that existing heading and added `aria-expanded`, which names
  // the state `cursor-pointer` could only hint at. Entry deleted rather than zeroed.
  // `src/components/SavedFilterShortcuts.tsx` used to sit here with `no-autofocus: 1` —
  // the "Save current filters as:" name field at `:150`. The only one of the five that is
  // NOT in a dialog, and still not a defect: the panel does not exist until the user
  // presses "+ Save Current" (`:129`), so the focus move is user-initiated and Escape
  // dismisses it (`:153`). Entry deleted rather than zeroed.
  // `src/components/StarEntryPicker.tsx` used to sit here with `click-events-have-key-events: 1`
  // + `no-static-element-interactions: 1` — `<div onClick={onToggle} className="cursor-pointer">`
  // in `StarEntryCard`. Unlike the other three, no control had to be ADDED: the card already
  // contained a real checkbox wired to the same `onToggle`, so WIC-2073 made the wrapper inert
  // and let the checkbox be the control, naming it with `aria-label={entry.title}`. Its
  // `onClick={(e) => e.stopPropagation()}` existed only to escape the wrapper handler and is now
  // dead code, deleted — the same call the Reports* fix removed, and the one part of the change
  // that could regress working behaviour, so it is pinned by name in StarEntryPicker.test.tsx.
  // Clicking the card BODY no longer toggles; that affordance was keyboard-unreachable, so it
  // was never part of the accessible contract, but it is a real change for pointer users.
  // Entry deleted rather than zeroed.
  // `src/components/wizard/WizardContainer.tsx` used to sit here with `no-autofocus: 1` —
  // the step-1 company field at `:288`, which renders inside `Dialog.Content` (`:481`, via
  // `renderStepContent()` at `:527`). Same WCAG 2.4.3 reading as CommandPalette. Entry
  // deleted rather than zeroed.
  // `src/pages/ProjectsList.tsx` used to sit here with `no-autofocus: 1` — the Project
  // Name field at `:234`, inside the create-modal's `Dialog.Content` (`:212`). This is the
  // one of the five that would have been actively DANGEROUS to "fix": per the comment at
  // `ProjectsList.tsx:52-54`, the `autoFocus` is what stops Radix dispatching
  // `onOpenAutoFocus`, which is what makes `useDialogFocusRestore`'s `focusin` fallback
  // capture the trigger. Removing it changes the focus-restore path pinned by WIC-1931 —
  // and it would do so silently, because the lint finding it retires says nothing about
  // focus restore. Entry deleted rather than zeroed; behaviour untouched.
  // The four `src/pages/Reports*.tsx` entries used to sit here, one
  // `click-events-have-key-events` + one `no-static-element-interactions` each — the
  // application card rendered as a bare `<div onClick={…} className="cursor-pointer">`,
  // unreachable by keyboard and invisible to assistive tech (WCAG 2.1.1). WIC-2062 moved
  // each card's navigation onto a real `<button>` inside its existing heading, following
  // the `ResumeVariantCard` precedent above rather than putting a role on the wrapper, so
  // all four files now have no jsx-a11y finding at all and the entries are deleted rather
  // than zeroed. That drops BASELINE_TOTAL 26 -> 18; both `--max-warnings` ceilings in
  // package.json move with it, and the trailing counts on `BASELINED_RULES` in
  // eslint.config.js go 9 -> 5 and 6 -> 2. Neither rule reaches zero, so both stay `warn`.
  // Keyboard reachability is pinned per page by `src/pages/Reports*.keyboardNav.test.tsx`.
  //
  // WIC-2073 then took the remaining four entries of that same shape — CatalogBrowseView,
  // FilterPanel, STARStoryBank and StarEntryPicker, all deleted in place above — dropping
  // BASELINE_TOTAL 18 -> 10 and both ceilings with it. This time a rule DID reach zero:
  // `no-static-element-interactions` (2 -> 0) is gone from `BASELINED_RULES` and back at
  // `error`, taking the enforcement surface 27/5/2 -> 28/4/2. That promotion is forced, not
  // chosen — 'states its enforcement surface exactly' below asserts the `warn` set equals
  // exactly the rules this map records, so a zero-finding rule cannot remain baselined.
  // Keyboard reachability is pinned per component by `*.keyboardNav.test.tsx` alongside each.
  //
  // WIC-2077 then took all five `no-autofocus` entries — CommandPalette, SavedFilterShortcuts,
  // WizardContainer, ProjectsList (all deleted in place above) and ResumeVariantDetail
  // (`:179`, the inline title-edit field revealed by the "Edit" button at `:197`) — dropping
  // BASELINE_TOTAL 10 -> 5 and both `--max-warnings` ceilings with it. `no-autofocus`
  // (5 -> 0) leaves `BASELINED_RULES` and returns to `error`, taking the enforcement
  // surface 28/4/2 -> 29/3/2.
  //
  // ⛔ Unlike every deletion above it, this one changed NO behaviour. All five sites were
  // read individually and all five are correct as written; the entries left because each
  // is now an `eslint-disable-next-line jsx-a11y/no-autofocus` carrying the reason it is
  // exempt. Do not read "no-autofocus reached 0" as "five autofocus defects were fixed" —
  // the rule is known to over-fire on exactly this case (a user-initiated focus move into
  // a newly-revealed input), and the fleet has now spent a card establishing that. If a
  // sixth site appears, the question to ask is which of the two spellings it deserves, not
  // whether to delete the attribute.
  //
  // This is still a net tightening. Before, `autoFocus` anywhere in the tree was a warning
  // absorbed by the ceiling; now it fails `npm run lint`, with five reviewed exemptions.
  //
  // WIC-2077 slice 2 then took `ResumeUpload.tsx`, dropping BASELINE_TOTAL 5 -> 4 and both
  // ceilings with it. `click-events-have-key-events` (1 -> 0) is promoted off
  // `BASELINED_RULES` back to `error`, taking the enforcement surface 29/3/2 -> 30/2/2.
  //
  // ⛔ Slice 2 was scoped as TWO files. `ApplicationCard.tsx` was implemented, measured, and
  // then REVERTED, and the reason is the most important thing on this card to carry forward:
  // the prescribed fix trades a `jsx-a11y` warning for a **serious axe violation**.
  //
  // Moving the card's activation onto a real `<button>` inside its `<h3>` — the
  // `ResumeVariantCard`/`Reports*` precedent, correct everywhere it has been applied before —
  // reds `routeAxe.render.test.tsx` with `nested-interactive` on `/applications`. The cause is
  // outside `ApplicationCard` entirely: `SortableApplicationCard` wraps every card in a dnd-kit
  // `<div role="button" tabindex="0" aria-roledescription="sortable">` (`{...attributes}`), so a
  // real button inside the card is an interactive control nested inside a widget. Isolated by
  // bisection — the `ResumeUpload` half alone is axe-clean, the `ApplicationCard` half alone
  // reproduces it.
  //
  // Note the direction. This is the WIC-1942 lesson inverted: there, REMOVING an
  // `<article role="button">` cleared both an axe finding and a jsx-a11y one at once. Here the
  // two ratchets pull against each other, and axe is measuring the more serious defect — so the
  // lint finding stays and the card keeps its `tabIndex`, which is the accessible-enough state
  // rather than the lint-clean one. A precedent that has held five times can still be wrong on
  // the sixth site, and only the OTHER baseline could say so.
  //
  // Also unfixed and deliberately not smuggled in here: `ApplicationCard`'s quick-action bar is
  // gated on `isHovered`, so its Edit and Delete buttons are mouse-only. That is a larger
  // keyboard gap than the lint finding beside it, and `jsx-a11y` is structurally blind to it —
  // no baseline number moves when it is fixed. Both are tracked as WIC-2078.
  //
  // WIC-2078 then adjudicated all three `no-noninteractive-element-interactions` survivors —
  // `ApplicationCard` (entry trimmed above), `ResumeUpload` and `wizard/WizardStep` (both
  // deleted in place) — dropping BASELINE_TOTAL 4 -> 1 and both `--max-warnings` ceilings with
  // it. The rule (3 -> 0) leaves `BASELINED_RULES` and returns to `error`, taking the
  // enforcement surface 30/2/2 -> 31/1/2.
  //
  // ⛔ All three are EXEMPTIONS, not fixes — the same shape as WIC-2077's `no-autofocus` block
  // above, and the distinction is again the thing worth carrying forward. No markup became
  // more operable at any of the three. The rule fires once per ELEMENT on the presence of any
  // handler, which was measured rather than assumed: on a bare `<article>`, `onClick` alone and
  // `onKeyDown` alone each trip it independently. That is what makes it unreachable here —
  // `ApplicationCard`'s finding could not have been retired by deleting the drag and hover
  // handlers, because the activation handlers the card must keep trip it by themselves.
  //
  // Each carries its reason at the line: the card's own activation (axe forbids the
  // alternatives, above); the resume drop TARGET, which cannot be given a keyboard equivalent
  // and instead has one on the sibling "browse files" button; and the wizard's Ctrl+Enter,
  // a container-scoped shortcut delegated from focusable descendants, where `tabIndex` would
  // add a dead tab stop and a `document` listener would widen the shortcut's scope.
  //
  // ⭐ The real user-facing defect on this card moved NO number here, which is the point of
  // recording it: `ApplicationCard`'s quick-action bar now reveals on focus as well as hover,
  // so Edit and Delete are keyboard-reachable for the first time (WCAG 2.1.1). `jsx-a11y` is
  // per-file and static and cannot see a control that is absent from the DOM, so this suite
  // was green before the fix and is green after it. It is pinned by
  // `ApplicationCard.keyboardNav.test.tsx` instead — which is where a reader who trusts the
  // baseline as a coverage measure should be sent, because on this defect it measured nothing.
  //
  // WIC-2078 also deleted the card's native HTML5 drag, which was write-only: `setData` with
  // no reader anywhere in `src`. That removed two more handlers from the same element and,
  // exactly as the paragraph above predicts, changed this file not at all.
};

const BASELINE_TOTAL = Object.values(A11Y_BASELINE)
  .flatMap((counts) => Object.values(counts))
  .reduce((a, b) => a + b, 0);

type Measurement = {
  byFile: Record<string, RuleCounts>;
  total: number;
  errors: number;
  /** How many files ESLint actually read. Zero findings over zero files is not a clean tree. */
  filesLinted: number;
};

/** Linting the whole tree takes ~10s, and two tests need it. Do it once. */
let measured: Promise<Measurement> | undefined;
function measure(): Promise<Measurement> {
  return (measured ??= runEslint());
}

/** Every jsx-a11y finding in `src`, as `{ [relativePath]: { [ruleName]: count } }`. */
async function runEslint(): Promise<Measurement> {
  const eslint = new ESLint({ cwd: webRoot });
  const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);

  const byFile: Record<string, RuleCounts> = {};
  let total = 0;
  let errors = 0;

  for (const result of results) {
    // ESLint reports absolute paths. Strip the root by prefix rather than with
    // `path.relative`, and fail loudly if a result lands outside it instead of emitting a
    // `../..`-shaped key that could never match the baseline and would read as a regression.
    if (!result.filePath.startsWith(`${webRoot}/`)) {
      throw new Error(`lint result outside ${webRoot}: ${result.filePath}`);
    }
    const rel = result.filePath
      .slice(webRoot.length + 1)
      .split('\\')
      .join('/');
    for (const message of result.messages) {
      if (!message.ruleId?.startsWith('jsx-a11y/')) continue;
      const rule = message.ruleId.slice('jsx-a11y/'.length);
      byFile[rel] ??= {};
      byFile[rel][rule] = (byFile[rel][rule] ?? 0) + 1;
      total += 1;
      if (message.severity === 2) errors += 1;
    }
  }

  return { byFile, total, errors, filesLinted: results.length };
}

describe('jsx-a11y baseline (WIC-1483)', () => {
  it('has the plugin actually wired into the shared config', async () => {
    // A positive control. Without it, every assertion below passes just as happily when
    // the plugin fails to load or the `extends` entry is dropped — a null result would
    // read as "the tree is clean" when it means "nothing was checked".
    //
    // The shape check on the root is necessary and NOT sufficient, which is worth stating
    // because the insufficiency was demonstrated rather than imagined: the vite-rewritten
    // `/@fs/…/packages/web` path satisfies this assertion and resolves to nothing on disk.
    // The count in the next test is what closes that; this only catches a gross mismatch.
    expect(webRoot.endsWith('/packages/web'), `webRoot resolved to ${webRoot}`).toBe(true);

    const eslint = new ESLint({ cwd: webRoot });
    const [result] = await eslint.lintText('export const Bad = () => <img src="x.png" />;\n', {
      filePath: `${webRoot}/src/__a11y_positive_control__.tsx`,
    });

    const fired = result.messages.filter((m) => m.ruleId?.startsWith('jsx-a11y/'));
    expect(fired.map((m) => m.ruleId)).toContain('jsx-a11y/alt-text');

    // ...and that a clean rule is a hard error, not a warning. This is what makes
    // `npm run lint` a build-failing gate rather than advisory output (AC-1).
    expect(fired.find((m) => m.ruleId === 'jsx-a11y/alt-text')?.severity).toBe(2);
  }, 60_000);

  it('matches the recorded baseline exactly — no new violations, and no stale entries', async () => {
    const { byFile, filesLinted } = await measure();

    // The anti-no-op guard, and it is NOT redundant with the equality below.
    //
    // `toEqual` pins *what* was found; nothing in it pins *how much was looked at*. Narrow
    // the glob and regenerate A11Y_BASELINE from the narrowed run — which is exactly the
    // shape of "regenerate the baseline until it goes green" — and the two agree with each
    // other perfectly while most of the tree goes unchecked. Re-measured at WIC-2077: glob
    // narrowed to `src/pages/**`, with A11Y_BASELINE and both `--max-warnings` ceilings
    // regenerated to agree, reads **60 of 249** files and fails here.
    //
    // Four corrections to earlier versions of this note, every one from re-measuring it
    // rather than re-reading it — which is the habit this whole file argues for. It once
    // said "8 of 148", which was the wrong quantity as well as a stale total: 8 is how many
    // files had FINDINGS, and the number this line exists to pin is how many were READ. It
    // then said "32 of 151", correct in quantity and stale in both figures. And it said the
    // mutation was otherwise fully green, which stopped being true when 'states its
    // enforcement surface exactly' was added below — that test ties the `warn` set to the
    // rules the baseline records, so a narrowed baseline reds it too.
    //
    // The fourth correction is WIC-2077's, and it moved the figure to a corner: `src/pages`
    // now yields **0** findings, not 1. `no-autofocus` was the only rule surviving the
    // narrowing, and its two `src/pages` sites (ProjectsList, ResumeVariantDetail) are now
    // disable directives. So the narrowed baseline is `{}` and the narrowed `warn` set is
    // empty — measured, not derived. That makes the mutation MORE loudly red, not less,
    // and it now fails whichever way it is patched up: leave `BASELINED_RULES` alone and
    // the `warn` set (2) disagrees with the rules an empty baseline records (0); trim it to
    // match and both fall back to `error`, so the error count goes 31 -> **32**.
    // Getting this mutation green means editing the assertions themselves, not just the
    // baseline — which is the point of both guards. Verified by running it, not by reading:
    // with this line deleted, the narrowed suite still reds on 'states its enforcement
    // surface exactly'.
    //
    // 249 `.ts`/`.tsx` files under `src` today; a floor of 100 absorbs ordinary churn.
    expect(filesLinted).toBeGreaterThan(100);

    // Equality, deliberately. `toBeLessThanOrEqual` on a total would let a regression
    // hide behind an unrelated fix, and would let the baseline outlive the defects it
    // describes. If this fails because a violation was FIXED: delete the entry, drop
    // `--max-warnings` in package.json to match, and if a rule hit zero, remove it from
    // BASELINED_RULES in eslint.config.js so it goes back to `error`.
    expect(byFile).toEqual(A11Y_BASELINE);
  }, 60_000);

  it('keeps the --max-warnings ceiling in step with the baseline', async () => {
    const { total, errors } = await measure();
    const pkg = JSON.parse(packageJsonRaw) as { scripts: Record<string, string> };

    // Guard the guard: if the flag is ever dropped or renamed, this must fail rather
    // than quietly stop pinning anything.
    const ceiling = /--max-warnings\s+(\d+)/.exec(pkg.scripts.lint);
    expect(ceiling, `no --max-warnings in lint script: ${pkg.scripts.lint}`).not.toBeNull();
    expect(Number(ceiling![1])).toBe(BASELINE_TOTAL);
    expect(total).toBe(BASELINE_TOTAL);

    // `lint:fix` carries the same ceiling and, until now, nothing checked it. Lower `lint`
    // to 20 and leave `lint:fix` at 18 and the two silently disagree — a hole in a guard
    // whose stated job is that they cannot. Both are pinned to the same measurement.
    const fixCeiling = /--max-warnings\s+(\d+)/.exec(pkg.scripts['lint:fix']);
    expect(
      fixCeiling,
      `no --max-warnings in lint:fix script: ${pkg.scripts['lint:fix']}`
    ).not.toBeNull();
    expect(Number(fixCeiling![1])).toBe(BASELINE_TOTAL);

    // The baselined 1 finding is `warn`, so `--max-warnings` is what pins them. Any
    // jsx-a11y finding at `error` severity would fail `npm run lint` outright — which is
    // correct for the other 31 rules, but means the tree is currently red, so say so here.
    //
    // NOTE (WIC-2077): this is also what proves the five `no-autofocus` disable directives
    // are actually taking effect. `no-autofocus` is now at `error`, so a directive that
    // failed to suppress its site — a typo in the rule name, a comment that drifted off the
    // line it guards — would land here as a non-zero `errors`, not as a quiet warning.
    expect(errors).toBe(0);
  }, 60_000);

  it('states its enforcement surface exactly — 31 error, 1 warn, 2 deliberately off', async () => {
    // The reason this test exists.
    //
    // Every other number in this PR is measured; the enforcement surface was not. It was
    // hand-derived as `34 - 8 = 26`, copied into four files, and wrong in all four —
    // `jsx-a11y`'s `recommended` ships 3 of its 34 entries `off`, so nothing was enforcing
    // them and the real figure was 23. No assertion here could fail on that, which is the
    // same shape as the defect this whole card is about: a stated requirement with no
    // mechanism able to contradict it.
    //
    // Read from the RESOLVED config for a real source file, so it accounts for the
    // plugin's own severities AND this repo's overrides together — the arithmetic that
    // produced 26 is exactly what must not be trusted a second time.
    const eslint = new ESLint({ cwd: webRoot });
    const config = await eslint.calculateConfigForFile(`${webRoot}/src/App.tsx`);

    const a11yRules = Object.entries(config.rules ?? {}).filter(([rule]) =>
      rule.startsWith('jsx-a11y/')
    );
    const severityOf = (entry: unknown) => (Array.isArray(entry) ? entry[0] : entry);
    const named = (severity: number) =>
      a11yRules
        .filter(([, entry]) => severityOf(entry) === severity)
        .map(([rule]) => rule)
        .sort();

    // Fails closed: if the config failed to resolve, `rules` is empty and every count is 0.
    expect(a11yRules).toHaveLength(34);

    expect(named(2)).toHaveLength(31);
    expect(named(1)).toHaveLength(1);

    // Pinned BY NAME, not just counted. `label-has-for` is deprecated upstream and
    // superseded by `label-has-associated-control`, now at `error` with 0 findings
    // (WIC-1589); leaving `label-has-for` on would re-litigate the same 82 findings in a
    // withdrawn spelling, now that the successor is clean.
    // `control-has-associated-label` is opt-in upstream and costs 3 — real work, owned by
    // WIC-1589, deliberately not smuggled into this change. If a plugin upgrade turns a
    // THIRD rule off, that is a silent loss of enforcement and this must fail.
    expect(named(0)).toEqual(['jsx-a11y/control-has-associated-label', 'jsx-a11y/label-has-for']);

    // The 1 at `warn` must be exactly the rule the baseline records findings for. This
    // ties the config to the evidence: baselining a rule that has no recorded violations,
    // or recording violations for a rule that is not baselined, both fail here.
    const baselinedRules = [
      ...new Set(Object.values(A11Y_BASELINE).flatMap((counts) => Object.keys(counts))),
    ]
      .map((rule) => `jsx-a11y/${rule}`)
      .sort();
    expect(named(1)).toEqual(baselinedRules);
  }, 60_000);

  it('is extended from `strict`, and closes the expression-value hole `recommended` leaves open', async () => {
    // Nothing above this line can tell `strict` from `recommended` (ADR-011 §4.2).
    //
    // The two configs are 33 entries `{error: 31, off: 2}` and 34 `{error: 31, off: 3}`,
    // and they differ on 7 rules — but 6 of those differences are in rule OPTIONS, and the
    // 7th is that `anchor-ambiguous-text` is absent from `strict` altogether while
    // `recommended` ships it `off`. PROMOTED_RULES restores it, so BOTH configs resolve to
    // 34 entries at 31/1/2, over the same 2 `off` names. They also produce byte-identical
    // findings on this tree: 4, matching on file + rule + line + column + severity.
    //
    // So every count in the test above is satisfied by either ruleset, and a revert of the
    // `extends` entry would pass the whole suite while quietly restoring the hole below.
    // Options are the only observable difference; this is the assertion that sees them.
    const eslint = new ESLint({ cwd: webRoot });
    const config = await eslint.calculateConfigForFile(`${webRoot}/src/App.tsx`);
    const optionsOf = (rule: string) => {
      const entry = (config.rules ?? {})[`jsx-a11y/${rule}`];
      return Array.isArray(entry) ? entry.slice(1) : [];
    };

    // `allowExpressionValues: true` suppresses these two rules whenever `role` is a JSX
    // expression rather than a literal — i.e. exactly where a static check is least able to
    // reason and most needs to complain. `recommended` sets it on both; `strict` sets
    // neither. Asserted as "no option object at all" rather than as `!== true`, so a future
    // upstream default that re-introduces it under another spelling still fails.
    expect(optionsOf('no-static-element-interactions')).toEqual([]);
    expect(optionsOf('no-noninteractive-tabindex')).toEqual([]);

    // A severity-only override (`'warn'` in BASELINED_RULES) replaces the severity and
    // KEEPS the extended config's options, which is why the tightening reaches these two
    // even though both are baselined. If flat config ever stopped merging that way, the
    // assertions above would read as `strict` on a config that had lost its options
    // entirely — so pin a rule that is NOT baselined and whose options are non-empty under
    // both. `strict` adds `progressbar` and `slider` to the tabbable set.
    const tabbable = (optionsOf('interactive-supports-focus')[0] as { tabbable?: string[] })
      ?.tabbable;
    expect(tabbable).toContain('progressbar');
    expect(tabbable).toContain('slider');

    // And the behaviour, not just the config that is supposed to produce it. Under
    // `recommended` this snippet emits NOTHING; a new instance of it would land in the tree
    // with no warning and no diff to argue with. Under `strict` it is a finding, which —
    // because `no-noninteractive-tabindex` is baselined at `warn` — makes it a 5th warning
    // and fails `npm run lint` against the `--max-warnings` ceiling.
    const [result] = await eslint.lintText(
      "const role = 'button';\nexport const Bad = () => <div role={role} tabIndex={0} />;\n",
      { filePath: `${webRoot}/src/__strict_control__.tsx` }
    );
    expect(result.messages.map((m) => m.ruleId)).toContain('jsx-a11y/no-noninteractive-tabindex');
  }, 60_000);
});
