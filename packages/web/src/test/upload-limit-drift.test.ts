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
 * Deliberately NOT covered: `upload.drift.test.ts`, which lands with PR #143
 * (WIC-1382) and pins `MAX_RESUME_SIZE_BYTES` against the API constant. This file
 * covers the surfaces that guard leaves open, and the two are complementary.
 */

/* -------------------------------------------------------------------------- */
/* Resolvers                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every resolver below is **pure**: it returns `{ mb: null, how: <diagnosis> }`
 * rather than asserting, and never throws.
 *
 * That is not a style choice, it is the whole load-bearing structure of this file
 * (WIC-1568 / F1). `it.fails` passes when its body throws, and it cannot tell an
 * assertion that failed on the real data from one that threw because a regex
 * stopped matching. A resolver with an `expect` inside it therefore turns every
 * reshape of the code it reads into a *green* trip-wire — the WIC-1485 shape.
 *
 * So: resolvers diagnose, the plain `it`s below assert that every resolver
 * resolved, and the trip-wires carry nothing but a value comparison. An
 * unresolvable surface is RED in `it`, and leaves its trip-wire comparing
 * `null` to a number — which fails, i.e. stays green, and never claims the
 * defect was fixed.
 */
interface Resolution {
  mb: number | null;
  how: string;
}

