import { describe, expect, it } from 'vitest';

import { formatFileSize } from './formatFileSize';

/**
 * WIC-2308 / WIC-2310. `utils/formatFileSize.ts` is the one way this app renders a
 * byte count. This is the guard that keeps it the only one — for a copy whose whole
 * render sits on one line. That qualifier is load-bearing; see SCOPE, HONESTLY.
 *
 * The home alone guarantees nothing. WIC-1382 landed `constants/upload.ts` *and*
 * `upload.drift.test.ts`, and extracting three copies is what stops the fourth only
 * if something fails when the fourth appears. WIC-2299 is the receipt: `ResumeUpload`
 * held a private `formatFileSize` that divided by 1024*1024 and always printed MB, so
 * a 42KB .docx rendered `0.0 MB / 0.0 MB` for the whole upload.
 *
 * WHAT THIS IS KEYED ON, AND WHY NOT `/ 1024` (WIC-2310)
 * -----------------------------------------------------
 * The obvious key is a literal `/ 1024`. Measured against `main` at `beef2ce3`, that
 * pattern matches 4 lines and **does not match the WIC-2299 defect itself**:
 *
 *     return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;   // ResumeUpload.tsx:268
 *
 * The open paren after the slash breaks it. So a fourth private copy written in the
 * MB-only shape — precisely the shape that produced `0.0 MB / 0.0 MB` — would sail
 * past a guard keyed that way, and both existing MB rungs are invisible to it too. A
 * guard that cannot see the bug in its own source card is not a guard.
 *
 * Widening to `\b1024\b` fails the other way: 35 matching lines on that same tree, 26
 * of which render nothing. It fires on `MAX_RESUME_SIZE_BYTES` (the subject of a
 * different guard), on `upload.drift.test.ts` and `upload-limit-drift.test.ts` — i.e.
 * on the existing guards — and on every `if (bytes < 1024)` range check. That is a red
 * `main` on arrival.
 *
 * So the key is the **conjunction** that actually defines the hazard: a quantity
 * divided by 1024 at any nesting, formatted, and adjacent to a unit literal. On
 * `beef2ce3` that selects 8 lines: all 7 real byte renders across all 5 formatter
 * sites, plus one false positive, pinned below.
 *
 * SCOPE, HONESTLY
 * ---------------
 * **The conjunction is matched per LINE, and that is the load-bearing limit** — not
 * the test-file exclusion below, which is the one that reads like the whole story.
 * DIV, FMT and UNIT must all hit the *same trimmed line*, so the identical defect
 * split across two lines carries all three signals and matches on neither:
 *
 *     const mb = (bytes / (1024 * 1024)).toFixed(1);   // DIV + FMT, no UNIT
 *     return `${mb} MB`;                               // UNIT, no DIV or FMT
 *
 * Measured with matched mutants planted at the same insertion point in
 * `ProjectDetail.tsx` (WIC-2318): the one-line form goes red and names the line; the
 * two-line form passes 10/10. So the property established here is "no fourth private
 * copy **written on one line**", which is narrower than "no fourth private copy". Do
 * not cite it as the latter.
 *
 * That shape is not contrived — it is what this codebase already does the moment the
 * value goes through a variable. The `sizeMB` renderer in `ResumeUploadZone` (see
 * ALLOWED_LINES) is a live in-tree instance. It is benign, a *limit* render of the
 * same class as the line pinned there, so this is a disclosure and not an unguarded
 * defect; its value is as proof that the evasion shape is natural.
 *
 * Widening is deliberately **not** attempted here (WIC-2318). A function-scope or
 * AST-aware window is a separate card and would have to be costed against the
 * false-positive population the way WIC-2310 costed `\b1024\b` — a naive multi-line
 * window would very likely re-introduce exactly the FPs the current key was chosen to
 * avoid. There is no live defect to justify that trade today.
 *
 * Test files are excluded, so a byte render inside a fixture is not caught. That is
 * deliberate and is the same call `stale.drift.test.ts` makes — a fixture renders
 * nothing to a user, and including them would make this file fail on its own negative
 * controls below. This catches the user-facing class, tree-wide, which is more than
 * the file-scoped guards it joins.
 */

