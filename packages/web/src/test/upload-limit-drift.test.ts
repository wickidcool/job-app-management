import { describe, expect, it } from 'vitest';

// Pulled in as text with Vite's `?raw`, the idiom `route-integrity.test.ts` and
// `upload.drift.test.ts` (PR #143) already use for this kind of static audit.
//
// Not `node:fs`: `packages/web` compiles with `types: ["vite/client"]` and no node
// types, so a filesystem read does not typecheck, and `import.meta.url` resolves to
// an `http:` URL under jsdom. `?raw` also fails the build outright if one of these
// files moves, rather than degrading into a check that passes over nothing.
import apiResumesRoute from '../../../api/src/routes/resumes.ts?raw';
import componentSpecsDoc from '../../../../docs/design/COMPONENT_SPECS.md?raw';
import onboardingFlowDoc from '../../../../docs/design/ONBOARDING_FLOW.md?raw';
import resumeUploadExportFlowDoc from '../../../../docs/design/RESUME_UPLOAD_EXPORT_FLOW.md?raw';
import resumeUploadZoneSource from '../components/onboarding/ResumeUploadZone.tsx?raw';
import resumeUploadSource from '../components/ResumeUpload.tsx?raw';

/**
 * WIC-1445. The resume size limit is written down in seven places across three
 * packages and three design docs, and until now exactly one pair of them was
 * connected by a check.
 *
 * The API is the only surface that can actually reject an upload, so it is the
 * canonical number here. Everything else — every client-side pre-check, every
 * line of design-doc prose that quotes a cap — is a copy, and this audit fails
 * when a copy disagrees with the original.
 *
 * Why prose is in scope: WIC-1436 exists because `ONBOARDING_FLOW.md` sat at 5MB
 * for the entire life of the 10MB server limit, and its error-state copy ended up
 * specifying a message that contradicts the one the product should show. The
 * chain WIC-1069 -> WIC-1184 -> WIC-1187 -> WIC-1195 is four tickets spent on one
 * under-specified design-doc line. A convention that says "don't restate the
 * number" is not enforcement; this is.
 *
 * Deliberately NOT covered: `packages/web/src/constants/upload.ts` and its
 * `upload.drift.test.ts`, which land with PR #143 (WIC-1382) and already pin
 * `MAX_RESUME_SIZE_BYTES` against the API constant. This file covers the surfaces
 * that guard leaves open, and the two are complementary rather than overlapping.
 */

/**
 * The limit the server enforces, in MB. This is the number every other surface
 * is measured against.
 *
 * The regex is anchored to the start of a line and required to match exactly
 * once, both lessons already paid for by `upload.drift.test.ts` (WIC-1421,
 * WIC-1462): unanchored, a stale value in a `// was:` comment shadows the real
 * declaration; unbounded, a stale copy at column 0 inside a block comment makes
 * "the first hit" arbitrary. Either way the guard passes while the numbers are
 * apart.
 */
function apiLimitMB(): number {
  const matches = [
    ...apiResumesRoute.matchAll(/^const MAX_FILE_SIZE\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024\s*;/gm),
  ];

  expect(
    matches.length,
    'Expected exactly one column-0 `const MAX_FILE_SIZE = <n> * 1024 * 1024;` in ' +
      `packages/api/src/routes/resumes.ts, found ${matches.length}. If the API reshaped ` +
      'that constant, re-point this audit at its new home — do not delete it.'
  ).toBe(1);

  return Number(matches[0]![1]);
}

/**
 * Phrasings that state *the limit*. Capture group 1 is the figure in MB.
 *
 * Keeping these explicit — rather than scanning for any `\d+MB` — is what lets the
 * audit run over prose at all. `ONBOARDING_FLOW.md:970` legitimately reads
 * "User uploads 50MB file (exceeds 5MB limit)": one sentence, two figures, only
 * one of which is the cap.
 */
