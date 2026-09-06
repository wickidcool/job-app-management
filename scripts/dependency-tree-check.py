#!/usr/bin/env python3
"""Fail the build if `npm ls --all` reports a dependency the tree cannot satisfy (WIC-2132).

Why this exists
---------------
WIC-2126: `packages/web` declared `zod@^3.23.8` while the committed lockfile installed a
nested `zod@4.3.6` beside `@hookform/resolvers@3.10.0`, which only understands zod 3's
`ZodError`. Every client-side form validation message in the app was dead for months.
`npm ls` saw it the whole time — the tree was invalid *as committed* — and nothing ran it.

The fix shipped a gate scoped to one package name (`npm ls zod`, PR #417). A named gate
only ever catches the bug it was named after. This generalises it to the whole tree.

Why a baseline and not a bare `npm ls --all`
--------------------------------------------
A bare `npm ls --all` exits 1 on this repo today, on two rows that are **not** skews:

    invalid: esbuild@0.19.12            node_modules/esbuild
    invalid: @vitest/coverage-v8@1.6.1  node_modules/@vitest/coverage-v8

Both are **unmet OPTIONAL peers of a nested package, on a copy hoisted for a different
consumer**. `packages/web/node_modules/vite@8.0.8` declares `esbuild: "^0.27.0 || ^0.28.0"`
as a peer marked `"optional": true`; npm walks up, finds the root `esbuild@0.19.12` that
`drizzle-kit` (`esbuild: ^0.19.7`) legitimately owns, judges it against *vite's* range, and
prints `invalid`. Same shape for `@vitest/coverage-v8@1.6.1`, owned by `packages/api`
(`vitest: ^1.6.0` + `@vitest/coverage-v8: ^1.6.0` — an exact, self-consistent pair) and
judged against `packages/web/node_modules/vitest@4.1.11`'s optional peer.

Nothing is mis-paired. `packages/api` is the only workspace with a `test:coverage` script,
and it resolves the hoisted 1.6.1 pair; `packages/web` declares no coverage package and
never runs coverage. **No coverage number this repo has quoted was ever affected.**

So the two available "make it exit 0" moves are both wrong: installing
`@vitest/coverage-v8@4.1.11` into a workspace that never imports it is cargo-culting, and
raising root `esbuild` to `^0.27` breaks `drizzle-kit`. And shipping a bare `npm ls --all`
would paint CI permanently red on that noise — trading WIC-2126's false green for a false
red, which is the same disease (see WIC-2122, WIC-2131).

Hence the shrink-only baseline idiom this repo already uses for `A11Y_BASELINE` /
`AXE_BASELINE`: pin the known rows *with their reason*, fail on anything new.

The exemption is verified, not asserted
---------------------------------------
A baseline keyed on a package **name** would let a future genuine skew hide behind an
entry written for a different reason (WIC-1970: key a guard on the HAZARD, not on a
consequence). So an entry is only honoured while its stated classification still holds:
for `unmet_optional_peer`, this script re-reads the requiring package's own
`package.json` on every run and confirms `peerDependenciesMeta[<name>].optional === true`
for **every** `"<range>" from <path>` clause npm attached to the row. If vite ever makes
that peer required, the exemption stops applying and the build goes red — without anyone
having to remember to revisit this file.

The baseline is pinned bidirectionally. A recorded row that no longer appears is *also* a
failure: it means the skew was resolved and the entry must be deleted in the same change,
so the baseline can only ever shrink.

`observedVersion` is recorded for the reader but deliberately **not** part of the match
key. A routine `drizzle-kit` bump that moves `esbuild@0.19.12 -> 0.19.13` does not change
the fact being exempted, and going red on it would be exactly the false-signal disease
above. Drift is printed as a note. The match key is
`(name, installPath, requiredBy-clauses)` — if vite changes the *range*, the key changes
and a human re-reviews.

Only `invalid:` rows are baselineable at all. Any other problem npm reports (`missing:`,
`extraneous:`, `peer dep missing:`) fails unconditionally; there are none today, so that
costs nothing and closes the obvious hole.

Flags that do NOT work (measured 2026-09-06, npm 10.x, on a clean `npm ci`)
--------------------------------------------------------------------------
    npm ls --all --omit=peer                exit 1, both rows still reported
    npm ls --all --omit=optional            exit 1, both rows still reported
    npm ls --all --omit=peer --omit=optional exit 1, both rows still reported
    npm ls --all --omit=dev                 exit 0 — but only by deleting the entire dev
                                            tree from the check, which is where vitest,
                                            vite and eslint live. A gate that cannot see
                                            the dev tree is not a gate.

`--omit=peer` was predicted on WIC-2132 to be a simpler alternative to this baseline. It
is not: the rows are *unmet* peers, so there is no installed peer edge for npm to omit —
the marker rides on the hoisted node itself, which is a regular dependency.

Usage
-----
    python3 scripts/dependency-tree-check.py                 # shells out to `npm ls --all --json`
    python3 scripts/dependency-tree-check.py --json f.json   # grade a saved report
    python3 scripts/dependency-tree-check.py --write-baseline
    python3 scripts/dependency-tree-check.py --selftest      # offline fixtures, no npm
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE_PATH = REPO_ROOT / "scripts" / "dependency-tree-baseline.json"

# `invalid: <name>@<version> <absolute install path>`
_PROBLEM_RE = re.compile(r"^invalid:\s+(?P<spec>\S+)\s+(?P<path>/.*)$")
# `"<range>" from <package path>` — npm may attach more than one clause to a row.
_CLAUSE_RE = re.compile(r'"(?P<range>[^"]*)"\s+from\s+(?P<from>\S+)')

CLASSIFICATION_UNMET_OPTIONAL_PEER = "unmet_optional_peer"


def run_npm_ls() -> dict:
    """`npm ls --all --json` exits 1 whenever it reports a problem; that is the normal path."""
    proc = subprocess.run(
        ["npm", "ls", "--all", "--json"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if not proc.stdout.strip():
        raise SystemExit(f"npm ls produced no JSON (exit {proc.returncode}):\n{proc.stderr}")
    return json.loads(proc.stdout)


def _split_spec(spec: str) -> tuple[str, str]:
    """`@vitest/coverage-v8@1.6.1` -> (`@vitest/coverage-v8`, `1.6.1`)."""
    at = spec.rfind("@")
    if at <= 0:
        return spec, ""
    return spec[:at], spec[at + 1 :]


def relativize(abs_path: str, repo_root: Path) -> str:
    """Make an install path from `npm ls` repo-relative.

    ⚠️ `relative_to()` alone is not enough. npm **redacts UUID-shaped segments** from every
    path it prints, on the assumption they may be secrets. This fleet's checkouts live under
    `.../workspaces/<agent-uuid>/...`, so npm reports

        invalid: esbuild@0.19.12 /home/alwick/.../workspaces/***/wt-wic2132/node_modules/esbuild

    — a path that exists nowhere, and that `relative_to(repo_root)` rejects. A CI runner's
    path (`/home/runner/work/...`) has no UUID and never triggers it, so the failure is
    invisible where it runs and only bites where the baseline is *authored*: the absolute,
    redacted path gets written into the file and then matches nothing, anywhere.

    So: try the honest relativization first, and otherwise take the LONGEST trailing run of
    segments that actually exists under the repo root. Longest, not shortest — a shortest
    match would collapse `packages/web/node_modules/zod` onto a hoisted `node_modules/zod`
    and silently merge two distinct rows.
    """
    try:
        return str(Path(abs_path).resolve().relative_to(repo_root))
    except ValueError:
        pass
    parts = [p for p in Path(abs_path).parts if p not in ("/", "")]
    for start in range(len(parts)):
        candidate = Path(*parts[start:])
        if (repo_root / candidate).exists():
            return str(candidate)
    return abs_path


def _reason_index(node: dict, out: dict[tuple[str, str], str]) -> None:
    """Map (name, install path) -> npm's `invalid` reason string, walking the whole tree.

    The reason lives on the tree node; the canonical deduped row set lives in the root
    `problems` array. Neither alone is enough, so both are read.
    """
    for name, child in (node.get("dependencies") or {}).items():
        if not isinstance(child, dict):
            continue
        invalid = child.get("invalid")
        if invalid:
            for problem in child.get("problems") or []:
                m = _PROBLEM_RE.match(problem)
                if m and _split_spec(m.group("spec"))[0] == name:
                    out[(name, m.group("path"))] = invalid
        _reason_index(child, out)


def collect(report: dict, repo_root: Path) -> tuple[list[dict], list[str]]:
    """Return (invalid rows, non-invalid problem strings).

    Rows carry repo-relative paths so a baseline is portable between a CI checkout and a
    local worktree.
    """
    reasons: dict[tuple[str, str], str] = {}
    _reason_index(report, reasons)

    rows: list[dict] = []
    others: list[str] = []
    seen: set[tuple] = set()
    for problem in report.get("problems") or []:
        m = _PROBLEM_RE.match(problem)
        if not m:
            others.append(problem)
            continue
        name, version = _split_spec(m.group("spec"))
        abs_path = m.group("path")
        rel_path = relativize(abs_path, repo_root)
        reason = reasons.get((name, abs_path), "")
        required_by = [
            {"range": c.group("range"), "from": c.group("from")}
            for c in _CLAUSE_RE.finditer(reason)
        ]
        row = {
            "name": name,
            "observedVersion": version,
            "installPath": rel_path,
            "requiredBy": required_by,
        }
        if key(row) in seen:
            continue
        seen.add(key(row))
        rows.append(row)
    return rows, others


def key(row: dict) -> tuple:
    """Match key. Deliberately excludes `observedVersion` — see the module docstring."""
    return (
        row["name"],
        row["installPath"],
        tuple(sorted((c["range"], c["from"]) for c in row["requiredBy"])),
    )


def classify(row: dict, repo_root: Path) -> tuple[str, str]:
    """Re-derive the row's classification from the packages on disk.

    Returns (classification, detail). `unmet_optional_peer` requires EVERY clause npm
    attached to the row to be an optional peerDependency of the requiring package — one
    hard requirement is enough to make the row a real skew.
    """
    if not row["requiredBy"]:
        return "unknown", "npm attached no requiring clause to this row"

    details = []
    for clause in row["requiredBy"]:
        pkg_json = repo_root / clause["from"] / "package.json"
        if not pkg_json.is_file():
            return "unknown", f"cannot read {clause['from']}/package.json"
        try:
            manifest = json.loads(pkg_json.read_text())
        except json.JSONDecodeError as exc:
            return "unknown", f"unparsable {clause['from']}/package.json: {exc}"
        peers = manifest.get("peerDependencies") or {}
        meta = (manifest.get("peerDependenciesMeta") or {}).get(row["name"]) or {}
        if row["name"] not in peers:
            return "hard_requirement", (
                f"{clause['from']} requires {row['name']}@{clause['range']} as a "
                "regular dependency, not a peer"
            )
        if meta.get("optional") is not True:
            return "hard_requirement", (
                f"{clause['from']} declares {row['name']}@{clause['range']} as a "
                "REQUIRED peer"
            )
        details.append(f"{clause['from']} (optional peer {clause['range']})")
    return CLASSIFICATION_UNMET_OPTIONAL_PEER, "; ".join(details)


def load_baseline(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return json.loads(path.read_text()).get("exempt", [])


def grade(rows: list[dict], others: list[str], baseline: list[dict], repo_root: Path) -> int:
    failures: list[str] = []
    notes: list[str] = []

    for problem in others:
        failures.append(f"npm reports a problem that is never exempt: {problem}")

    by_key = {key(r): r for r in rows}
    base_by_key = {key(b): b for b in baseline}

    for k, row in by_key.items():
        classification, detail = classify(row, repo_root)
        base = base_by_key.get(k)
        if base is None:
            failures.append(
                f"NEW invalid row: {row['name']}@{row['observedVersion']} at "
                f"{row['installPath']} — {detail or classification}.\n"
                "    This is what the gate is for. Resolve the version skew. Only add it "
                "to scripts/dependency-tree-baseline.json if it is genuinely benign, with "
                "the reason written out."
            )
            continue
        if base.get("classification") != classification:
            failures.append(
                f"EXPIRED exemption: {row['name']} at {row['installPath']} is baselined as "
                f"'{base.get('classification')}' but now classifies as "
                f"'{classification}' — {detail}.\n"
                "    The exemption's premise no longer holds; this is a real problem now."
            )
            continue
        if base.get("observedVersion") != row["observedVersion"]:
            notes.append(
                f"{row['name']} moved {base.get('observedVersion')} -> "
                f"{row['observedVersion']} (not a failure; re-run --write-baseline to refresh)"
            )

    for k, base in base_by_key.items():
        if k not in by_key:
            failures.append(
                f"STALE exemption: {base.get('name')} at {base.get('installPath')} is "
                "recorded in the baseline but no longer appears in `npm ls --all`.\n"
                "    Good news — it was resolved. Delete the entry: this baseline only "
                "shrinks."
            )

    print(f"npm ls --all: {len(rows)} invalid row(s), {len(baseline)} baselined exemption(s)")
    for row in rows:
        classification, detail = classify(row, repo_root)
        mark = "exempt " if key(row) in base_by_key else "NEW    "
        print(f"  {mark} {row['name']}@{row['observedVersion']}  [{classification}]  {detail}")
    for note in notes:
        print(f"  note: {note}")

    if failures:
        print("\nFAIL — dependency tree check:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nOK — no invalid dependency rows outside the documented baseline.")
    return 0


def write_baseline(rows: list[dict], repo_root: Path, path: Path) -> int:
    entries = []
    for row in sorted(rows, key=lambda r: (r["name"], r["installPath"])):
        classification, detail = classify(row, repo_root)
        entries.append({**row, "classification": classification, "detail": detail, "reason": ""})
    payload = {
        "_comment": (
            "Shrink-only baseline for scripts/dependency-tree-check.py (WIC-2132). Every "
            "entry needs a human-written `reason`. `classification` is re-verified against "
            "the packages on disk on every run; `observedVersion` is informational and is "
            "not part of the match key."
        ),
        "exempt": entries,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {len(entries)} entr(ies) to {path.relative_to(repo_root)}")
    print("Fill in the `reason` for each entry before committing.")
    return 0


# --------------------------------------------------------------------------------------
# Offline fixtures. These exercise the grading logic without npm or a node_modules tree,
# so the check is verifiable on a machine that cannot install (and by a reviewer reading
# the diff). `_FS` stands in for the package manifests `classify()` reads from disk.
# --------------------------------------------------------------------------------------

_FS = {
    "packages/web/node_modules/vite/package.json": {
        "version": "8.0.8",
        "peerDependencies": {"esbuild": "^0.27.0 || ^0.28.0"},
        "peerDependenciesMeta": {"esbuild": {"optional": True}},
    },
    "packages/web/node_modules/vitest/package.json": {
        "version": "4.1.11",
        "peerDependencies": {"@vitest/coverage-v8": "4.1.11"},
        "peerDependenciesMeta": {"@vitest/coverage-v8": {"optional": True}},
    },
    # Same package, but with the peer made REQUIRED — the premise-expiry arm.
    "packages/web/node_modules/strictvite/package.json": {
        "version": "9.0.0",
        "peerDependencies": {"esbuild": "^0.27.0"},
    },
    "packages/api/node_modules/hookform/package.json": {
        "version": "3.10.0",
        "dependencies": {"zod": "^3.23.8"},
    },
}


def _fixture_report(problems: list[str], invalid_nodes: dict) -> dict:
    deps = {}
    for name, (version, invalid, path) in invalid_nodes.items():
        deps[name] = {
            "version": version,
            "invalid": invalid,
            "problems": [f"invalid: {name}@{version} {path}"],
        }
    return {"name": "jobtrail", "problems": problems, "dependencies": deps}


class _FakeRoot:
    """Path stand-in that resolves `<root>/<pkg>/package.json` out of `_FS`."""

    def __init__(self, root: str = "/repo"):
        self.root = root

    def __truediv__(self, other):
        return _FakePath(f"{other}")


class _FakePath:
    def __init__(self, rel: str):
        self.rel = rel

    def __truediv__(self, other):
        return _FakePath(f"{self.rel}/{other}")

    def is_file(self) -> bool:
        return self.rel in _FS

    def read_text(self) -> str:
        return json.dumps(_FS[self.rel])


_ROWS_TODAY = [
    {
        "name": "esbuild",
        "observedVersion": "0.19.12",
        "installPath": "node_modules/esbuild",
        "requiredBy": [
            {"range": "^0.27.0 || ^0.28.0", "from": "packages/web/node_modules/vite"}
        ],
    },
    {
        "name": "@vitest/coverage-v8",
        "observedVersion": "1.6.1",
        "installPath": "node_modules/@vitest/coverage-v8",
        "requiredBy": [{"range": "4.1.11", "from": "packages/web/node_modules/vitest"}],
    },
]


def _baseline_today() -> list[dict]:
    return [
        {**r, "classification": CLASSIFICATION_UNMET_OPTIONAL_PEER, "reason": "fixture"}
        for r in _ROWS_TODAY
    ]


def selftest() -> int:
    fake_root = _FakeRoot()
    failures = []

    def check(label, got, want):
        ok = got == want
        print(f"  [{'ok  ' if ok else 'FAIL'}] {label}: got {got}, want {want}")
        if not ok:
            failures.append(label)

    # 1. Parsing: the real npm payload shape must yield exactly the two rows, with the
    #    range and requiring package pulled out of the free-text `invalid` string.
    report = _fixture_report(
        [
            "invalid: esbuild@0.19.12 /repo/node_modules/esbuild",
            "invalid: @vitest/coverage-v8@1.6.1 /repo/node_modules/@vitest/coverage-v8",
        ],
        {
            "esbuild": (
                "0.19.12",
                '"^0.27.0 || ^0.28.0" from packages/web/node_modules/vite',
                "/repo/node_modules/esbuild",
            ),
            "@vitest/coverage-v8": (
                "1.6.1",
                '"4.1.11" from packages/web/node_modules/vitest',
                "/repo/node_modules/@vitest/coverage-v8",
            ),
        },
    )
    rows, others = collect(report, Path("/repo"))
    check("parses both rows", (len(rows), len(others)), (2, 0))
    check(
        "extracts the requiring clause",
        sorted((r["name"], r["requiredBy"][0]["from"]) for r in rows),
        sorted(
            [
                ("@vitest/coverage-v8", "packages/web/node_modules/vitest"),
                ("esbuild", "packages/web/node_modules/vite"),
            ]
        ),
    )

    # 1b. Path relativization must survive npm's UUID redaction, and must prefer the
    #     LONGEST existing suffix — otherwise a workspace-nested copy collapses onto the
    #     hoisted one of the same name and two distinct rows silently become one.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "node_modules" / "zod").mkdir(parents=True)
        (root / "packages" / "web" / "node_modules" / "zod").mkdir(parents=True)
        check(
            "relativizes a redacted npm path",
            relativize("/home/a/workspaces/***/wt/packages/web/node_modules/zod", root),
            "packages/web/node_modules/zod",
        )
        check(
            "relativizes an honest path",
            relativize(str(root / "node_modules" / "zod"), root),
            "node_modules/zod",
        )

    # 2. The steady state: today's two rows against today's baseline is green.
    check("baselined rows pass", grade(_ROWS_TODAY, [], _baseline_today(), fake_root), 0)

    # 3. The whole point of the card — a NEW invalid row is red even though the two
    #    known ones are still present. This is the arm `npm ls zod` could not cover.
    new_row = {
        "name": "zod",
        "observedVersion": "4.3.6",
        "installPath": "packages/web/node_modules/zod",
        "requiredBy": [{"range": "^3.23.8", "from": "packages/api/node_modules/hookform"}],
    }
    check(
        "a new invalid row fails",
        grade(_ROWS_TODAY + [new_row], [], _baseline_today(), fake_root),
        1,
    )

    # 4. Shrink-only: a baselined row that has been resolved must be deleted, not left.
    check(
        "a resolved (stale) exemption fails",
        grade(_ROWS_TODAY[:1], [], _baseline_today(), fake_root),
        1,
    )

    # 5. Premise expiry — keyed on the HAZARD, not the name. Same package, same path,
    #    but the requiring package now declares the peer as REQUIRED. A name-keyed
    #    baseline would wave this through; this must not.
    strict = {
        "name": "esbuild",
        "observedVersion": "0.19.12",
        "installPath": "node_modules/esbuild",
        "requiredBy": [{"range": "^0.27.0", "from": "packages/web/node_modules/strictvite"}],
    }
    strict_baseline = [
        {**strict, "classification": CLASSIFICATION_UNMET_OPTIONAL_PEER, "reason": "fixture"}
    ]
    check(
        "a required peer cannot hide behind an optional-peer exemption",
        grade([strict], [], strict_baseline, fake_root),
        1,
    )
    check(
        "classify() names the required peer",
        classify(strict, fake_root)[0],
        "hard_requirement",
    )

    # 6. A non-`invalid` problem (missing / extraneous) is never exempt, even with an
    #    otherwise-clean tree and a full baseline.
    check(
        "a missing dependency fails unconditionally",
        grade(_ROWS_TODAY, ["missing: left-pad@^1.0.0, required by jobtrail"], _baseline_today(), fake_root),
        1,
    )

    # 7. `observedVersion` drift is a note, not a failure — a drizzle-kit bump that moves
    #    esbuild a patch release does not change the fact being exempted.
    bumped = [{**_ROWS_TODAY[0], "observedVersion": "0.19.13"}, _ROWS_TODAY[1]]
    check("a patch bump of an exempt package passes", grade(bumped, [], _baseline_today(), fake_root), 0)

    # 8. The EMPTY-baseline arms. As of WIC-2137 the real baseline file has no entries at
    #    all, and emptying a baseline can quietly disarm the checks built on top of it
    #    (WIC-2110). Arms 2-7 above cannot see that: they grade against `_baseline_today()`,
    #    a fixture derived from `_ROWS_TODAY`, so they pass identically whatever the file on
    #    disk says. These two are the ones that actually exercise the shipped state.
    check("a clean tree against an EMPTY baseline passes", grade([], [], [], fake_root), 0)
    check(
        "a new invalid row against an EMPTY baseline fails",
        grade([_ROWS_TODAY[0]], [], [], fake_root),
        1,
    )

    if failures:
        print(f"\nselftest FAILED: {', '.join(failures)}")
        return 1
    print("\nselftest OK")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Gate the whole npm tree on `npm ls --all`.")
    ap.add_argument("--json", type=Path, help="grade a saved `npm ls --all --json` report")
    ap.add_argument("--write-baseline", action="store_true", help="regenerate the baseline file")
    ap.add_argument("--selftest", action="store_true", help="run offline fixtures and exit")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    report = json.loads(args.json.read_text()) if args.json else run_npm_ls()
    rows, others = collect(report, REPO_ROOT)
    if args.write_baseline:
        return write_baseline(rows, REPO_ROOT, BASELINE_PATH)
    return grade(rows, others, load_baseline(BASELINE_PATH), REPO_ROOT)


if __name__ == "__main__":
    sys.exit(main())
