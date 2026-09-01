#!/usr/bin/env bash
#
# Re-merge every open PR's base branch into its head, so GitHub stops reporting
# conflicts that only exist on GitHub.
#
# WHY THIS EXISTS
#
# `.gitattributes` marks CHANGELOG.md `merge=union`, which makes the append-at-the-
# same-spot collision resolve itself in a local checkout. Merge drivers are a local
# feature: GitHub computes PR mergeability server-side with the default text driver
# and ignores the rule entirely. So every open PR that touches [Unreleased] flips to
# CONFLICTING the moment any other such PR merges ahead of it, and the flag clears
# only once a merge commit that already contains the base is pushed to the head
# branch. See the CAVEAT block in .gitattributes for the measurements.
#
# The result is a treadmill: merging one PR re-conflicts the rest, and the queue is
# never all-green at the same moment. This script replays the resolution git would
# have done locally, across every open PR, in one pass.
#
# WHAT IT DOES
#
#   - merges each PR's *own base* into its head, not always main. Roughly a third of
#     the open PRs are stacked on another PR's branch, so merging main into them
#     would be the wrong three-way merge and would drag in unrelated commits.
#   - union-resolves CHANGELOG.md when the driver did not fire on its own (branches
#     that predate .gitattributes do not have the rule in their checkout).
#   - merges, never rebases: these branches have other PRs stacked on them, and a
#     force-push would detach every child.
#   - refuses to guess at anything else. A conflict outside CHANGELOG.md is a real
#     conflict between two people's work; those are listed at the end for a human.
#
# USAGE
#
#   npm run git:remerge            # sweep every open PR
#   npm run git:remerge -- --dry-run
#
# Run it after each merge to main. Requires `gh` authenticated against the repo.

set -uo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

REMOTE="${REMERGE_REMOTE:-origin}"
git remote get-url "$REMOTE" >/dev/null 2>&1 || {
  echo "error: no git remote named '$REMOTE' (override with REMERGE_REMOTE=<name>)" >&2
  exit 1
}

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "error: working tree has uncommitted changes; refusing to switch branches" >&2
  exit 1
fi

START_REF="$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)"
restore() { git checkout --quiet "$START_REF" 2>/dev/null || true; }
trap restore EXIT

echo "Fetching $REMOTE..."
git fetch --quiet --prune "$REMOTE"

SKIPPED=()
PUSHED=0
CLEAN=0

while IFS=$'\t' read -r num base head; do
  [ -n "${num:-}" ] || continue

  # Already contains its base — nothing to do.
  if git merge-base --is-ancestor "$REMOTE/$base" "$REMOTE/$head" 2>/dev/null; then
    CLEAN=$((CLEAN + 1))
    continue
  fi

  if [ "$DRY_RUN" = 1 ]; then
    echo "would re-merge PR #$num: $base -> $head"
    continue
  fi

  if ! git checkout --quiet -B "$head" "$REMOTE/$head" 2>/dev/null; then
    SKIPPED+=("#$num ($head): could not check out")
    continue
  fi

  if ! git merge --no-edit "$REMOTE/$base" \
        -m "merge: bring $base into $head" >/dev/null 2>&1; then
    other=$(git diff --name-only --diff-filter=U | grep -v '^CHANGELOG.md$')
    if [ -n "$other" ]; then
      git merge --abort
      SKIPPED+=("#$num ($head): $(echo "$other" | tr '\n' ' ')")
      continue
    fi

    # CHANGELOG.md only: apply the union the driver would have, from the index
    # stages. Both sides are additive appends, so keeping both is the whole fix.
    git show :1:CHANGELOG.md > .changelog.base 2>/dev/null || : > .changelog.base
    git show :2:CHANGELOG.md > .changelog.ours
    git show :3:CHANGELOG.md > .changelog.theirs
    git merge-file --union -p \
      .changelog.ours .changelog.base .changelog.theirs > CHANGELOG.md
    rm -f .changelog.base .changelog.ours .changelog.theirs
    git add CHANGELOG.md
    git commit --quiet --no-edit
  fi

  if git push --quiet "$REMOTE" "$head:$head" 2>/dev/null; then
    echo "re-merged PR #$num ($base -> $head)"
    PUSHED=$((PUSHED + 1))
  else
    SKIPPED+=("#$num ($head): push rejected")
  fi
done < <(gh pr list --state open --limit 200 \
           --json number,baseRefName,headRefName \
           --jq '.[] | [.number, .baseRefName, .headRefName] | @tsv')

echo
echo "re-merged: $PUSHED    already current: $CLEAN"

if [ ${#SKIPPED[@]} -gt 0 ]; then
  echo
  echo "Needs a human — real conflicts, not the CHANGELOG artefact:"
  printf '  %s\n' "${SKIPPED[@]}"
  exit 1
fi
