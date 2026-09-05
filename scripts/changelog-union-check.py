#!/usr/bin/env python3
"""Detect corruption that the `CHANGELOG.md merge=union` driver introduces silently.

WIC-2103 (carrying WIC-2087, spec WIC-1792). The detector itself is not new: root
`CLAUDE.md` has carried a correct, threshold-free version in prose since WIC-1778.
Nothing ran it. This file is that prose, executable, plus the fixtures that prove it
still works when there is no live traffic to point it at.

WHAT IT LOOKS FOR

`CHANGELOG.md` is `merge=union` (see `.gitattributes`). The driver resolves by
concatenating both sides at each differing hunk, reports success, and never raises a
conflict. Four corruptions ride through that silently, and none of them is visible in
`git diff`:

  WELD               A `### ` heading glued to the previous entry's last line, because
                     union ate the blank separator at the seam -- even when BOTH parents
                     had the blank line (WIC-1567). The most common of the four, and the
                     precondition for MISFILED.
  DUPLICATE          The same bullet kept twice under one heading (WIC-1561).
  DUPLICATE_HEADING  A whole `### ` entry kept twice, because one side moved the block
                     and the other edited inside it (WIC-1692).
  MISFILED           A bullet filed under a `### ` entry that NEITHER parent filed it
                     under, where it reads as a claim about an unrelated change
                     (WIC-1786 / PR #115). No similarity threshold can see this one --
                     the discriminator is structural.

HOW IT DECIDES

Everything below follows four constraints from WIC-1792. Each was a measured bug in an
earlier attempt, so they are requirements, not preferences:

  1. ORIENTATION IS `ours = PR head`. `git merge` puts the CURRENT branch on `ours`, and
     the operation every PR here performs is `git merge <base>` on the PR branch.
     Verified byte-identical to a real merge; the reversed order silently LOSES hits (it
     found 0 misfiled where the real orientation finds 1, and 10 welds where the real one
     finds 11).
  2. EACH PR IS MEASURED AGAINST ITS OWN BASE, never a moving `main`. Many PRs here are
     stacked; simulating a stacked PR against `main` manufactures duplicates that will
     never ship.
  3. EVERYTHING IS CONTENT-ADDRESSED. Findings key on normalised heading/bullet TEXT and
     carry the line number only as a locator. Open PRs sit on many distinct merge bases,
     so `@@ -N` coordinates are not comparable across them -- and subtracting the parents
     by line number blames the merge for welds that merely shifted down the file (17
     reported vs 10 real, measured 2026-08-30).
  4. `--attr-source` IS A GLOBAL OPTION: `git --attr-source=<rev> merge-tree ...`. After
     the subcommand git exits 129; omitted, merge-tree reads merge attributes from the
     WORKING TREE and measures nothing while printing a confident answer. `selftest`
     asserts all three placements, so this cannot regress silently.

And one from this card: a finding is reported only if the union INTRODUCED it. The same
weld or duplicate is often already sitting on the branch or inherited from its base --
measured 2026-08-29, the raw union output flagged 36 PRs where only 20 were the merge's
doing. So every check is `checks(union) - checks(ours) - checks(theirs)`, subtracted by
content key.

WHAT IT DELIBERATELY DOES NOT DO

It never reads GitHub's `mergeable` / `mergeStateStatus` flag, and never fetches
`refs/pull/N/merge`. Measured in-repo 2026-09-02 (WIC-1904, recorded in the
`.gitattributes` header): GitHub's SERVER does not apply the union driver, so a PR
touching `[Unreleased]` flips to CONFLICTING routinely and benignly, and the merge ref is
frequently stale. Both signals are wrong for this question. This detector does its own
three-way simulation from `refs/pull/N/head` and the base branch tip, which needs neither.
`selftest` enforces that by scanning this file's own executable lines.

USAGE

    changelog-union-check.py selftest              # synthetic fixtures; no network, no repo
    changelog-union-check.py replay                # re-check two real historical PRs
    changelog-union-check.py pr 115                # one PR, against its own base
    changelog-union-check.py sweep                 # every open PR
    changelog-union-check.py refs --ours <rev> --theirs <rev>

Exit 0 clean, 1 findings, 2 could not evaluate (which is NOT a pass -- see `main`).
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

CHANGELOG = "CHANGELOG.md"

# Key widths, kept identical to the prose detector in root CLAUDE.md so the two cannot
# disagree about what counts as "the same" heading or bullet. Do not widen them to make a
# check stricter -- WIC-1687 records why the bullet key is a normalised PREFIX and not the
# whole line: the duplicates that matter are usually reworded, and an exact-match check
# could not see the class it was written for.
HEADING_KEY = 60  # heading key used to home a bullet
WELD_KEY = 55  # heading key used for welds and duplicate headings
BULLET_KEY = 70
MIN_BULLET = 60  # shorter lines are boilerplate and collide constantly


class Unevaluable(Exception):
    """Raised when a verdict cannot be honestly computed. Never downgraded to a pass."""


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


def git(*args: str, check: bool = True, cwd: str | None = None) -> subprocess.CompletedProcess:
    p = subprocess.run(["git", *args], capture_output=True, text=True, cwd=cwd)
    if check and p.returncode != 0:
        raise Unevaluable(f"git {' '.join(args)} -> {p.returncode}: {p.stderr.strip()[:400]}")
    return p


def blob(rev: str, path: str = CHANGELOG, cwd: str | None = None) -> str | None:
    """File content at a rev, or None when the path does not exist there."""
    p = git("show", f"{rev}:{path}", check=False, cwd=cwd)
    return p.stdout if p.returncode == 0 else None


# --------------------------------------------------------------------------------------
# The union simulation
# --------------------------------------------------------------------------------------


def union_merge(ours: str, theirs: str, path: str = CHANGELOG, cwd: str | None = None) -> str:
    """Return `path` as the union driver will actually write it merging `theirs` into `ours`.

    `ours` is the PR head and `theirs` is the base branch -- constraint 1. This is a real
    `git merge-tree`, so the resolution comes from the driver configured in
    `.gitattributes` rather than from a hardcoded `--union`, which is the only way the
    result stays honest if that line is ever changed or removed.

    ATTR-SOURCE. `--attr-source` is passed as a GLOBAL option, before the subcommand
    (constraint 4). It is pointed at `ours`, not at the merge base, because the merge this
    simulates is `git checkout <pr-branch> && git merge <base>` and git reads
    `.gitattributes` from the working tree -- i.e. from the PR head. A PR that deletes the
    `merge=union` line therefore gets simulated WITHOUT the driver, which is exactly what
    that PR would really do.
    """
    mb = git("merge-base", ours, theirs, cwd=cwd).stdout.strip()
    if not mb:
        raise Unevaluable(f"no merge base between {ours} and {theirs}")

    p = git(
        f"--attr-source={ours}",
        "merge-tree",
        "--write-tree",
        f"--merge-base={mb}",
        ours,
        theirs,
        check=False,
        cwd=cwd,
    )
    # Exit 1 only means SOME path conflicted; it is routine and says nothing about
    # CHANGELOG.md. Anything above that is a real failure -- notably 129, which is what
    # git returns when --attr-source is placed after the subcommand.
    if p.returncode > 1:
        raise Unevaluable(
            f"git merge-tree exited {p.returncode} (129 means --attr-source was not passed "
            f"as a global option): {p.stderr.strip()[:400]}"
        )
    tree = p.stdout.splitlines()[0].strip() if p.stdout.strip() else ""
    if not tree:
        raise Unevaluable("git merge-tree wrote no tree")

    merged = blob(tree, path, cwd=cwd)
    if merged is None:
        raise Unevaluable(f"{path} is absent from the merged tree")

    # POSITIVE CONTROL, and the reason this function cannot fail open. If the driver had
    # not been applied -- a bad --attr-source, a .gitattributes that lost the line -- the
    # merge would leave conflict markers here rather than concatenating. Every finding
    # below would then be an artifact of reading a conflicted file. Refuse instead.
    if re.search(r"^<{7} ", merged, re.M) or re.search(r"^>{7} ", merged, re.M):
        raise Unevaluable(
            f"{path} came back with conflict markers, so the union driver was NOT applied; "
            "check that .gitattributes still carries `CHANGELOG.md merge=union` at the PR head"
        )
    return merged


# --------------------------------------------------------------------------------------
# The checks
# --------------------------------------------------------------------------------------


def welds(text: str) -> dict[str, int]:
    """Normalised heading text -> line number, for every `### ` glued to a non-blank line."""
    lines = text.split("\n")
    return {
        norm(l)[:WELD_KEY]: n + 1
        for n, l in enumerate(lines)
        if l.startswith("### ") and n and lines[n - 1].strip()
    }


def heading_counts(text: str) -> collections.Counter:
    return collections.Counter(
        norm(l)[:WELD_KEY] for l in text.split("\n") if l.startswith("### ")
    )


def homes(text: str) -> dict[str, collections.Counter]:
    """Normalised bullet text -> Counter of the `### ` headings it sits under."""
    out: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    cur = ""
    for l in text.split("\n"):
        s = l.strip()
        if s.startswith("### "):
            cur = norm(s)[:HEADING_KEY]
        elif s.startswith("- ") and len(s) > MIN_BULLET:
            out[norm(s)[:BULLET_KEY]][cur] += 1
    return out


def analyse(ours: str, theirs: str, union: str) -> list[dict]:
    """Findings the union INTRODUCED, subtracted from both parents by content key."""
    found: list[dict] = []

    w_o, w_t, w_u = welds(ours), welds(theirs), welds(union)
    for key, line in sorted(w_u.items(), key=lambda kv: (kv[1], kv[0])):
        if key in w_o or key in w_t:
            continue  # already welded on a parent; the merge only moved it down the file
        found.append(
            {
                "kind": "WELD",
                "key": key,
                "line": line,
                "detail": "`### ` heading welded to the previous entry's last line",
            }
        )

    h_o, h_t, h_u = heading_counts(ours), heading_counts(theirs), heading_counts(union)
    for key, n in sorted(h_u.items()):
        pmax = max(h_o[key], h_t[key])
        if n > 1 and n > pmax:
            found.append(
                {
                    "kind": "DUPLICATE_HEADING",
                    "key": key,
                    "line": None,
                    "detail": f"entry appears {n}x (parent max {pmax})",
                }
            )

    b_o, b_t, b_u = homes(ours), homes(theirs), homes(union)
    for key, heads in sorted(b_u.items()):
        parents = set(b_o.get(key, {})) | set(b_t.get(key, {}))
        if not parents:
            continue  # new on neither parent: not this class
        for head, n in sorted(heads.items()):
            if head not in parents:
                # A bullet belongs under exactly one heading. If the union filed a copy
                # under a heading NEITHER parent filed it under, the union misfiled it.
                # There is no benign reading and no threshold involved.
                found.append(
                    {
                        "kind": "MISFILED",
                        "key": key,
                        "line": None,
                        "detail": f"now under: {head or '(no heading)'}",
                    }
                )
            else:
                pmax = max(b_o.get(key, {}).get(head, 0), b_t.get(key, {}).get(head, 0))
                if n > pmax and n > 1:
                    found.append(
                        {
                            "kind": "DUPLICATE",
                            "key": key,
                            "line": None,
                            "detail": f"kept {n}x under {head or '(no heading)'} (parent max {pmax})",
                        }
                    )
    return found


def check_pair(ours: str, theirs: str, path: str = CHANGELOG, cwd: str | None = None) -> list[dict]:
    """Simulate `git merge <theirs>` on branch `ours` and report what union introduced."""
    ours_text = blob(ours, path, cwd=cwd)
    theirs_text = blob(theirs, path, cwd=cwd)
    if ours_text is None or theirs_text is None:
        return []  # the file does not exist on one side; nothing for the driver to do
    if ours_text == theirs_text:
        return []  # identical: the merge cannot introduce anything
    return analyse(ours_text, theirs_text, union_merge(ours, theirs, path, cwd=cwd))


# --------------------------------------------------------------------------------------
# GitHub plumbing
# --------------------------------------------------------------------------------------


def gh_json(*args: str):
    if not shutil.which("gh"):
        raise Unevaluable("`gh` is not on PATH")
    p = subprocess.run(["gh", *args], capture_output=True, text=True)
    if p.returncode != 0:
        raise Unevaluable(f"gh {' '.join(args)} -> {p.returncode}: {p.stderr.strip()[:400]}")
    return json.loads(p.stdout)


def open_prs() -> list[dict]:
    """Open PRs with their OWN base branch -- constraint 2, never a moving `main`.

    Mergeability is deliberately not requested; the module docstring says why. Forks are
    not filtered out either: `refs/pull/N/head` exists in the base repo for a fork PR too,
    and this tool only ever READS blobs from it -- it never checks out or executes PR code,
    which is what makes running it under `pull_request_target` safe.
    """
    return gh_json(
        "pr", "list", "--state", "open", "--limit", "300",
        "--json", "number,baseRefName,headRefOid",
    )


def fetch_pr(number: int, base_ref: str) -> tuple[str, str]:
    """Fetch the PR head and its base branch tip. Returns (ours_rev, theirs_rev)."""
    git("fetch", "--quiet", "origin", f"+refs/pull/{number}/head:refs/remotes/pr/{number}")
    git("fetch", "--quiet", "origin", f"+refs/heads/{base_ref}:refs/remotes/origin/{base_ref}")
    return f"refs/remotes/pr/{number}", f"refs/remotes/origin/{base_ref}"


# --------------------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------------------

IN_ACTIONS = os.environ.get("GITHUB_ACTIONS") == "true"


def emit(line: str) -> None:
    print(line, flush=True)


def annotate(level: str, message: str) -> None:
    if IN_ACTIONS:
        emit(f"::{level} file={CHANGELOG}::{message}")


def summary(text: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text + "\n")


def report(label: str, findings: list[dict]) -> None:
    if not findings:
        emit(f"  {label}: clean")
        return
    emit(f"  {label}: {len(findings)} finding(s)")
    for f in findings:
        where = f" (line {f['line']})" if f["line"] else ""
        emit(f"    {f['kind']:<18} {f['key'][:70]}{where}\n        {f['detail']}")


# --------------------------------------------------------------------------------------
# Self-test: synthetic fixtures
# --------------------------------------------------------------------------------------

FIXTURE_BASE = """# Changelog

