#!/usr/bin/env python3
"""Fail on any unmarked all-caps label in a COMPONENT_SPECS.md wireframe.

Enforces the convention in COMPONENT_SPECS.md "Reading the wireframes: casing".
A caps label is positional: it opens its box row and is followed by nothing but
trailing space, a colon, or a right-aligned badge. Caps inside a sentence are
acronyms or inline status words (STAR, PDF, DOCX, LINKED, FAILED), not labels.

Every caps label must carry a trailing marker outside the closing box border:
  <overline>  source ships mixed case + a CSS `uppercase` class
  <sample>    placeholder / example content / wireframe annotation
  <deferred>  known-wrong, owned by another ticket

Exits 1 and prints file:line for anything unmarked.

Scope note: this checks *row-leading* labels only. A caps run in the middle of a
row (e.g. `Overall Fit: MODERATE FIT`) is out of its reach and still needs the
reader. It is a floor on the convention, not a proof of it.

Usage: python3 docs/design/wireframe-casing-audit.py [path]
"""

import re
import sys
import unicodedata

DEFAULT_PATH = "docs/design/COMPONENT_SPECS.md"
MARKERS = ("‹overline›", "‹sample›", "‹deferred›")

# Box-drawing, block and rule glyphs that pad a wireframe row.
BOX = "│┌┐└┘├┤┬┴┼─═━"
BOX += "╔╗╚╝║▓░"
# Leading ornaments that can precede a label inside the row.
ORNAMENT = "●○★☆✓✗•·←→"

CAPS_RUN = re.compile(r"^[A-Z][A-Z0-9&'\-\.]*(?:\s[A-Z0-9&'\-\.]+)*")


def is_emoji(ch: str) -> bool:
    return unicodedata.east_asian_width(ch) in ("W", "F") and not ch.isalnum()


def row_content(line: str) -> str:
    """Strip box padding and leading ornaments to expose the row's first token."""
    s = line
    while True:
        stripped = s.lstrip(BOX + ORNAMENT + " \t")
        if stripped and (is_emoji(stripped[0]) or ord(stripped[0]) in (0xFE0F, 0x200D)):
            stripped = stripped[1:]
            s = stripped
            continue
        if stripped == s:
            return s
        s = stripped


def caps_label(line: str) -> str | None:
    """Return the caps label opening this row, or None."""
    content = row_content(line)
    m = CAPS_RUN.match(content)
    if not m:
        return None
    label = m.group(0).rstrip()
    if not any(len(w) >= 2 for w in re.findall(r"[A-Za-z]+", label)):
        return None
    rest = content[m.end():]
    # A label is followed by end-of-row, a colon, or a right-aligned badge
    # (>= 3 spaces of gutter). Anything else means the caps sit in a sentence.
    if rest.strip(BOX + " \t") == "":
        return label
    if rest.startswith(":"):
        return label
    if re.match(r"^ {3,}\S", rest):
        return label
    return None


def audit(path: str) -> int:
    lines = open(path, encoding="utf-8").read().split("\n")
    in_block = False
    failures = []
    for n, line in enumerate(lines, 1):
        if line.lstrip().startswith("```"):
            in_block = not in_block
            continue
        if not in_block:
            continue
        label = caps_label(line)
        if label and not any(mk in line for mk in MARKERS):
            failures.append((n, label))

    if failures:
        print(f"{len(failures)} unmarked caps label(s) in {path}:\n")
        for n, label in failures:
            print(f"  {path}:{n}: {label!r}")
        print(
            "\nEach needs a trailing marker, or de-shouting to the string the "
            "component ships.\nSee COMPONENT_SPECS.md 'Reading the wireframes: casing'."
        )
        return 1

    print(f"OK — no unmarked caps labels in {path}")
    return 0


if __name__ == "__main__":
    sys.exit(audit(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH))
