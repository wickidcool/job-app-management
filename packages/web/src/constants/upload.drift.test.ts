import { describe, expect, it } from 'vitest';

// WIC-1382 (D-7). The client used to cap resume uploads at 5MB while the API accepted
// 10MB and the accepted WIC-238 criteria (AC-3/AC-4) put the boundary at 10MB, so a 7MB
// PDF the server would have taken was refused during onboarding. The two numbers lived
// in different packages and nothing connected them, which is why they drifted.
//
// @wic/web and @wic/api cannot import each other's code — the API builds with tsc under
// `rootDir: ./src`, so a shared TS module would need a build-order change to the deploy
// workflow. Pulling the API route in as text with Vite's `?raw` is the cheap version of
// the same guarantee: no build-graph change, no runtime coupling, and it fails the build
// outright if the file moves rather than degrading to a check that passes vacuously.
import apiResumesRoute from '../../../api/src/routes/resumes.ts?raw';
import { MAX_RESUME_SIZE_BYTES } from './upload';

function readApiMaxFileSize(): number {
  // Anchored to the start of a line (WIC-1421 review). Unanchored, `match` returns the
  // FIRST hit, so a stale value left behind in a comment — `// was: const MAX_FILE_SIZE =
  // 10 * 1024 * 1024;` above a changed declaration — shadows the real one and the guard
  // passes while the two limits are actually apart. Measured: 2 passed with the client at
  // 10MB and the server at 20MB.
  const matches = [
    ...apiResumesRoute.matchAll(/^const MAX_FILE_SIZE\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024\s*;/gm),
  ];

  // Exactly one, not "the first one" (WIC-1462). The `^`/`m` anchor above stops a `// was:`
  // line shadowing the real declaration, but a stale copy sitting at column 0 inside a
  // /* ... */ block still matches it, and then "the first hit" is arbitrary — measured, that
  // shape also passed 2/2 with the client at 10MB and the server at 20MB. Requiring exactly
  // one match closes it and keeps the renamed/moved case loud in the same assertion.
  expect(
    matches.length,
    'Expected exactly one column-0 "const MAX_FILE_SIZE = <n> * 1024 * 1024;" in ' +
      `packages/api/src/routes/resumes.ts, found ${matches.length}. If the API reshaped ` +
      'that constant, re-point this guard at its new home — do not delete it.'
  ).toBe(1);

  const match = matches[0] ?? null;

  // Not a soft failure. If this stops matching, the guard has silently stopped guarding,
  // which is the state that produced the defect in the first place.
  expect(
    match,
    'Could not find "const MAX_FILE_SIZE = <n> * 1024 * 1024;" in ' +
      'packages/api/src/routes/resumes.ts. If the API reshaped that constant, re-point ' +
      'this guard at its new home — do not delete it.'
  ).not.toBeNull();

  return Number(match![1]) * 1024 * 1024;
}

describe('resume size limit', () => {
  it('matches the limit the API enforces', () => {
    expect(MAX_RESUME_SIZE_BYTES).toBe(readApiMaxFileSize());
  });

  it('is the 10MB the accepted WIC-238 criteria specify', () => {
    expect(MAX_RESUME_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });
});