## [Unreleased]

### WIC-0001: Alpha subsystem gains a retry budget
- Alpha now retries transient upstream failures three times before giving up.
- Alpha logs the retry count so operators can see the budget being spent.

### WIC-0002: Bravo subsystem stops double-counting rows
- Bravo deduplicates by primary key before it aggregates the daily totals.

## [1.0.0] - 2026-01-01
- Initial release of the whole thing, recorded here for posterity only.
"""

_A2 = "- Alpha logs the retry count so operators can see the budget being spent."
_B1 = "- Bravo deduplicates by primary key before it aggregates the daily totals."
_H1 = "### WIC-0001: Alpha subsystem gains a retry budget"
_DUP = "- Bravo emits a per-tenant counter so the dedup rate is visible in metrics."
_CORRECTION = "- Alpha retry budget is three attempts, not five as first documented."
_CHARLIE = [
    "### WIC-0003: Charlie subsystem learns to page",
    "- Charlie pages the on-call rotation when the queue depth exceeds the cap.",
]


def _splice(anchor: str, block: list[str], after: bool = False) -> str:
    lines = FIXTURE_BASE.split("\n")
    i = lines.index(anchor) + (1 if after else 0)
    return "\n".join(lines[:i] + block + lines[i:])


def fixtures() -> list[dict]:
    """Branch pairs reproducing each defect class, plus a clean control.

    These exist because there is no live traffic to validate against: `gh pr list --state
    open` returned 0 on 2026-09-05. A detector whose only evidence is "it found 0 on an
    empty queue" is indistinguishable from one that does nothing.

    Every pair is a REAL union merge of REAL commits through `union_merge`, so the
    fixtures exercise the same `git --attr-source=... merge-tree` path the PR checks use.
    """
    return [
        {
            # WIC-1567. Both parents carry the blank separator; union eats one at the
            # seam. The most common class by a wide margin.
            "name": "weld",
            "ours": _splice(_H1, _CHARLIE + [""]),
            "theirs": _splice(
                _H1,
                [
                    "### WIC-0004: Delta subsystem gains a cache",
                    "- Delta caches the resolved tenant row for the lifetime of one request.",
                    "",
                ],
            ),
            "expect": ["WELD"],
        },
        {
            # WIC-1561. The same bullet lands on both sides at different offsets inside
            # one entry, so nothing conflicts and union keeps both copies.
            "name": "duplicate-bullet",
            "ours": _splice(_B1, [_DUP]),
            "theirs": _splice(_B1, [_DUP], after=True),
            "expect": ["DUPLICATE"],
        },
        {
            # WIC-1786 / PR #115, and the mechanism CLAUDE.md records as "a weld you
            # commit is a misfile you have armed for whoever branches off you next":
            # `ours` already carries a welded entry at the seam, `theirs` appends a
            # correction to the entry above it, and union files the correction under the
            # WELDED heading -- an entry neither parent filed it under.
            #
            # This fixture is also the control for content-keyed subtraction: the weld is
            # present in `ours` AND in the union, so it must NOT be reported. A
            # line-number subtraction would report it, because the merge moves it.
            "name": "misfiled-bullet",
            "ours": _splice(_A2, _CHARLIE + [""], after=True),
            "theirs": _splice(_A2, [_CORRECTION], after=True),
            "expect": ["MISFILED"],
        },
        {
            # WIC-1692. One side moves a whole entry, the other edits inside it; the two
            # do not line up as one diff3 region, so union keeps both copies of the entry.
            "name": "duplicate-heading",
            "ours": "\n".join(
                [
                    "# Changelog",
                    "",
                    "## [Unreleased]",
                    "",
                    "### WIC-0002: Bravo subsystem stops double-counting rows",
                    _B1,
                    "",
                    _H1,
                    "- Alpha now retries transient upstream failures three times before giving up.",
                    _A2,
                    "",
                    "## [1.0.0] - 2026-01-01",
                    "- Initial release of the whole thing, recorded here for posterity only.",
                    "",
                ]
            ),
            "theirs": FIXTURE_BASE.replace(
                _B1, "- Bravo deduplicates by primary key before it aggregates the weekly totals."
            ),
            "expect": ["DUPLICATE_HEADING"],
        },
        {
            # NEGATIVE CONTROL for constraint 3 (content-addressing). `ours` has ALREADY
            # committed a weld low in the file; `theirs` adds a clean entry at the top,
            # which shifts that weld three lines down in the merge result. The merge is
            # innocent, so nothing may be reported.
            #
            # This is the fixture that fails if the parent subtraction is ever rewritten
            # to compare LINE NUMBERS instead of normalised heading text. That exact
            # regression was live until 2026-08-30 and reported 17 welding PRs where 10
            # were real -- all 7 extras were pre-existing welds the merge merely moved.
            "name": "weld-already-on-branch",
            "ours": FIXTURE_BASE.replace(
                "\n\n### WIC-0002: Bravo", "\n### WIC-0002: Bravo"
            ),
            "theirs": _splice(
                _H1,
                [
                    "### WIC-0006: Foxtrot subsystem records a trace id",
                    "- Foxtrot threads the inbound trace id through every downstream call.",
                    "",
                ],
            ),
            "expect": [],
        },
        {
            # NEGATIVE CONTROL. Two ordinary entries at different anchors, each written
            # with the blank lines the convention asks for. A detector that flags this is
            # useless in practice, so it is asserted as hard as the positives.
            "name": "clean-control",
            "ours": _splice(
                _H1,
                [
                    "### WIC-0005: Echo subsystem gains a health probe",
                    "- Echo answers a readiness probe on the same port as the main listener.",
                    "",
                ],
            ),
            "theirs": _splice(
                _B1, ["- Bravo skips the aggregate entirely when the tenant has no rows today."], after=True
            ),
            "expect": [],
        },
    ]


def _init_fixture_repo(root: str, *, with_driver: bool = True) -> None:
    git("init", "--quiet", "--initial-branch=base", root)
    git("config", "user.email", "selftest@example.invalid", cwd=root)
    git("config", "user.name", "changelog-union-check selftest", cwd=root)
    if with_driver:
        with open(os.path.join(root, ".gitattributes"), "w", encoding="utf-8") as fh:
            fh.write("CHANGELOG.md merge=union\n")
    with open(os.path.join(root, CHANGELOG), "w", encoding="utf-8") as fh:
        fh.write(FIXTURE_BASE)
    git("add", "-A", cwd=root)
    git("commit", "--quiet", "-m", "base", cwd=root)


def _commit_variant(root: str, branch: str, text: str) -> str:
    git("checkout", "--quiet", "-B", branch, "base", cwd=root)
    with open(os.path.join(root, CHANGELOG), "w", encoding="utf-8") as fh:
        fh.write(text)
    git("commit", "--quiet", "-am", branch, cwd=root)
    return branch


def _executable_source() -> str:
    """This file's code with comments and triple-quoted prose stripped out.

    The rule being enforced is "no executable line consults GitHub's mergeability", and
    this file DISCUSSES those signals at length -- the module docstring is mostly about
    why they are the wrong input -- so a plain grep cannot express it.

    Nor can a hand-rolled `\"\"\"` toggle, which is what this was first written as. That
    version mistook FIXTURE_BASE's closing delimiter for the OPENING of a docstring and
    silently stopped reading two thirds of the way down the file, so the check went
    vacuous and a mutant that gated the sweep on `mergeable` survived it. Tokenizing is
    the fix; `_source_consults_mergeability` additionally asserts the scan reached the
    last line, because a guard that silently stops scanning still reports PASS.

    Ordinary (single-delimiter) string literals are KEPT, because that is the shape the
    banned code actually takes -- `pr.get("...")`, or an extra field in a `--json` list.
    """
    import tokenize

    out = []
    with open(os.path.abspath(__file__), "rb") as fh:
        for tok in tokenize.tokenize(fh.readline):
            if tok.type == tokenize.COMMENT:
                continue
            if tok.type == tokenize.STRING and tok.string.lstrip("rbfuRBFU")[:3] in ('"""', "'''"):
                continue
            out.append(tok.string)
    return "\n".join(out)


