#!/usr/bin/env python3
"""Positive-control selftest for .gitleaks.toml (WIC-2243).

WHY THIS EXISTS
---------------
An allowlist entry that suppresses a false positive is byte-indistinguishable, in
the audit's own output, from an allowlist entry that disarms the rule outright.
Both show up as "findings went down". The full-history audit therefore cannot tell
you whether `pc-db-connection-string` still catches anything -- a green run is
consistent with the rule being dead.

This asserts both directions against a synthetic corpus:
  * MUST_CATCH  -- routable hosts. A miss here means the rule is disarmed.
  * MUST_ALLOW  -- provably non-routable hosts (RFC 5735 loopback, RFC 2606
                   reserved names). A hit here is the false-positive class that
                   turned the audit permanently red on 2026-09-06.

The tightest pair is deliberate: `...supabase.com` must be caught and
`...supabase.invalid` must not. They differ by one TLD, so an allowlist that is
even slightly too broad fails this test.

THE CORPUS IS ASSEMBLED AT RUNTIME, NEVER WRITTEN AS A LITERAL.
The rule matches `scheme://user:pass@host` contiguously. If this file contained
whole connection strings, the full-history scan would flag *this file* forever --
the selftest would break the very audit it protects. Splitting each string at
`://` keeps the committed bytes inert while the assembled value is a faithful
test input. Do not "clean this up" by inlining the strings.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

SEP = "://"

# (label, scheme, remainder-after-scheme-separator)
MUST_CATCH = [
    ("routable vendor host", "postgres", "realuser:s3cr3tPassw0rd@db.prod.acmecorp.io:5432/app"),
    ("real supabase pooler", "postgres", "u:p@aws-1-us-west-2.pooler.supabase.com:6543/postgres"),
    ("RFC1918 private host", "postgresql", "admin:hunter2hunter2@10.0.0.5:5432/main"),
    ("mongodb+srv cluster", "mongodb+srv", "root:Tr0ub4dor@cluster0.abcd.mongodb.net/db"),
]

MUST_ALLOW = [
    ("hyperdrive localConnectionString", "postgresql", "postgres:postgres@localhost:5432/postgres"),
    ("RFC2606 .invalid test fixture", "postgres", "u:p@aws-1-us-west-2.pooler.supabase.invalid:6543/app"),
    ("loopback literal", "postgres", "user:pass@127.0.0.1:5432/db"),
    ("RFC2606 example.com", "postgres", "user:pass@db.example.com:5432/db"),
    ("RFC2606 .test TLD", "postgres", "user:pass@svc.internal.test:5432/db"),
]

RULE_ID = "pc-db-connection-string"


def main() -> int:
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    config = os.path.join(repo, ".gitleaks.toml")
    if not os.path.exists(config):
        print(f"::error::config not found: {config}")
        return 1

    cases = [(lbl, s + SEP + rest, True) for lbl, s, rest in MUST_CATCH]
    cases += [(lbl, s + SEP + rest, False) for lbl, s, rest in MUST_ALLOW]

    # Scan directory and report path are both outside the repo: a report written
    # into the scanned tree gets re-scanned on the next run and corrupts the count.
    with tempfile.TemporaryDirectory() as scan_dir, tempfile.TemporaryDirectory() as out_dir:
        with open(os.path.join(scan_dir, "corpus.txt"), "w", encoding="utf-8") as fh:
            for _, value, _ in cases:
                fh.write(value + "\n")

        report = os.path.join(out_dir, "selftest.json")
        proc = subprocess.run(
            [
                "gitleaks", "dir", scan_dir,
                "--config", config,
                "--report-path", report,
                "--report-format", "json",
                "--no-banner",
                "--exit-code", "0",
            ],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            print(f"::error::gitleaks failed to run (exit {proc.returncode})")
            print(proc.stderr.strip())
            return 1

        with open(report, encoding="utf-8") as fh:
            findings = json.load(fh)

    # Line numbers are 1-based and match corpus write order.
    flagged = {f["StartLine"] for f in findings if f["RuleID"] == RULE_ID}
    other = sorted({f["RuleID"] for f in findings if f["RuleID"] != RULE_ID})

    failures = []
    for idx, (label, _value, should_catch) in enumerate(cases, start=1):
        caught = idx in flagged
        if should_catch and not caught:
            failures.append(f"DISARMED: {RULE_ID} no longer catches {label!r}")
        elif not should_catch and caught:
            failures.append(f"FALSE POSITIVE: {RULE_ID} flags non-routable {label!r}")

    print(f"{RULE_ID} selftest: {len(MUST_CATCH)} must-catch, {len(MUST_ALLOW)} must-allow")
    if other:
        print(f"note: other rules also fired on the corpus (not asserted): {', '.join(other)}")

    if failures:
        for f in failures:
            print(f"::error::{f}")
        return 1

    print("OK: rule is armed against routable hosts and quiet on reserved ones.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
