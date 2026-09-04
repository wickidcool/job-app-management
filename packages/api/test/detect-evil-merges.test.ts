/**
 * WIC-1979 — the evil-merge detector's decisions.
 *
 * The script answers one question per file in a merge: *did any parent hold
 * this content?* Getting it wrong is expensive in both directions. A false
 * negative restores the blind spot the card was filed about — content landing
 * in `main` on no reviewable commit. A false positive fails a required check on
 * an ordinary conflict resolution, and at the historical rate of 47 merges in
 * 594 that would train everyone to ignore it.
 *
 * So the fixtures below are **real `git show --cc` output**, pasted verbatim
 * from this repository, not hand-written approximations of the format. The
 * parser's whole job is to read git's grammar, and a fixture invented to match
 * the parser would test nothing. The two headline fixtures are the two
 * instances that exist in the entire history of `main`:
 *
 *   d59c74bf  packages/web/vite.config.ts   b45d1f2f,b45d1f2f..0ed7b909
 *   6f2b8f21  .../dashboard.metrics.test.ts 00000000,00000000..82c60435
 *
 * `inspectMerge` and `mergesIn` take an injectable `runner`, so every test here
 * runs without a git repository and without depending on this repo's history
 * staying as it is today.
 */
import { describe, it, expect } from 'vitest';
import {
  isAbsent,
  parseCombinedDiff,
  classifyFile,
  pathspecFor,
  verdict,
  mergesIn,
  inspectMerge,
  SOURCE_PATHSPEC,
  // @ts-expect-error — plain .mjs ops script, no type declarations
} from '../scripts/detect-evil-merges.mjs';

/** Verbatim `git show --cc --format= d59c74bf -- packages/web/vite.config.ts`. */
const EVIL_MERGE_DIFF = `diff --cc packages/web/vite.config.ts
index b45d1f2f,b45d1f2f..0ed7b909
--- a/packages/web/vite.config.ts
+++ b/packages/web/vite.config.ts
@@@ -5,6 -5,6 +5,9 @@@ import react from '@vitejs/plugin-react
   export default defineConfig({
     plugins: [react()],
     server: {
++    fs: {
++      allow: ['..'],
++    },
       proxy: {
`;

/** Verbatim head of the merge that created a test file present in no parent. */
const NEW_FILE_DIFF = `diff --cc packages/api/test/dashboard.metrics.test.ts
index 00000000,00000000..82c60435
new file mode 100644
--- /dev/null
+++ b/packages/api/test/dashboard.metrics.test.ts
@@@ -1,0 -1,0 +1,329 @@@
++/**
++ * \`GET /dashboard\` — metric definitions (WIC-1515, AC-T1e).
++ */
`;

/** Verbatim: two files whose parents genuinely disagreed — a real resolution. */
const RESOLUTION_DIFF = `diff --cc packages/web/src/components/wizard/WizardContainer.tsx
index 06028a78,cd8befab..9ac9f0da
--- a/packages/web/src/components/wizard/WizardContainer.tsx
+++ b/packages/web/src/components/wizard/WizardContainer.tsx
@@@ -1,3 -1,3 +1,4 @@@
++const merged = true;
diff --cc packages/web/src/pages/DialogueCapture.tsx
index 1c718c6d,6f51a30b..f0fe87d5
--- a/packages/web/src/pages/DialogueCapture.tsx
+++ b/packages/web/src/pages/DialogueCapture.tsx
@@@ -1,3 -1,3 +1,4 @@@
++const other = 1;
`;

describe('isAbsent — all-zero blob means the file was not in that parent', () => {
  it('reads the all-zero id as absent', () => {
    expect(isAbsent('00000000')).toBe(true);
    expect(isAbsent('0000000000000000000000000000000000000000')).toBe(true);
  });

  it('does not mistake a real blob that merely starts with zeros', () => {
    expect(isAbsent('0ed7b909')).toBe(false);
    expect(isAbsent('b45d1f2f')).toBe(false);
  });
});

