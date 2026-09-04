/**
 * WIC-2055 — the API-shaped evil-merge detector must decide exactly what the
 * git-driven one decides.
 *
 * `evil-merge-guard.yml` (WIC-1979) cannot be a required status check: it is
 * `pull_request`-triggered because it checks out PR head code, and that trigger
 * is unreachable on a PR whose base predates the workflow, never retro-fires
 * onto open PRs, and does not run at all on a CONFLICTING PR. The companion
 * sweeper runs from the default branch with no checkout, so it has no working
 * tree and must reach the same verdict from GitHub API data alone.
 *
 * Two detectors deciding the same thing is a drift liability, so the gate here
 * is a recorded corpus of **all 594 merge commits on `main`**, in which each
 * merge carries the blob triple for every path the detector must judge AND the
 * verdict of the real `detect-evil-merges.mjs` as the oracle.
 *
 * WHY RECORDED AND NOT LIVE GIT — this is the load-bearing decision.
 *
 * The natural test walks the repository. It would pass for the wrong reason:
 * `deploy.yml` checks out with no `fetch-depth`, so CI runs at the default
 * depth of 1, `git rev-list --merges` returns nothing, and a live parity test
 * would compare two empty sets and report success. That is the same trap
 * `evil-merge-guard.yml` documents when it explains why `fetch-depth: 0` is
 * load-bearing. So the corpus is recorded by
 * `scripts/record-evil-merge-parity-corpus.mjs` and committed, and the
 * integrity block below asserts the corpus is actually populated and still
 * contains both known instances — an emptied or truncated fixture must fail
 * loudly, not vanish into a green tick.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import corpus from './fixtures/evil-merge-parity-corpus.json';
import {
  ABSENT_BLOB,
  isAbsent,
  isGatedPath,
  blobMapFromTree,
  assertTreeComplete,
  classifyBlobs,
  inspectMergeBlobMaps,
  verdictFor,
  describeVerdict,
  // @ts-expect-error — plain .mjs ops script, no type declarations
} from '../scripts/evil-merge-api-detector.mjs';

type Finding = { file: string; kind: string; newFile: boolean; sha: string };

/** The two instances that exist in the entire history of `main`. */
const VITE_CONFIG = 'packages/web/vite.config.ts';
const DASHBOARD_TEST = 'packages/api/test/dashboard.metrics.test.ts';

// ---------------------------------------------------------------------------
// The gate surface, mirroring git pathspecs `*.ts` / `:!*.test.*` / `:!*/test/*`
// ---------------------------------------------------------------------------

