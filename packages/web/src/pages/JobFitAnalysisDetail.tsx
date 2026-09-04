import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useJobFitAnalysisById } from '../hooks/useJobFitAnalysis';
import { FIT_LEVEL_LABELS, NO_FIT_LEVEL_LABEL } from '../constants/fitLevel';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * A stored job fit analysis, read by id (WIC-2058 / WIC-1860).
 *
 * ## Why this page exists
 *
 * `WorkflowChecklist`'s "Job Fit Analysis" row dropped its link the moment the step
 * ticked, because until now there was nowhere to send the user: `/job-fit-analysis` is a
 * *create* page that takes an optional `appId` to pre-fill a job description and takes no
 * analysis id at all. The other two artefact rows repoint at `/cover-letters/:id` and
 * `/resume-variants/:id` on completion; this route is the missing third destination, and
 * `CoverLetterDetail` is the shape it copies.
 *
 * The state it really exists for is the **unscored** one — `fitScore === null`, from an
 * empty catalog or a job description naming no required skills. That analysis ticks the
 * step with no badge, so before this route the user was told "you have done this", shown
 * nothing, and given nowhere to go.
 *
 * ## Why it renders the summary and not the whole analysis
 *
 * It reads `GET /catalog/job-fit/analyses/:id`, which returns the same
 * `JobFitAnalysisSummary` the list does. The four JSONB payloads — parsed JD, matches,
 * gaps, recommended STAR entries — are deliberately not on that contract, and putting them
 * on it is a larger change than this card is. What the summary carries is exactly what the
 * checklist row promises: the verdict, the score, the prose summary, and when it was run.
 *
 * ## Every branch renders the `<h1>`
 *
 * Four returns — loading, error, not-found, loaded — and each is a separate document
 * outline. Routing them all through {@link JobFitAnalysisDetailFrame} makes the heading
 * structural rather than copied four times, which is what `routeOutline.render.test.tsx`
 * inventories and what WIC-2050 closed across the app. A fifth return added later inherits
 * it, or does not render at all.
 */
function JobFitAnalysisDetailFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <Link
          to="/applications"
          className="text-sm text-neutral-600 hover:text-neutral-900 mb-2 inline-block"
        >
          ← Back to Applications
        </Link>
        <h1 className="text-3xl font-bold text-neutral-900 mb-6">{JOB_FIT_ANALYSIS_TITLE}</h1>
        {children}
      </div>
    </div>
  );
}

/**
 * Mirrors the `<h1>` above, per `ROUTE_TITLE_CONVENTION.md` §0.3.
 *
 * The same string as `/job-fit-analysis`'s title, on purpose: both screens name the same
 * artefact, and the convention makes a route's tab title its heading verbatim rather than
 * a disambiguating variant of it. `/resumes/exports` and `/resumes/:resumeId/exports`
 * already share a title for the same reason.
 */
const JOB_FIT_ANALYSIS_TITLE = 'Job Fit Analysis';

/** Centred single-message body, shared by the loading and not-found states. */
function StatusBody({ children }: { children: ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-12 text-center text-neutral-600">
      {children}
    </div>
  );
}

export function JobFitAnalysisDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useJobFitAnalysisById(id);

  useDocumentTitle(JOB_FIT_ANALYSIS_TITLE);

  const analysis = data?.analysis;

  if (isLoading) {
    return (
      <JobFitAnalysisDetailFrame>
        <StatusBody>Loading analysis…</StatusBody>
      </JobFitAnalysisDetailFrame>
    );
  }

  // One branch for the API error and for a well-formed response with no analysis in it.
  // They are the same thing to a reader — the analysis is not here — and the server
  // cannot tell them apart either: it ANDs the owner term into the read, so a stranger's
  // id and a nonexistent one both come back 404. Splitting them in the UI would promise a
  // distinction that does not exist.
  if (error || !analysis) {
    return (
      <JobFitAnalysisDetailFrame>
        <StatusBody>
          <p className="mb-4">We couldn&apos;t find that job fit analysis.</p>
          <Link to="/job-fit-analysis" className="text-primary-600 hover:text-primary-700">
            Run a new analysis
          </Link>
        </StatusBody>
      </JobFitAnalysisDetailFrame>
    );
  }

  return (
    <JobFitAnalysisDetailFrame>
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="text-center">
          <div className="text-sm text-neutral-500">Overall fit</div>
          <div className="text-2xl font-bold text-neutral-900 mb-2">
            {analysis.recommendation
              ? FIT_LEVEL_LABELS[analysis.recommendation]
              : NO_FIT_LEVEL_LABEL}
          </div>

          {/*
            `!= null`, not truthiness. A genuine 0% match is a score and must render as
            "0% match"; `null` is an analysis that scored nothing at all. `fitScore ? …`
            collapses the two and shows a user with a real zero the same bare row as a
            user whose catalog was empty — the WIC-1835 defect, one layer up.
          */}
          {analysis.fitScore != null && (
            <div className="inline-flex items-center rounded-full bg-primary-100 px-3 py-1 text-sm font-medium text-primary-800">
              {analysis.fitScore}% match
            </div>
          )}

          <p className="text-neutral-700 mt-4">{analysis.summary}</p>
          <div className="text-sm text-neutral-500 mt-2">Confidence: {analysis.confidence}</div>
        </div>
      </div>

      {/*
        The unscored case, said out loud rather than left as an absent badge. This is the
        state the card is about: the step is ticked, there is no percentage, and without
        this the page is a verdict with no explanation of why it has no number.
      */}
      {analysis.fitScore == null && (
        <div className="rounded-lg bg-info-50 p-4 mb-6">
          <p className="text-sm text-info-800">
            {analysis.catalogEmpty
              ? 'This analysis produced no match score because your catalog was empty when it ran. Add experience to your catalog and run it again for a score.'
              : 'This analysis produced no match score because the job description named no required skills to match against.'}
          </p>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4">About this analysis</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="font-medium text-neutral-700">Analyzed</dt>
            <dd className="text-neutral-600">{new Date(analysis.analyzedAt).toLocaleString()}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-neutral-700">Application</dt>
            <dd className="text-neutral-600">
              {/*
                `applicationId` is nullable by contract: analysing a bare job description
                from `/job-fit-analysis` with no `appId` is a supported flow, and such an
                analysis belongs to no application. Linking it unconditionally would
                produce `/applications/null`, which routes to a page that cannot load.
              */}
              {analysis.applicationId ? (
                <Link
                  to={`/applications/${analysis.applicationId}`}
                  className="text-primary-600 hover:text-primary-700"
                >
                  View application
                </Link>
              ) : (
                'Not linked to an application'
              )}
            </dd>
          </div>
        </dl>
      </div>
    </JobFitAnalysisDetailFrame>
  );
}
