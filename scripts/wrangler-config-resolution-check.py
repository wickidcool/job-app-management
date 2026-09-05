#!/usr/bin/env python3
"""Guard: every wrangler invocation in CI must resolve the repo-root config.

WIC-2107. Pure stdlib. Exit 0 = clean, exit 1 = violation, exit 2 = the scanner
itself could not do its job (treated as failure, never as a pass).

WHAT THIS GUARDS
================

Wrangler picks its config file with a chain of three INDEPENDENT find-up walks,
one per filename, in this order (`findWranglerConfig`, wrangler 4.x, verified in
the shipped bundle at `wrangler-dist/cli.js`):

    file("wrangler.json",  cwd)      # walk cwd -> / looking for wrangler.json
      ?? file("wrangler.jsonc", cwd) # then the whole walk again for .jsonc
      ?? file("wrangler.toml",  cwd) # then the whole walk again for .toml

The consequence is unintuitive and is the entire reason this file exists:

    FILENAME PRECEDENCE IS EVALUATED BEFORE DIRECTORY PROXIMITY.

A `wrangler.jsonc` at ANY ancestor beats a `wrangler.toml` sitting in the cwd
itself, because the `.jsonc` pass runs to completion before the `.toml` pass
starts. Proximity only breaks ties WITHIN a single filename's pass.

So in this repo, `cd packages/api && npx wrangler ...` reads the repo-root
`wrangler.jsonc`, NOT the adjacent `packages/api/wrangler.toml`. That is
measured, not inferred -- CI run 33972023673 logged it verbatim:

    ▲ [WARNING] Processing ../../wrangler.jsonc configuration:
    🌀 Creating the secret for the Worker "jobtrail-preview"

...from a step that declared `working-directory: packages/api`.

WHY IT MATTERS THAT THIS IS GUARDED RATHER THAN JUST DOCUMENTED
---------------------------------------------------------------

The root config maps `--env preview` to Worker `jobtrail-preview`. Until
WIC-2107, `packages/api/wrangler.toml` mapped the SAME `--env preview` to
`jobtrail` -- the PRODUCTION Worker. Nothing resolved that file, so nothing was
broken; but the repo was one filename away from `--env preview` meaning
"production", and the difference was invisible in every diff. Concretely, ANY of
these would have flipped it live:

  1. converting the root config to `wrangler.toml` (the `.toml` pass would then
     find `packages/api/wrangler.toml` FIRST, by proximity);
  2. adding `packages/api/wrangler.json` or `.jsonc` (wins outright);
  3. adding an explicit `--config` to a call site;
  4. a wrangler release changing the resolution order -- and note `wrangler` is
     NOT a declared dependency of this repo, so `npx wrangler` installs whatever
     is latest at run time (4.86.0 in run 33972023673; 4.129.0 a day later).

WIC-2107 removed `packages/api/wrangler.toml` and the `working-directory:
packages/api` line that made it look load-bearing. This check keeps both closed.
It cannot see hazard (4) -- no static check can -- see "LIMITS" below.

THE TWO CHECKS
==============

Check A -- call-site resolution.
    For every wrangler invocation under `.github/workflows`, compute the step's
    effective cwd and assert the config it resolves is the repo-root config.

Check B -- shadowed configs.
    For every wrangler config file in the repo, assert that running wrangler
    from ITS OWN directory resolves THAT file. A config that loses to an
    ancestor is a trap: a human who cd's into that directory and runs `wrangler
    deploy`, which is the obvious thing to do, silently deploys something else
    entirely. `SHADOWED_ALLOWLIST` is a RATCHET -- an entry that stops being
    shadowed, or whose file no longer exists, is a failure, so a fix forces the
    entry out rather than leaving it to rot. It is EMPTY as of WIC-2109, which
    renamed the one entry it carried; the ratchet is what forced that removal.

ANTI-VACUITY
============

A scanner that silently stops matching reports a clean repo, which is the same
output as a healthy one. So the scan self-checks: it asserts it still finds
wrangler call sites in every workflow known to have them, and at least
`MIN_EXPECTED_SITES` overall. Reformat the workflows past the scanner and this
fails loudly instead of going quiet. Any construct that would make the effective
cwd unknowable (a `cd` inside a wrangler run block, a `defaults.run.
working-directory`) is likewise a failure, not a skip -- an unparsed site must
never read as a clean one.

LIMITS (state these before quoting this check as proof of anything)
===================================================================

* It models wrangler's resolution; it does not execute wrangler. If a future
  release reorders the chain, this check keeps asserting the OLD model and stays
  green. The behavioural probe is `npx wrangler deploy --dry-run --env preview`,
  whose "Processing <path> configuration" line names the resolved file; re-run it
  from `packages/api` and from the repo root after any wrangler major bump.
* The find-up is bounded at the repo root. Real wrangler walks to `/`, so a
  stray `~/wrangler.toml` above a developer's checkout can change local
  behaviour in a way this cannot see. In CI the checkout is the boundary.
* It reads workflow files as text. It is not a YAML parser and does not try to
  be one; it is deliberately strict, and bails (exit 2) rather than guessing.
"""

