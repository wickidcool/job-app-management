/**
 * Client-side limits for resume upload.
 *
 * These MUST agree with the server. The API rejects anything larger at
 * `MAX_FILE_SIZE` in `packages/api/src/routes/resumes.ts`, and the accepted
 * WIC-238 criteria AC-3/AC-4 put the boundary at 10 MB. Before WIC-1382 the
 * client carried its own 5 MB number, so a 7 MB PDF that the spec calls valid
 * and the server would have accepted was refused during onboarding — at the
 * single highest-drop-off moment in the product, with no way around it.
 *
 * `upload.drift.test.ts` reads the API constant and fails if these two numbers
 * ever diverge again. That guard is the point of this module; if you change the
 * value here, change it there in the same commit.
 */
export const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024;