# Assembled from fragments deliberately: written whole, this tuple would match itself and
# the check would fail on its own definition.
_BANNED_SIGNALS = (
    "merge" + "able",
    "merge" + "StateStatus",
    "merge" + "able_state",
)

# The merge ref, in any spelling. It is frequently stale, so it certifies nothing; the
# legitimate fetch in `fetch_pr` takes `refs/pull/N/head` and must not trip this.
_BANNED_REF = re.compile(r"refs/pull/[^\s\"']*/" + "merge")


def _source_consults_mergeability() -> list[str]:
    """Executable fragments of this file that read GitHub's mergeability signals.

    `mergeable` is a sticky cache GitHub computes with the DEFAULT TEXT DRIVER, so a PR
    touching `[Unreleased]` flips to CONFLICTING routinely and benignly; the merge ref is
    frequently stale. Keying off either would make this detector wrong in exactly the
    cases it exists for.
    """
    src = _executable_source()
    # The last token in the file. If tokenizing ever stops early -- the failure mode that
    # made the previous implementation vacuous -- this is what says so out loud.
    if "__main__" not in src:
        return ["the source scan did not reach the end of the file, so this check is vacuous"]
    hits = [s for s in _BANNED_SIGNALS if re.search(rf"\b{re.escape(s)}", src)]
    hits += sorted({m.group(0) for m in _BANNED_REF.finditer(src)})
    return hits