from __future__ import annotations

import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOW_DIR = os.path.join(REPO_ROOT, ".github", "workflows")

# Wrangler's precedence order, highest first. Order is load-bearing -- see the
# module docstring. Keep in sync with `findWranglerConfig`.
CONFIG_FILENAMES = ("wrangler.json", "wrangler.jsonc", "wrangler.toml")

# The one config this repo actually deploys.
ROOT_CONFIG = "wrangler.jsonc"

# Workflows known to invoke wrangler. If one of these stops matching, the
# scanner has drifted and the run fails rather than reporting a clean repo.
EXPECTED_SITE_FILES = {
    "deploy.yml",
    "deploy-marketing.yml",
    "remediate-worker-secret-leak.yml",
    "set-worker-secrets.yml",
}

# Floor on total call sites found, set below the count at the commit that
# introduced this check so ordinary edits do not trip it. Raise it if the true
# count grows a lot; never lower it to make a red run green.
MIN_EXPECTED_SITES = 8

# Configs that lose to an ancestor and are knowingly left that way. RATCHET: an
# entry here that is NOT shadowed is a failure, so fixing one forces its removal.
#   path -> why it is tolerated
#
# EMPTY IS THE CORRECT STATE, AND IT IS THE RATCHET WORKING. The single entry this
# started with -- `packages/infra/redirect-worker/wrangler.toml` -- was retired by
# WIC-2109, which renamed that file to `wrangler.jsonc` so it wins its own directory
# by proximity. The ratchet below forced the removal in the same commit: with the
# file renamed and the entry still present, this check exits 1 on the `no longer
# exists` branch. That was run as a positive control before the entry was deleted.
#
# Do not add an entry here to make a red run green. Renaming the config so it wins
# its own directory is nearly always cheaper than tolerating a shadowed one.
SHADOWED_ALLOWLIST: dict[str, str] = {}

# A wrangler invocation: at a command boundary, or introduced by npx (with any
# number of npx flags), optionally version-pinned, followed by a subcommand.
# Deliberately does NOT match `/tmp/wrangler.log`, `$WRANGLER_EXIT`, or
# `echo "wrangler ..."`.
#
# Two anchoring details are load-bearing, and BOTH were caught by the mutation
# matrix rather than by review -- the `cd`-in-a-run-block mutant graded GREEN
# twice before this comment existed:
#
#   re.MULTILINE -- a `run:` block is a multi-line string, so without it `^`
#   anchors only at the start of the whole block, and every command after the
#   first line has to be caught by the `npx`/pipe alternatives.
#
#   `^[ \t]*` rather than a bare `^` -- run-block lines are kept WITH their YAML
#   indentation, so a bare `^` is immediately followed by ten spaces and can
#   never match a command sitting on its own line. Use `[ \t]*`, not `\s*`:
#   `\s` eats newlines, which would let a match start on one line and land on
#   the next, corrupting the offset the `--config` tail scan depends on.
WRANGLER_CALL_RE = re.compile(
    r"""(?:^[ \t]*|[|;&(][ \t]*|\bnpx\s+(?:--\S+\s+)*)
        wrangler(?:@[\w.^~+-]+)?
        \s+([a-z][\w:-]*)""",
    re.VERBOSE | re.MULTILINE,
)

