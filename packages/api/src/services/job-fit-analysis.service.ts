// Resolution of the `jobFitAnalysisId` request field — ADR-012 AC-5 / WIC-1818.
//
// `jobFitAnalysisId` is accepted on five generation entry points. It was never
// dereferenced anywhere: no job fit analysis is persisted (WIC-1652), there is
// no `job_fit_analyses` table, and `analyzeJobFit` returns its result to the
// caller without writing it down. So the field was not inert — it was a
// caller-controlled string that satisfied `JOB_CONTEXT_REQUIRED`, waived
// `TARGET_INFO_REQUIRED`, was interpolated into the model prompt as the job
// context, and was written to the `job_fit_analysis_id` column of the generated
// row.
//
// This module is the single place that decides whether an id resolves. Until
// the table lands (WIC-1652 AC-1) *every* id is unresolvable, so the honest
// answer at the boundary is to reject — which is what makes AC-5a severable
// from the table.
//
// Note that this file is deliberately dependency-light (`AppError` only). The
// three service modules that call it — cover-letter, resume-variant and
// interviewPrep, five call sites between them — must not acquire a transitive
// dependency on `job-fit.service.ts`, which pulls in the LLM client, `node:dns`
// and config.
import { AppError } from '../types/index.js';

/**
 * A job fit analysis that exists and belongs to the caller.
 *
 * Only `id` today, because only `id` is knowable today — the columns follow the
 * table. AC-5b widens this with the stored analysis (the parsed job
 * description, matches and gaps) so the two `jdContext` sites can be fed the
 * analysis itself instead of an interpolated id string.
 */
export interface ResolvedJobFitAnalysis {
  id: string;
}

/**
 * 422, not 404: the id is a field inside an otherwise well-formed generation
 * request, so the request is unprocessable rather than the route being absent.
 *
 * The message deliberately does not distinguish "no such analysis" from
 * "belongs to another user". AC-5b resolves by `(id, userId)`, and a message
 * that told the two apart would turn this into an existence oracle over other
 * users' analyses.
 */
export class JobFitAnalysisNotFoundError extends AppError {
  constructor() {
    super('JOB_FIT_ANALYSIS_NOT_FOUND', 'Job fit analysis not found', undefined, 422);
    this.name = 'JobFitAnalysisNotFoundError';
  }
}

/**
 * Resolve a caller-supplied `jobFitAnalysisId`.
 *
 * Returns `null` when the caller supplied nothing, and the resolved analysis
 * when they supplied one that exists and is theirs. It never returns `null` for
 * a *supplied* id — an unresolvable id throws. That asymmetry is the point:
 * callers can write `(await resolveJobFitAnalysis(...)) !== null` to mean
 * "the caller supplied job context via an analysis", and cannot accidentally
 * treat an unresolvable id as absent.
 *
 * ⚠ Presence is `!== undefined`, not truthiness. `z.string().optional()` admits
 * `''`, and every shipped call site tested this field with `!!` / `!`, so an
 * empty id read as "not supplied" and fell through to the other guards. An
 * empty string is a supplied id that does not resolve.
 *
 * AC-5b seam: replace the throw with a lookup scoped to `userId` — the caller
 * signature is already in place at all five sites so that change touches this
 * function only.
 */
export async function resolveJobFitAnalysis(
  id: string | undefined,
  _userId: string | undefined
): Promise<ResolvedJobFitAnalysis | null> {
  if (id === undefined) return null;
  throw new JobFitAnalysisNotFoundError();
}
