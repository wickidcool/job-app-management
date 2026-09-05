#!/usr/bin/env python3
"""Fail the build if any Playwright e2e spec is skipped *unconditionally* (WIC-2124).

Why this exists
---------------
`packages/web/e2e/personal-info.spec.ts` sat behind five `test.describe.skip(...)`
blocks from 2026-05-11 to 2026-09-05 — 18 specs, four months, behind a commit message
promising an "infrastructure fix" that no card tracked. `job-fit-analysis.spec.ts`
TC-4 sat behind a bare `test.skip(...)` from 2026-04-25 labelled "flaky in CI"; it was
not flaky, it failed 12/12 on a strict-mode violation. Neither was visible in any
`ls`-level or filename-level audit: the files still read as covered, and the suite
still reported a healthy pass count, because a skipped spec is not a failing spec.

The hazard is "a spec that can never run, added silently". This checks exactly that,
and nothing else.

The discriminator
-----------------
A skip that is *gated* carries a reason:

    test.skip(!process.env.TEST_USER_EMAIL, 'TEST_USER_EMAIL not set');

A skip that is *hard-coded* cannot carry one — neither `test.describe.skip(title, fn)`
nor `test.skip(title, fn)` has anywhere to put it:

    test.describe.skip('Personal Information — Onboarding flow', () => { ... });

So `annotation.type == "skip"` with no `description` is the signature of an
unconditional skip, and it is the thing to gate on. Note this is keyed on the
**hazard** and not on a count: pinning "there must be exactly N skips" would go red
every time a credential-gated band legitimately grows or shrinks, which is precisely
what WIC-2122 is expected to do when the `E2E_TEST_USER*` secrets land. The count is
reported for visibility; only the unconditional set is enforced.

⚠️ Count annotations, never `status`. In `--list` mode Playwright reports **every**
spec as `status: "skipped"`, so a status-based count returns 177/177 and means nothing.

A runtime `test.skip()` called inside a test body (there is one, in
`personal-info.spec.ts`, for an optional back button) is invisible here: it only
annotates when the test actually executes, and `--list` never executes anything. That
is the correct behaviour — such a skip is conditional by construction.

Usage
-----
    python3 scripts/e2e-skip-floor-check.py              # shells out to playwright --list
    python3 scripts/e2e-skip-floor-check.py --json f.json  # grade a saved --list report
    python3 scripts/e2e-skip-floor-check.py --selftest     # offline fixtures, no playwright
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Unset so the credential-gated bands report as skipped rather than as runnable. The
# check does not depend on this — a gated skip carries a reason either way, and an
# unrun gated spec carries no annotation at all — but clearing them makes the
# *reported* counts reproducible between a developer's shell and CI.
CREDENTIAL_VARS = (
    "TEST_USER_EMAIL",
    "TEST_USER_PASSWORD",
    "TEST_USER2_EMAIL",
    "TEST_USER2_PASSWORD",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
)


def iter_specs(report: dict):
    """Yield (file, spec) over Playwright's nested suite tree."""

    def walk(suite: dict, file: str):
        file = suite.get("file") or file
        for spec in suite.get("specs", []):
            yield file, spec
        for child in suite.get("suites", []):
            yield from walk(child, file)

    for suite in report.get("suites", []):
        yield from walk(suite, suite.get("file", "<unknown>"))


def classify(report: dict):
    """Split every skip-annotated spec into (gated, unconditional)."""
    gated, unconditional = [], []
    total = 0
    for file, spec in iter_specs(report):
        total += 1
        skips = [
            ann
            for test in spec.get("tests", [])
            for ann in test.get("annotations", [])
            if ann.get("type") == "skip"
        ]
        if not skips:
            continue
        entry = (file, spec.get("title", "<untitled>"))
        # Any reason at all makes it gated; a hard-coded skip can carry none.
        if any((ann.get("description") or "").strip() for ann in skips):
            gated.append(entry)
        else:
            unconditional.append(entry)
    return total, gated, unconditional