# A `cd` that would move the cwd out from under a wrangler call in the same
# block. Its presence makes the effective cwd unknowable to a text scan, which
# is a Bail (exit 2), never a pass. Same anchoring rules as above, and they
# matter more here: a `cd` is nearly always alone on its own indented line,
# which is exactly the position a bare `^` cannot see.
CD_RE = re.compile(r"(?:^[ \t]*|[|;&(][ \t]*)cd\s+\S", re.MULTILINE)


class Bail(Exception):
    """The scanner cannot do its job. Never downgrade this to a pass."""


def find_config(start_dir: str) -> str | None:
    """Replicate wrangler's `findWranglerConfig`, bounded at the repo root.

    Three independent find-up walks, one per filename, in precedence order --
    NOT one walk that checks all three names per directory. That distinction is
    the whole point; collapsing it would model a different (and wrong) wrangler.

    Returns a repo-relative path, or None if no config is reachable.
    """
    for name in CONFIG_FILENAMES:
        cur = os.path.abspath(start_dir)
        while True:
            candidate = os.path.join(cur, name)
            if os.path.isfile(candidate):
                return os.path.relpath(candidate, REPO_ROOT)
            if os.path.normpath(cur) == os.path.normpath(REPO_ROOT):
                break
            parent = os.path.dirname(cur)
            if parent == cur:
                break
            cur = parent
    return None


def strip_shell_comments(block: str) -> str:
    """Drop whole-line shell comments so prose about wrangler is not a call."""
    return "\n".join(
        line for line in block.splitlines() if not line.lstrip().startswith("#")
    )


def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def scan_workflow(path: str) -> list[dict]:
    """Return one record per wrangler call site in a workflow file.

    Text-directed, not a YAML parse. Anything ambiguous raises Bail.
    """
    with open(path, "r", encoding="utf-8") as handle:
        lines = handle.read().splitlines()

    rel = os.path.relpath(path, REPO_ROOT)

    # A workflow- or job-level `defaults.run.working-directory` would silently
    # relocate every step. This repo has none; if one appears, the scanner's
    # per-step model is wrong and must be revisited rather than trusted.
    for i, line in enumerate(lines):
        if re.match(r"^\s*working-directory:", line):
            # Legitimate only as a step key; a defaults block puts it under
            # `defaults:` -> `run:`. Walk back to see which context we are in.
            for j in range(i - 1, max(-1, i - 6), -1):
                if re.match(r"^\s*defaults:", lines[j]):
                    raise Bail(
                        f"{rel}:{i + 1}: `working-directory` under a `defaults:` "
                        "block. This scanner models per-step cwd only; teach it "
                        "about defaults before trusting a green run."
                    )

    sites: list[dict] = []
    steps_indent: int | None = None
    step_indent: int | None = None

    cur: dict | None = None
    run_block: list[str] = []
    in_run_block = False
    run_block_indent = 0

    def flush() -> None:
        nonlocal cur, run_block, in_run_block
        if cur is None:
            return
        body = strip_shell_comments("\n".join(run_block))
        uses = cur.get("uses", "")
        is_action = "cloudflare/wrangler-action" in uses
        calls = [m.group(0).strip() for m in WRANGLER_CALL_RE.finditer(body)]

        # An explicit --config bypasses the resolution this check models. Scope
        # the search to the remainder of the wrangler command itself: a naive
        # search over the whole block matches `python3 -c '...'` in the same
        # step and reports two false positives in deploy.yml.
        explicit_config = False
        for match in WRANGLER_CALL_RE.finditer(body):
            tail = body[match.start():].split("\n", 1)[0]
            if re.search(r"\s(?:--config[=\s]|-c\s)", tail):
                explicit_config = True
                break

        if calls or is_action:
            if calls and CD_RE.search(body):
                raise Bail(
                    f"{rel}:{cur['line']}: a `cd` shares a run block with a "
                    "wrangler call, so the effective cwd cannot be determined "
                    "by inspection. Move the wrangler call to its own step with "
                    "an explicit `working-directory`, or teach this scanner."
                )
            sites.append(
                {
                    "file": rel,
                    "line": cur["line"],
                    "name": cur.get("name", "(unnamed step)"),
                    "working_directory": cur.get("working_directory"),
                    "kind": "wrangler-action" if is_action else "run",
                    "calls": calls or ["cloudflare/wrangler-action (command:)"],
                    "explicit_config": explicit_config,
                }
            )
        cur = None
        run_block = []
        in_run_block = False

    for idx, line in enumerate(lines):
        lineno = idx + 1
        stripped = line.strip()

        if re.match(r"^\s*steps:\s*$", line):
            flush()
            steps_indent = indent_of(line)
            step_indent = None
            continue

        if steps_indent is None:
            continue

        cur_indent = indent_of(line)

        # A new step item: `- name:` / `- uses:` / `- run:` just inside `steps:`.
        if stripped.startswith("- ") and cur_indent > steps_indent:
            if step_indent is None:
                step_indent = cur_indent
            if cur_indent == step_indent:
                flush()
                cur = {"line": lineno}
                rest = stripped[2:]
                if ":" in rest:
                    key, _, value = rest.partition(":")
                    key, value = key.strip(), value.strip()
                    if key == "name":
                        cur["name"] = value
                    elif key == "uses":
                        cur["uses"] = value
                    elif key == "run":
                        in_run_block = True
                        run_block_indent = cur_indent + 2
                        if value not in ("|", ">", "|-", ">-", ""):
                            run_block.append(value)
                            in_run_block = False
                    elif key == "working-directory":
                        cur["working_directory"] = value
                continue

        # Dedented out of the steps list entirely (e.g. next job).
        if stripped and step_indent is not None and cur_indent < step_indent:
            flush()
            steps_indent = None
            step_indent = None
            continue

        if cur is None:
            continue

        # Inside a block scalar: consume until the indent drops back.
        if in_run_block:
            if not stripped:
                run_block.append("")
                continue
            if cur_indent >= run_block_indent:
                run_block.append(line)
                continue
            in_run_block = False

        if step_indent is not None and cur_indent == step_indent + 2:
            key, _, value = stripped.partition(":")
            key, value = key.strip(), value.strip()
            if key == "name":
                cur.setdefault("name", value)
            elif key == "uses":
                cur["uses"] = value
            elif key == "working-directory":
                cur["working_directory"] = value
            elif key == "run":
                in_run_block = True
                run_block_indent = cur_indent + 2
                if value not in ("|", ">", "|-", ">-", ""):
                    run_block.append(value)
                    in_run_block = False
        elif cur.get("uses") and "wrangler-action" in cur["uses"]:
            # wrangler-action's own cwd input lives under `with:`.
            if stripped.startswith("workingDirectory:"):
                cur["working_directory"] = stripped.split(":", 1)[1].strip()

    flush()
    return sites