def selftest() -> int:
    failures: list[str] = []
    root = tempfile.mkdtemp(prefix="changelog-union-selftest-")
    try:
        _init_fixture_repo(root)

        emit("fixtures (real commits, real `git --attr-source=<ours> merge-tree`):")
        for fx in fixtures():
            ours = _commit_variant(root, f"{fx['name']}-ours", fx["ours"])
            theirs = _commit_variant(root, f"{fx['name']}-theirs", fx["theirs"])
            try:
                found = check_pair(ours, theirs, cwd=root)
            except Unevaluable as exc:
                failures.append(f"{fx['name']}: could not evaluate: {exc}")
                continue
            kinds = sorted(f["kind"] for f in found)
            want = sorted(fx["expect"])
            ok = kinds == want
            emit(f"  {'PASS' if ok else 'FAIL'}  {fx['name']:<18} expected {want or ['clean']}, got {kinds or ['clean']}")
            for f in found:
                emit(f"          {f['kind']}: {f['key'][:64]} -- {f['detail'][:90]}")
            if not ok:
                failures.append(f"{fx['name']}: expected {want}, got {kinds}")

        # ------------------------------------------------------------------------------
        # --attr-source controls (WIC-1792 constraint 4). Three assertions, because
        # "the flag is present" and "the flag is doing anything" are different claims.
        # ------------------------------------------------------------------------------
        emit("--attr-source placement controls:")
        ours, theirs = "weld-ours", "weld-theirs"

        # (a) Global, before the subcommand -- the form this file uses. Must succeed AND
        #     apply the driver, i.e. no conflict markers.
        try:
            union_merge(ours, theirs, cwd=root)
            emit("  PASS  global `git --attr-source=<rev> merge-tree` merges under the union driver")
        except Unevaluable as exc:
            failures.append(f"global --attr-source failed: {exc}")
            emit(f"  FAIL  global --attr-source: {exc}")

        # (b) After the subcommand -- git rejects it outright. This is the test that fails
        #     if anyone moves the flag: 129 is not a conflict, it is a usage error, and
        #     union_merge() surfaces it rather than treating it as "no findings".
        p = git("merge-tree", f"--attr-source={ours}", "--write-tree", ours, theirs, check=False, cwd=root)
        ok = p.returncode == 129
        emit(f"  {'PASS' if ok else 'FAIL'}  `merge-tree --attr-source=...` (flag after the subcommand) exits 129, got {p.returncode}")
        if not ok:
            failures.append(f"expected exit 129 for a post-subcommand --attr-source, got {p.returncode}")

        # (c) THE FLAG MUST BE DOING SOMETHING, not merely accepted. `ours` is a head that
        #     DELETED the `merge=union` line while the checked-out working tree still has
        #     it -- which is the arrangement in CI, where the runner checks out the base.
        #
        #     With the global --attr-source, git reads the attributes from that head, the
        #     merge conflicts, and union_merge refuses to report a verdict. WITHOUT it,
        #     merge-tree falls back to the WORKING TREE, silently unions anyway, and
        #     returns "clean" -- confidently wrong about a PR whose real merge would
        #     conflict. That is the "measures nothing" failure WIC-1792 records, and this
        #     is the assertion that catches it: dropping the flag makes this check fail.
        #
        #     Checking out a driver-carrying branch first is load-bearing. It is what
        #     makes the fallback path *succeed*, and therefore what makes the two
        #     placements distinguishable at all.
        git("checkout", "--quiet", "weld-ours", cwd=root)
        driverless = _commit_variant(root, "driver-deleted-ours", fixtures()[0]["ours"])
        git("rm", "--quiet", ".gitattributes", cwd=root)
        git("commit", "--quiet", "-m", "delete the union driver", cwd=root)
        git("checkout", "--quiet", "weld-ours", cwd=root)  # working tree HAS the driver
        try:
            union_merge(driverless, "weld-theirs", cwd=root)
            failures.append(
                "a head that deleted `merge=union` still merged clean, so --attr-source is "
                "inert and merge-tree is reading the working tree instead"
            )
            emit("  FAIL  a head without the driver merged clean -- --attr-source is not being consulted")
        except Unevaluable:
            emit("  PASS  a head that deleted `merge=union` is refused, so --attr-source is load-bearing")

        # ------------------------------------------------------------------------------
        # The detector must never gate on GitHub's mergeability signals.
        # ------------------------------------------------------------------------------
        hits = _source_consults_mergeability()
        # The wording avoids the banned literals on purpose -- this line is itself
        # executable source, and naming them here would trip the check it reports.
        emit(f"  {'PASS' if not hits else 'FAIL'}  no executable line consults GitHub's mergeability signals")
        for h in hits:
            emit(f"          {h}")
        if hits:
            failures.append(f"source consults GitHub mergeability: {hits}")
    finally:
        shutil.rmtree(root, ignore_errors=True)

    if failures:
        emit("")
        emit(f"SELFTEST FAILED ({len(failures)}):")
        for f in failures:
            emit(f"  - {f}")
        return 1
    emit("")
    emit("SELFTEST PASSED")
    return 0