def run_playwright_list() -> dict:
    env = {k: v for k, v in os.environ.items() if k not in CREDENTIAL_VARS}
    proc = subprocess.run(
        ["npx", "playwright", "test", "--list", "--reporter=json"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        sys.stderr.write(
            "Could not parse `playwright test --list --reporter=json` output.\n"
            f"exit={proc.returncode}\n--- stdout (first 2000) ---\n{proc.stdout[:2000]}\n"
            f"--- stderr (first 2000) ---\n{proc.stderr[:2000]}\n"
        )
        raise SystemExit(2)


def grade(report: dict) -> int:
    total, gated, unconditional = classify(report)

    by_file: dict[str, int] = {}
    for file, _ in gated:
        by_file[file] = by_file.get(file, 0) + 1

    print(f"e2e specs discovered:        {total}")
    print(f"credential-gated skips:      {len(gated)}")
    for file, n in sorted(by_file.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"    {n:3d}  {file}")
    print(f"unconditional skips:         {len(unconditional)}")

    if not unconditional:
        print("\nOK — every skipped spec is gated on a condition and says why.")
        return 0

    print("\nFAIL — these specs can never run, under any credential or environment:")
    for file, title in unconditional:
        print(f"    {file} :: {title}")
    print(
        "\nA hard-coded `test.skip(...)` / `test.describe.skip(...)` is not a way to park\n"
        "work — it is a spec that reads as covered forever. Either fix it and drop the\n"
        "`.skip`, or delete it so the suite's spec count stops overstating coverage.\n"
        "If it is genuinely blocked on something, gate it on that condition with a reason\n"
        "string so the block is visible here, and file a card for it (WIC-2124)."
    )
    return 1


# ─── selftest ────────────────────────────────────────────────────────────────
# Fixtures rather than live parsing, so the grader is exercised offline in ~0s and
# a green run proves the FAIL path fires — not merely that the OK path is reachable.

_GATED = {
    "suites": [
        {
            "file": "auth.spec.ts",
            "specs": [
                {
                    "title": "logs in",
                    "tests": [
                        {
                            "annotations": [
                                {"type": "skip", "description": "TEST_USER_EMAIL not set"}
                            ]
                        }
                    ],
                }
            ],
        }
    ]
}

_UNCONDITIONAL = {
    "suites": [
        {
            "file": "personal-info.spec.ts",
            "suites": [
                {
                    "specs": [
                        {
                            "title": "renders the form",
                            "tests": [{"annotations": [{"type": "skip"}]}],
                        }
                    ]
                }
            ],
            "specs": [],
        }
    ]
}

_EMPTY_REASON = {
    "suites": [
        {
            "file": "x.spec.ts",
            "specs": [
                {
                    "title": "whitespace reason is not a reason",
                    "tests": [{"annotations": [{"type": "skip", "description": "   "}]}],
                }
            ],
        }
    ]
}

_CLEAN = {
    "suites": [
        {
            "file": "x.spec.ts",
            "specs": [{"title": "runs", "tests": [{"annotations": []}]}],
        }
    ]
}


def selftest() -> int:
    cases = [
        ("no skips at all", _CLEAN, 0, 0, 0),
        ("gated skip passes", _GATED, 0, 1, 0),
        ("nested unconditional skip fails", _UNCONDITIONAL, 1, 0, 1),
        ("whitespace-only reason counts as unconditional", _EMPTY_REASON, 1, 0, 1),
    ]
    failures = []
    for name, report, want_rc, want_gated, want_uncond in cases:
        _, gated, uncond = classify(report)
        rc = 1 if uncond else 0
        got = (rc, len(gated), len(uncond))
        want = (want_rc, want_gated, want_uncond)
        status = "ok  " if got == want else "FAIL"
        if got != want:
            failures.append(name)
        print(f"  [{status}] {name}: got {got}, want {want}")

    # The nesting arm matters on its own: `iter_specs` must descend into
    # `suites[].suites[]`, because every `test.describe` block becomes a nested
    # suite. A walker that only reads the top level reports zero skips and grades
    # this whole check green on the exact file it was written for.
    _, _, nested = classify(_UNCONDITIONAL)
    if len(nested) != 1:
        failures.append("nested-suite descent")
        print("  [FAIL] walker did not descend into nested suites")

    if failures:
        print(f"\nselftest FAILED: {', '.join(failures)}")
        return 1
    print("\nselftest OK")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", type=Path, help="grade a saved `--list --reporter=json` report")
    ap.add_argument("--selftest", action="store_true", help="run offline fixtures and exit")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    report = json.loads(args.json.read_text()) if args.json else run_playwright_list()
    return grade(report)


if __name__ == "__main__":
    raise SystemExit(main())
