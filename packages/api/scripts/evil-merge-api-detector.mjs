// WIC-2055 — the evil-merge rule, expressed over GitHub API data instead of a
// working tree, so it can run in a workflow that never checks out PR head code.
//
// WHY THIS EXISTS ALONGSIDE detect-evil-merges.mjs
//
// `evil-merge-guard.yml` (WIC-1979) is `pull_request`-triggered because it runs
// `actions/checkout` on the PR head, and `pull_request_target` would hand that
// untrusted code a base-repo token. That trigger choice is correct and must not
// change — but it also makes the guard impossible to name as a required status
// check, for exactly the reasons `skip-ci-sweeper.yml`'s header records for
// `skip-ci-guard.yml`: a `pull_request` workflow is unreachable when the PR's
// base predates the workflow file, does not retro-fire onto already-open PRs,
// and does not run at all on a CONFLICTING PR. A required context that never
// reports leaves every PR pending forever.
//
// So the gate needs a second shape: a sweeper that runs from the DEFAULT branch
// with no checkout and no `run:` step, and publishes a commit status. That job
// has no working tree, so it cannot shell out to git. Everything below is the
// same decision procedure driven by two API reads per merge commit:
//
//   GET /repos/{o}/{r}/commits/{sha}             -> parent shas
//   GET /repos/{o}/{r}/git/trees/{sha}?recursive=1 -> path -> blob sha
//
// THE RULE IS UNCHANGED, AND IS A PURE BLOB-SHA COMPARISON
//
// A path is `invented` when every parent holds the *same* blob for it and the
// merge result differs. Nothing was in conflict, so the merge authored that
// content itself and it appears on no reviewable commit. That is bit-for-bit
// the rule in `detect-evil-merges.mjs`; `git show --cc`'s combined index line
// (`index <p1>,<p2>..<result>`) is literally the blob triple this module reads
// out of the tree API instead.
//
// PARITY IS EXACT ON THE GATED CLASS, AND *DELIBERATELY NOT CLAIMED* ELSEWHERE
//
// Measured over all 594 merge commits on `main` at `45ef8509`, this module and
// `detect-evil-merges.mjs` return the identical `invented` set:
//
//   default        script 1, api 1   (d59c74bf packages/web/vite.config.ts)
//   --include-tests script 2, api 2   (adds 6f2b8f21 dashboard.metrics.test.ts)
//
// with zero findings reported by the script and missed here, in either mode.
// That is the whole gate, and it is exact. The reason it is safe is structural:
// "every parent held the same blob AND the result differs" implies the result
// differs from every parent, which is precisely when `git show --cc` prints a
// file. The gated class can never fall through the gap below.
//
// The NON-gated class is a different story, and pretending otherwise would be
// the drift that makes people stop trusting both tools. `git show --cc` is a
// *dense* combined diff: it suppresses hunks whose content came from a single
// parent, and drops the file when every hunk is suppressed. So an ordinary
// clean auto-merge — both branches edited the same file in different places,
// git combined them with nothing to resolve — produces a result blob that
// differs from both parents yet prints NOTHING under `--cc`. Same 594 merges,
// the script reports 75 such files and a blob-only rule sees 161.
//
// That gap is not a bug to be closed here: telling a clean auto-merge from a
// hand-written blend needs line-level content, not blob ids, and this module
// has only blob ids by design. So the non-gated class is named `contested`
// rather than `resolved`, it is documented as a strict superset of the script's
// `resolved`, and the sweeper does NOT publish it. A number that means
// something different under the same name is worse than no number.
//
// See `test/evil-merge-api-detector.test.ts` for the parity corpus.
//
// THE BLOCK BELOW IS COPIED VERBATIM INTO THE SWEEPER WORKFLOW
//
// `evil-merge-sweeper.yml` deliberately has no `actions/checkout`, which is the
// whole reason it is safe to run on `pull_request_target`. No checkout means no
// repository files, so it cannot import this module and must carry its own copy
// inside the `github-script` block — the same duplication, for the same reason,
// that `skip-ci-sweeper.yml` documents for its SKIP_PATTERNS and ALLOWED lists.
//
// Unlike that one, this copy is not maintained by a "keep in sync" comment and
// good intentions. Everything between the two SHARED-CORE markers is compared
// byte-for-byte against the workflow by `evil-merge-api-detector.test.ts`, after
// dedenting the YAML and dropping the `export ` keywords that a github-script
// body cannot carry. Edit one and the test names the other.

// >>> SHARED-CORE BEGIN — mirrored in .github/workflows/evil-merge-sweeper.yml

/** A git tree API response omits absent paths; the script sees an all-zero id. */
export const ABSENT_BLOB = '0'.repeat(40);

/** Combined-diff blob ids are all-zero when the file is absent in that parent. */
export function isAbsent(blob) {
  return /^0+$/.test(blob);
}

// The gate surface, mirroring `pathspecFor()` in detect-evil-merges.mjs.
//
// Those are git pathspecs (`*.ts`, `:!*.test.*`, `:!*/test/*`). Git matches a
// plain wildcard pathspec with fnmatch and WITHOUT FNM_PATHNAME, so `*` crosses
// `/` freely: `*.ts` matches `packages/web/vite.config.ts`, and `:!*/test/*`
// excludes `packages/api/test/x.ts`. The regexes below reproduce that, which is
// why they are anchored the way they are and not as path-segment matches.
//
// One deliberate consequence, shared with the script: `*/test/*` requires a `/`
// before `test`, so a repository-root `test/x.ts` is NOT excluded by it.

/** Default gate surface: runtime source, excluding tests. */
export const SOURCE_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs)$/;