# --------------------------------------------------------------------------------------
# Replay: real repo history, against answers published independently of this code
# --------------------------------------------------------------------------------------

# The synthetic fixtures prove the checks fire; these prove they agree with the hand
# measurements root CLAUDE.md recorded for two real corrupted PRs, months before this
# script existed. Every expected answer below is quoted from that file, not derived here.
#
# Deliberately NOT wired into CI. It depends on `refs/pull/N/head` objects and on a base
# branch that this repo does not control -- a deleted branch or a GC'd pull ref would turn
# the gate red for a reason that has nothing to do with the detector. The hermetic
# `selftest` is the gate; this is the re-runnable evidence behind it.
#
#     git fetch origin '+refs/pull/115/head:refs/remotes/pr/115' \
#                      '+refs/pull/129/head:refs/remotes/pr/129'
#     git fetch origin '+refs/heads/fix/wic1141-modal-focus-pr2:refs/remotes/origin/wic1141'
#     python3 scripts/changelog-union-check.py replay
REPLAY_CASES = [
    {
        "name": "#129 pre-fix, real orientation",
        "ours": "97989e6",  # PR #129 head before its author repaired it
        "theirs": "743cfeb",  # `main` at the time
        "expect": ["DUPLICATE"],
        "source": "CLAUDE.md: `ours = PR head` -> MISFILED 0, DUPLICATE 1",
    },
    {
        # The same three inputs with the sides swapped. CLAUDE.md records that one
        # corruption presents as DUPLICATE in the real orientation and as two MISFILED in
        # the wrong one -- so this case pins constraint 1 against real data, and it is the
        # concrete reason side order is not a stylistic choice.
        "name": "#129 pre-fix, WRONG orientation",
        "ours": "743cfeb",
        "theirs": "97989e6",
        "expect": ["MISFILED", "MISFILED"],
        "source": "CLAUDE.md: `ours = base branch` -> MISFILED 2, DUPLICATE 0",
    },
    {
        "name": "#129 after a7a13fb, real orientation",
        "ours": "a7a13fb9",
        "theirs": "743cfeb",
        "expect": [],
        "source": "CLAUDE.md: re-measured at that head, union clean on all three checks",
    },
    {
        # The worked example the misfiling check was written for (WIC-1786). Pinned to
        # SHAs on both sides, including the base, so the answer cannot drift when a branch
        # tip moves.
        "name": "#115 at 7890a2c vs its own base",
        "ours": "7890a2c",
        "theirs": "0fa58ee7",  # fix/wic1141-modal-focus-pr2
        "expect": ["MISFILED"],
        "source": "CLAUDE.md: exactly one hit, #115, and no false positives",
    },
    {
        "name": "#115 at today's head vs the same base",
        "ours": "f75d483e",
        "theirs": "0fa58ee7",
        "expect": [],
        "source": "repaired since; negative control on real data",
    },
]


