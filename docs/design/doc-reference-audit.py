#!/usr/bin/env python3
"""
Dangling design-doc reference audit.

WIC-1582 was filed because `docs/design/*.md` cited sibling specifications by
filename that existed only in an agent's private workspace. An implementer told
to obey "`NOTFOUND_PAGE_DESIGN_SPEC.md` §1, D2" could not open the document, so
the constraint did not really exist. Three such references were live when
WIC-1626 measured it; all three are now resolved by porting the documents in.

This script stops the class from coming back: any `SOMETHING.md` named inside
`docs/` must resolve to a real file somewhere in the repo.

Scope, stated so the green check is not read as more than it is: only
*marked-up* references are checked — `FOO.md` in backticks, or a `[](FOO.md)`
link target. A bare unbackticked `FOO.md` sitting in prose is **not** matched
and will not fail the build. That is deliberate (matching bare filenames
misfires on ordinary sentences), but it means a citation written without
backticks escapes this audit entirely. Backtick your references.

Exit codes: 0 = clean, 1 = at least one dangling reference.

Wired into `.github/workflows/deploy.yml` alongside `route-title-table-audit.py`
and `wireframe-casing-audit.py`. An audit script no CI job runs is prose with a
shebang.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
DOCS = REPO / "docs"

# A markdown-file reference: bare `FOO.md` in backticks, or a []() link target.
DOC_REF = re.compile(r"`([A-Za-z0-9_\-/]+\.md)`|\]\(([A-Za-z0-9_\-./]+\.md)[^)]*\)")

# Fenced code blocks and inline shell/py snippets legitimately name files that
# need not exist (examples, mktemp scratch paths). Strip fences before scanning
# — the same defect the route-title audit hit, where a *comment* naming a
# removed string was credited as a live render site.
FENCE = re.compile(r"^```")

# References that are deliberately not repo files.
ALLOW = {
    # Named inside a wireframe as example content, not a document reference.
    "2023.md",
    # Conventional filenames discussed in prose.
    "README.md",
    "CHANGELOG.md",
    "MEMORY.md",
}


def strip_fenced(text: str) -> str:
    """Drop fenced code blocks; keep line count stable so numbers stay usable."""
    out, in_fence = [], False
    for line in text.split("\n"):
        if FENCE.match(line.strip()):
            in_fence = not in_fence
            out.append("")
            continue
        out.append("" if in_fence else line)
    return "\n".join(out)


# Directories that are never a home for a cited document, and are expensive to
# walk. Excluding them is a speed fix, not a correctness one: a design doc
# citing something inside node_modules would be a bug in its own right.
PRUNE = {".git", "node_modules", "dist", "build", ".wrangler", "__pycache__"}


def index_markdown() -> set[str]:
    """Every markdown basename in the repo, collected in a single walk.

    Built once rather than per-reference. The obvious implementation --
    `REPO.rglob(target)` inside the loop -- is O(refs x repo size) and walks
    node_modules for every *missing* reference, which is precisely the slow
    path since a missing file never short-circuits. That made the first draft
    of this script hang long enough to time out a CI step.
    """
    names: set[str] = set()
    stack = [REPO]
    while stack:
        for entry in stack.pop().iterdir():
            if entry.is_dir():
                if entry.name not in PRUNE:
                    stack.append(entry)
            elif entry.suffix == ".md":
                names.add(entry.name)
    return names


def main() -> int:
    failures: list[str] = []
    checked = 0
    known = index_markdown()

    for md in sorted(DOCS.rglob("*.md")):
        text = strip_fenced(md.read_text(encoding="utf-8"))
        for lineno, line in enumerate(text.split("\n"), start=1):
            for m in DOC_REF.finditer(line):
                ref = m.group(1) or m.group(2)
                if not ref or Path(ref).name in ALLOW:
                    continue
                checked += 1
                if Path(ref).name not in known and not (REPO / ref).exists():
                    rel = md.relative_to(REPO)
                    failures.append(
                        f"  {rel}:{lineno} cites `{ref}` — no such file in the repo"
                    )

    if failures:
        print("Dangling design-doc references:\n")
        print("\n".join(failures))
        print(
            f"\n{len(failures)} dangling reference(s) across {checked} checked.\n"
            "\nA specification cited at a path the implementer cannot open is not a\n"
            "specification. Either port the document into docs/ (re-measuring it as\n"
            "you go — see ROUTE_TITLE_CONVENTION.md), or remove the citation."
        )
        return 1

    print(f"Design-doc references OK — {checked} reference(s) all resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