def check_call_sites() -> list[str]:
    problems: list[str] = []
    all_sites: list[dict] = []

    if not os.path.isdir(WORKFLOW_DIR):
        raise Bail(f"{WORKFLOW_DIR} does not exist")

    for entry in sorted(os.listdir(WORKFLOW_DIR)):
        if not entry.endswith((".yml", ".yaml")):
            continue
        all_sites.extend(scan_workflow(os.path.join(WORKFLOW_DIR, entry)))

    # --- anti-vacuity: a scanner that found nothing has not proved anything ---
    found_files = {s["file"].rsplit("/", 1)[-1] for s in all_sites}
    missing = EXPECTED_SITE_FILES - found_files
    if missing:
        raise Bail(
            "expected wrangler call sites in "
            + ", ".join(sorted(missing))
            + " but found none. The scanner has drifted from the workflow "
            "formatting -- fix the scanner; do not relax EXPECTED_SITE_FILES."
        )
    if len(all_sites) < MIN_EXPECTED_SITES:
        raise Bail(
            f"found only {len(all_sites)} wrangler call sites, expected at least "
            f"{MIN_EXPECTED_SITES}. Same reasoning as above."
        )

    for site in all_sites:
        wd = site["working_directory"]
        cwd = os.path.join(REPO_ROOT, wd) if wd else REPO_ROOT
        if not os.path.isdir(cwd):
            problems.append(
                f"{site['file']}:{site['line']} ({site['name']}): "
                f"working-directory `{wd}` does not exist"
            )
            continue

        resolved = find_config(cwd)
        if resolved != ROOT_CONFIG:
            problems.append(
                f"{site['file']}:{site['line']} ({site['name']}): runs wrangler "
                f"in `{wd or '.'}`, which resolves `{resolved}` instead of "
                f"`{ROOT_CONFIG}`. Every wrangler caller in this repo must "
                f"resolve the root config -- a second config means `--env "
                f"preview` can name a different Worker. Calls: "
                + "; ".join(site["calls"])
            )

        if site["explicit_config"]:
            problems.append(
                f"{site['file']}:{site['line']} ({site['name']}): passes an "
                "explicit --config. That bypasses the resolution this check "
                "models; if it is intentional, extend this check to verify the "
                "target rather than leaving it unguarded."
            )

    if problems:
        print(f"Check A: {len(all_sites)} wrangler call sites, "
              f"{len(problems)} problem(s).", file=sys.stderr)
    else:
        print(f"Check A: {len(all_sites)} wrangler call sites, all resolving "
              f"`{ROOT_CONFIG}`.")
    return problems


