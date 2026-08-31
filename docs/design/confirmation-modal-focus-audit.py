#!/usr/bin/env python3
"""
`ConfirmationModal` focus-restore obligation audit — MODAL_FOCUS_MANAGEMENT_SPEC §5.3.

WIC-1181 was the app's only irreversible action dropping focus on `<body>`: the
`🗑️ Delete` trigger is rendered per row inside `resumes.map(...)`, so confirming
the delete unmounts the very element focus was restored to. The remedy is the
`restoreFocusTo` prop, and that prop is — correctly — **optional**: a cancel-only
dialog whose trigger survives must not be forced to name a fallback.

That optionality is the hole this script closes. A future call site whose confirm
action destroys its own trigger reintroduces WIC-1181 with no type error, no lint
error and no failing test. The author cannot catch it by inspecting the trigger at
close time either — the failure is an *ordering* race (spec §4.2: the restore
succeeds and is then undone a macrotask later), so both obvious in-code guards are
measurably wrong.

A lint rule cannot decide this. "Does this dialog's `onConfirm` unmount its own
trigger?" is a data-flow question across a mutation, a query invalidation and a
conditional render — not statically decidable in general. So the guard is a
**declaration**: every call site either passes `restoreFocusTo`, or says in one
line why its trigger survives.

    <ConfirmationModal ... restoreFocusTo={listRef} />          # obligation met

    {/* focus-restore-exempt: the Filters button lives in the toolbar above the
        list, so no confirm outcome can unmount it. */}
    <ConfirmationModal ... />                                    # obligation waived, on the record

Exit codes: 0 = clean, 1 = at least one undeclared call site.

Wired into `.github/workflows/deploy.yml` alongside `doc-reference-audit.py`,
`route-title-table-audit.py` and `wireframe-casing-audit.py`. An audit script no CI
job runs is prose with a shebang.

WHAT A GREEN CHECK HERE DOES *NOT* MEAN — stated so it is not over-read:

  * **It does not check that the ref you passed is any good.** §5.1 rule 1 (the
    fallback must render on *both* arms of the branch the action flips) and rule 2
    (a `fallbackRef` still `null` at `onCloseAutoFocus` disables the watch
    silently) are structural judgements this script cannot make. Passing a
    throwaway ref satisfies this audit and ships the bug — which is exactly why
    §5.3 refuses to make the prop required.
  * **It does not read the exemption's reasoning**, only that one exists and is
    longer than a shrug.
  * **It covers `ConfirmationModal` call sites only.** The §5.3 obligation is
    normative for *every* dialog in the app; this mechanises the one component
    with a uniform prop to grep for.
  * **It skips test and e2e files**, which instantiate the component to exercise
    it rather than to ship a surface.
  * **It is dormant until the `restoreFocusTo` prop exists** (see below).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
WEB_SRC = REPO / "packages" / "web" / "src"
COMPONENT = WEB_SRC / "components" / "ConfirmationModal.tsx"

OPEN_TAG = "<ConfirmationModal"
PROP = "restoreFocusTo"

# The prop as *declared on the component*, e.g. `restoreFocusTo?: RefObject<…>`.
PROP_DECL = re.compile(rf"\b{PROP}\??\s*:")

EXEMPT = re.compile(r"focus-restore-exempt:\s*(.+)", re.DOTALL)

# How many lines above the opening tag an exemption comment may sit. Enough for a
# wrapped two-line comment, short enough that it must be adjacent to the thing it
# excuses.
EXEMPT_LOOKBACK = 8

# A reason shorter than this is a shrug, not a declaration. "n/a", "ok", "cancel
# only" all fail; the sentence a reviewer can disagree with passes.
MIN_REASON_CHARS = 40

SKIP_SUFFIXES = (".test.tsx", ".spec.tsx")
SKIP_DIRS = {"test", "__tests__", "e2e"}


def element_text(source: str, start: int) -> str | None:
    """Return the JSX element text beginning at `start`, or None if unterminated.

    Walks to the `>` that closes the opening tag, tracking `{...}` nesting so a
    brace expression containing `>` (an arrow function, a comparison) does not end
    the tag early. Quotes are tracked only at brace depth 0, where a `>` inside
    `attr="a > b"` would otherwise mislead; inside a brace expression the depth
    counter is already doing the work, and honouring quotes there would misparse
    the `"` characters that appear inside template literals.
    """
    depth = 0
    quote = ""
    for i in range(start, len(source)):
        ch = source[i]
        if quote:
            if ch == quote:
                quote = ""
            continue
        if ch in "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        elif depth == 0:
            if ch in "\"'":
                quote = ch
            elif ch == ">":
                return source[start : i + 1]
    return None


def preceding_lines(source: str, start: int) -> str:
    """The `EXEMPT_LOOKBACK` source lines immediately above the tag at `start`."""
    return "\n".join(source[:start].split("\n")[-(EXEMPT_LOOKBACK + 1) : -1])


def call_sites() -> list[tuple[Path, int, str, str]]:
    """(path, line number, element text or '', context above) for every call site."""
    found = []
    for path in sorted(WEB_SRC.rglob("*.tsx")):
        if path == COMPONENT:
            continue
        if path.name.endswith(SKIP_SUFFIXES) or SKIP_DIRS & set(path.parts):
            continue
        source = path.read_text(encoding="utf-8")
        for m in re.finditer(re.escape(OPEN_TAG) + r"[\s/>]", source):
            start = m.start()
            found.append(
                (
                    path,
                    source[:start].count("\n") + 1,
                    element_text(source, start) or "",
                    preceding_lines(source, start),
                )
            )
    return found


def main() -> int:
    if not COMPONENT.exists():
        print(f"ConfirmationModal not found at {COMPONENT.relative_to(REPO)} — "
              "the component moved or was renamed. Update this audit.")
        return 1

    sites = call_sites()
    prop_exists = bool(PROP_DECL.search(COMPONENT.read_text(encoding="utf-8")))

    if not prop_exists:
        # Dormant, loudly. The rule is adopted (spec §5.3) but the prop it names
        # does not exist at HEAD yet — it lands with PR #115. Failing here would
        # only fail the *existing* compliant-by-absence tree; passing silently
        # would let a green check be read as coverage it does not have.
        print(
            f"NOTICE: `{PROP}` is not declared on ConfirmationModal at this commit, so\n"
            f"MODAL_FOCUS_MANAGEMENT_SPEC §5.3 is NOT ENFORCED on the "
            f"{len(sites)} call site(s) below.\n"
            "This audit activates automatically on the commit that adds the prop\n"
            "(PR #115, WIC-1181). Until then its green check means nothing.\n"
        )
        for path, lineno, _, _ in sites:
            print(f"  unenforced: {path.relative_to(REPO)}:{lineno}")
        return 0

    failures: list[str] = []
    notes: list[str] = []

    for path, lineno, element, context in sites:
        rel = f"{path.relative_to(REPO)}:{lineno}"
        if not element:
            failures.append(
                f"  {rel} — could not find the end of this <ConfirmationModal> tag.\n"
                "      This audit could not read the call site, so it is not "
                "declaring it clean."
            )
            continue
        if PROP in element:
            notes.append(f"  declares {PROP}: {rel}")
            continue
        m = EXEMPT.search(element) or EXEMPT.search(context)
        if m:
            reason = " ".join(m.group(1).replace("*/", " ").replace("}", " ").split())
            if len(reason) < MIN_REASON_CHARS:
                failures.append(
                    f"  {rel} — focus-restore-exempt reason is too short to be a "
                    f"declaration:\n      {reason!r}\n"
                    "      Say what keeps the trigger mounted across the confirm "
                    "action, in a sentence a reviewer can disagree with."
                )
            else:
                notes.append(f"  exempt: {rel} — {reason}")
            continue
        failures.append(
            f"  {rel} — passes neither {PROP} nor a focus-restore-exempt comment."
        )

    for line in notes:
        print(line)

    if failures:
        print(f"\n{len(failures)} undeclared <ConfirmationModal> call site(s):\n")
        print("\n".join(failures))
        print(
            "\nMODAL_FOCUS_MANAGEMENT_SPEC §5.3: if this dialog's confirm action can\n"
            "remove the trigger's own DOM node — directly, or by changing a list or\n"
            "branch the trigger renders inside — `restoreFocusTo` is REQUIRED.\n"
            "\nThe test is NOT 'is the trigger detached when the dialog closes' (it\n"
            "usually is not — §4.2). It is: DOES THE TRIGGER RENDER INSIDE ANYTHING\n"
            "THE ACTION'S REFETCH RE-RENDERS? A per-row control inside a .map() over\n"
            "the mutated collection always answers yes.\n"
            "\nIf the answer is no, say so on the record:\n"
            "  {/* focus-restore-exempt: <why the trigger survives the confirm> */}\n"
            "\nDo not pass a throwaway ref to clear this check. A ref that is null at\n"
            "close time disables the watch silently (§5.1 rule 2) — strictly worse\n"
            "than the omission it hides."
        )
        return 1

    print(f"\nConfirmationModal focus restore OK — {len(sites)} call site(s) declared.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