/** `<n> * 1024 * 1024`, as a column-0 (optionally exported) const declaration. */
function byteConstantPattern(identifier: string): RegExp {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^(?:export\\s+)?const ${escaped}\\s*=\\s*(\\d+)\\s*\\*\\s*1024\\s*\\*\\s*1024\\s*;`,
    'gm'
  );
}

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
function resolveApiLimit(): Resolution {
  const matches = [...apiResumesRoute.matchAll(byteConstantPattern('MAX_FILE_SIZE'))];

  if (matches.length !== 1) {
    return {
      mb: null,
      how:
        'Expected exactly one column-0 `const MAX_FILE_SIZE = <n> * 1024 * 1024;` in ' +
        `packages/api/src/routes/resumes.ts, found ${matches.length}. If the API reshaped ` +
        'that constant, re-point this audit at its new home — do not delete it.',
    };
  }

  return { mb: Number(matches[0]![1]), how: 'packages/api/src/routes/resumes.ts MAX_FILE_SIZE' };
}

/**
 * `packages/web/src/constants/*.ts` as text.
 *
 * `import.meta.glob` rather than a static `?raw` import because the module this
 * needs to reach — `constants/upload.ts`, home of `MAX_RESUME_SIZE_BYTES` — does
 * not exist on `main`; it arrives with PR #143. A static import of a missing file
 * fails the build, so the audit could not otherwise be written against both the
 * pre- and post-#143 trees at once. A glob simply matches whatever is present.
 *
 * (The directory itself is not new — `main` already carries four unrelated
 * constants modules, none of which declares a byte expression. The glob picking
 * them up is harmless: `resolveZoneLimit` only looks for the one identifier
 * `ResumeUploadZone.tsx` actually names.)
 *
 * `*.test.ts` is excluded (WIC-1572). Sibling tests are not a source of truth for
 * a constant's value, and a test that declares its own `<n> * 1024 * 1024` at
 * column 0 would make `resolveZoneLimit` see two declarations and go
 * unresolvable — a RED about arithmetic, not about drift. PR #143 lands exactly
 * such a file (`constants/upload.drift.test.ts`) and gets away with it today only
 * because it happens not to declare one.
 */
const WEB_CONSTANT_MODULES = import.meta.glob(['../constants/*.ts', '!../constants/*.test.ts'], {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>;

/**
 * The cap `<ResumeUploadZone />` actually applies when its only call site
 * (`OnboardingModal.tsx`) passes no `maxSizeBytes` prop — i.e. the onboarding
 * upload cap as shipped.
 *
 * This resolves the *default parameter expression*, then follows the identifier
 * it names, rather than matching a fixed constant name (WIC-1568 / F1). The
 * previous version anchored on `DEFAULT_MAX_SIZE_BYTES`, and PR #143 — the very
 * fix the trip-wire below is aimed at — **deletes** that declaration instead of
 * changing its value:
 *
 *     -const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
 *     -  maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
 *     +  maxSizeBytes = MAX_RESUME_SIZE_BYTES,
 *
 * so the anchored regex matched nothing and the trip-wire stayed green on a
 * swallowed `TypeError`. Following the identifier means the extractor follows the
 * fix: under #143 it resolves through `constants/upload.ts` to 10 and the wire
 * flips, instead of going unresolvable and inviting a repair that silently
 * retires the only guard on this surface.
 */
function resolveZoneLimit(): Resolution {
  const defaults = [
    ...resumeUploadZoneSource.matchAll(/^\s*maxSizeBytes\s*=\s*([A-Za-z_$][\w$]*)\s*,\s*$/gm),
  ];

  if (defaults.length !== 1) {
    return {
      mb: null,
      how:
        'Expected exactly one `maxSizeBytes = <IDENTIFIER>,` default in ' +
        `ResumeUploadZone.tsx's props destructuring, found ${defaults.length}. If the ` +
        'component now resolves its cap some other way, re-point this resolver — and ' +
        're-check whether the trip-wire below should still be `.fails`.',
    };
  }

  const identifier = defaults[0]![1]!;
  const searched: [string, string][] = [
    ['ResumeUploadZone.tsx', resumeUploadZoneSource],
    ...Object.entries(WEB_CONSTANT_MODULES),
  ];

  const declarations: { path: string; mb: number }[] = [];
  for (const [path, source] of searched) {
    for (const match of source.matchAll(byteConstantPattern(identifier))) {
      declarations.push({ path, mb: Number(match[1]) });
    }
  }

  if (declarations.length !== 1) {
    return {
      mb: null,
      how:
        `\`${identifier}\` — the identifier ResumeUploadZone.tsx defaults \`maxSizeBytes\` ` +
        `to — resolved to ${declarations.length} column-0 \`<n> * 1024 * 1024\` declarations ` +
        `(${declarations.map((d) => d.path).join(', ') || 'none'}) across ResumeUploadZone.tsx ` +
        'and packages/web/src/constants/*.ts. Re-point this resolver at wherever the value ' +
        'now lives — and re-check whether the trip-wire below should still be `.fails`.',
    };
  }

  return { mb: declarations[0]!.mb, how: `${identifier} via ${declarations[0]!.path}` };
}

/** The standalone `/resumes/upload` surface's own client-side cap. */
function resolveStandaloneLimit(): Resolution {
  const matches = [...resumeUploadSource.matchAll(/^const DEFAULT_MAX_SIZE_MB\s*=\s*(\d+)\s*;/gm)];

  if (matches.length !== 1) {
    return {
      mb: null,
      how:
        'Expected exactly one column-0 `const DEFAULT_MAX_SIZE_MB = <n>;` in ' +
        `ResumeUpload.tsx, found ${matches.length}.`,
    };
  }

  return { mb: Number(matches[0]![1]), how: 'ResumeUpload.tsx DEFAULT_MAX_SIZE_MB' };
}

/* -------------------------------------------------------------------------- */
/* Doc figure classification                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Phrasings that state *the limit*. Capture group 1 is the figure in MB.
 *
 * Keeping these explicit — rather than scanning for any `\d+MB` — is what lets the
 * audit run over prose at all. `ONBOARDING_FLOW.md` legitimately reads
 * "User uploads 50MB file (exceeds the 10MB limit)": one sentence, two figures,
 * only one of which is the cap.
 */
const LIMIT_PATTERNS: readonly RegExp[] = [
  // "max 5MB", "Max 10MB", "Maximum size is 5MB", "maximum size: 10MB"
  /\bmax(?:imum)?\s*(?:size\s*)?(?:is\s*|:\s*)?(\d+)\s*MB\b/gi,
  // "< 5MB", "<= 10MB", "≤ 10MB", "under 10MB". No leading `\b`: `<` is not a word
  // character, so a word boundary before it never holds and the `<` form goes
  // unread. Caught by the unclassified-figure check below, which is the entire
  // reason it exists. `<=` added for WIC-1568 / F3 — PR #150 rewrites the
  // Validation block to "File size must be <= 10MB".
  /(?:<=?\s*|≤\s*|\bunder\s+)(\d+)\s*MB\b/gi,
  // "exceeds 5MB limit", "exceeds the 10MB limit"
  /\bexceeds\s+(?:the\s+)?(\d+)\s*MB\s+limit\b/gi,
  // "// 5MB" trailing a byte expression in a fenced code block
  /\/\/\s*(\d+)\s*MB\b/gi,
  // "Both are `10 * 1024 * 1024` (10MB)" — an MB gloss parenthesised directly
  // after a byte expression (WIC-1568 / F3). Contextual, not an allowlist: it only
  // fires where a byte expression immediately precedes it.
  /\d+\s*\*\s*1024\s*\*\s*1024\s*[`'"]?\s*\((\d+)\s*MB\)/gi,
  // `The wireframes below quote "10MB" for readability` — a bare quoted figure
  // (WIC-1568 / F3). Requires the quote to abut the digits, so a quoted
  // sentence like "File must be under 10MB" is left to the `under` rule above.
  /["“](\d+)\s*MB["”]/gi,
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

/**
 * Markers that say the figure *following them* is superseded. PR #150 adds
 * "This doc previously specified 5MB, which is where the client's 5MB limit came
 * from", and measuring that against the live cap would fail on correct prose
 * (WIC-1568 / F3).
 *
 * Deliberately narrow on two axes, because an escape hatch is a blind spot:
 *
 * - **Lexically**: a bare `\bwas\b` would exempt most sentences a stale cap could
 *   hide in. Every marker here states explicitly that the figure is superseded.
 * - **Positionally**: the marker must appear *before* the figure, and *in the same
 *   clause* — not merely somewhere earlier on the line (WIC-1572 / F5).
 *
 * Both halves of that positional rule were paid for by a measured mutation.
 * Dropping "before" lets a live cap ride along in front of a trailing
 * "(previously)": `(Max 9MB) (previously)` passed a line-scoped-either-direction
 * version of this rule. Dropping "same clause" is the mirror image, and is what
 * the clause split below fixes — these markers are generic English, so one used
 * for an unrelated reason earlier on the line used to exempt every figure after
 * it. Measured on `560f5df`: rewriting COMPONENT_SPECS.md's spec line as
 *
 *     The inline hint is no longer shown on mobile. PDF, DOCX, TXT (Max 3MB)
 *
 * left the whole file green, shipping a live, wrong 3MB cap unguarded.
 *
 * The hatch also carries its own staleness test — see `historical size mentions
 * are actually historical` below — so it cannot be used to park the *current*
 * figure somewhere unread either. That is WIC-1439's complaint about
 * `KNOWN_DEAD_LINKS` answered up front rather than left for a later ticket.
 *
 * Note the two are complementary and neither subsumes the other: the staleness
 * test only fires when the exempted figure EQUALS the live limit, so it is
 * airtight against parking the *current* figure out of reach and blind to hiding
 * a *stale* one — which is the drift this file exists to catch.
 *
 * The clause split narrows that blind spot; it does not close it, and this
 * comment should not be read as claiming otherwise (WIC-1578). A marker inside a
 * parenthetical still reaches a figure later in the same clause, because `(` and
 * `)` are not clause boundaries. Measured on `5fd367a`:
 *
 *     The inline hint (no longer shown on mobile) says PDF, DOCX, TXT (Max 3MB)
 *
 * leaves the file fully green with a live, wrong 3MB cap unguarded, exactly as
 * the line-scoped version did. Adding `(` to the delimiter class is not the fix:
 * it cuts the marker off a parenthesised figure, so ordinary historical prose —
 * "the cap was previously smaller (5MB) before WIC-1382" — stops being exempt and
 * REDs as an unclassified figure. Closing this is a judgement about how much
 * apparatus a rare phrasing is worth, and is deliberately left open rather than
 * papered over here.
 */
const HISTORICAL_MARKERS =
  /\b(?:previously|formerly|historically|used to (?:be|specify|say)|prior to|no longer|superseded|before WIC-)\b/i;

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** Offset of the start of `index`'s line. */
function lineStartAt(source: string, index: number): number {
  return source.lastIndexOf('\n', index - 1) + 1;
}

/**
 * The text between the last clause boundary before `index` and `index` itself,
 * never crossing a line start.
 *
 * `|` is in the delimiter class and is load-bearing, not decorative:
 * COMPONENT_SPECS.md's `File Too Large` row — `| File Too Large | Drop 15MB file
 * (max 10MB) | Show error toast: "File must be under 10MB" |` — is a markdown
 * table row, and neighbouring cells have to scope apart or a marker in one cell
 * exempts the figures in the next.
 *
 * That row is named by content, not by line number, because every line number
 * this comment has carried went stale before anyone read it. It has moved twice
 * under merges already, and the number cited here previously now points at an
 * unrelated `acceptedFormats` field in a TypeScript block. `grep` for the row
 * instead. The behaviour is pinned by `table cells scope apart` below, which
 * likewise does not depend on a line number.
 *
 * The failure direction is safe. An abbreviation the split does not know about
 * — `e.g.`, `i.e.`, a decimal — can only cut the clause *shorter* than the
 * writer meant, which NARROWS the exemption. A mis-split therefore makes a
 * genuinely historical figure measurable and goes RED with a message, and can
 * never widen the hatch into a silent green.
 */
function clauseBefore(source: string, index: number): string {
  const before = source.slice(lineStartAt(source, index), index);
  return before.slice(before.search(/[^.;!?|]*$/));
}

/**
 * True when a historical marker precedes `index` *in the same clause* — i.e. the
 * figure at `index` is being described as superseded.
 */
function isHistoricalAt(source: string, index: number): boolean {
  return HISTORICAL_MARKERS.test(clauseBefore(source, index));
}

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

/** Every stated-limit figure in the doc, excluding figures marked historical. */
function limitFiguresIn(source: string): number[] {
  const figures: number[] = [];
  for (const pattern of LIMIT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (isHistoricalAt(source, match.index!)) continue;
      figures.push(Number(match[1]));
    }
  }
  return figures;
}

/**
 * The distinct values the doc states as the cap, ascending.
 *
 * The trip-wires and per-doc checks compare against *this*, not against an array
 * of a fixed length (WIC-1568 / F2). Comparing to `Array.from({length: 9})` made
 * every check count-sensitive, so PR #150 — a 78+/51- rewrite that legitimately
 * takes ONBOARDING_FLOW.md from nine figures to ten — would have failed on the
 * count rather than passing on the values, and its trip-wire would have stayed
 * green while the doc was in fact fixed.
 *
 * Non-vacuity (a doc that states no cap at all yields `[]`, which equals nothing)
 * is proven separately, in a plain `it`.
 */
function distinctLimitFiguresIn(source: string): number[] {
  return [...new Set(limitFiguresIn(source))].sort((a, b) => a - b);
}

/**
 * Every `<n>MB` in the file that is neither a stated limit, nor a recognised
 * example, nor preceded by a historical marker. A non-empty result means someone
 * reworded a cap into a phrasing `LIMIT_PATTERNS` does not know, and the audit has
 * quietly stopped covering that line — the exact vacuous-pass failure WIC-1421
 * caught in `upload.drift.test.ts`.
 *
 * This check has now earned its keep twice: it caught a `\b<` bug during
 * development, and it is the only thing that surfaced the five figures PR #150's
 * rewrite moved out of reach (WIC-1568 / F3).
 */
function unclassifiedFiguresIn(source: string): string[] {
  const classified = [...spansOf(source, LIMIT_PATTERNS), ...spansOf(source, EXAMPLE_PATTERNS)];
  const lines = source.split('\n');
  const unclassified: string[] = [];

  for (const match of source.matchAll(/\b\d+(?:\.\d+)?\s*MB\b/gi)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (classified.some((span) => span.start <= start && span.end >= end)) continue;
    if (isHistoricalAt(source, start)) continue;

    const line = lineNumberAt(source, start);
    unclassified.push(`${line}: ${match[0]} — ${lines[line - 1]!.trim()}`);
  }

  return unclassified;
}

/** Figures exempted as historical, with their location, for the staleness test. */
function historicalFiguresIn(source: string): { line: number; mb: number; text: string }[] {
  const lines = source.split('\n');
  const found: { line: number; mb: number; text: string }[] = [];

  for (const match of source.matchAll(/\b(\d+)(?:\.\d+)?\s*MB\b/gi)) {
    if (!isHistoricalAt(source, match.index!)) continue;
    const line = lineNumberAt(source, match.index!);
    found.push({ line, mb: Number(match[1]), text: lines[line - 1]!.trim() });
  }

  return found;
}

/**
 * The design docs that quote the resume cap.
 *
 * `minLimitFigures` is a floor, deliberately not an exact count (WIC-1568 / F2).
 * The exact counts this replaced were justified as "a count that needs updating
 * puts a human on the change" — but in practice they put the human on the *wrong*
 * change: PR #150 reflows this prose, and an exact count turns that into a RED
 * with a message about arithmetic rather than about drift.
 *
 * Each floor is set to the doc's **currently measured** count rather than a
 * uniform 2 (WIC-1572 / F6), which gives the floors ratchet semantics: additions
 * are free, so prose reflow still never fails on arithmetic, but deletions are
 * loud. A uniform 2 left ONBOARDING_FLOW.md with seven figures of slack —
 * measured: seven of its nine cap statements could be deleted with the file still
 * fully green. The unclassified-figure check catches a cap *reworded* out of
 * reach; nothing caught one simply *removed* down to the floor.
 *
 * Counts measured on the merge of `origin/main` at `9ba5041`, which is the tree
 * CI builds. Raising a floor when a doc legitimately gains a cap line is the
 * intended (and only) maintenance cost.
 */
const AUDITED_DOCS = [
  {
    path: 'docs/design/COMPONENT_SPECS.md',
    source: componentSpecsDoc,
    minLimitFigures: 3,
  },
  {
    path: 'docs/design/RESUME_UPLOAD_EXPORT_FLOW.md',
    source: resumeUploadExportFlowDoc,
    minLimitFigures: 2,
  },
  {
    // Currently at 5MB against a 10MB server. PR #150 (WIC-1436) moves all of them,
    // and takes this doc from nine figures to ten — above the floor, so free.
    path: 'docs/design/ONBOARDING_FLOW.md',
    source: onboardingFlowDoc,
    minLimitFigures: 9,
  },
] as const;

const ONBOARDING_FLOW_PATH = 'docs/design/ONBOARDING_FLOW.md';

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('resume upload size limit', () => {
  /**
   * Reachability lives here, in plain `it`s, and deliberately not inside the
   * `it.fails` trip-wires below — see the note on `Resolution` above. Every read
   * the trip-wires depend on is proven here, where a broken path, a vanished
   * figure or an unresolvable identifier is RED with a message that names the
   * repair.
   */
  it('every limit-bearing code surface resolves to exactly one figure', () => {
    const resolutions = [
      ['api', resolveApiLimit()],
      ['onboarding zone', resolveZoneLimit()],
      ['standalone /resumes/upload', resolveStandaloneLimit()],
    ] as const;

    // Asserted as a list of diagnoses rather than `expect(mb).toBeGreaterThan(0)`
    // per surface: a matcher like `toBeGreaterThan` throws a bare TypeError on
    // `null` ("actual value must be number or bigint") and **discards the custom
    // message**, which is the one thing this assertion exists to deliver. Failing
    // on the diagnosis strings puts the repair in the diff of the failure itself.
    expect(
      resolutions.filter(([, r]) => r.mb === null).map(([label, r]) => `${label}: ${r.how}`),
      'A surface that states the resume limit no longer resolves to exactly one figure. ' +
        'Until it does, the trip-wires below cannot tell "unresolvable" from "still ' +
        'broken" — they are green and meaningless. Re-point the resolver, then re-check ' +
        'whether each `.fails` is still the right disposition.'
    ).toEqual([]);

    for (const [label, resolution] of resolutions) {
      expect(resolution.mb, `${label}: ${resolution.how}`).toBeGreaterThan(0);
    }
  });

  it('no audited doc states the limit fewer times than it does today', () => {
    for (const doc of AUDITED_DOCS) {
      expect(
        limitFiguresIn(doc.source).length,
        `${doc.path} states the cap fewer times than the ${doc.minLimitFigures} this audit ` +
          'reads today. Either a cap statement was deleted, or its phrasing moved out of ' +
          'LIMIT_PATTERNS. Adding cap lines is free; if one was removed on purpose, lower ' +
          'the floor in AUDITED_DOCS in the same commit so the deletion is in the diff.'
      ).toBeGreaterThanOrEqual(doc.minLimitFigures);
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

  /**
   * The staleness test for the historical escape hatch. A figure introduced by
   * "previously ..." is exempt from measurement — so if it is the *current* limit,
   * either the history is wrong or the marker is being used (deliberately or not)
   * to park a live figure somewhere the audit will not read it.
   */
  it('historical size mentions are actually historical', () => {
    const limit = resolveApiLimit().mb;

    for (const doc of AUDITED_DOCS) {
      const contradictions = historicalFiguresIn(doc.source).filter((f) => f.mb === limit);
      expect(
        contradictions.map((f) => `${f.line}: ${f.text}`),
        `${doc.path} describes the current limit (${limit}MB) as superseded. Figures behind ` +
          'a historical marker are exempt from this audit, so a live one is unguarded. ' +
          'Either the sentence is wrong, or the figure belongs ahead of the marker.'
      ).toEqual([]);
    }
  });

  /**
   * The audit's own reading rules, over fixtures rather than the real docs
   * (WIC-1578).
   *
   * Everything else in this file reads the three design docs, and none of them
   * carries historical prose today — `historicalFiguresIn` returns `[]` for all
   * three. So against this tree the clause scoping and the `|` delimiter that
   * WIC-1573 added are unfalsifiable: reverting either one leaves the file at
   * `7 passed | 2 expected fail`, and the same is true of the glob's `*.test.ts`
   * exclusion. A rule whose only evidence is a mutation run outside the repo is a
   * rule the next edit can silently retire.
   *
   * These strings hold the cases the real docs only acquire when PR #150 lands,
   * so they are inert with respect to every doc — nothing here changes when the
   * prose moves.
   */
  describe("the audit's own reading rules", () => {
    it('a marker in an earlier clause does not exempt a later figure', () => {
      // The F5 mutation: line-prefix scoping let a generic marker used for an
      // unrelated reason earlier on the line exempt a live, wrong cap.
      expect(
        limitFiguresIn('The inline hint is no longer shown on mobile. PDF, DOCX, TXT (Max 3MB)')
      ).toEqual([3]);
    });

    it('a marker in the same clause still exempts the figure', () => {
      // The other polarity: narrowing the hatch must not close it, or PR #150's
      // genuine historical prose goes RED on correct writing.
      expect(limitFiguresIn('This doc previously specified Max 3MB for uploads')).toEqual([]);
    });

    it('table cells scope apart, so a marker in one cell does not exempt the next', () => {
      // `|` in the delimiter class. Neither figure here is the live limit, so the
      // staleness test cannot be what makes this row RED.
      expect(limitFiguresIn('| Legacy | The cap is no longer 4MB | Max 7MB |')).toEqual([7]);
    });

    it('an exempted figure is still visible to the staleness test', () => {
      const limit = resolveApiLimit().mb;
      expect(
        historicalFiguresIn(`This doc previously specified ${limit}MB`).map((f) => f.mb)
      ).toEqual([limit]);
    });

    it('the constants glob excludes sibling tests', () => {
      // Not vacuous: `constants/` already carries `requirementLabel.test.ts` and
      // `skillCount.test.ts`, so dropping the exclusion puts both in this list.
      expect(Object.keys(WEB_CONSTANT_MODULES).filter((p) => /\.test\.ts$/.test(p))).toEqual([]);
    });
  });

  it('the /resumes/upload surface enforces the API limit', () => {
    // PR #143 (WIC-1382) routes ResumeUploadZone through `MAX_RESUME_SIZE_BYTES` and
    // pins that constant to the API. It does not touch this component, which keeps its
    // own literal — so after #143 lands this is the one client cap with no guard on it.
    expect(resolveStandaloneLimit().mb).toBe(resolveApiLimit().mb);
  });

  for (const doc of AUDITED_DOCS.filter((d) => d.path !== ONBOARDING_FLOW_PATH)) {
    it(`${doc.path} quotes the API limit`, () => {
      expect(distinctLimitFiguresIn(doc.source)).toEqual([resolveApiLimit().mb]);
    });
  }

  /**
   * Was a trip-wire (green while the defect was live, RED the moment it was
   * fixed) until PR #143 (WIC-1382) landed. Now a guard: the onboarding zone
   * and the server agree on the limit, and this keeps them that way.
   */
  it('the onboarding upload zone enforces the API limit (WIC-1382 / PR #143)', () => {
    expect(resolveZoneLimit().mb).toBe(resolveApiLimit().mb);
  });

  /**
   * Was a trip-wire until PR #150 (WIC-1436) moved every figure in this doc to
   * 10MB. Now a guard.
   *
   * Compares distinct *values*, not a fixed-length array, so a reflow of the
   * surrounding prose cannot keep it green on a count mismatch (WIC-1568 / F2).
   */
  it(`${ONBOARDING_FLOW_PATH} quotes the API limit (WIC-1436 / PR #150)`, () => {
    expect(distinctLimitFiguresIn(onboardingFlowDoc)).toEqual([resolveApiLimit().mb]);
  });
});
