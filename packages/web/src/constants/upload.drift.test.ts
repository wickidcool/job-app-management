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
  const match = apiResumesRoute.match(
    /const MAX_FILE_SIZE\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024\s*;/
  );

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
