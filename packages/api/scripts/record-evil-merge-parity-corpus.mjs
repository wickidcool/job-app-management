// WIC-2055 — record the parity corpus that `evil-merge-api-detector` is gated on.
//
// WHY A RECORDED FIXTURE AND NOT LIVE GIT
//
// The obvious test is "walk this repo's merges and compare the two detectors",
// and that is exactly what this script does — once, here, with full history.
// It cannot be the test itself, because the test has to hold in CI, and in CI
// there is no history to walk: `deploy.yml` runs `actions/checkout` with no
// `fetch-depth`, so the default depth of 1 applies and `git rev-list --merges`
// returns nothing. A live-git parity test would find an empty corpus, compare
// two empty sets, and pass. That is the same trap `evil-merge-guard.yml`'s
// header records for the guard itself, where `fetch-depth: 0` is load-bearing.
//
// So the corpus is recorded here and committed, and the test runs against the
// recording with no repository and no network. The test additionally asserts
// the corpus still contains the two known instances and is of the expected
// size, so an emptied or truncated fixture fails loudly instead of passing
// vacuously on nothing.
//
// WHAT IS RECORDED
//
// Per merge commit, the blob triple `(parents[], result)` for every gated path
// where the parents and the result do not all agree — i.e. every path the
// detector has to make a real decision about. Paths identical everywhere are
// omitted: they are unbounded in number, they classify `unchanged` by
// definition, and the unit tests cover that branch directly with full trees.
//
// Alongside each merge, the `invented` file list as reported by the REAL
// `detect-evil-merges.mjs` — the oracle the API detector must reproduce.
//
// Usage:
//   node packages/api/scripts/record-evil-merge-parity-corpus.mjs [ref] > \
//     packages/api/test/fixtures/evil-merge-parity-corpus.json
//
// Re-record after history changes; the test pins counts, so it will tell you.
import { execFileSync } from 'node:child_process';
import { inspectMerge } from './detect-evil-merges.mjs';
import { isGatedPath, ABSENT_BLOB } from './evil-merge-api-detector.mjs';

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** Gated `path -> blob` for one tree, in the shape the API's tree list gives. */
function blobMap(sha, includeTests) {
  const map = new Map();
  for (const line of git(['ls-tree', '-r', sha]).split('\n')) {
    if (!line) continue;
    const [meta, path] = line.split('\t');
    const [, type, blob] = meta.split(/\s+/);
    if (type !== 'blob') continue;
    if (!isGatedPath(path, { includeTests })) continue;
    map.set(path, blob);
  }
  return map;
}

/**
 * Blob and path strings repeat heavily across 594 merges (1,655 distinct blobs
 * and 471 distinct paths over 28,537 decisions), so they are interned into two
 * tables and each decision is stored as `[pathIdx, resultIdx, ...parentIdxs]`.
 * Written plainly this corpus is 7.2 MB, which is not a thing to commit; the
 * tables bring it under half a megabyte with no loss. `decodeCorpus` in the
 * test reverses it, and this script stays the readable source of truth.
 */
function interner() {
  const table = [];
  const index = new Map();
  return {
    table,
    id(value) {
      let i = index.get(value);
      if (i === undefined) {
        i = table.length;
        table.push(value);
        index.set(value, i);
      }
      return i;
    },
  };
}

function record(ref) {
  const merges = git(['rev-list', '--merges', ref]).split('\n').filter(Boolean);
  const entries = [];
  const blobs = interner();
  const paths = interner();

  for (const sha of merges) {
    const parents = git(['rev-list', '--parents', '-n', '1', sha])
      .trim()
      .split(/\s+/)
      .slice(1);

    // Record at the WIDEST surface (`includeTests: true`) so one corpus can
    // drive both modes: the narrow default is a filter over these same paths,
    // so the test can re-derive it without a second recording.
    const parentMaps = parents.map((p) => blobMap(p, true));
    const resultMap = blobMap(sha, true);

    const touched = new Set();
    for (const m of parentMaps) for (const p of m.keys()) touched.add(p);
    for (const p of resultMap.keys()) touched.add(p);

    const files = [];
    for (const path of [...touched].sort()) {
      const ps = parentMaps.map((m) => m.get(path) ?? ABSENT_BLOB);
      const result = resultMap.get(path) ?? ABSENT_BLOB;
      // Drop paths every side agrees on — nothing to decide.
      if (ps.every((p) => p === ps[0]) && result === ps[0]) continue;
      files.push([paths.id(path), blobs.id(result), ...ps.map((b) => blobs.id(b))]);
    }

    // The oracle: what the real, git-driven detector says about this merge.
    const oracle = (kind, mode) =>
      inspectMerge(sha, mode)
        .filter((f) => f.kind === kind)
        .map((f) => f.file)
        .sort();

    entries.push({
      sha,
      parents,
      files,
      expectedInvented: oracle('invented', { includeTests: false }),
      expectedInventedWithTests: oracle('invented', { includeTests: true }),
      // Not a parity target — the API detector CANNOT reproduce this from blob
      // shas (see the `contested` note in evil-merge-api-detector.mjs). Recorded
      // so the test can pin the documented direction of the gap: every file the
      // script calls `resolved` must still appear in the API detector's
      // `contested`. Losing that containment would mean the blob-only rule had
      // started missing real hand-resolutions, not merely over-reporting.
      scriptResolved: oracle('resolved', { includeTests: false }),
    });
  }

  return {
    _comment:
      'WIC-2055 parity corpus. Generated by packages/api/scripts/' +
      'record-evil-merge-parity-corpus.mjs — do not hand-edit. `expectedInvented*` ' +
      'is the verdict of the real git-driven detect-evil-merges.mjs, which the ' +
      'API-shaped detector must reproduce from blob shas alone.',
    _encoding:
      'blobTable/pathTable are string interning tables. Each entry of a merge’s ' +
      '`files` is [pathIdx, resultBlobIdx, ...parentBlobIdxs]; parent order matches ' +
      '`parents`. Recorded at the widest surface (tests included); the narrow ' +
      'default mode is a filter over the same paths.',
    ref,
    recordedAt: git(['rev-parse', ref]).trim(),
    blobTable: blobs.table,
    pathTable: paths.table,
    merges: entries,
  };
}

const ref = process.argv[2] || 'origin/main';
process.stdout.write(`${JSON.stringify(record(ref))}\n`);
