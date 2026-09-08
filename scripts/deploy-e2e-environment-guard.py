#!/usr/bin/env python3
"""Fail the build if the `e2e-tests` job in deploy.yml declares an `environment:` key.

Why this exists (WIC-2262, enforcing WIC-2204 / WIC-2201)
---------------------------------------------------------
Adding `environment: dev` to the `e2e-tests` job in `.github/workflows/deploy.yml`
has broken production deploys twice. The `dev`-scoped `E2E_TEST_USER*` secrets only
resolve in a job that *names* the environment, so naming it wakes ~29 credential-gated
Playwright specs that assume a running backend CI never starts. They time out, the job
blows its `timeout-minutes: 15`, and because `deploy-production` declares
`needs: [lint-and-test, e2e-tests]`, a cancelled `e2e-tests` SKIPS the deploy — `main`
then silently ships nothing. Measured on run 34052242328 (e2e-tests cancelled at 15m14s,
deploy-production skipped) and reverted in PR #446 (`f1c0127`).

WIC-2204 is the standing ruling: **do NOT re-add `environment: dev` to `e2e-tests`.**
`deploy.yml` already carries an in-file warning comment (WIC-2201), but a comment is
advisory: it did not stop `2a9482a7` from adding the key the first time, and a granted
board approval (`559bd043`) whose payload is exactly this change has been sitting on the
queue. This guard makes the ruling mechanical — the change cannot reach `main` green.

Isolation coverage is enabled the SAFE way instead: an in-job backend on the separate
`e2e-isolation-coverage` job, which is NOT in `deploy-production.needs` (WIC-2122
route 2). That job legitimately declares `environment: dev`, so this guard is deliberately
NARROW — it asserts only on `jobs['e2e-tests']` and ignores every other job.

Why parse YAML and not grep (WIC-2262)
--------------------------------------
Five lines on `main` contain the literal string `environment: dev` and three of them are
prose (a guard comment, another guard comment, and text inside an `echo`). Only two are
real keys — on `e2e-isolation-coverage` and `deploy-preview` — and both must STAY. A grep
guard red-lines `main` on day one and gets disabled. So this parses the document with
PyYAML and asserts on the job structure, exactly the check the card specified:

    d = yaml.safe_load(open(".github/workflows/deploy.yml"))
    assert "environment" not in d["jobs"]["e2e-tests"]

YAML 1.1 gotcha, noted for anyone who widens this: the top-level `on:` key parses as the
boolean `True`, not the string "on". It does not touch `jobs`, so the check above is safe
as written; do not rewrite it to iterate top-level keys without accounting for that.

Usage
-----
    python3 scripts/deploy-e2e-environment-guard.py            # check the live deploy.yml
    python3 scripts/deploy-e2e-environment-guard.py --selftest # grade offline fixtures
    python3 scripts/deploy-e2e-environment-guard.py --file X   # check an arbitrary file
"""
import sys

try:
    import yaml
except ImportError:  # pragma: no cover - the workflow installs PyYAML before running.
    print("deploy-e2e-environment-guard: PyYAML is required "
          "(`python3 -m pip install pyyaml`).", file=sys.stderr)
    raise SystemExit(2)

WORKFLOW = ".github/workflows/deploy.yml"
GUARDED_JOB = "e2e-tests"


def evaluate(text):
    """Return (found_job: bool, has_environment: bool) for the guarded job.

    Pure structural read of a parsed workflow document. `has_environment` is True
    iff the `e2e-tests` job declares a job-level `environment:` key (in either the
    `environment: dev` scalar form or the `environment:\\n  name: dev` mapping form —
    PyYAML normalises both to a present key).
    """
    doc = yaml.safe_load(text)
    if not isinstance(doc, dict):
        return False, False
    jobs = doc.get("jobs")
    if not isinstance(jobs, dict):
        return False, False
    job = jobs.get(GUARDED_JOB)
    if not isinstance(job, dict):
        return False, False
    return True, ("environment" in job)