// Mirrors TEST_EXCLUDES in detect-evil-merges.mjs, in the same order:
// `:!*.test.*`, `:!*.spec.*`, then the two directory ones for `test` and
// `tests`. (Written as a line comment, not JSDoc, because a git pathspec ends
// in `*` + `/` and would close a block comment early.)
export const TEST_EXCLUDE_PATTERNS = [/\.test\./, /\.spec\./, /\/test\//, /\/tests\//];

export function isGatedPath(path, { includeTests = false } = {}) {
  if (!SOURCE_EXTENSIONS.test(path)) return false;
  if (includeTests) return true;
  return !TEST_EXCLUDE_PATTERNS.some((re) => re.test(path));
}

/**
 * `GET /git/trees/{sha}?recursive=1` -> `Map<path, blobSha>` over gated paths.
 *
 * Only `type === 'blob'` entries carry content. Submodules (`commit`) and
 * directories (`tree`) are dropped: a submodule pointer moving inside a merge
 * is a different finding than invented source, and this rule has nothing to say
 * about it.
 *
 * `truncated` is NOT handled here on purpose — a truncated tree silently loses
 * paths, which would turn this gate fail-open. The caller must check it and
 * refuse to publish a verdict. See `assertTreeComplete`.
 */
export function blobMapFromTree(tree, { includeTests = false } = {}) {
  const map = new Map();
  for (const entry of tree || []) {
    if (entry.type !== 'blob') continue;
    if (!isGatedPath(entry.path, { includeTests })) continue;
    map.set(entry.path, entry.sha);
  }
  return map;
}

/**
 * A tree the API truncated is missing paths we would have gated on, so any
 * verdict drawn from it is fail-open. Refuse it loudly instead.
 */
export function assertTreeComplete(response, sha) {
  if (response && response.truncated) {
    throw new Error(
      `git tree for ${String(sha).slice(0, 8)} came back truncated; a partial ` +
        `tree cannot support a fail-closed verdict`
    );
  }
  return response;
}

/**
 * Classify one path from its blob in each parent and in the merge result.
 *
 * `invented`  — every parent held the same blob, and the result differs.
 *               Nothing was in conflict; the merge authored this itself. This
 *               is the gated class, and it is in exact parity with the script.
 * `contested` — parents disagreed and the result matches no parent. A STRICT
 *               SUPERSET of the script's `resolved`: it also contains ordinary
 *               clean auto-merges, which differ from both parents by blob but
 *               print nothing under `git show --cc`. Never gated, and not
 *               published by the sweeper — see the header.
 * `taken`     — parents disagreed and the result is one parent's blob verbatim.
 *               An explicit "took one side", carrying no invented content.
 * `unchanged` — every parent and the result agree.
 */
export function classifyBlobs({ path, parents, result }) {
  const [first, ...rest] = parents;
  const parentsAgree = rest.every((p) => p === first);
  if (!parentsAgree) {
    const kind = parents.includes(result) ? 'taken' : 'contested';
    return { file: path, parents, result, kind, newFile: false };
  }
  if (result === first) {
    return { file: path, parents, result, kind: 'unchanged', newFile: false };
  }
  return { file: path, parents, result, kind: 'invented', newFile: isAbsent(first) };
}

/**
 * Classify every gated path of one merge commit.
 *
 * `parentMaps` is one `blobMapFromTree` per parent, in parent order; `resultMap`
 * is the merge commit's own tree. A path missing from a map reads as
 * `ABSENT_BLOB`, which is what the script sees as an all-zero combined-diff id.
 *
 * Output drops `unchanged` and `taken`, keeping `invented` (the gate) and
 * `contested` (informational, and broader than the script's `resolved`).
 */
export function inspectMergeBlobMaps({ sha, parentMaps, resultMap }) {
  if (!Array.isArray(parentMaps) || parentMaps.length < 2) {
    throw new Error(`${String(sha).slice(0, 8)} is not a merge: needs >= 2 parent trees`);
  }
  const paths = new Set();
  for (const map of parentMaps) for (const p of map.keys()) paths.add(p);
  for (const p of resultMap.keys()) paths.add(p);

  const findings = [];
  for (const path of [...paths].sort()) {
    const f = classifyBlobs({
      path,
      parents: parentMaps.map((m) => m.get(path) ?? ABSENT_BLOB),
      result: resultMap.get(path) ?? ABSENT_BLOB,
    });
    if (f.kind === 'unchanged' || f.kind === 'taken') continue;
    findings.push({ ...f, sha });
  }
  return findings;
}

/**
 * Turn per-file classifications into a verdict. `ok`/`exitCode` mirror
 * `verdict()` in detect-evil-merges.mjs exactly, so the two tools cannot
 * disagree about what counts as a failure.
 *
 * `contested` is carried for callers that want to look, but it is NOT the
 * script's `resolved` and must not be reported as if it were.
 */
export function verdictFor(findings) {
  const invented = findings.filter((f) => f.kind === 'invented');
  const contested = findings.filter((f) => f.kind === 'contested');
  return {
    ok: invented.length === 0,
    exitCode: invented.length === 0 ? 0 : 2,
    invented,
    contested,
  };
}

/**
 * The commit-status description for a verdict, in the <=140 chars the statuses
 * API accepts (it truncates silently past that, which would cut the file list
 * mid-path and read as a different finding).
 */
export function describeVerdict(v, { mergesInspected = 0 } = {}) {
  const text = v.ok
    ? `No parent-independent source content in ${mergesInspected} merge commit(s) on this branch.`
    : `${v.invented.length} file(s) authored inside a merge commit, on no reviewable commit: ` +
      v.invented.map((f) => f.file).slice(0, 3).join(', ');
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

// >>> SHARED-CORE END