// Project-root-relative so the keys are stable paths rather than a mix of `./` and
// `../` that depends on where this file happens to live.
const MODULES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * The single home. It is *supposed* to contain the ladder, so it is the one file
 * exempt from the scan — exactly as `stale.drift.test.ts` exempts
 * `/src/constants/stale.ts` from its own tree-wide sweep.
 *
 * This exemption is not optional. `formatFileSize.ts` carries two lines that match the
 * hazard conjunction (its KB and MB rungs), so a scan without it is red the moment the
 * home lands — the guard would forbid the fix it exists to protect.
 */
const HOME = '/src/utils/formatFileSize.ts';

/** A quantity divided by 1024, at any nesting: tolerates `/ (1024 * 1024)`. */
const DIV = /\/\s*\(?\s*1024/;
/** ...formatted for display. */
const FMT = /\.toFixed\s*\(/;
/** ...and adjacent to a unit literal, either quoted or straight out of a `}`. */
const UNIT = /[`'"]\s*(?:B|KB|MB|GB)\b|\}\s*(?:B|KB|MB|GB)\b/;

/**
 * Comments are stripped before matching, so prose describing the hazard — including
 * this file's own docstring, and `formatFileSize.ts`'s — cannot trip the guard. Code
 * is the only thing under audit.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** The byte-render lines in one file, trimmed, in source order. */
function byteRenderLines(source: string): string[] {
  return stripComments(source)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => DIV.test(line) && FMT.test(line) && UNIT.test(line));
}

/**
 * The one false positive on `beef2ce3`, pinned **by source-line content** rather than
 * by a count (WIC-2310).
 *
 * `ResumeUploadZone` renders the upload *limit* here — "max 10MB" — not a file's size,
 * and always-MB is correct for a constant 10MB cap. Note the class is already split
 * across two shapes: the sibling that computes the same value into `sizeMB` and
 * interpolates it on the next line does **not** match, because the unit literal sits
 * on a different line. That is not a quirk of this file — it is the guard's general
 * per-line limit, stated as such under SCOPE, HONESTLY above. Do not try to express
 * "limit renderer" in the pattern; pin the line.
 *
 * (An earlier revision cited that sibling as `:48`; it is `:49`, and it will move
 * again. Grep for `sizeMB` rather than navigating to either number — a bare line
 * number in a comment is a baseline that rots with no test to notice.)
 *
 * Why content and not `expect(hits).toHaveLength(n)`: a count assertion is
 * byte-indistinguishable from a disarmed guard once the count drops, and this one
 * *will* drop as sites migrate.
 */
const ALLOWED_LINES: Record<string, readonly string[]> = {
  '/src/components/onboarding/ResumeUploadZone.tsx': [
    '{(maxSizeBytes / (1024 * 1024)).toFixed(0)}MB)',
  ],
};

const FILES = Object.keys(MODULES)
  .filter((path) => !/\.test\.tsx?$/.test(path))
  .sort();

function offendingLines(path: string): string[] {
  const allowed = ALLOWED_LINES[path] ?? [];
  return byteRenderLines(MODULES[path]).filter((line) => !allowed.includes(line));
}

describe('formatFileSize is the only byte renderer in packages/web', () => {
  it('scans a file set that actually contains the surfaces under guard', () => {
    // An empty or truncated glob is a vacuous pass that looks exactly like a clean
    // one. Pin the scope before trusting the verdict.
    expect(FILES).toContain(HOME);
    expect(FILES).toContain('/src/components/ResumeUpload.tsx');
    expect(FILES).toContain('/src/components/ResumeExportList.tsx');
    expect(FILES).toContain('/src/components/onboarding/ResumeUploadZone.tsx');
    expect(FILES).toContain('/src/pages/ProjectDetail.tsx');
    expect(FILES).toContain('/src/pages/ResumeManager.tsx');
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('holds no byte renderer outside the shared home', () => {
    const offenders = FILES.filter((path) => path !== HOME)
      .flatMap((path) => offendingLines(path).map((line) => `${path}: ${line}`))
      .sort();
    expect(
      offenders,
      'Inline byte renderer outside utils/formatFileSize.ts. Import formatFileSize ' +
        'instead of re-deriving the ladder — a fourth private copy is how the third ' +
        'one drifted (WIC-2299). If this is genuinely not a file-size render, pin the ' +
        'line in ALLOWED_LINES with a comment saying what it renders.'
    ).toEqual([]);
  });

  it('still recognises the home as a byte renderer', () => {
    // The home is exempt, not unexamined. If `formatFileSize.ts` stops matching the
    // hazard shape, the pattern has drifted away from the code it is keyed on and
    // every result above is suspect — this is the assertion that stops the exemption
    // from quietly becoming the whole guard.
    expect(byteRenderLines(MODULES[HOME]).length).toBeGreaterThan(0);
  });

  it('keeps every ALLOWED_LINES entry live', () => {
    // A pin that stops matching is a baseline that has rotted: the line moved or was
    // deleted, and the allowlist silently narrows the guard rather than failing. Each
    // entry must still correspond to a real line in its file.
    const dead = Object.entries(ALLOWED_LINES).flatMap(([path, lines]) => {
      const present = byteRenderLines(MODULES[path] ?? '');
      return lines.filter((line) => !present.includes(line)).map((line) => `${path}: ${line}`);
    });
    expect(dead, 'ALLOWED_LINES entry no longer matches any line — remove it').toEqual([]);
  });
});

describe('the guard fires on the shapes that motivated it', () => {
  // Negative controls. `offenders` is asserted empty above, and an empty result is
  // exactly what a broken scan returns too — these bodies are the proof it can still
  // see something.

  it('fires on the WIC-2299 defect, verbatim', () => {
    // `ResumeUpload.tsx:268` as it stood on `main` at `beef2ce3`. This is the line the
    // `/ 1024` key misses, and the entire reason WIC-2310 re-keyed this guard.
    const before = 'return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;';
    expect(byteRenderLines(before)).toHaveLength(1);
  });

  it('is not satisfied by the `/ 1024` key that WIC-2308 originally specified', () => {
    // The control that makes the re-key a measurement rather than an opinion: the
    // originally-specified pattern is green on the defect above.
    const before = 'return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;';
    expect(/\/\s*1024/.test(before)).toBe(false);
  });

  it('fires on both KB-only stragglers WIC-2308 migrates', () => {
    const uploadZoneBefore =
      '{uploadedResume.fileName} ({(uploadedResume.fileSize / 1024).toFixed(1)} KB)';
    const projectDetailBefore = '{(file.size / 1024).toFixed(1)} KB';
    expect(byteRenderLines(uploadZoneBefore)).toHaveLength(1);
    expect(byteRenderLines(projectDetailBefore)).toHaveLength(1);
  });

  it('does not fire on a range check or a bare limit constant', () => {
    // The two classes that made the `\b1024\b` widening ship a red `main`.
    expect(byteRenderLines('if (bytes < 1024) return `${bytes} B`;')).toEqual([]);
    expect(byteRenderLines('export const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024;')).toEqual([]);
  });

  it('does not fire on prose describing the hazard', () => {
    // WIC-2308's own remedy text, and this file's docstring, both name the shape.
    const prose = '// a copy that divided by (1024 * 1024) and printed `${x.toFixed(1)} MB`';
    expect(byteRenderLines(prose)).toEqual([]);
  });
});

describe('formatFileSize renders the ladder the stragglers got wrong', () => {
  it('uses KB below a megabyte and MB above it', () => {
    // A 42KB resume is the WIC-2299 case: the private MB-only copy rendered `0.0 MB`.
    expect(formatFileSize(42 * 1024)).toBe('42.0 KB');
    expect(formatFileSize(7 * 1024 * 1024)).toBe('7.0 MB');
    expect(formatFileSize(512)).toBe('512 B');
  });
});
