import { Link } from 'react-router-dom';
import type { ApplicationStatus } from '../types/application';

interface WorkflowChecklistProps {
  applicationId: string;
  status: ApplicationStatus;
  hasJobDescription: boolean;
  /**
   * Whether a job fit analysis exists for this application.
   *
   * "Exists", not "scored something". An analysis that produced no score — the
   * catalog was empty, or the job description named no required skills — is
   * still an analysis the user has run, and the step ticks for it. Ticking off
   * the score instead would keep offering to create an analysis that already
   * exists, which was WIC-1652's user-visible complaint.
   *
   * The caller resolves this from `GET /catalog/job-fit/analyses?applicationId=`
   * as `analyses.length > 0`. Filtering by application is required, not a
   * convenience: `job_fit_analyses.application_id` is nullable, so an
   * unfiltered list is not a substitute (WIC-1835).
   *
   * This is a *different* gap from WIC-1544, which is still open. There the row
   * exists and only its `application_id` link is missing, on `cover_letters`
   * and `resume_variants` — which is why those two steps below are still
   * reconstructed by company-and-role rather than looked up.
   */
  hasFitAnalysis?: boolean;
  /**
   * The match percentage for the "Job Fit Analysis" badge, 0-100.
   *
   * Three states, and they stay three: `undefined` is no analysis, `null` is an
   * analysis that scored nothing, and `0` is a real score of zero. The badge
   * renders for the third and not the first two, so the test below is
   * `!= null` and **not** truthiness — `fitScore ? …` swallowed a genuine `0`
   * and showed a user with a real 0% match the same bare row as a user with no
   * analysis at all.
   *
   * A null score renders no badge on purpose: there is no percentage to show
   * and "0% match" would be a false one. The tick, driven by
   * {@link hasFitAnalysis}, is what tells that user their analysis exists.
   */
  fitScore?: number | null;
  hasCoverLetter?: boolean;
  /**
   * The letter the "Cover Letter" step was completed by, if there is one.
   *
   * A completed step drops its link (`link: hasX ? undefined : …`), which is
   * right for a step whose only link is "go create one" but wrong here: the
   * artefact the step produced has a detail page, and this is the natural place
   * to reach it. Supplying the id repoints the row at `/cover-letters/:id`
   * instead of leaving a finished step inert (WIC-1533).
   */
  coverLetterId?: string;
  hasResumeVariant?: boolean;
  /**
   * The variant the "Tailored Resume" step was completed by, if there is one.
   * Repoints the row at `/resume-variants/:id` for the same reason
   * {@link coverLetterId} does (WIC-1536).
   */
  resumeVariantId?: string;
  /**
   * Whether an interview prep exists for this application.
   *
   * Unlike every other flag on this component, this one needs no
   * reconstruction: `interview_preps.application_id` is a real `notNull`,
   * `unique` foreign key and `GET /applications/:applicationId/interview-prep`
   * resolves it directly. Before WIC-1536 the step was hardcoded
   * `completed: false`, so a user who had generated a prep still saw the step
   * unticked.
   *
   * The row keeps its link in both states on purpose:
   * `/applications/:id/prep` is where you *read* an existing prep, not only
   * where you create one, so dropping the link on completion — the right move
   * for the two "go generate one" steps above — would take the finished
   * artefact away.
   */
  hasInterviewPrep?: boolean;
}

interface ChecklistItem {
  label: string;
  completed: boolean;
  recommended: boolean;
  link?: string;
  badge?: string;
}

export function WorkflowChecklist({
  applicationId,
  status,
  hasJobDescription,
  hasFitAnalysis = false,
  fitScore,
  hasCoverLetter = false,
  coverLetterId,
  hasResumeVariant = false,
  resumeVariantId,
  hasInterviewPrep = false,
}: WorkflowChecklistProps) {
  const items: ChecklistItem[] = [
    {
      label: 'Job Fit Analysis',
      completed: hasFitAnalysis,
      recommended: hasJobDescription && !hasFitAnalysis,
      link: hasFitAnalysis ? undefined : `/job-fit-analysis?appId=${applicationId}`,
      // `!= null`, not truthiness: a genuine 0% match is a score, and the `?`
      // this replaces rendered it as no badge at all. See {@link fitScore}.
      badge: fitScore != null ? `${fitScore}% match` : undefined,
    },
    {
      label: 'Cover Letter',
      completed: hasCoverLetter,
      recommended: hasFitAnalysis && !hasCoverLetter,
      link: hasCoverLetter
        ? coverLetterId
          ? `/cover-letters/${coverLetterId}`
          : undefined
        : `/cover-letters/new?appId=${applicationId}`,
    },
    {
      label: 'Tailored Resume',
      completed: hasResumeVariant,
      recommended: hasFitAnalysis && !hasResumeVariant,
      link: hasResumeVariant
        ? resumeVariantId
          ? `/resume-variants/${resumeVariantId}`
          : undefined
        : `/resume-variants/new?appId=${applicationId}`,
    },
    {
      label: 'Interview Prep',
      completed: hasInterviewPrep,
      recommended: status === 'interview' || status === 'phone_screen',
      link: `/applications/${applicationId}/prep`,
    },
  ];

  const completedCount = items.filter((item) => item.completed).length;
  const totalCount = items.length;
  const progressPercent = (completedCount / totalCount) * 100;

  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Application Workflow</h2>
          <p className="text-sm text-neutral-600">
            {completedCount} of {totalCount} steps completed
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-neutral-900">{Math.round(progressPercent)}%</div>
          <div className="text-xs text-neutral-500">Complete</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
        <div
          className="h-full bg-primary-500 transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Checklist Items */}
      <ul className="space-y-3">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0">
              {item.completed ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success-100 text-success-600">
                  ✓
                </span>
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-neutral-300" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {item.link ? (
                  <Link
                    to={item.link}
                    className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className={`text-sm font-medium ${
                      item.completed ? 'text-neutral-900' : 'text-neutral-600'
                    }`}
                  >
                    {item.label}
                  </span>
                )}
                {item.badge && (
                  <span className="inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800">
                    {item.badge}
                  </span>
                )}
                {item.recommended && !item.completed && (
                  <span className="inline-flex items-center rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-800">
                    Recommended
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!hasJobDescription && (
        <div className="mt-4 rounded-lg bg-info-50 p-3">
          <p className="text-sm text-info-800">
            💡 Add a job description to unlock Job Fit Analysis and personalized recommendations
          </p>
        </div>
      )}
    </div>
  );
}
