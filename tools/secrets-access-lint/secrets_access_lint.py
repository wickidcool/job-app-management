#!/usr/bin/env python3
"""Secrets-Access content linter — ADR-0001 Addendum A, Layer 2.

Fails when *added* content matches high-signal "how to access live secrets"
indicators, catching the prose-only exposure class (WIC-985) that value-only
secret scanners (gitleaks, Layer 1) do not flag.

Diff-scoped by design: only lines ADDED relative to a base ref are examined, so
already-clean history never perpetually fails and the gate targets new content.

Usage:
    secrets_access_lint.py --base <ref>            # scan added lines vs base (CI/PR)
    secrets_access_lint.py --files a.md b.md       # scan whole files (local/full)
    secrets_access_lint.py --self-test             # run built-in fixtures, exit 0/1

Exit codes: 0 = clean, 1 = policy violation(s), 2 = usage/internal error.
Remediation on failure points at ADR-0001 Addendum A. A waiver requires an
Architect/Librarian-approved PR review (Layer 3), recorded in the PR.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PATTERNS = os.path.join(HERE, "patterns.txt")
REMEDIATION = ("ADR-0001 Addendum A — Prohibition & Detection of Secrets-Access "
               "Documentation. Remove the access-recipe content, or obtain an "
               "Architect/Librarian waiver recorded in PR review (Layer 3).")

# The rule definitions necessarily *contain* the phrasings they match, so the tool
# would flag itself — guaranteed failure in whole-file/empty-tree mode. Exclude only
# the linter's own directory, and keep the list HARD-CODED: a user-editable ignore
# file would be the obvious way for a misbehaving agent to route around the gate.
# Changing this list therefore requires a CODEOWNERS-reviewed change to this file.
SELF_EXCLUDE_PREFIXES = ("tools/secrets-access-lint/",)


def is_excluded(path):
    norm = path.replace("\\", "/").lstrip("./")
    return any(norm.startswith(p) for p in SELF_EXCLUDE_PREFIXES)


def load_rules(path):
    """Return (singles, cooccur) where singles=[(rule,regex)] and
    cooccur={rule: {group: regex}}."""
    singles, cooccur = [], defaultdict(dict)
    with open(path, encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, 1):
            line = raw.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) != 3:
                sys.stderr.write("patterns.txt:%d malformed (want 3 tab fields)\n" % lineno)
                sys.exit(2)
            rule_id, kind, pat = (p.strip() for p in parts)
            try:
                rx = re.compile(pat, re.IGNORECASE)
            except re.error as exc:
                sys.stderr.write("patterns.txt:%d bad regex for %s: %s\n" % (lineno, rule_id, exc))
                sys.exit(2)
            if kind == "single":
                singles.append((rule_id, rx))
            elif kind == "cooccur":
                base, _, group = rule_id.partition("#")
                if not group:
                    sys.stderr.write("patterns.txt:%d cooccur rule needs #GROUP: %s\n" % (lineno, rule_id))
                    sys.exit(2)
                cooccur[base][group] = rx
            else:
                sys.stderr.write("patterns.txt:%d unknown kind %r\n" % (lineno, kind))
                sys.exit(2)
    return singles, cooccur


def _is_commit(ref):
    return subprocess.call(["git", "cat-file", "-e", ref + "^{commit}"],
                           stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL) == 0


def added_lines_by_file(base):
    """Map path -> list of added line strings from the diff vs `base`.

    Uses symmetric diff (`base...HEAD`, i.e. vs the merge base) when `base` is a
    reachable commit — the correct scope for a PR. Falls back to a direct diff
    (`base HEAD`) otherwise, so a tree-ish base such as the empty tree still works;
    the empty tree yields the whole tree as "added", which is fail-closed.
    """
    spec = [base + "...HEAD"] if _is_commit(base) else [base, "HEAD"]
    try:
        diff = subprocess.check_output(
            ["git", "diff", "--no-color", "--unified=0"] + spec,
            text=True, stderr=subprocess.STDOUT)
    except subprocess.CalledProcessError as exc:
        sys.stderr.write("git diff failed (base %r): %s\n" % (base, exc.output))
        sys.exit(2)
    out, cur = defaultdict(list), None
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            cur = line[6:]
        elif line.startswith("+++ "):
            cur = None
        elif line.startswith("+") and not line.startswith("+++") and cur:
            out[cur].append(line[1:])
    return out


def scan(files_lines, singles, cooccur):
    """files_lines: path -> list-of-lines. Return list of (rule_id, message)."""
    violations = []
    for path, lines in sorted(files_lines.items()):
        if is_excluded(path):
            continue
        for rule_id, rx in singles:
            for ln in lines:
                if rx.search(ln):
                    violations.append((rule_id,
                                       "%s: [%s] added line matches access-recipe pattern: %s"
                                       % (path, rule_id, ln.strip()[:120])))
                    break
        blob = "\n".join(lines)
        for base_rule, groups in cooccur.items():
            if all(rx.search(blob) for rx in groups.values()):
                violations.append((base_rule,
                                   "%s: [%s] all co-occurrence groups (%s) present in added content"
                                   % (path, base_rule, ",".join(sorted(groups)))))
    return violations


def report(violations, fmt="text"):
    rules = sorted({rule_id for rule_id, _ in violations})
    if fmt == "json":
        json.dump({"ok": not violations,
                   "rules": rules,
                   "violations": [m for _, m in violations]}, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 1 if violations else 0
    if not violations:
        print("secrets-access-lint: OK (no access-recipe indicators in added content)")
        return 0
    sys.stderr.write("secrets-access-lint: %d violation(s) — build BLOCKED\n\n" % len(violations))
    for _, message in violations:
        sys.stderr.write("  - %s\n" % message)
    sys.stderr.write("\n%s\n" % REMEDIATION)
    return 1


def self_test(patterns_path):
    singles, cooccur = load_rules(patterns_path)
    # positive fixtures — each SHOULD trip at least one rule
    positives = {
        "howto.md": ["This documents how to decrypt the fleet secrets store."],
        "path.md": ["The master decryption key is stored at /var/run/paperclip/master.key"],
        "cooccur.md": ["Load the keyfile at /etc/pc/keystore.key",
                       "then run gpg --decrypt to reveal the value."],
        "enum.md": ["The secret names are: CF_TOKEN, RESEND_KEY, DB_PASS",
                    "all stored in the embedded postgres secrets store."],
    }
    # negative fixtures — legitimate prose that MUST stay clean
    negatives = {
        "ok_process.md": ["A secrets store exists. To get access, file a request via the access-request process."],
        "ok_generic.md": ["We rotated our API keys last week and updated the deployment."],
        # Regression fixture for the self-exclusion (Rev 3 Defect 2): the linter's own
        # rule table contains the phrasings it matches, so without the exclusion every
        # whole-tree / empty-tree-fallback run fails on the tool itself.
        "tools/secrets-access-lint/patterns.txt": [
            "The master decryption key is stored at /var/run/paperclip/master.key",
            "This documents how to decrypt the fleet secrets store.",
        ],
    }
    ok = True
    for name, lines in positives.items():
        if not scan({name: lines}, singles, cooccur):
            ok = False
            sys.stderr.write("SELF-TEST FAIL: expected violation for %s\n" % name)
    for name, lines in negatives.items():
        v = scan({name: lines}, singles, cooccur)
        if v:
            ok = False
            sys.stderr.write("SELF-TEST FAIL: false positive on %s: %s\n" % (name, v))
    print("secrets-access-lint self-test:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main(argv):
    ap = argparse.ArgumentParser(description="Secrets-Access content linter (ADR-0001 Addendum A, Layer 2)")
    ap.add_argument("--base", help="git ref; scan lines added vs this ref (CI/PR mode)")
    ap.add_argument("--files", nargs="*", help="scan whole files (local/full mode)")
    ap.add_argument("--patterns", default=DEFAULT_PATTERNS)
    ap.add_argument("--format", choices=("text", "json"), default="text")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test(args.patterns)

    singles, cooccur = load_rules(args.patterns)
    if args.base:
        files_lines = added_lines_by_file(args.base)
    elif args.files:
        files_lines = {}
        for f in args.files:
            with open(f, encoding="utf-8", errors="replace") as fh:
                files_lines[f] = fh.read().splitlines()
    else:
        ap.error("one of --base, --files, or --self-test is required")
    return report(scan(files_lines, singles, cooccur), args.format)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
