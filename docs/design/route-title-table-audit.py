#!/usr/bin/env python3
"""Keep ROUTE_TITLE_CONVENTION.md §5 honest against the tree it describes.

Why this exists
---------------
`ROUTE_TITLE_CONVENTION.md` was written 2026-08-19 and lived outside the repository until
WIC-1582. By the time it was ported, four of its rows were wrong — a heading had moved to a
different file (WIC-1571), the 404's copy had changed, a route had been added with no row, and
two line numbers had drifted. Every one of those was found by a person reading carefully, which
is the failure mode this file replaces: the *next* drift should be a red check, not a lucky
reader.

The table is a copy of strings that live in source. A copy with no checker rots silently, and a
rotted design doc is worse than an absent one — an implementer who follows it introduces exactly
the title/heading mismatch the document exists to prevent.

What it checks
--------------
1. **Route coverage, both directions.** Every `<Route path=...>` in `App.tsx` has a row in §5
   (or is listed as redirect-only), and every §5 row corresponds to a real route. This is the
   check that would have caught `/resumes/:resumeId/exports`.
2. **Cited files exist and are long enough.** Every non-struck `File.tsx:NNN` citation resolves
   to a real file with at least NNN lines.
3. **Literal titles still appear in the file that supposedly renders them**, with comments
   stripped first. This is what catches a copy change like `Page not found` →
   `That page couldn't be found`, and — because of the stripping — a heading that moved to
   another file while leaving a comment behind that still names it (WIC-1571 left exactly such
   a comment in `CoverLetterGenerator.tsx:181`).

What it deliberately does not check
-----------------------------------
Exact line numbers are *not* asserted to still hold the heading. Line numbers drift on every
edit above them, and failing the build for that would train people to ignore this check. The
citation is a pointer for a reader; the string and the route set are the contract.

Struck-through (`~~...~~`) citations are historical corrections and are skipped by design.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DOC = REPO / "docs/design/ROUTE_TITLE_CONVENTION.md"
APP = REPO / "packages/web/src/App.tsx"
WEB_SRC = REPO / "packages/web/src"

STRUCK = re.compile(r"~~.*?~~", re.S)
# Comments must be stripped before a string counts as "rendered here". A comment explaining
# that a heading was *removed* names the very string it removed — crediting that match is how
# this script first passed a negative control it should have failed, and it is the same defect
# WIC-1560 found in the route-orphan audit.
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
JSX_COMMENT = re.compile(r"\{\s*/\*.*?\*/\s*\}", re.S)
LINE_COMMENT = re.compile(r"^\s*//.*$", re.M)
CITATION = re.compile(r"`([A-Za-z0-9_/]+\.tsx):(\d+)")
ROUTE_IN_APP = re.compile(r'<Route\s+path="([^"]+)"')
# A path= that sits on its own line inside a multi-line <Route ...> element.
BARE_PATH = re.compile(r'^\s*path="([^"]+)"', re.M)


def fail(msgs: list[str]) -> None:
    print("\nROUTE_TITLE_CONVENTION.md §5 is out of date with the tree.\n")
    for m in msgs:
        print(f"  ✗ {m}")
    print(
        "\nFix the table (or the code), then re-run:  "
        "python3 docs/design/route-title-table-audit.py\n"
        "The table's strings are copies of the route <h1>s — see "
        "docs/design/ROUTE_HEADING_OUTLINE.md §6 for the obligation to update both together.\n"
    )
    sys.exit(1)


def split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def section_5_rows() -> list[list[str]]:
    text = DOC.read_text(encoding="utf-8")
    start = text.index("## 5. Title table")
    end = text.index("**Redirect-only routes need no title**", start)
    rows = []
    for line in text[start:end].splitlines():
        if not line.startswith("|"):
            continue
        cells = split_row(line)
        if len(cells) != 3 or cells[0] in ("Path", "---") or set(cells[0]) <= {"-"}:
            continue
        rows.append(cells)
    return rows


def redirect_paths() -> set[str]:
    text = DOC.read_text(encoding="utf-8")
    start = text.index("**Redirect-only routes need no title**")
    end = text.index("**Root/document title**", start)
    out = set()
    for line in text[start:end].splitlines():
        if line.startswith("|"):
            cells = split_row(line)
            if cells and cells[0].startswith("`/"):
                out.add(cells[0].strip("`"))
    return out


def resolve(rel: str) -> Path | None:
    direct = WEB_SRC / "pages" / rel
    if direct.exists():
        return direct
    direct = WEB_SRC / "components" / rel
    if direct.exists():
        return direct
    matches = [p for p in WEB_SRC.rglob(Path(rel).name) if p.is_file()]
    # Disambiguate by the directory prefix the doc gave, when it gave one.
    if len(matches) > 1 and "/" in rel:
        narrowed = [p for p in matches if str(p).endswith(rel)]
        if narrowed:
            matches = narrowed
    return matches[0] if len(matches) == 1 else (matches[0] if matches else None)


def strip_comments(src: str) -> str:
    """Remove JSX/JS comments so prose about a string cannot pass for rendering it."""
    src = JSX_COMMENT.sub("", src)
    src = BLOCK_COMMENT.sub("", src)
    return LINE_COMMENT.sub("", src)


def literal_titles(title_cell: str) -> list[str]:
    """Backticked literals in the title column, minus dynamic ones."""
    if "new copy" in title_cell:
        return []
    out = []
    for lit in re.findall(r"`([^`]+)`", title_cell):
        if "{" in lit:  # {jobTitle}, {variant.title} — resolved at runtime
            continue
        out.append(lit)
    return out


def main() -> int:
    problems: list[str] = []

    for path in (DOC, APP):
        if not path.exists():
            print(f"✗ missing required file: {path.relative_to(REPO)}")
            return 1

    rows = section_5_rows()
    if not rows:
        print("✗ parsed zero rows from §5 — the table format changed; update this script.")
        return 1

    # The path cell may carry a trailing gloss — the catch-all is spelled "`*` (NotFound)" —
    # so take the first backticked token, not the whole cell.
    def route_of(path_cell: str) -> str:
        m = re.search(r"`([^`]+)`", path_cell)
        return m.group(1) if m else path_cell.strip()

    documented = {route_of(r[0]) for r in rows}

    app_text = APP.read_text(encoding="utf-8")
    in_app = set(ROUTE_IN_APP.findall(app_text)) | set(BARE_PATH.findall(app_text))
    in_app.discard("/*")  # the authenticated shell wrapper, not a leaf route

    redirects = redirect_paths()

    for route in sorted(in_app - documented - redirects):
        problems.append(
            f"route `{route}` exists in App.tsx but has no row in §5 "
            f"(add a row, or list it under 'Redirect-only routes')"
        )
    for route in sorted(documented - in_app - redirects):
        problems.append(
            f"§5 documents `{route}` but App.tsx has no such route "
            f"(remove the row, or fix the path)"
        )

    for path_cell, title_cell, source_cell in rows:
        route = route_of(path_cell)
        live = STRUCK.sub("", source_cell)
        cites = CITATION.findall(live)

        for rel, lineno in cites:
            resolved = resolve(rel)
            if resolved is None:
                problems.append(f"{route}: cited file `{rel}` does not exist under packages/web/src")
                continue
            n = len(resolved.read_text(encoding="utf-8").splitlines())
            if int(lineno) > n:
                problems.append(
                    f"{route}: `{rel}:{lineno}` is past end of file ({n} lines) — "
                    f"the citation is stale"
                )

        titles = literal_titles(title_cell)
        if not titles or not cites:
            continue
        primary = resolve(cites[0][0])
        if primary is None:
            continue
        body = strip_comments(primary.read_text(encoding="utf-8"))
        for lit in titles:
            if lit not in body:
                problems.append(
                    f"{route}: §5 says the title is \"{lit}\" but that string does not appear "
                    f"in {primary.relative_to(REPO)} — the copy changed, or the heading moved"
                )

    if problems:
        fail(problems)

    print(
        f"✓ ROUTE_TITLE_CONVENTION.md §5 matches the tree: "
        f"{len(rows)} documented routes, {len(in_app)} in App.tsx, "
        f"{len(redirects)} redirect-only."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
