// WIC-1979: find source content that entered the tree through a *merge commit*
// and therefore appears on no reviewable commit.
//
// The concrete instance that prompted this: merge `d59c74bf` added three lines
// to `packages/web/vite.config.ts` that exist in neither parent. Every routine
// review lens missed it —
//
//   git log --oneline <base>..<head> -- packages/web/vite.config.ts
//       shows only the merge, no authored commit
//   git log -S"allow: ['..']" --all -- packages/web/vite.config.ts
//       zero hits: `log -S` skips merges unless you pass -m
//   GitHub's "Files changed"
//       merge-commit-only content is attributed to no reviewable commit
//
// So a source file changed between approval and merge with nothing to show a
// reviewer. The specific line was benign; the blind spot is the finding.
//
// WHY THE STRICT SIGNAL IS "ALL PARENT BLOBS EQUAL", NOT "ANY --cc OUTPUT"
//
// `git show --cc` prints a hunk whenever the result differs from *every*
// parent. That is the honest definition of parent-independent content, but it
// also fires on legitimate hand-resolutions: when two branches touch the same
// file and the resolver writes a blend, no parent matches and `--cc` prints it.
// Measured over all 594 merges on `main` at `e1bda4e8`, under this script's
// default pathspec, that loose rule flags 75 files across 47 merges (7.9%) —
// far too noisy to gate on, and nearly all are ordinary conflict resolutions.
//
// This script gates on the strictly smaller class instead: files whose parent
// blobs are all **identical to each other** yet differ from the merge result.
// There was nothing to resolve — every parent agreed — so any difference is
// content the merge invented. Same 594 merges, that rule flags **2**:
//
//   d59c74bf  packages/web/vite.config.ts             b45d1f2f,b45d1f2f..0ed7b909
//   6f2b8f21  packages/api/test/dashboard.metrics.test.ts  00000000,00000000..82c60435
//
// Both are real. The second created a 329-line test file present in neither
// parent. 2/594 = 0.34% is a rate a required check can carry; 8% is not.
//
// The loose class is still worth *seeing*, so `--report` lists it without
// failing. Gate on strict, read loose when certifying a post-approval delta.
//
// Usage:
//   node scripts/detect-evil-merges.mjs <range>            # e.g. origin/main..HEAD
//   node scripts/detect-evil-merges.mjs --commit <sha>     # one merge
//   node scripts/detect-evil-merges.mjs <range> --report   # also list resolutions
//   node scripts/detect-evil-merges.mjs <range> --include-tests
//
// By default only non-test source is gated (`*.ts *.tsx *.js *.mjs *.cjs`,
// minus `*.test.*` / `*.spec.*`), because a test file invented in a merge is a
// review-visibility problem but not a runtime one. `--include-tests` widens it.
//
// Exit codes: 0 clean · 2 findings · 1 internal error.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Combined-diff blob ids are all-zero when the file is absent in that parent. */
export function isAbsent(blob) {
  return /^0+$/.test(blob);
}

/**
 * Parse `git show --cc` output into one entry per file.
 *
 * The only line we need is the combined index line, whose grammar is
 * `index <p1>,<p2>[,<pN>]..<result>` with an optional trailing mode. Splitting
 * on `..` before `,` matters: the parent list is comma-separated and the result
 * is separated by dots, so the reverse order would mis-split a 3-parent merge.
 *
 * A file with no index line (a pure mode change) yields no entry — it carries
 * no content, which is exactly what this script is looking for.
 */
export function parseCombinedDiff(text) {
  const entries = [];
  let file = null;
  for (const line of String(text).split('\n')) {
    const d = line.match(/^diff --cc (.+)$/);
    if (d) {
      file = d[1];
      continue;
    }
    const i = line.match(/^index ([0-9a-fA-F,]+)\.\.([0-9a-fA-F]+)/);
    if (i && file) {
      entries.push({
        file,
        parents: i[1].split(','),
        result: i[2],
      });
      file = null;
    }
  }
  return entries;
}

/**
 * `invented`  — every parent held the same blob, and the merge result differs.
 *               Nothing was in conflict, so the merge authored this itself.
 * `resolved`  — parents disagreed; the result is a resolution. Expected, and
 *               not gated, though `--report` lists it.
 *
 * `newFile` distinguishes the sub-case where the file was absent from every
 * parent (all-zero blobs), i.e. the merge created it outright. It is still
 * `invented` — the flag only sharpens the message.
 */
