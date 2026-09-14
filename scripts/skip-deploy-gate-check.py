#!/usr/bin/env python3
"""WIC-2386: assert the `[skip deploy]` gate reads the commit SUBJECT, not the body.

`deploy.yml` used to gate `deploy-production` (and `e2e-tests`) on

    !contains(github.event.head_commit.message, '[skip deploy]')

`head_commit.message` is SUBJECT + BODY. A squash merge builds the body from one
bullet per branch commit, so a `[skip deploy]` left on any WIP commit suppressed
the whole PR's production deploy — silently, behind a clean subject line.

That is not hypothetical. `6ce89e8f` (PR #499) is the `/api/auth/me` fix for a bug
that killed every session on page load, and it sat undeployed for days because a
squashed sub-commit carried the marker. Its subject never did.

The repo's convention is that the SUBJECT is the intentional location (see
`1bd96ddb`, which says so in its own message). The gate now matches the convention:
`lint-and-test` resolves the marker from the subject and publishes `skip_deploy`,
and the two gated jobs consume that output.

This guard fails if anyone reintroduces a whole-message read. Pure stdlib, no
network, ~20ms.

Usage:
    python3 scripts/skip-deploy-gate-check.py [--selftest]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEPLOY_YML = REPO_ROOT / ".github" / "workflows" / "deploy.yml"

MARKER = "[skip deploy]"

# The banned construct: any expression that tests the FULL commit message for the
# marker. Whitespace-tolerant so a reformat cannot sneak it back in.
BANNED = re.compile(
    r"contains\s*\(\s*github\.event\.head_commit\.message\s*,\s*['\"]\[skip deploy\]['\"]\s*\)"
)

# What the gate must look like instead.
GATE_STEP_ID = "skip-deploy-gate"
GATE_OUTPUT = "needs.lint-and-test.outputs.skip_deploy"

# Jobs that must consume the resolved output rather than reading the raw message.
GATED_JOBS = ("e2e-tests", "deploy-production")


def subject_of(message: str) -> str:
    """Mirror of the workflow step: the marker decision reads line 1 only."""
    return message.split("\n", 1)[0]


def skip_deploy(message: str) -> bool:
    """Mirror of the workflow step's shell logic, for the selftest."""
    return MARKER in subject_of(message)


def selftest() -> int:
    """Behavioural cases drawn from real commits on `main`."""
    cases = [
        # (message, expected_skip, description)
        (
            "fix(WIC-2384): refuse an API request with no auth token (#500) [skip deploy]\n"
            "\nLanded ZERO-DEPLOY deliberately.",
            True,
            "1bd96ddb: deliberate marker in SUBJECT is honoured",
        ),
        (
            "fix(WIC-2383): /auth/me called a GoTrue admin endpoint with the anon key (#499)\n"
            "\n* fix(WIC-2383): /auth/me called a GoTrue admin endpoint [skip deploy]\n"
            "\n* test(WIC-2383): fixture anon key [skip deploy]",
            False,
            "6ce89e8f: marker inherited from squashed WIP bodies no longer suppresses",
        ),
        (
            "ci(WIC-2386): name the commit that suppressed the deploy [skip deploy] (#501)\n"
            "\nBody mentions [skip deploy] too.",
            True,
            "ddeb8325: subject marker wins even when the body repeats it",
        ),
        (
            "Merge pull request #491 from wickidcool/docs/wic2321-offset-efficacy",
            False,
            "35eaabc7: an unmarked merge deploys",
        ),
        (
            "",
            False,
            "pull_request / workflow_dispatch: head_commit is absent, never skip-gated",
        ),
        (
            "docs: explain the [skip deploy] marker in CONTRIBUTING",
            True,
            "a literal marker in the subject is still a marker, even in prose",
        ),
        (
            "fix: something\n\n[skip deploy]",
            False,
            "marker alone on a body line does not suppress",
        ),
    ]

    failures = 0
    for message, expected, description in cases:
        actual = skip_deploy(message)
        if actual != expected:
            failures += 1
            print(
                f"FAIL  expected skip_deploy={expected}, got {actual}: {description}",
                file=sys.stderr,
            )
        else:
            print(f"ok    skip_deploy={str(actual).lower():5s} {description}")

    if failures:
        print(f"\n{failures} selftest case(s) failed.", file=sys.stderr)
        return 1
    print(f"\nAll {len(cases)} selftest cases passed.")
    return 0


def check() -> int:
    if not DEPLOY_YML.exists():
        print(f"FAIL  {DEPLOY_YML} not found.", file=sys.stderr)
        return 1

    text = DEPLOY_YML.read_text(encoding="utf-8")
    problems: list[str] = []

    banned_hits = [
        (text[: m.start()].count("\n") + 1, m.group(0)) for m in BANNED.finditer(text)
    ]
    for line_no, snippet in banned_hits:
        problems.append(
            f"{DEPLOY_YML.relative_to(REPO_ROOT)}:{line_no}: reads the FULL commit "
            f"message for '{MARKER}' -- {snippet}\n"
            f"        `head_commit.message` is SUBJECT + BODY, so a squashed WIP commit "
            f"carrying the marker silently suppresses production deploys.\n"
            f"        Consume `{GATE_OUTPUT}` instead."
        )

    if f"id: {GATE_STEP_ID}" not in text:
        problems.append(
            f"the `{GATE_STEP_ID}` step is missing from "
            f"{DEPLOY_YML.relative_to(REPO_ROOT)} -- nothing resolves the marker."
        )

    if f"skip_deploy: ${{{{ steps.{GATE_STEP_ID}.outputs.skip_deploy }}}}" not in text:
        problems.append(
            "`lint-and-test` does not publish a `skip_deploy` output from the "
            f"`{GATE_STEP_ID}` step -- the gated jobs have nothing to read."
        )

    # Each gated job must reference the resolved output.
    for job in GATED_JOBS:
        job_start = text.find(f"\n  {job}:\n")
        if job_start == -1:
            problems.append(f"job `{job}` not found in deploy.yml.")
            continue
        # Slice to the next top-level job, or EOF.
        next_job = re.search(r"\n  [A-Za-z0-9_-]+:\n", text[job_start + 1 :])
        job_end = job_start + 1 + next_job.start() if next_job else len(text)
        body = text[job_start:job_end]
        if GATE_OUTPUT not in body:
            problems.append(
                f"job `{job}` does not consume `{GATE_OUTPUT}` -- its "
                f"`{MARKER}` gate is not wired to the subject-only resolver."
            )

    if problems:
        print("skip-deploy gate check FAILED:\n", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print(
            "\nSee scripts/skip-deploy-gate-check.py and WIC-2386 for why this matters.",
            file=sys.stderr,
        )
        return 1

    print(
        f"skip-deploy gate OK: marker resolved from the commit subject by "
        f"`{GATE_STEP_ID}`; {', '.join(GATED_JOBS)} consume `{GATE_OUTPUT}`."
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--selftest",
        action="store_true",
        help="run the behavioural cases for the subject-only decision",
    )
    args = parser.parse_args()
    return selftest() if args.selftest else check()


if __name__ == "__main__":
    sys.exit(main())