const LIMIT_PATTERNS: readonly RegExp[] = [
  // "max 5MB", "Max 10MB", "Maximum size is 5MB", "maximum size: 10MB"
  /\bmax(?:imum)?\s*(?:size\s*)?(?:is\s*|:\s*)?(\d+)\s*MB\b/gi,
  // "< 5MB", "under 10MB". No leading `\b`: `<` is not a word character, so a word
  // boundary before it never holds and the `<` form goes unread. Caught by the
  // unclassified-figure check below, which is the entire reason it exists.
  /(?:<\s*|\bunder\s+)(\d+)\s*MB\b/gi,
  // "exceeds 5MB limit", "exceeds the 10MB limit"
  /\bexceeds\s+(?:the\s+)?(\d+)\s*MB\s+limit\b/gi,
  // "// 5MB" trailing a byte expression in a fenced code block
  /\/\/\s*(\d+)\s*MB\b/gi,
  // "5 * 1024 * 1024" in a fenced code block. Has no "MB" of its own, so it never
  // needs classifying below — it only contributes a value.
  /\b(\d+)\s*\*\s*1024\s*\*\s*1024\b/g,
];

/**
 * Phrasings that are *not* the limit and must not be measured against it: a
 * concrete file size in an example, or a progress readout.
 */
const EXAMPLE_PATTERNS: readonly RegExp[] = [
  // "2.3 MB", "50.2MB", "1.2 MB / 1.9 MB" — a decimal is never a stated cap.
  /\b\d+\.\d+\s*MB\b/gi,
  // "50MB file", "Drop 15MB file" — the over-limit example.
  /\b\d+\s*MB\s+file\b/gi,
];

interface Span {
  start: number;
  end: number;
}

function spansOf(source: string, patterns: readonly RegExp[]): Span[] {
  const spans: Span[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      spans.push({ start: match.index!, end: match.index! + match[0].length });
    }
  }
  return spans;
}

function limitFiguresIn(source: string): number[] {
  const figures: number[] = [];
  for (const pattern of LIMIT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      figures.push(Number(match[1]));
    }
  }
  return figures;
}

/**
 * Every `<n>MB` in the file that is neither a stated limit nor a recognised
 * example. A non-empty result means someone reworded a cap into a phrasing
 * `LIMIT_PATTERNS` does not know, and the audit has quietly stopped covering
 * that line — the exact vacuous-pass failure WIC-1421 caught in
 * `upload.drift.test.ts`.
 */
function unclassifiedFiguresIn(source: string): string[] {
  const classified = [...spansOf(source, LIMIT_PATTERNS), ...spansOf(source, EXAMPLE_PATTERNS)];
  const unclassified: string[] = [];

  for (const match of source.matchAll(/\b\d+(?:\.\d+)?\s*MB\b/gi)) {
    const start = match.index!;
    const end = start + match[0].length;
    const covered = classified.some((span) => span.start <= start && span.end >= end);
    if (covered) continue;

    const line = source.slice(0, start).split('\n').length;
    unclassified.push(`${line}: ${match[0]} — ${source.split('\n')[line - 1]!.trim()}`);
  }

  return unclassified;
}

/**
 * The design docs that quote the resume cap, with the number of limit figures each
 * is expected to contain.
 *
 * The counts are asserted, not just the values. Without them a doc could drop its
 * last cap mention — or reword every one of them out of `LIMIT_PATTERNS`' reach —
 * and this audit would pass over an empty set and report success. A count that
 * needs updating when someone legitimately adds a cap line is the intended cost:
 * it puts a human on the change.
 */
const AUDITED_DOCS = [
  {
    path: 'docs/design/COMPONENT_SPECS.md',
    source: componentSpecsDoc,
    limitFigureCount: 3,
  },
  {
    path: 'docs/design/RESUME_UPLOAD_EXPORT_FLOW.md',
    source: resumeUploadExportFlowDoc,
    limitFigureCount: 2,
  },
  {
    // Currently at 5MB against a 10MB server. PR #150 (WIC-1436) moves all of them.
    // Nine figures across eight lines: `:253` states the cap twice, once as a byte
    // expression and once in the trailing comment, and both have to agree.
    path: 'docs/design/ONBOARDING_FLOW.md',
    source: onboardingFlowDoc,
    limitFigureCount: 9,
  },
] as const;