export function classifyFile(entry) {
  const [first, ...rest] = entry.parents;
  const parentsAgree = rest.every((p) => p === first);
  if (!parentsAgree) return { ...entry, kind: 'resolved', newFile: false };
  if (entry.result === first) return { ...entry, kind: 'unchanged', newFile: false };
  return { ...entry, kind: 'invented', newFile: isAbsent(first) };
}

/** Default gate surface: runtime source, excluding tests. */
export const SOURCE_PATHSPEC = ['*.ts', '*.tsx', '*.js', '*.mjs', '*.cjs'];
export const TEST_EXCLUDES = [':!*.test.*', ':!*.spec.*', ':!*/test/*', ':!*/tests/*'];

export function pathspecFor({ includeTests = false } = {}) {
  return includeTests ? [...SOURCE_PATHSPEC] : [...SOURCE_PATHSPEC, ...TEST_EXCLUDES];
}

/**
 * Turn per-file classifications into a verdict.
 *
 * Only `invented` fails. `resolved` is carried through so `--report` can show
 * it, and so a caller certifying an approval delta can read both classes from
 * one pass.
 */
export function verdict(findings) {
  const invented = findings.filter((f) => f.kind === 'invented');
  const resolved = findings.filter((f) => f.kind === 'resolved');
  return {
    ok: invented.length === 0,
    exitCode: invented.length === 0 ? 0 : 2,
    invented,
    resolved,
  };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Merge commits in `range`, newest first. */
export function mergesIn(range, runner = git) {
  return runner(['rev-list', '--merges', range])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Classify one merge commit. `runner` is injectable so tests need no repo. */
export function inspectMerge(sha, { includeTests = false } = {}, runner = git) {
  const out = runner([
    'show',
    '--cc',
    '--format=',
    sha,
    '--',
    ...pathspecFor({ includeTests }),
  ]);
  return parseCombinedDiff(out)
    .map(classifyFile)
    .filter((f) => f.kind !== 'unchanged')
    .map((f) => ({ ...f, sha }));
}

function main(argv) {
  const args = argv.slice(2);
  const report = args.includes('--report');
  const includeTests = args.includes('--include-tests');
  const commitIdx = args.indexOf('--commit');
  const positional = args.filter((a) => !a.startsWith('--'));

  let merges;
  if (commitIdx !== -1) {
    const sha = args[commitIdx + 1];
    if (!sha) {
      console.error('--commit needs a sha');
      return 1;
    }
    merges = [sha];
  } else {
    const range = positional[0];
    if (!range) {
      console.error(
        'usage: detect-evil-merges.mjs <range> [--report] [--include-tests]\n' +
          '       detect-evil-merges.mjs --commit <sha>'
      );
      return 1;
    }
    merges = mergesIn(range);
  }

  const findings = merges.flatMap((sha) => inspectMerge(sha, { includeTests }));
  const v = verdict(findings);

  if (report && v.resolved.length) {
    console.log(
      `Conflict resolutions (not gated — parents disagreed, so this content is a ` +
        `resolution, but it is still on no reviewable commit):`
    );
    for (const f of v.resolved) {
      console.log(`  ${f.sha.slice(0, 8)}  ${f.file}`);
    }
    console.log('');
  }

  if (v.ok) {
    console.log(
      `No parent-independent source content in ${merges.length} merge commit(s).`
    );
    return 0;
  }

  console.error(
    `${v.invented.length} file(s) changed inside a merge commit with no parent to ` +
      `attribute the change to.\n` +
      `Every parent held the same blob, so nothing was in conflict — the merge ` +
      `authored this content itself, and it appears on no reviewable commit.\n`
  );
  for (const f of v.invented) {
    const how = f.newFile
      ? 'created outright (absent from every parent)'
      : `content invented (all parents ${f.parents[0].slice(0, 8)}, result ${f.result.slice(0, 8)})`;
    console.error(`  ${f.sha.slice(0, 8)}  ${f.file}\n      ${how}`);
    console.error(`      inspect: git show --cc --format= ${f.sha.slice(0, 8)} -- ${f.file}`);
  }
  console.error(
    `\nIf the content is intended, land it as its own commit on the branch so a ` +
      `reviewer can see it. If it is an accident of conflict resolution, redo the ` +
      `merge taking a parent's version.`
  );
  return v.exitCode;
}

// Only run as a CLI, so the pure helpers above import cleanly in tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