describe('parseCombinedDiff — read git’s combined index grammar', () => {
  it('extracts file, both parents and the result from real evil-merge output', () => {
    expect(parseCombinedDiff(EVIL_MERGE_DIFF)).toEqual([
      {
        file: 'packages/web/vite.config.ts',
        parents: ['b45d1f2f', 'b45d1f2f'],
        result: '0ed7b909',
      },
    ]);
  });

  it('handles a new-file combined diff, where both parents are all-zero', () => {
    expect(parseCombinedDiff(NEW_FILE_DIFF)).toEqual([
      {
        file: 'packages/api/test/dashboard.metrics.test.ts',
        parents: ['00000000', '00000000'],
        result: '82c60435',
      },
    ]);
  });

  it('returns one entry per file when a merge touches several', () => {
    const entries = parseCombinedDiff(RESOLUTION_DIFF);
    expect(entries.map((e: { file: string }) => e.file)).toEqual([
      'packages/web/src/components/wizard/WizardContainer.tsx',
      'packages/web/src/pages/DialogueCapture.tsx',
    ]);
    expect(entries[1]).toEqual({
      file: 'packages/web/src/pages/DialogueCapture.tsx',
      parents: ['1c718c6d', '6f51a30b'],
      result: 'f0fe87d5',
    });
  });

  it('splits an octopus merge on `..` first, so 3 parents do not corrupt the result', () => {
    // The parent list is comma-separated and the result is dot-separated;
    // splitting on ',' first would put "cccccccc..dddddddd" in the last parent.
    const entries = parseCombinedDiff(
      'diff --cc src/a.ts\nindex aaaaaaaa,bbbbbbbb,cccccccc..dddddddd\n'
    );
    expect(entries).toEqual([
      { file: 'src/a.ts', parents: ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'], result: 'dddddddd' },
    ]);
  });

  it('tolerates a trailing mode on the index line', () => {
    const entries = parseCombinedDiff(
      'diff --cc src/a.ts\nindex aaaaaaaa,aaaaaaaa..bbbbbbbb 100644\n'
    );
    expect(entries[0].result).toBe('bbbbbbbb');
  });

  it('yields nothing for a file with no index line — a pure mode change carries no content', () => {
    expect(parseCombinedDiff('diff --cc src/run.sh\nold mode 100644\nnew mode 100755\n')).toEqual(
      []
    );
  });

  it('does not attribute an index line to a file it did not follow', () => {
    // A stray index line with no preceding `diff --cc` must not latch onto the
    // previous file, or one entry would be reported twice under one name.
    const entries = parseCombinedDiff(
      'diff --cc src/a.ts\nindex aaaaaaaa,aaaaaaaa..bbbbbbbb\nindex cccccccc,cccccccc..dddddddd\n'
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].result).toBe('bbbbbbbb');
  });

  it('returns nothing for empty output — the clean case', () => {
    expect(parseCombinedDiff('')).toEqual([]);
  });
});

describe('classifyFile — invented content vs a genuine resolution', () => {
  it('calls it invented when every parent agreed yet the result differs', () => {
    const [entry] = parseCombinedDiff(EVIL_MERGE_DIFF);
    expect(classifyFile(entry)).toMatchObject({
      file: 'packages/web/vite.config.ts',
      kind: 'invented',
      newFile: false,
    });
  });

  it('marks a file absent from every parent as invented AND newFile', () => {
    const [entry] = parseCombinedDiff(NEW_FILE_DIFF);
    expect(classifyFile(entry)).toMatchObject({ kind: 'invented', newFile: true });
  });

  it('calls it resolved when the parents disagreed — this is the 47/594 class, not gated', () => {
    for (const entry of parseCombinedDiff(RESOLUTION_DIFF)) {
      expect(classifyFile(entry)).toMatchObject({ kind: 'resolved', newFile: false });
    }
  });

  it('calls it unchanged when the result equals the agreed parent blob', () => {
    expect(
      classifyFile({ file: 'a.ts', parents: ['aaaaaaaa', 'aaaaaaaa'], result: 'aaaaaaaa' })
    ).toMatchObject({ kind: 'unchanged' });
  });

  it('needs ALL parents to agree, not just the first two', () => {
    expect(classifyFile({ file: 'a.ts', parents: ['aa', 'aa', 'bb'], result: 'cc' })).toMatchObject(
      { kind: 'resolved' }
    );
    expect(classifyFile({ file: 'a.ts', parents: ['aa', 'aa', 'aa'], result: 'cc' })).toMatchObject(
      { kind: 'invented' }
    );
  });
});