def replay() -> int:
    failures, skipped = [], []
    emit("replay against real repo history:")
    for case in REPLAY_CASES:
        missing = [
            r for r in (case["ours"], case["theirs"])
            if git("cat-file", "-e", f"{r}^{{commit}}", check=False).returncode != 0
        ]
        if missing:
            # Reported, never silently passed -- a skipped case is absence of evidence.
            emit(f"  SKIP  {case['name']:<40} objects not present: {', '.join(missing)}")
            skipped.append(case["name"])
            continue
        try:
            found = check_pair(case["ours"], case["theirs"])
        except Unevaluable as exc:
            failures.append(f"{case['name']}: {exc}")
            emit(f"  FAIL  {case['name']:<40} {exc}")
            continue
        kinds = sorted(f["kind"] for f in found)
        want = sorted(case["expect"])
        ok = kinds == want
        emit(f"  {'PASS' if ok else 'FAIL'}  {case['name']:<40} expected {want or ['clean']}, got {kinds or ['clean']}")
        emit(f"          {case['source']}")
        if not ok:
            failures.append(f"{case['name']}: expected {want}, got {kinds}")

    if skipped:
        emit("")
        emit(f"{len(skipped)} case(s) skipped for missing objects -- see the fetch commands above.")
    if failures:
        emit("")
        emit(f"REPLAY FAILED ({len(failures)}): {'; '.join(failures)}")
        return 1
    emit("")
    emit("REPLAY PASSED" if not skipped else "REPLAY PASSED (incomplete -- see skips)")
    return 0


