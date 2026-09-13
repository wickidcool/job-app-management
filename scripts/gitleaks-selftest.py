#!/usr/bin/env python3
"""Positive-control selftest for .gitleaks.toml (WIC-2243, extended WIC-2367).

WHY THIS EXISTS
---------------
An allowlist entry that suppresses a false positive is byte-indistinguishable, in
the audit's own output, from an allowlist entry that disarms the rule outright.
Both show up as "findings went down". The full-history audit therefore cannot tell
you whether `pc-db-connection-string` still catches anything -- a green run is
consistent with the rule being dead.

This asserts both directions against a synthetic corpus:
  * MUST_CATCH  -- routable hosts / real-shaped secrets. A miss means a rule is disarmed.
  * MUST_ALLOW  -- provably non-routable hosts (RFC 5735 loopback, RFC 2606
                   reserved names) or structural placeholders. A hit is the
                   false-positive class that turned the audit permanently red.

The tightest pair is deliberate: `...supabase.com` must be caught and
`...supabase.invalid` must not. They differ by one TLD, so an allowlist that is
even slightly too broad fails this test.

THE CORPUS IS ASSEMBLED AT RUNTIME, NEVER WRITTEN AS A LITERAL.
The rule matches `scheme://user:pass@host` contiguously. If this file contained
whole connection strings, the full-history scan would flag *this file* forever --
the selftest would break the very audit it protects. Splitting each string at
`://` keeps the committed bytes inert while the assembled value is a faithful
test input. Do not "clean this up" by inlining the strings.

Similarly for JWTs (WIC-2367): the header segment is public metadata, and the
synthetic payload + all-zero fake signature are inert by construction.  The
three segments are kept as separate constants so no 3-part JWT literal is ever
committed; they are joined at runtime to form a valid-looking test input.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

SEP = "://"

# ── pc-db-connection-string ──────────────────────────────────────────────────

# (label, scheme, remainder-after-scheme-separator)
DB_MUST_CATCH = [
    ("routable vendor host", "postgres", "realuser:s3cr3tPassw0rd@db.prod.acmecorp.io:5432/app"),
    ("real supabase pooler", "postgres", "u:p@aws-1-us-west-2.pooler.supabase.com:6543/postgres"),
    ("RFC1918 private host", "postgresql", "admin:hunter2hunter2@10.0.0.5:5432/main"),
    ("mongodb+srv cluster", "mongodb+srv", "root:Tr0ub4dor@cluster0.abcd.mongodb.net/db"),
    # Rev 6.1 (WIC-2367): adversarial cases for the Rev 6 allowlist additions.
    #
    # WHY THESE EXIST: Rev 6 shipped a SCREAMING_CASE rule that suppressed any
    # userinfo *containing* a 4+ char uppercase run, and a dotless-host rule that
    # suppressed every single-label hostname. Both passed the then-current 12/12
    # corpus -- because not one MUST_CATCH password happened to contain an
    # uppercase run, and not one used an internal host. The corpus, not the
    # reasoning, was the gap. Measured: the SCREAMING_CASE form swallowed 67.6%
    # of random 24-char alphanumeric passwords.
    #
    # Keep at least one MUST_CATCH per allowlist entry, shaped like the thing the
    # entry is meant to allow but with a REAL secret in it.
    ("real pw w/ embedded uppercase run", "postgresql",
     "postgres.fnmuvgnkxdeupprcyvdt:Xk7PQRSTuvw2ndL@aws-1-us-west-2.pooler.supabase.com:6543/postgres"),
    ("real pw, leading uppercase run", "postgres",
     "admin:SECRETKEY9f2a@db.internal.acmecorp.org:5432/app"),
    ("real pw on dotless internal host", "postgresql",
     "svc_user:aB3xQRSTuvWX9z@prod-db"),
    ("real pw containing 'xxx' substring", "postgres",
     "svc:Rxxxq7ZmNt4w@db.prod.acmecorp.io:5432/app"),
]

DB_MUST_ALLOW = [
    # Pre-existing (WIC-2243)
    ("hyperdrive localConnectionString", "postgresql", "postgres:postgres@localhost:5432/postgres"),
    ("RFC2606 .invalid test fixture", "postgres", "u:p@aws-1-us-west-2.pooler.supabase.invalid:6543/app"),
    ("loopback literal", "postgres", "user:pass@127.0.0.1:5432/db"),
    ("RFC2606 example.com", "postgres", "user:pass@db.example.com:5432/db"),
    ("RFC2606 .test TLD", "postgres", "user:pass@svc.internal.test:5432/db"),
    # Rev 6 additions (WIC-2367): structural placeholder patterns in userinfo
    ("SCREAMING_CASE placeholder password", "postgresql",
     "postgres.PROJECT:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres"),
    ("bare 'password' word in userinfo", "postgresql",
     "user:password@db.prod.acmecorp.io:5432/mydb"),
    ("short x-run placeholder (xxx)", "postgres",
     "postgres.xxx:mypass@aws-0-us-west-1.pooler.supabase.com:6543/postgres"),
    # Rev 6 additions (WIC-2367): dotless single-label hostname (Docker / local alias)
    ("dotless Docker service alias", "postgresql",
     "careerpin:careerpin@db:5432/careerpin"),
    ("single-label host no port", "postgresql",
     "user:password@dbhost/mydb"),
]

DB_RULE_ID = "pc-db-connection-string"

# ── generic-api-key: JWT positive control (WIC-2367) ─────────────────────────
#
# A real-shaped HS256 JWT has three base64url segments joined by dots:
#   header.payload.signature
# The header segment below decodes to {"alg":"HS256","typ":"JWT"} — public
# metadata, not a secret. The payload is synthetic {"role":"anon"} — not
# secret. The signature is all-zero bytes encoded in base64url — explicitly
# fake, never a real HMAC output. None of the three segments is a credential
# in isolation, so splitting them here keeps this file inert under the
# full-history audit while the runtime-assembled string is a faithful
# generic-api-key test input.
_JWT_H = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"   # {"alg":"HS256","typ":"JWT"}
_JWT_P = "eyJyb2xlIjoiYW5vbiJ9"                     # {"role":"anon"}
_JWT_S = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"  # fake / all-zero signature
_JWT_KW = "SUPABASE_ANON_KEY="

# Assembled at runtime: SUPABASE_ANON_KEY=<header>.<payload>.<signature>
_JWT_REAL = _JWT_KW + ".".join([_JWT_H, _JWT_P, _JWT_S])

# Header-only + literal ellipsis — the docs/architecture false positive (WIC-2367 #1-3)
_JWT_ELLIPSIS = _JWT_KW + _JWT_H + "..."

JWT_MUST_CATCH = [
    ("real-shaped 3-segment HS256 JWT", _JWT_REAL),
]
JWT_MUST_ALLOW = [
    ("JWT header constant + ellipsis (docs placeholder)", _JWT_ELLIPSIS),
]

# The JWT may be caught by either the default "jwt" rule (for 3-segment JWTs)
# or "generic-api-key" (for truncated/keyword-adjacent forms). Both are valid.
JWT_RULE_IDS = {"jwt", "generic-api-key"}


def _run_scan(config: str, corpus_lines: list[str]) -> list[dict]:
    with tempfile.TemporaryDirectory() as scan_dir, tempfile.TemporaryDirectory() as out_dir:
        with open(os.path.join(scan_dir, "corpus.txt"), "w", encoding="utf-8") as fh:
            for line in corpus_lines:
                fh.write(line + "\n")

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
            sys.exit(1)

        with open(report, encoding="utf-8") as fh:
            return json.load(fh)


def main() -> int:
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    config = os.path.join(repo, ".gitleaks.toml")
    if not os.path.exists(config):
        print(f"::error::config not found: {config}")
        return 1

    failures: list[str] = []

    # ── pc-db-connection-string ───────────────────────────────────────────────
    db_cases = [(lbl, s + SEP + rest, True) for lbl, s, rest in DB_MUST_CATCH]
    db_cases += [(lbl, s + SEP + rest, False) for lbl, s, rest in DB_MUST_ALLOW]
    db_corpus = [v for _, v, _ in db_cases]

    db_findings = _run_scan(config, db_corpus)
    db_flagged = {f["StartLine"] for f in db_findings if f["RuleID"] == DB_RULE_ID}
    db_other = sorted({f["RuleID"] for f in db_findings if f["RuleID"] != DB_RULE_ID})

    for idx, (label, _value, should_catch) in enumerate(db_cases, start=1):
        caught = idx in db_flagged
        if should_catch and not caught:
            failures.append(f"DISARMED: {DB_RULE_ID} no longer catches {label!r}")
        elif not should_catch and caught:
            failures.append(f"FALSE POSITIVE: {DB_RULE_ID} flags non-routable/placeholder {label!r}")

    print(f"{DB_RULE_ID} selftest: {len(DB_MUST_CATCH)} must-catch, {len(DB_MUST_ALLOW)} must-allow")
    if db_other:
        print(f"note: other rules also fired on db corpus (not asserted): {', '.join(db_other)}")

    # ── generic-api-key: JWT ─────────────────────────────────────────────────
    jwt_cases = [(lbl, v, True) for lbl, v in JWT_MUST_CATCH]
    jwt_cases += [(lbl, v, False) for lbl, v in JWT_MUST_ALLOW]
    jwt_corpus = [v for _, v, _ in jwt_cases]

    jwt_findings = _run_scan(config, jwt_corpus)
    jwt_flagged = {f["StartLine"] for f in jwt_findings if f["RuleID"] in JWT_RULE_IDS}
    jwt_rules_fired = sorted({f["RuleID"] for f in jwt_findings if f["RuleID"] in JWT_RULE_IDS})

    for idx, (label, _value, should_catch) in enumerate(jwt_cases, start=1):
        caught = idx in jwt_flagged
        if should_catch and not caught:
            failures.append(f"DISARMED: jwt/generic-api-key no longer catches {label!r}")
        elif not should_catch and caught:
            failures.append(f"FALSE POSITIVE: jwt/generic-api-key flags structural placeholder {label!r}")

    print(f"JWT selftest ({', '.join(jwt_rules_fired) or 'no rules fired'}): "
          f"{len(JWT_MUST_CATCH)} must-catch, {len(JWT_MUST_ALLOW)} must-allow")

    if failures:
        for f in failures:
            print(f"::error::{f}")
        return 1

    print("OK: all rules are armed and quiet on structural placeholders.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