describe('resume upload size limit', () => {
  it('the API declares exactly one enforceable limit', () => {
    expect(apiLimitMB()).toBeGreaterThan(0);
  });

  /**
   * Reachability lives here, in a plain `it`, and deliberately not inside the
   * `it.fails` trip-wires below.
   *
   * `it.fails` passes when its body throws — and it cannot tell an assertion that
   * failed on the real data from one that threw because a path stopped resolving
   * or a regex stopped matching. A trip-wire whose file has moved is green, and
   * green for the wrong reason (WIC-1485). So the trip-wires carry nothing but a
   * value comparison, and every read they depend on is proven here instead, where
   * a broken path or a vanished figure is RED.
   */
  it('every audited file is readable and its limit figures are located', () => {
    expect(apiResumesRoute).toContain('MAX_FILE_SIZE');
    expect(resumeUploadSource).toContain('DEFAULT_MAX_SIZE_MB');
    expect(resumeUploadZoneSource).toContain('DEFAULT_MAX_SIZE_BYTES');

    for (const doc of AUDITED_DOCS) {
      expect(limitFiguresIn(doc.source), `${doc.path}: limit figures`).toHaveLength(
        doc.limitFigureCount
      );
    }
  });

  it('every MB figure in the audited docs is a stated limit or a recognised example', () => {
    for (const doc of AUDITED_DOCS) {
      expect(
        unclassifiedFiguresIn(doc.source),
        `${doc.path} has MB figures this audit cannot classify. Either they state the ` +
          'cap — add the phrasing to LIMIT_PATTERNS — or they are example file sizes, ' +
          'in which case add the phrasing to EXAMPLE_PATTERNS. Leaving them unclassified ' +
          'means the audit is not reading them.'
      ).toEqual([]);
    }
  });

  it('the /resumes/upload surface enforces the API limit', () => {
    // PR #143 (WIC-1382) routes ResumeUploadZone through `MAX_RESUME_SIZE_BYTES` and
    // pins that constant to the API. It does not touch this component, which keeps its
    // own literal — so after #143 lands this is the one client cap with no guard on it.
    const matches = [
      ...resumeUploadSource.matchAll(/^const DEFAULT_MAX_SIZE_MB\s*=\s*(\d+)\s*;/gm),
    ];

    expect(matches.length, 'Expected exactly one `const DEFAULT_MAX_SIZE_MB = <n>;`').toBe(1);
    expect(Number(matches[0]![1])).toBe(apiLimitMB());
  });

  for (const doc of AUDITED_DOCS.filter((d) => d.path !== 'docs/design/ONBOARDING_FLOW.md')) {
    it(`${doc.path} quotes the API limit`, () => {
      const limit = apiLimitMB();
      expect(limitFiguresIn(doc.source)).toEqual(
        Array.from({ length: doc.limitFigureCount }, () => limit)
      );
    });
  }

  /**
   * Trip-wire, not a guard: green while the defect is live, RED the moment it is
   * fixed. PR #143 (WIC-1382) is the fix. When it merges, delete `.fails`.
   *
   * The onboarding zone caps uploads at 5MB while the server accepts 10MB, so a 7MB
   * PDF is refused at the highest-drop-off point in the product with no way around
   * it — the standalone `/resumes/upload` surface takes the same file.
   */
  it.fails('the onboarding upload zone enforces the API limit (WIC-1382 / PR #143)', () => {
    const matches = [
      ...resumeUploadZoneSource.matchAll(
        /^const DEFAULT_MAX_SIZE_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024\s*;/gm
      ),
    ];

    expect(Number(matches[0]![1])).toBe(apiLimitMB());
  });

  /**
   * Trip-wire, not a guard. PR #150 (WIC-1436) moves all eight figures to 10MB;
   * when it merges, delete `.fails`.
   *
   * Note the ordering this enforces. ONBOARDING_FLOW.md is the doc that specifies
   * `<ResumeUploadZone />`, and today its 5MB is an accurate description of that
   * component — it is the *component* that contradicts the server, not the doc.
   * #150 is docs-only and does not touch the component, so if it lands alone the
   * doc becomes wrong about the thing it specifies. Both trip-wires are here so
   * that each PR flips its own, and neither can land silently.
   */
  it.fails('docs/design/ONBOARDING_FLOW.md quotes the API limit (WIC-1436 / PR #150)', () => {
    const limit = apiLimitMB();
    expect(limitFiguresIn(onboardingFlowDoc)).toEqual(Array.from({ length: 9 }, () => limit));
  });
});
