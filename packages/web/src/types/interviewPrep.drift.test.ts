import { describe, expect, it } from 'vitest';

// WIC-1821. `InterviewPrepPage` builds its child props as
// `{ ...applicationSummary, interviewDate: application.interviewDate }` (:287, :368), and
// both consumers gate on that value — `InterviewPrepCard:138` renders a countdown, and
// `QuickReferenceExport:111` prints the date into the exported quick reference. Neither has
// ever rendered, because the interview-prep endpoint does not send the field.
//
// Nothing caught it. The read type-checks: `application` at that call site is an
// `ApplicationSummary` (via `GetInterviewPrepResponse`), not an `Application`, and
// `ApplicationSummary` declares `interviewDate?: string`. Reading a declared-optional
// property the server never populates is exactly as legal as reading one it does, so the
// compiler has nothing to say and the branch just stays dark.
//
// The root cause is a client type that is WIDER than the wire contract it stands for. This
// guard pins that divergence explicitly instead of leaving it implicit.
//
// @wic/web and @wic/api cannot import each other's code — the API builds with tsc under
// `rootDir: ./src`, so a shared TS module would need a build-order change to the deploy
// workflow. Pulling the API service in as text with Vite's `?raw` is the cheap version of
// the same guarantee, and it fails the build outright if the file moves rather than
// degrading to a check that passes vacuously. Same technique as `constants/upload.drift.test.ts`.
import apiInterviewPrepService from '../../../api/src/services/interviewPrep.service.ts?raw';
import webInterviewPrepTypes from './interviewPrep.ts?raw';

/**
 * Fields the web `ApplicationSummary` declares that the interview-prep endpoint is known
 * NOT to send. Every entry here is a render site that cannot light up.
 *
 * This is a baseline, not a permission. It is pinned in BOTH directions below: an entry
 * that the API starts sending fails just as loudly as a new unbacked field, so the list
 * cannot quietly become a hole that swallows the next occurrence of this defect.
 */
const KNOWN_UNBACKED_FIELDS = ['interviewDate'] as const;

/**
 * The `application` object the API's interview-prep read path returns, parsed out of its
 * declared return type. Declared twice — `getInterviewPrep` and
 * `getInterviewPrepByApplication` — and this asserts the two agree rather than trusting
 * whichever one the regex happened to reach first.
 */
function readApiApplicationFields(): string[] {
  // Anchored at column 0 + `m`, and counted rather than "take the first". An unanchored
  // `match` would return a single arbitrary hit, so a stale copy in a comment could shadow
  // the real declaration and the guard would pass while the two shapes were actually apart
  // — the failure mode `upload.drift.test.ts` was hardened against twice (WIC-1421/1462).
  const matches = [...apiInterviewPrepService.matchAll(/^ {2}application: \{([^}]*)\};$/gm)];

  expect(
    matches.length,
    'Expected exactly 2 `application: { ... };` return-type declarations in ' +
      `packages/api/src/services/interviewPrep.service.ts (getInterviewPrep and ` +
      `getInterviewPrepByApplication), found ${matches.length}. If that service reshaped ` +
      'its return type, re-point this guard at its new home — do not delete it.'
  ).toBe(2);

  const fieldSets = matches.map((m) =>
    m[1]
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.split(':')[0].trim().replace(/\?$/, ''))
  );

  // The two declarations must agree. If they drift, "what the endpoint returns" stops
  // having a single answer and every assertion below is measuring an arbitrary half.
  expect(
    fieldSets[1],
    'getInterviewPrep and getInterviewPrepByApplication declare different `application` ' +
      'shapes. They share one implementation, so the two return types must match.'
  ).toEqual(fieldSets[0]);

  return fieldSets[0];
}

/** Field names declared on the web `ApplicationSummary`, optional marker stripped. */
function readWebApplicationSummaryFields(): string[] {
  const matches = [
    ...webInterviewPrepTypes.matchAll(/^export interface ApplicationSummary \{([^}]*)\}/gm),
  ];

  expect(
    matches.length,
    'Expected exactly one `export interface ApplicationSummary { ... }` in ' +
      `packages/web/src/types/interviewPrep.ts, found ${matches.length}.`
  ).toBe(1);

  return matches[0][1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'))
    .map((line) => line.split(':')[0].trim().replace(/\?$/, ''));
}

describe('interview-prep `application` payload', () => {
  // Positive control. Both parsers run over source text, and a regex that quietly stops
  // matching yields an empty set that satisfies every "for each field" assertion below
  // vacuously. Pinning the exact expected scope means a dead parse fails HERE, loudly,
  // instead of turning the rest of this file green and blind.
  it('parses the API-declared shape (scope pin — fails loudly if the parse dies)', () => {
    expect(readApiApplicationFields()).toEqual(['id', 'jobTitle', 'company', 'status']);
  });

  it('parses the web-declared shape (scope pin — fails loudly if the parse dies)', () => {
    expect(readWebApplicationSummaryFields()).toEqual([
      'id',
      'jobTitle',
      'company',
      'status',
      'interviewDate',
    ]);
  });

  it('declares no client field the API does not send, except the known-unbacked baseline', () => {
    const apiFields = readApiApplicationFields();
    const unbacked = readWebApplicationSummaryFields().filter(
      (field) => !apiFields.includes(field)
    );

    expect(
      unbacked,
      'packages/web/src/types/interviewPrep.ts `ApplicationSummary` declares a field that ' +
        'the interview-prep endpoint does not return, so any render site gated on it is ' +
        'permanently dark and TypeScript cannot see it (an optional property absorbs a ' +
        'server that never sends it). Either thread the field through ' +
        'packages/api/src/services/interviewPrep.service.ts, or drop it from the client type.'
    ).toEqual([...KNOWN_UNBACKED_FIELDS]);
  });

  // The other direction. Without this, the entry above stays on the allowlist forever and
  // silently converts a fixed defect back into an unguarded one.
  it('keeps the known-unbacked baseline honest — no entry is secretly backed now', () => {
    const apiFields = readApiApplicationFields();
    const nowBacked = KNOWN_UNBACKED_FIELDS.filter((field) => apiFields.includes(field));

    expect(
      nowBacked,
      'The interview-prep endpoint now returns a field listed in KNOWN_UNBACKED_FIELDS. ' +
        'Remove it from that list, and confirm the render sites it gates — ' +
        'InterviewPrepCard.tsx:138 and QuickReferenceExport.tsx:111 — actually render now.'
    ).toEqual([]);
  });
});