# --------------------------------------------------------------------------------------
# Modes
# --------------------------------------------------------------------------------------


def run_prs(prs: list[dict], scope: str) -> int:
    rows: list[tuple[str, str, str]] = []
    total = 0
    errors: list[str] = []

    for pr in sorted(prs, key=lambda p: p["number"]):
        n = pr["number"]
        label = f"PR #{n} (base {pr['baseRefName']})"
        try:
            ours, theirs = fetch_pr(n, pr["baseRefName"])
            found = check_pair(ours, theirs)
        except Unevaluable as exc:
            emit(f"  {label}: UNEVALUATED -- {exc}")
            rows.append((f"#{n}", "unevaluated", str(exc)[:140]))
            errors.append(f"#{n}: {exc}")
            continue
        report(label, found)
        total += len(found)
        rows.append(
            (
                f"#{n}",
                "clean" if not found else "corrupt",
                "-" if not found else "; ".join(sorted({f["kind"] for f in found})),
            )
        )
        for f in found:
            annotate(
                "error",
                f"PR #{n}: union merge with `{pr['baseRefName']}` introduces {f['kind']} -- "
                f"{f['key'][:80]} ({f['detail']})",
            )

    lines = [
        "## Changelog union-corruption detector",
        "",
        f"{scope}: **{len(prs)}** open PR(s), **{total}** finding(s).",
        "",
        "| PR | State | Kinds |",
        "| --- | --- | --- |",
    ]
    lines += [f"| {a} | {b} | {c} |" for a, b, c in rows] or ["| _none_ | | |"]
    if not prs:
        lines.append("")
        lines.append(
            "> No open PRs. **This is not validation** -- an empty queue tells you nothing "
            "about the detector. The `selftest` job is what proves it works."
        )
    summary("\n".join(lines))

    if errors:
        emit("")
        emit(f"Could not evaluate {len(errors)} PR(s): {'; '.join(errors)}")
        return 2
    return 1 if total else 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="mode", required=True)

    sub.add_parser("selftest", help="run the synthetic fixtures; needs no repo and no network")
    sub.add_parser("replay", help="re-check two real historical PRs against CLAUDE.md's published answers")

    p_pr = sub.add_parser("pr", help="check one PR against its own base")
    p_pr.add_argument("number", type=int)
    p_pr.add_argument("--base-ref", help="skip the `gh pr view` lookup")

    sub.add_parser("sweep", help="check every open PR against its own base")

    p_refs = sub.add_parser("refs", help="check an arbitrary pair of revisions")
    p_refs.add_argument("--ours", required=True, help="the PR head -- orientation matters")
    p_refs.add_argument("--theirs", required=True, help="the base branch")

    args = ap.parse_args(argv)

    if args.mode == "selftest":
        return selftest()

    if args.mode == "replay":
        try:
            return replay()
        except Unevaluable as exc:
            emit(f"UNEVALUATED: {exc}")
            return 2

    try:
        if args.mode == "refs":
            found = check_pair(args.ours, args.theirs)
            report(f"{args.ours} <- {args.theirs}", found)
            return 1 if found else 0

        if args.mode == "pr":
            base = args.base_ref
            if not base:
                base = gh_json("pr", "view", str(args.number), "--json", "baseRefName")["baseRefName"]
            return run_prs(
                [{"number": args.number, "baseRefName": base}],
                "Evaluated",
            )

        return run_prs(open_prs(), "Swept")
    except Unevaluable as exc:
        emit(f"UNEVALUATED: {exc}")
        summary(f"## Changelog union-corruption detector\n\nUnevaluated: {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
