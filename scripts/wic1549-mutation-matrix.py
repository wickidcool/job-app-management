#!/usr/bin/env python3
"""WIC-1549 revert matrix.

Mutates ONE predicate at a time in interviewPrep.service.ts and records how many
tests in interview-prep.generate.tenancy.test.ts fail.

Guards this harness applies, each because a previous card lost time to its absence:
  * the target line must match an expected anchor BEFORE mutating (WIC-1465:
    line numbers drift as soon as you edit the file);
  * the anchor must match EXACTLY ONE line in the file, or the cell is refused
    (WIC-1435: 629 and 1000 here are byte-identical, so a string replace would
    silently hit the wrong one);
  * the file must actually differ after the edit (WIC-1464: a harness that does
    not verify the mutation applied prints the UNMUTATED baseline as a clean
    sweep);
  * restore is `cp` from a pristine backup, never `git checkout --` (WIC-1465:
    that eats the real edits sitting in the worktree).
"""
import re
import shutil
import subprocess
import sys

import os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

SVC = "packages/api/src/services/interviewPrep.service.ts"
TEST = "test/interview-prep.generate.tenancy.test.ts"
BACKUP = "/tmp/wic1549-svc-pristine.ts"

# (label, anchor-substring identifying the line, replacement line, predicted failures)
CELLS = [
    (
        "427 generateInterviewPrep application read  [THE DEFECT]",
        "and(eq(applications.id, input.applicationId), ownerScope(applications, userId))",
        "    .where(eq(applications.id, input.applicationId))",
        4,
    ),
    (
        "443 generateInterviewPrep prep uniqueness probe",
        "and(eq(interviewPreps.applicationId, input.applicationId), ownerScope(interviewPreps, userId))",
        "      eq(interviewPreps.applicationId, input.applicationId)",
        1,
    ),
    (
        "48  ownerScope absent-caller fallback -> undefined",
        "return userId ? eq(table.userId, userId) : isNull(table.userId);",
        "  return userId ? eq(table.userId, userId) : undefined;",
        1,
    ),
    (
        "629 getInterviewPrep application read       [CONTROL]",
        None,  # byte-identical to 1000 -> addressed by line number only
        "    .where(eq(applications.id, prep.applicationId))",
        0,
    ),
    (
        "1000 exportInterviewPrep application read   [CONTROL]",
        None,
        "    .where(eq(applications.id, prep.applicationId))",
        0,
    ),
]

# The two controls are identified by line number because their text is identical.
CONTROL_LINES = {"629 getInterviewPrep application read       [CONTROL]": 629,
                 "1000 exportInterviewPrep application read   [CONTROL]": 1000}
CONTROL_ANCHOR = "and(eq(applications.id, prep.applicationId), ownerScope(applications, userId))"


def run_tests():
    r = subprocess.run(
        ["npx", "vitest", "run", TEST, "--reporter=basic"],
        cwd="packages/api", capture_output=True, text=True,
    )
    out = r.stdout + r.stderr
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    if not m:
        if "failed" in out.lower():
            m2 = re.search(r"(\d+) failed", out)
            return (int(m2.group(1)) if m2 else -1), out
        return -1, out
    return int(m.group(1) or 0), out


def main():
    shutil.copy(SVC, BACKUP)
    pristine = open(BACKUP).read()

    base_fail, out = run_tests()
    total = re.search(r"Tests\s+.*?(\d+) passed", out)
    print(f"BASELINE (unmutated): {base_fail} failed  [{total.group(1) if total else '?'} passed]")
    if base_fail != 0:
        print("Baseline is not green; aborting.")
        return 1

    results = []
    for label, anchor, repl, predicted in CELLS:
        lines = pristine.split("\n")

        if anchor is None:
            lineno = CONTROL_LINES[label]
            idx = lineno - 1
            # count how many lines carry the shared control anchor
            matches = [i for i, l in enumerate(lines) if CONTROL_ANCHOR in l]
            assert len(matches) == 2, f"expected 2 identical control sites, got {len(matches)}"
            assert idx in matches, f"line {lineno} is not one of the control sites {[m+1 for m in matches]}"
        else:
            matches = [i for i, l in enumerate(lines) if anchor in l]
            if len(matches) != 1:
                print(f"REFUSED {label}: anchor matched {len(matches)} sites, need exactly 1")
                results.append((label, predicted, None, "REFUSED"))
                continue
            idx = matches[0]

        before = lines[idx]
        lines[idx] = repl
        mutated = "\n".join(lines)
        assert mutated != pristine, "mutation did not change the file"
        open(SVC, "w").write(mutated)

        # prove on disk that exactly one line differs, and it is the one we meant
        diff = subprocess.run(["git", "diff", "--numstat", "--", SVC],
                              capture_output=True, text=True).stdout.strip()
        fails, _ = run_tests()
        shutil.copy(BACKUP, SVC)
        assert open(SVC).read() == pristine, "restore failed"

        verdict = "RED" if fails > 0 else "GREEN"
        ok = "OK " if fails == predicted else "!! "
        print(f"{ok}{label}\n     line {idx+1}: {before.strip()[:70]}\n"
              f"     -> {repl.strip()[:70]}\n"
              f"     numstat={diff}  predicted {predicted} failed, got {fails}  [{verdict}]")
        results.append((label, predicted, fails, verdict))

    print("\n=== SUMMARY ===")
    bad = 0
    for label, pred, got, verdict in results:
        flag = "OK " if got == pred else "!! "
        if got != pred:
            bad += 1
        print(f"{flag}{label:55s} predicted {pred}  actual {got}  {verdict}")
    print(f"\n{len(results)-bad}/{len(results)} cells matched their predicted kill count.")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