describe('isGatedPath — mirrors the script’s git pathspec', () => {
  it('gates every runtime source extension', () => {
    for (const p of ['a.ts', 'pkg/b.tsx', 'pkg/c.js', 'd.mjs', 'e.cjs']) {
      expect(isGatedPath(p)).toBe(true);
    }
  });

  it('ignores files with no runtime surface', () => {
    for (const p of ['README.md', 'a.json', '.github/workflows/x.yml', 'a.tsx.snap']) {
      expect(isGatedPath(p)).toBe(false);
    }
  });

  it('excludes tests by default and includes them on request', () => {
    const tests = [
      'packages/api/src/x.test.ts',
      'packages/api/src/x.spec.ts',
      'packages/api/test/x.ts',
      'packages/web/tests/x.ts',
    ];
    for (const p of tests) {
      expect(isGatedPath(p)).toBe(false);
      expect(isGatedPath(p, { includeTests: true })).toBe(true);
    }
  });

  it('matches git’s wildcards ACROSS directory separators, not per segment', () => {
    // Git matches a plain pathspec with fnmatch and without FNM_PATHNAME, so
    // `*.ts` reaches into any depth. A per-segment implementation would miss
    // exactly the file the whole card is about.
    expect(isGatedPath(VITE_CONFIG)).toBe(true);
    expect(isGatedPath('a/b/c/d/e/f.ts')).toBe(true);
  });

  it('reproduces the pathspec’s quirk: a ROOT-level test/ dir is not excluded', () => {
    // `:!*/test/*` needs a `/` before `test`, so `test/x.ts` at the repository
    // root falls through it. The script behaves this way too; pinning it here
    // means a future "cleanup" of these regexes cannot silently change the gate
    // surface without a failing test to explain itself.
    expect(isGatedPath('test/x.ts')).toBe(true);
    expect(isGatedPath('packages/api/test/x.ts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reading the tree API
// ---------------------------------------------------------------------------

describe('blobMapFromTree — read GET /git/trees?recursive=1', () => {
  const tree = [
    { path: 'packages/web', type: 'tree', sha: 'aaa' },
    { path: VITE_CONFIG, type: 'blob', sha: 'b45d1f2f' },
    { path: 'README.md', type: 'blob', sha: 'ccc' },
    { path: 'packages/api/test/x.ts', type: 'blob', sha: 'ddd' },
    { path: 'vendor/thing', type: 'commit', sha: 'eee' },
  ];

  it('keeps only gated blobs', () => {
    expect([...blobMapFromTree(tree).entries()]).toEqual([[VITE_CONFIG, 'b45d1f2f']]);
  });

  it('drops directories and submodule pointers, which carry no source content', () => {
    const map = blobMapFromTree(tree, { includeTests: true });
    expect(map.has('packages/web')).toBe(false);
    expect(map.has('vendor/thing')).toBe(false);
    expect(map.has('packages/api/test/x.ts')).toBe(true);
  });

  it('tolerates a missing tree array rather than throwing', () => {
    expect(blobMapFromTree(undefined).size).toBe(0);
  });
});

describe('assertTreeComplete — a truncated tree must not yield a verdict', () => {
  it('throws when GitHub truncated the tree', () => {
    // A truncated tree is missing paths we would have gated on, so any verdict
    // drawn from it is fail-OPEN — the exact failure mode this whole card is
    // about. Refusing loudly is the only safe response.
    expect(() => assertTreeComplete({ truncated: true, tree: [] }, 'd59c74bf')).toThrow(
      /truncated/
    );
  });

  it('passes a complete tree straight through', () => {
    const res = { truncated: false, tree: [] };
    expect(assertTreeComplete(res, 'd59c74bf')).toBe(res);
  });
});

// ---------------------------------------------------------------------------
// The rule itself
// ---------------------------------------------------------------------------

describe('classifyBlobs — the four outcomes', () => {
  it('invented: every parent agreed, so the merge authored the difference', () => {
    expect(
      classifyBlobs({ path: VITE_CONFIG, parents: ['b45d1f2f', 'b45d1f2f'], result: '0ed7b909' })
    ).toMatchObject({ kind: 'invented', newFile: false });
  });

  it('invented + newFile: absent from every parent, created by the merge', () => {
    expect(
      classifyBlobs({
        path: DASHBOARD_TEST,
        parents: [ABSENT_BLOB, ABSENT_BLOB],
        result: '82c60435',
      })
    ).toMatchObject({ kind: 'invented', newFile: true });
  });

  it('contested: parents disagreed and the result matches neither', () => {
    expect(
      classifyBlobs({ path: 'a.ts', parents: ['1c718c6d', '6f51a30b'], result: 'f0fe87d5' })
    ).toMatchObject({ kind: 'contested', newFile: false });
  });

  it('taken: parents disagreed and the merge took one side verbatim', () => {
    expect(
      classifyBlobs({ path: 'a.ts', parents: ['1c718c6d', '6f51a30b'], result: '6f51a30b' })
    ).toMatchObject({ kind: 'taken' });
  });

  it('unchanged: everyone agrees', () => {
    expect(
      classifyBlobs({ path: 'a.ts', parents: ['aaa', 'aaa'], result: 'aaa' })
    ).toMatchObject({ kind: 'unchanged' });
  });

  it('handles an octopus merge, where "parents agree" spans more than two', () => {
    expect(
      classifyBlobs({ path: 'a.ts', parents: ['aaa', 'aaa', 'aaa'], result: 'bbb' })
    ).toMatchObject({ kind: 'invented' });
    expect(
      classifyBlobs({ path: 'a.ts', parents: ['aaa', 'aaa', 'zzz'], result: 'bbb' })
    ).toMatchObject({ kind: 'contested' });
  });

  it('does not mistake a real blob that merely starts with zeros for absent', () => {
    expect(isAbsent('0ed7b909')).toBe(false);
    expect(isAbsent(ABSENT_BLOB)).toBe(true);
  });
});

describe('inspectMergeBlobMaps — one merge, end to end', () => {
  // Real blob shas, read out of this repository.
  const P1 = 'f8b046d4001d3486b16ff69bc0e8c1deccc3f521';
  const P2 = 'fb57518fb459afd443d5b5ec9b50195c91beee8d';
  const PARENT_BLOB = 'b45d1f2f3cf96bd0bc627228dd4ec0e548254790';
  const RESULT_BLOB = '0ed7b909beeda91b6c4205e90d17793c52875cc4';

  const treeOf = (viteBlob: string) => [
    { path: VITE_CONFIG, type: 'blob', sha: viteBlob },
    { path: 'packages/web/src/main.tsx', type: 'blob', sha: 'stable0000' },
    { path: 'README.md', type: 'blob', sha: 'ignored000' },
  ];

  it('finds d59c74bf’s invented vite.config.ts and nothing else', () => {
    const findings: Finding[] = inspectMergeBlobMaps({
      sha: 'd59c74bf516e56091f390e16e81ea619ea9c1463',
      parentMaps: [blobMapFromTree(treeOf(PARENT_BLOB)), blobMapFromTree(treeOf(PARENT_BLOB))],
      resultMap: blobMapFromTree(treeOf(RESULT_BLOB)),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: VITE_CONFIG, kind: 'invented', newFile: false });
    expect(verdictFor(findings)).toMatchObject({ ok: false, exitCode: 2 });
  });

  it('carries the merge sha onto every finding', () => {
    const findings: Finding[] = inspectMergeBlobMaps({
      sha: 'd59c74bf516e56091f390e16e81ea619ea9c1463',
      parentMaps: [blobMapFromTree(treeOf(PARENT_BLOB)), blobMapFromTree(treeOf(PARENT_BLOB))],
      resultMap: blobMapFromTree(treeOf(RESULT_BLOB)),
    });
    expect(findings[0].sha).toBe('d59c74bf516e56091f390e16e81ea619ea9c1463');
  });

  it('is silent when the merge changed nothing a parent did not already hold', () => {
    const findings = inspectMergeBlobMaps({
      sha: P1,
      parentMaps: [blobMapFromTree(treeOf(PARENT_BLOB)), blobMapFromTree(treeOf(PARENT_BLOB))],
      resultMap: blobMapFromTree(treeOf(PARENT_BLOB)),
    });
    expect(findings).toEqual([]);
    expect(verdictFor(findings)).toMatchObject({ ok: true, exitCode: 0 });
  });

  it('emits no `taken` entry — a took-one-side file is not a finding at all', () => {
    // `verdictFor` selects by kind, so leaking `taken` through here would not
    // change any verdict — which is exactly why it needs its own test. Anything
    // reading the raw finding list (the sweeper's job summary, a future caller)
    // would otherwise be handed files that `git show --cc` prints nothing for.
    const p1 = blobMapFromTree([{ path: 'a.ts', type: 'blob', sha: 'aaa' }]);
    const p2 = blobMapFromTree([{ path: 'a.ts', type: 'blob', sha: 'bbb' }]);
    const findings: Finding[] = inspectMergeBlobMaps({
      sha: P1,
      parentMaps: [p1, p2],
      resultMap: blobMapFromTree([{ path: 'a.ts', type: 'blob', sha: 'bbb' }]),
    });
    expect(findings.map((f) => f.kind)).toEqual([]);
  });

  it('refuses a commit that is not a merge instead of quietly passing it', () => {
    // A non-merge reaching this function means the caller's parent filter broke.
    // Returning "clean" would be fail-open, so it throws.
    expect(() =>
      inspectMergeBlobMaps({ sha: P2, parentMaps: [new Map()], resultMap: new Map() })
    ).toThrow(/not a merge/);
  });
});

// ---------------------------------------------------------------------------
// AC-2: parity with detect-evil-merges.mjs over the recorded corpus
// ---------------------------------------------------------------------------

type CorpusMerge = {
  sha: string;
  parents: string[];
  files: number[][];
  expectedInvented: string[];
  expectedInventedWithTests: string[];
  scriptResolved: string[];
};

const CORPUS = corpus as unknown as {
  recordedAt: string;
  blobTable: string[];
  pathTable: string[];
  merges: CorpusMerge[];
};

/**
 * Reverse the interning done by `record-evil-merge-parity-corpus.mjs`: each
 * `files` row is `[pathIdx, resultBlobIdx, ...parentBlobIdxs]`.
 *
 * The corpus is recorded at the widest surface (tests included), so narrowing
 * to the default mode is a filter on the decoded paths. That filter uses the
 * module's own `isGatedPath`, which is deliberate rather than circular: the
 * oracle verdicts were produced by REAL git pathspecs, so a wrong `isGatedPath`
 * shows up as a corpus mismatch in one direction or the other — dropping
 * vite.config.ts loses an expected finding, keeping the dashboard test file
 * adds an unexpected one.
 */
function decodeMerge(m: CorpusMerge, { includeTests }: { includeTests: boolean }) {
  const parentMaps: Map<string, string>[] = m.parents.map(() => new Map());
  const resultMap = new Map<string, string>();

  for (const row of m.files) {
    const path = CORPUS.pathTable[row[0]];
    if (!isGatedPath(path, { includeTests })) continue;
    const result = CORPUS.blobTable[row[1]];
    if (result !== ABSENT_BLOB) resultMap.set(path, result);
    for (let i = 0; i < parentMaps.length; i += 1) {
      const blob = CORPUS.blobTable[row[2 + i]];
      if (blob !== ABSENT_BLOB) parentMaps[i].set(path, blob);
    }
  }
  return { parentMaps, resultMap };
}

function inventedFor(m: CorpusMerge, includeTests: boolean): string[] {
  const { parentMaps, resultMap } = decodeMerge(m, { includeTests });
  const findings: Finding[] = inspectMergeBlobMaps({ sha: m.sha, parentMaps, resultMap });
  return verdictFor(findings)
    .invented.map((f: Finding) => f.file)
    .sort();
}

describe('parity corpus integrity — the fixture must not be able to pass vacuously', () => {
  it('carries every merge commit on main, not an empty or clipped subset', () => {
    expect(CORPUS.merges.length).toBe(594);
    expect(CORPUS.recordedAt).toBe('45ef8509' + CORPUS.recordedAt.slice(8));
  });

  it('carries real decisions, not just merge headers', () => {
    const decisions = CORPUS.merges.reduce((n, m) => n + m.files.length, 0);
    expect(decisions).toBe(28537);
    expect(CORPUS.blobTable.length).toBeGreaterThan(1000);
    expect(CORPUS.pathTable.length).toBeGreaterThan(400);
  });

  it('still contains both known instances, so a rewrite cannot silently drop them', () => {
    expect(CORPUS.merges.flatMap((m) => m.expectedInvented)).toEqual([VITE_CONFIG]);
    expect(CORPUS.merges.flatMap((m) => m.expectedInventedWithTests).sort()).toEqual([
      DASHBOARD_TEST,
      VITE_CONFIG,
    ]);
  });

  it('reproduces WIC-1979’s measured resolution rate — 75 files across 47 merges', () => {
    expect(CORPUS.merges.reduce((n, m) => n + m.scriptResolved.length, 0)).toBe(75);
    expect(CORPUS.merges.filter((m) => m.scriptResolved.length > 0).length).toBe(47);
  });
});

describe('AC-2 — API detector reproduces detect-evil-merges.mjs on all 594 merges', () => {
  it('agrees merge-for-merge in the default (tests excluded) mode', () => {
    const disagreements = CORPUS.merges
      .map((m) => ({ sha: m.sha, got: inventedFor(m, false), want: m.expectedInvented }))
      .filter((r) => JSON.stringify(r.got) !== JSON.stringify(r.want));
    expect(disagreements).toEqual([]);
  });

  it('agrees merge-for-merge with --include-tests', () => {
    const disagreements = CORPUS.merges
      .map((m) => ({ sha: m.sha, got: inventedFor(m, true), want: m.expectedInventedWithTests }))
      .filter((r) => JSON.stringify(r.got) !== JSON.stringify(r.want));
    expect(disagreements).toEqual([]);
  });

  it('fires on the one real instance and on no other merge — 1 of 594', () => {
    const firing = CORPUS.merges.filter((m) => inventedFor(m, false).length > 0);
    expect(firing.map((m) => m.sha.slice(0, 8))).toEqual(['d59c74bf']);
    expect(inventedFor(firing[0], false)).toEqual([VITE_CONFIG]);
  });

  it('adds exactly the test-file instance when tests are included — 2 of 594', () => {
    const firing = CORPUS.merges.filter((m) => inventedFor(m, true).length > 0);
    expect(firing.map((m) => m.sha.slice(0, 8)).sort()).toEqual(['6f2b8f21', 'd59c74bf']);
  });

  it('reports zero false positives across the whole corpus', () => {
    // The number that decides whether this can be a required check. WIC-1979
    // rejected the loose `--cc` rule at 47 merges (7.9%); the gated rule fires
    // on 1 (0.17%), and every one of the other 593 must stay silent.
    const clean = CORPUS.merges.filter((m) => m.expectedInvented.length === 0);
    expect(clean.length).toBe(593);
    expect(clean.filter((m) => inventedFor(m, false).length > 0)).toEqual([]);
  });
});

describe('the non-gated class is a documented superset, and must stay one', () => {
  it('contains every file the git-driven script calls a resolution', () => {
    // The API detector cannot tell a hand-written blend from an ordinary clean
    // auto-merge — that needs line content, not blob shas — so its `contested`
    // class is BROADER than the script's `resolved`. Broader is safe and is why
    // the sweeper does not publish it. NARROWER would mean the blob-only rule
    // had started missing real resolutions, so containment is pinned here.
    const missing: string[] = [];
    for (const m of CORPUS.merges) {
      if (m.scriptResolved.length === 0) continue;
      const { parentMaps, resultMap } = decodeMerge(m, { includeTests: false });
      const findings: Finding[] = inspectMergeBlobMaps({ sha: m.sha, parentMaps, resultMap });
      const contested = new Set(verdictFor(findings).contested.map((f: Finding) => f.file));
      for (const file of m.scriptResolved) {
        if (!contested.has(file)) missing.push(`${m.sha.slice(0, 8)} ${file}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('is strictly broader, which is the reason it is never reported as `resolved`', () => {
    let contestedTotal = 0;
    for (const m of CORPUS.merges) {
      const { parentMaps, resultMap } = decodeMerge(m, { includeTests: false });
      const findings: Finding[] = inspectMergeBlobMaps({ sha: m.sha, parentMaps, resultMap });
      contestedTotal += verdictFor(findings).contested.length;
    }
    expect(contestedTotal).toBe(161);
    expect(contestedTotal).toBeGreaterThan(75);
  });
});

// ---------------------------------------------------------------------------
// AC-1: the workflow's inlined copy must not drift from the tested module
// ---------------------------------------------------------------------------

describe('shared core — the sweeper embeds this module verbatim', () => {
  // The sweeper has no `actions/checkout` (that is what makes it safe on
  // `pull_request_target`), so it cannot import the module and must inline it.
  // Everything the parity corpus above proves is therefore only true of the
  // WORKFLOW if the two copies are identical. skip-ci-sweeper.yml handles the
  // same problem with a "keep in sync" comment; this pins it instead.
  const BEGIN = '// >>> SHARED-CORE BEGIN';
  const END = '// >>> SHARED-CORE END';

  function region(text: string): string {
    const from = text.indexOf(BEGIN);
    const to = text.indexOf(END);
    // Guard both markers: a rename or a botched edit must fail here rather than
    // extract an empty string and compare '' to '' successfully.
    expect(from, 'SHARED-CORE BEGIN marker missing').toBeGreaterThan(-1);
    expect(to, 'SHARED-CORE END marker missing').toBeGreaterThan(from);
    return text.slice(text.indexOf('\n', from) + 1, to);
  }

  /** Strip the common YAML indentation the `script: |` block adds. */
  function dedent(text: string): string {
    const indents = text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.length - l.trimStart().length);
    const pad = Math.min(...indents);
    return text
      .split('\n')
      .map((l) => (l.trim() ? l.slice(pad) : ''))
      .join('\n');
  }

  const moduleSrc = readFileSync(
    fileURLToPath(new URL('../scripts/evil-merge-api-detector.mjs', import.meta.url)),
    'utf8'
  );
  const workflowSrc = readFileSync(
    fileURLToPath(new URL('../../../.github/workflows/evil-merge-sweeper.yml', import.meta.url)),
    'utf8'
  );

  it('is byte-identical once dedented and stripped of `export`', () => {
    // `export` is the only permitted difference: a github-script body is a
    // function body, where the keyword is a syntax error.
    const fromModule = region(moduleSrc).replaceAll('export ', '').trimEnd();
    const fromWorkflow = dedent(region(workflowSrc)).trimEnd();
    expect(fromWorkflow).toBe(fromModule);
  });

  it('actually contains the decision procedure, so the check cannot pass on nothing', () => {
    const body = dedent(region(workflowSrc));
    for (const symbol of [
      'ABSENT_BLOB',
      'isGatedPath',
      'blobMapFromTree',
      'assertTreeComplete',
      'classifyBlobs',
      'inspectMergeBlobMaps',
      'verdictFor',
      'describeVerdict',
    ]) {
      expect(body, `workflow copy is missing ${symbol}`).toContain(`${symbol}`);
    }
    expect(body.split('\n').length).toBeGreaterThan(100);
  });

  it('the workflow carries no checkout and no run: step', () => {
    // The security property the whole `pull_request_target` choice rests on.
    // Asserted on the file, not on prose in its header.
    expect(workflowSrc).toContain('pull_request_target');
    expect(workflowSrc).not.toMatch(/^\s*-?\s*uses:\s*actions\/checkout/m);
    expect(workflowSrc).not.toMatch(/^\s{6,}run:\s/m);
  });

  it('names the status context the ruleset requires', () => {
    expect(workflowSrc).toContain("const CONTEXT = 'evil-merge-sweep';");
  });
});

// ---------------------------------------------------------------------------
// The published status
// ---------------------------------------------------------------------------

describe('describeVerdict — fits the commit-status API’s 140-char field', () => {
  it('states the clean case with the number of merges actually inspected', () => {
    const text = describeVerdict(verdictFor([]), { mergesInspected: 3 });
    expect(text).toContain('3 merge commit(s)');
    expect(text.length).toBeLessThanOrEqual(140);
  });

  it('names the offending files when it fails', () => {
    const findings = [{ file: VITE_CONFIG, kind: 'invented', newFile: false, sha: 'd59c74bf' }];
    const text = describeVerdict(verdictFor(findings), { mergesInspected: 1 });
    expect(text).toContain(VITE_CONFIG);
    expect(text).toContain('1 file(s)');
  });

  it('truncates rather than letting the API cut a path mid-string', () => {
    // The statuses API silently clips past 140, which would sever the last path
    // and read as a different finding. Truncating with an ellipsis says so.
    const many = Array.from({ length: 8 }, (_, i) => ({
      file: `packages/web/src/some/deeply/nested/component-number-${i}.tsx`,
      kind: 'invented',
      newFile: false,
      sha: 'd59c74bf',
    }));
    const text = describeVerdict(verdictFor(many), { mergesInspected: 1 });
    expect(text.length).toBeLessThanOrEqual(140);
    expect(text.endsWith('...')).toBe(true);
  });
});