def check_shadowed_configs() -> list[str]:
    problems: list[str] = []
    configs: list[str] = []

    for dirpath, dirnames, filenames in os.walk(REPO_ROOT):
        dirnames[:] = [
            d for d in dirnames
            if d not in {".git", "node_modules", "dist", "build", ".wrangler"}
        ]
        for name in filenames:
            if name in CONFIG_FILENAMES:
                rel = os.path.relpath(os.path.join(dirpath, name), REPO_ROOT)
                # Test fixtures are inert data, not configs wrangler ever reads.
                if "/test/fixtures/" in rel or rel.startswith("test/fixtures/"):
                    continue
                configs.append(rel)

    for rel in sorted(configs):
        owning_dir = os.path.join(REPO_ROOT, os.path.dirname(rel)) or REPO_ROOT
        resolved = find_config(owning_dir)

        if resolved != rel and rel not in SHADOWED_ALLOWLIST:
            problems.append(
                f"{rel} is SHADOWED: wrangler run from `{os.path.dirname(rel) or '.'}` "
                f"resolves `{resolved}` instead. Anyone who cd's there and runs "
                f"wrangler silently operates on a different Worker. Delete the "
                f"file, or rename it so it wins its own directory (filename "
                f"precedence: {' > '.join(CONFIG_FILENAMES)})."
            )

    # Ratchet: the allowlist may only shrink. Drive this off the ALLOWLIST, not
    # off the discovered configs -- an entry whose file was renamed or deleted
    # no longer appears in `configs` at all, so a loop over configs silently
    # skips it and the stale entry survives forever. (Measured: renaming the one
    # allowlisted config to `.jsonc` un-shadowed it and the ratchet never fired.)
    for rel, reason in sorted(SHADOWED_ALLOWLIST.items()):
        abs_path = os.path.join(REPO_ROOT, rel)
        if not os.path.isfile(abs_path):
            problems.append(
                f"{rel} is in SHADOWED_ALLOWLIST but no longer exists. Remove "
                f"the entry -- a stale allowlist hides the next one."
            )
            continue
        if find_config(os.path.dirname(abs_path)) == rel:
            problems.append(
                f"{rel} is in SHADOWED_ALLOWLIST but is no longer shadowed. "
                f"Remove the entry -- a stale allowlist hides the next one."
            )

    print(f"Check B: {len(configs)} wrangler config(s), "
          f"{len(SHADOWED_ALLOWLIST)} allowlisted as shadowed.",
          file=sys.stderr if problems else sys.stdout)
    return problems


def main() -> int:
    try:
        problems = check_call_sites() + check_shadowed_configs()
    except Bail as exc:
        print(f"\nSCANNER BAILED: {exc}", file=sys.stderr)
        print(
            "This is a FAILURE, not a pass. An unparsed call site is not a "
            "clean one.",
            file=sys.stderr,
        )
        return 2

    if problems:
        print(
            f"\nwrangler config resolution: {len(problems)} problem(s)\n",
            file=sys.stderr,
        )
        for problem in problems:
            print(f"  - {problem}\n", file=sys.stderr)
        print(
            "Background: wrangler resolves its config by three independent "
            "find-up walks, one per filename, in the order "
            f"{' > '.join(CONFIG_FILENAMES)}. Filename precedence beats "
            "directory proximity. See this script's module docstring.",
            file=sys.stderr,
        )
        return 1

    print("\nwrangler config resolution: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