# ---------------------------------------------------------------------------
# Fixtures. Kept inline so the self-test needs no on-disk fixtures and runs on
# every CI trigger — a green self-test is the load-bearing evidence that the
# guard actually flags the change it exists to catch, per changelog-union-guard.
# ---------------------------------------------------------------------------
GOOD = """\
name: Deploy
on: [push]
jobs:
  lint-and-test:
    runs-on: ubuntu-latest
  e2e-tests:
    name: E2E Tests
    needs: lint-and-test
    # WIC-2201: this job deliberately has NO environment: dev.
    timeout-minutes: 15
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:e2e
  e2e-isolation-coverage:
    environment: dev
    runs-on: ubuntu-latest
  deploy-preview:
    environment: dev
    runs-on: ubuntu-latest
  deploy-production:
    environment: production
    needs: [lint-and-test, e2e-tests]
"""

BAD_INLINE = """\
name: Deploy
on: [push]
jobs:
  e2e-tests:
    name: E2E Tests
    environment: dev
    runs-on: ubuntu-latest
"""

BAD_BLOCK = """\
name: Deploy
on: [push]
jobs:
  e2e-tests:
    name: E2E Tests
    environment:
      name: dev
    runs-on: ubuntu-latest
"""

GOOD_COMMENTED = """\
name: Deploy
on: [push]
jobs:
  e2e-tests:
    name: E2E Tests
    # do not add environment: dev here
    runs-on: ubuntu-latest
  deploy-preview:
    environment: dev
    runs-on: ubuntu-latest
"""

MISSING_JOB = """\
name: Deploy
on: [push]
jobs:
  lint-and-test:
    runs-on: ubuntu-latest
  deploy-production:
    environment: production
    runs-on: ubuntu-latest
"""


def selftest():
    # (label, text, expected (found_job, has_env), overall verdict the live check renders)
    cases = [
        ("GOOD (no env on e2e-tests, env elsewhere)", GOOD, (True, False), True),
        ("BAD inline environment: dev", BAD_INLINE, (True, True), False),
        ("BAD block environment:/ name: dev", BAD_BLOCK, (True, True), False),
        ("GOOD env only in a comment", GOOD_COMMENTED, (True, False), True),
        ("MISSING e2e-tests job (rename evasion)", MISSING_JOB, (False, False), False),
    ]
    ok = True
    for label, text, expected, should_pass in cases:
        got = evaluate(text)
        found_job, has_env = got
        verdict_pass = found_job and not has_env
        if got != expected or verdict_pass != should_pass:
            ok = False
            print(f"  FAIL {label}: got {got}, expected {expected} "
                  f"(verdict_pass={verdict_pass}, want {should_pass})")
        else:
            print(f"  ok   {label}")
    return ok


def check_file(path):
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError as exc:
        print(f"deploy-e2e-environment-guard: cannot read {path}: {exc}", file=sys.stderr)
        return 2
    try:
        found_job, has_env = evaluate(text)
    except yaml.YAMLError as exc:
        print(f"deploy-e2e-environment-guard: FAIL — {path} is not valid YAML: {exc}",
              file=sys.stderr)
        return 1
    if not found_job:
        print(f"deploy-e2e-environment-guard: FAIL — job '{GUARDED_JOB}' not found in "
              f"{path}. The guard's target moved; a rename must be reviewed against "
              f"WIC-2204 before this guard is adjusted (do not just retarget it).",
              file=sys.stderr)
        return 1
    if has_env:
        print(f"deploy-e2e-environment-guard: FAIL — the '{GUARDED_JOB}' job in {path} "
              f"declares an 'environment:' key. This re-breaks production deploys "
              f"(WIC-2201 / WIC-2204): the dev-scoped E2E_TEST_USER* secrets resolve, "
              f"wake ~29 backend-dependent specs against a backend CI never starts, the "
              f"job times out, and 'deploy-production' (needs: e2e-tests) is skipped. "
              f"Enable isolation coverage on 'e2e-isolation-coverage' instead "
              f"(WIC-2122 route 2), which is not in deploy-production.needs.",
              file=sys.stderr)
        return 1
    print(f"deploy-e2e-environment-guard: OK — '{GUARDED_JOB}' declares no "
          f"'environment:' key in {path}.")
    return 0


def main(argv):
    if "--selftest" in argv:
        print("deploy-e2e-environment-guard selftest:")
        return 0 if selftest() else 1
    path = WORKFLOW
    if "--file" in argv:
        path = argv[argv.index("--file") + 1]
    return check_file(path)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