describe('pathspecFor — what the gate actually looks at', () => {
  it('excludes tests by default', () => {
    const spec = pathspecFor();
    expect(spec).toEqual(expect.arrayContaining(SOURCE_PATHSPEC));
    expect(spec).toContain(':!*.test.*');
    expect(spec).toContain(':!*/test/*');
  });

  it('drops every exclusion under --include-tests', () => {
    expect(pathspecFor({ includeTests: true })).toEqual(SOURCE_PATHSPEC);
  });

  it('does not let a caller mutate the shared constant', () => {
    pathspecFor({ includeTests: true }).push(':!*.oops');
    expect(SOURCE_PATHSPEC).not.toContain(':!*.oops');
  });
});

describe('verdict — only invented content fails the gate', () => {
  it('passes and exits 0 when there is nothing invented', () => {
    expect(verdict([])).toMatchObject({ ok: true, exitCode: 0 });
  });

  it('passes on resolutions alone, but still carries them for --report', () => {
    const v = verdict([{ kind: 'resolved', file: 'a.ts' }]);
    expect(v).toMatchObject({ ok: true, exitCode: 0 });
    expect(v.resolved).toHaveLength(1);
    expect(v.invented).toHaveLength(0);
  });

  it('fails with exit 2 on invented content', () => {
    const v = verdict([
      { kind: 'invented', file: 'a.ts' },
      { kind: 'resolved', file: 'b.ts' },
    ]);
    expect(v).toMatchObject({ ok: false, exitCode: 2 });
    expect(v.invented).toHaveLength(1);
  });
});

describe('mergesIn — enumerate merge commits', () => {
  it('asks git for merges in the range and drops blank lines', () => {
    const calls: string[][] = [];
    const runner = (args: string[]) => {
      calls.push(args);
      return 'aaaa\nbbbb\n\n';
    };
    expect(mergesIn('origin/main..HEAD', runner)).toEqual(['aaaa', 'bbbb']);
    expect(calls[0]).toEqual(['rev-list', '--merges', 'origin/main..HEAD']);
  });

  it('returns nothing for a range with no merges', () => {
    expect(mergesIn('a..b', () => '\n')).toEqual([]);
  });
});

describe('inspectMerge — the whole pass, over real git output', () => {
  it('flags the vite.config.ts instance and stamps it with the sha', () => {
    const findings = inspectMerge('d59c74bf', {}, () => EVIL_MERGE_DIFF);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sha: 'd59c74bf',
      file: 'packages/web/vite.config.ts',
      kind: 'invented',
    });
  });

  it('passes the test-excluding pathspec to git by default', () => {
    let seen: string[] = [];
    inspectMerge('abc', {}, (args: string[]) => {
      seen = args;
      return '';
    });
    expect(seen.slice(0, 4)).toEqual(['show', '--cc', '--format=', 'abc']);
    expect(seen).toContain('--');
    expect(seen).toContain(':!*.test.*');
  });

  it('widens the pathspec under includeTests', () => {
    let seen: string[] = [];
    inspectMerge('abc', { includeTests: true }, (args: string[]) => {
      seen = args;
      return '';
    });
    expect(seen).not.toContain(':!*.test.*');
  });

  it('drops unchanged files so they never reach the verdict', () => {
    const findings = inspectMerge(
      'abc',
      {},
      () => 'diff --cc a.ts\nindex aaaaaaaa,aaaaaaaa..aaaaaaaa\n'
    );
    expect(findings).toEqual([]);
  });

  it('reports resolutions as findings, so --report can list them', () => {
    const findings = inspectMerge('abc', {}, () => RESOLUTION_DIFF);
    expect(findings).toHaveLength(2);
    expect(verdict(findings)).toMatchObject({ ok: true, exitCode: 0 });
  });

  it('a clean merge produces no findings at all', () => {
    expect(inspectMerge('abc', {}, () => '')).toEqual([]);
  });
});
