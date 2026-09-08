#!/usr/bin/env python3
"""Fail the build if a Postgres `date` column is handed to `new Date(...)` (WIC-2279).

Why this exists
---------------
`applications.next_action_due` is a Postgres `date`, and drizzle serves it as a bare
`YYYY-MM-DD` string (`date(..., { mode: 'string' })`). `new Date('2026-01-01')` parses
that form as **UTC midnight** per the ECMAScript date-time string format. Render it
with a local formatter and every negative-offset zone -- all of the Americas -- shows
the *previous* calendar day: a stored `2026-01-01` displays as "Dec 31, 2025", wrong
day, month *and* year, and a row due today badges "Overdue".

It shipped to production in two mirror-image halves, because the inverse conversion
(`localMidnight.toISOString().slice(0, 10)`) is wrong in every *positive*-offset zone:

  * WIC-2268 -- the SQL-bound half, `packages/api`. Fixed and shipped (PR #470).
  * WIC-2267 -- the label half, `packages/web`. Fixed in PR #469.

Both are silent under `TZ=UTC`, which is what CI runs, and that is the whole reason
they survived review twice. Nothing in the suite fails when a *new* call site
reintroduces the same parse -- the behaviour test on `reports.service.needsAction`
covers the call sites that exist, not the ones someone adds next week. This guards the
hazard directly.

The correct spellings are `parseDateOnly` / `formatDateOnly` / `calendarDaysBetween`
in `packages/api/src/lib/date-only.ts`, or `startOfDay(parseISO(...))` from date-fns
(measured exact over a 420-day sweep across UTC / New_York / Berlin / Sydney /
Kiritimati, including both DST transitions in each zone).

The discriminator
-----------------
A `new Date(...)` whose argument is an identifier the schema says is date-only. The
name is the signal, and the trailing word boundary is load-bearing:

    new Date(application.nextActionDue)      <- flagged
    new Date(nextActionDue)                  <- flagged
    new Date(application.interviewDate)      <- NOT flagged, and must not be

`interviewDate` is `timestamp({ withTimezone: true })`, not a `date` column, so
`new Date(...)` is *correct* there. That is a deliberate rejection, not a gap -- do
not "fix" those call sites, and do not add `interviewDate` to the name list.
`nextActionDue` is the only `date()` column in `packages/api/src/db/schema.ts`, which
is what bounds this class exactly.

⚠️ KNOWN LIMITATION -- state it, do not oversell it. The pattern keys on **identifier
names**. A date-only value carried in a differently-named variable (`const d = row.x;
new Date(d)`) is invisible to it. This is a reintroduction tripwire for the known
contract, not a type-level proof. The type-level fix is a branded `DateOnlyString`
that never structurally satisfies the `Date` constructor; that is a larger change and
is not what this card bought.

Same class, second face (WIC-2284): the dotted prefix below only traverses *plain
identifier* segments, so `new Date(getRecord().nextActionDue)`, `new Date(rows[0]
.nextActionDue)` and `new Date((app as Application).nextActionDue)` all miss. Unchanged
by any revision of this file and **0** reachable sites in `packages/**` today, so it is
recorded rather than fixed -- but it is a statement about today's code, and it rots.

Second, and this one is *closed* rather than merely stated (raised in the WIC-2281
review). The scan is line-based, so a call Prettier has wrapped splits the two halves of
the pattern across two physical lines, and a naive per-line scan sees neither:

    new Date(
      application.nextActionDue
    )

`scan_text` therefore joins one continuation line onto any line ending in `new Date(`.
That is exactly the shape Prettier 3.8.3 emits at this repo's `printWidth: 100` --
measured, not assumed: an argument long enough to break puts the whole argument on its
own line and the `)` on the next.

What remains open is a *deeper* break -- `new Date(` / `application` / `.nextActionDue`
-- which needs a member chain long enough that Prettier splits the chain too. The
one-line join does not reach it, and the selftest pins that scope explicitly. Today it
is unreachable in this tree, and both measurements are recorded so the next reader can
re-check rather than re-derive: **0** lines in `packages/**` currently end in a dangling
`new Date(` at all, and the longest declared identifier there is **35** characters with
**0 of 4627** reaching 40, while the shortest identifier that forces even the shallow
wrap is **66**. Neither number is a proof about the pattern -- both are statements about
today's code, and both rot.

LEGACY, and why it is not a baseline
------------------------------------
Four call sites on `main` are still unfixed today. They are not a rolling baseline and
this guard does not "allow N violations": each is pinned by its **exact normalised
source line**, so the entry stops matching the moment anyone edits it, and any *other*
`new Date(<date-only>)` anywhere in the tree fails the build immediately. A count-based
floor would have been byte-indistinguishable from a disarmed guard; this is not.

All four are fixed by PR #469. When it lands they stop matching, and the guard prints a
RETIRE notice naming the entries to delete. That notice is deliberately **not** fatal in
the default mode -- turning `main` red on the merge that *fixes* the bug would make this
guard hostile to its own remedy. Once the notice appears, delete the `LEGACY` entries and
flip the workflow to `--strict`; at that point every occurrence is fatal and this file
carries no exceptions at all.

Usage
-----
    python3 scripts/date-only-guard.py              # fatal on new violations only
    python3 scripts/date-only-guard.py --strict     # fatal on LEGACY too (post-#469)
    python3 scripts/date-only-guard.py --selftest   # fixtures, offline, no repo needed

Pure stdlib, no network. Run from the repository root.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import os
import re
import subprocess
import sys

# Identifiers the schema says carry a bare `YYYY-MM-DD`. `nextActionDue` is the column
# itself; the other three are the local names the API's reports service binds it to.
# ⛔ Do NOT add `interviewDate` -- it is TIMESTAMPTZ, see the module docstring.
DATE_ONLY_NAMES = ("nextActionDue", "dueDate", "todayStr", "thresholdStr")

# `new Date(` <optional dotted prefix> <date-only name> <word boundary>.
# The name must be the LAST path segment, so `nextActionDueLabel` and `interviewDate`
# both fall outside the pattern rather than being special-cased out.
#
# The `[!?]?` before each `.` covers TypeScript's non-null assertion and optional
# chaining (`app!.nextActionDue`, `app?.nextActionDue`). Both spellings are common in
# this codebase -- `r.nextActionDue!` is how the fixed API call site reads -- and the
# selftest caught the prefix form escaping an earlier revision of this pattern.
VIOLATION = re.compile(
    r"new\s+Date\s*\(\s*"
    r"(?:[A-Za-z_$][\w$]*\s*[!?]?\s*\.\s*)*"
    r"(?:" + "|".join(DATE_ONLY_NAMES) + r")\b"
)

SKIP_DIR = ("node_modules", "dist", "build", ".git")
IS_TEST = re.compile(r"\.(test|spec)\.")

# Pinned by exact normalised source line, not by count. Each entry is removed by the PR
# named beside it; when it stops matching, delete the entry (see RETIRE notice).
LEGACY = [
    # PR #469 (WIC-2267) -- packages/web label half.
    ("packages/web/src/pages/ReportsPipeline.tsx", "const due = new Date(nextActionDue);"),
    ("packages/web/src/pages/ReportsPipeline.tsx", "return new Date(nextActionDue) < today;"),
    ("packages/web/src/pages/ReportsPipeline.tsx", "const due = new Date(app.nextActionDue);"),
    (
        "packages/web/src/pages/ApplicationDetail.tsx",
        "{format(new Date(application.nextActionDue), 'MMM d, yyyy')}",
    ),
]


def normalise(line: str) -> str:
    """Collapse whitespace so a pure reindent does not invalidate a LEGACY pin."""
    return " ".join(line.split())


# A `new Date(` left dangling at end of line. Prettier wraps an over-long call by putting
# the argument on its own line, which splits the two halves of the pattern across two
# physical lines and makes a per-line scan see neither of them.
OPEN_CALL = re.compile(r"new\s+Date\s*\(\s*$")


def scan_text(path: str, text: str) -> list[tuple[str, int, str]]:
    lines = text.splitlines()
    hits: list[tuple[str, int, str]] = []
    for n, line in enumerate(lines, 1):
        probe = line
        if n < len(lines) and OPEN_CALL.search(line):
            # One continuation line, which is exactly the shape Prettier emits at this
            # repo's `printWidth: 100`. Deeper breaks stay invisible -- see the KNOWN
            # LIMITATION block. The hit is reported at the `new Date(` line, not the
            # argument line, because that is the line a reviewer has to change.
            probe = line + " " + lines[n].strip()
        if VIOLATION.search(probe):
            hits.append((path, n, normalise(probe)))
    return hits


def tracked_sources() -> list[str]:
    """Every tracked .ts/.tsx under packages/, excluding tests and build output.

    `git ls-files` rather than a filesystem walk: an untracked scratch file in the
    working tree is not something CI should fail on, and a tracked file is exactly the
    population a reviewer can act on.
    """
    out = subprocess.run(
        ["git", "ls-files", "-z", "--", "packages/*.ts", "packages/*.tsx"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [
        p
        for p in out.split("\0")
        if p
        and not IS_TEST.search(os.path.basename(p))
        and not any(f"/{d}/" in f"/{p}" for d in SKIP_DIR)
    ]


def collect() -> list[tuple[str, int, str]]:
    hits: list[tuple[str, int, str]] = []
    for path in tracked_sources():
        try:
            with open(path, encoding="utf-8") as fh:
                hits += scan_text(path, fh.read())
        except (OSError, UnicodeDecodeError):
            pass
    return hits


def report(hits: list[tuple[str, int, str]], strict: bool) -> int:
    # Under --strict the pins are not consulted at all, so nothing can be "left over" to
    # retire; seeding this with LEGACY there was a seed-but-never-consume (WIC-2281 review,
    # note 2). ⚠️ It was NOT the false-RETIRE bug, and an earlier revision of this comment
    # said it was (corrected by WIC-2284). Under the old code `fresh == hits` in --strict, so
    # the notice was reachable only when the scan found nothing at all -- exactly the state in
    # which the pins really are gone. It was true in the only state that could print it.
    # The false RETIRE came from the line-based scan missing a Prettier-wrapped pin, and is
    # fixed in scan_text, not here. One behaviour change to know about: flipping --strict
    # before the LEGACY entries are deleted used to print a true "delete these four" notice
    # and now prints silence. Inert in CI, which runs the default mode.
    legacy_left = [] if strict else list(LEGACY)
    fresh: list[tuple[str, int, str]] = []

    for hit in hits:
        key = (hit[0], hit[2])
        if key in legacy_left:
            legacy_left.remove(key)  # consume one pin per occurrence
        else:
            fresh.append(hit)

    for path, line, code in fresh:
        print(f"  {path}:{line}: {code[:100]}")

    if fresh:
        print(f"\nVIOLATIONS: {len(fresh)}")
        print(
            "\n`new Date(<YYYY-MM-DD>)` parses as UTC midnight and renders one calendar\n"
            "day early in every negative-offset zone. Use `parseDateOnly` from\n"
            "packages/api/src/lib/date-only.ts, or `startOfDay(parseISO(...))`.\n"
            "If the value is a TIMESTAMPTZ and not a `date` column, it does not belong\n"
            "under one of these names -- rename it rather than allowlisting it."
        )
        return 1

    if legacy_left:
        print(
            f"RETIRE: {len(legacy_left)} LEGACY entr"
            f"{'y is' if len(legacy_left) == 1 else 'ies are'} no longer present "
            "-- the fix landed."
        )
        for path, code in legacy_left:
            print(f"  delete from LEGACY: {path}  {code[:80]}")
        print(
            "Remove them from scripts/date-only-guard.py and switch the CI step to\n"
            "`--strict`. Not fatal here on purpose: the merge that FIXES the bug must\n"
            "not be the merge that turns `main` red."
        )

    print(f"date-only guard: clean ({len(hits) - len(fresh)} pinned legacy, 0 new)")
    return 0


# --------------------------------------------------------------------------------------
# Self-test. This runs on every CI invocation and is the load-bearing evidence that the
# detector does anything at all: a tree-scan that reports 0 is byte-indistinguishable
# from a scanner that silently matches nothing. Both directions are covered, because a
# pattern that flags everything passes a positive-only suite.
# --------------------------------------------------------------------------------------

MUST_FLAG = [
    "const due = new Date(nextActionDue);",
    "return new Date(nextActionDue) < today;",
    "const due = new Date(app.nextActionDue);",
    "{format(new Date(application.nextActionDue), 'MMM d, yyyy')}",
    "const t = new Date( row.dueDate );",  # whitespace inside the call
    "const t = new Date(todayStr);",
    "const t = new Date(thresholdStr);",
    "const d = new Date(app!.nextActionDue!);",  # non-null assertions
    "const d = new Date(app?.nextActionDue);",  # optional chaining
    "const d = new  Date(a.b.c.nextActionDue);",  # deep path, doubled space
]

MUST_NOT_FLAG = [
    "const due = parseDateOnly(app.nextActionDue);",  # the fix
    "const d = startOfDay(parseISO(app.nextActionDue));",  # the other correct spelling
    "const now = new Date();",  # no argument
    "const iv = new Date(application.interviewDate);",  # TIMESTAMPTZ -- correct rejection
    "const x = new Date(nextActionDueLabel);",  # word boundary: different identifier
    "const y = new Date(app.nextActionDueAt);",  # ditto, dotted
    "const z = new Date(interviewDate);",  # TIMESTAMPTZ, bare
]


# The Prettier-wrapped shape, which no single-line fixture can express. Each is a whole
# file rather than a line.
MUST_FLAG_WRAPPED = [
    "const due = new Date(\n  application.nextActionDue\n);",
    "const due = new Date(\n  app!.nextActionDue!\n);",
]

MUST_NOT_FLAG_WRAPPED = [
    "const iv = new Date(\n  application.interviewDate\n);",  # TIMESTAMPTZ, still correct
]


def selftest() -> int:
    failures = []

    for src in MUST_FLAG:
        if not scan_text("f.ts", src):
            failures.append(f"MISSED (should flag): {src}")
    for src in MUST_NOT_FLAG:
        if scan_text("f.ts", src):
            failures.append(f"FALSE POSITIVE (should not flag): {src}")

    for src in MUST_FLAG_WRAPPED:
        got = scan_text("f.ts", src)
        if len(got) != 1:
            failures.append(f"MISSED (wrapped, should flag once): {src!r} -> {len(got)}")
        elif got[0][1] != 1:
            failures.append(f"wrapped hit reported at line {got[0][1]}, want 1: {src!r}")
    for src in MUST_NOT_FLAG_WRAPPED:
        if scan_text("f.ts", src):
            failures.append(f"FALSE POSITIVE (wrapped, should not flag): {src!r}")

    # The join must not run away: a dangling `new Date(` at EOF has no next line to read.
    # The second assertion pins the *documented scope* -- a date-only name two lines down
    # is the deeper break the header declares still open. It is not a desirable outcome:
    # if you widen the join to cover it, delete this assertion and that paragraph together.
    if scan_text("f.ts", "const d = new Date("):
        failures.append("join walked off the end of the file")
    if scan_text("f.ts", "const d = new Date(\n  a\n    .nextActionDue\n);"):
        failures.append("join reached a second continuation line; the header says it cannot")

    # A file-level control: the fixtures must survive being read as a file, and the
    # test/spec exclusion must actually exclude.
    blob = "\n".join(MUST_FLAG + MUST_NOT_FLAG)
    if len(scan_text("x.ts", blob)) != len(MUST_FLAG):
        failures.append("file-level scan disagrees with the line-level fixtures")
    if not IS_TEST.search("foo.test.ts") or not IS_TEST.search("foo.spec.tsx"):
        failures.append("test-file exclusion regex no longer matches .test./.spec.")
    if IS_TEST.search("dateOnly.ts"):
        failures.append("test-file exclusion regex over-matches a plain source file")

    # The RETIRE notice, all four arms. It is a claim about the world ("the fix landed"),
    # so it has to be driven by pin *absence* and by nothing else. A one-armed check here
    # would pass against a notice that always prints, and equally against one that never
    # does; four arms is what pins the notice to the world rather than to a mode.
    def run(hits, strict):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = report(hits, strict)
        return rc, buf.getvalue()

    pin_hits = [(path, 1, code) for path, code in LEGACY]

    rc, out = run([], False)  # pins all absent, default -> notice, non-fatal
    if "RETIRE" not in out or rc != 0:
        failures.append("default mode: absent pins must print a non-fatal RETIRE notice")
    rc, out = run([], True)  # pins never consulted -> no notice to print
    if "RETIRE" in out or rc != 0:
        failures.append("--strict printed a RETIRE notice for pins it never consulted")
    rc, out = run(pin_hits, False)  # pins all present, default -> silent, clean
    if "RETIRE" in out or rc != 0:
        failures.append("default mode: present pins must be consumed silently")
    rc, out = run(pin_hits, True)  # pins present, strict -> every one is fatal
    if rc != 1 or f"VIOLATIONS: {len(LEGACY)}" not in out:
        failures.append("--strict must fail on every LEGACY occurrence")

    # Guard the guard: a shrinking fixture list is how a self-test goes quiet without
    # ever failing. Pin both counts.
    counts = (
        len(MUST_FLAG),
        len(MUST_NOT_FLAG),
        len(MUST_FLAG_WRAPPED),
        len(MUST_NOT_FLAG_WRAPPED),
    )
    if counts != (10, 7, 2, 1):
        failures.append(
            f"fixture count changed: {counts} = positive / negative / wrapped positive / "
            "wrapped negative, expected (10, 7, 2, 1). Update this assertion deliberately."
        )

    for f in failures:
        print(f"  {f}")
    if failures:
        print(f"\nSELFTEST FAILED: {len(failures)} problem(s)")
        return 1
    print(
        f"date-only guard selftest: {len(MUST_FLAG)} positive, "
        f"{len(MUST_NOT_FLAG)} negative, "
        f"{len(MUST_FLAG_WRAPPED)}+{len(MUST_NOT_FLAG_WRAPPED)} wrapped, all correct"
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--strict",
        action="store_true",
        help="fail on LEGACY occurrences too; the intended mode once PR #469 has landed",
    )
    ap.add_argument("--selftest", action="store_true", help="run fixtures and exit")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    return report(collect(), args.strict)


if __name__ == "__main__":
    sys.exit(main())
