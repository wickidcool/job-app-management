import { Link } from 'react-router-dom';
import type { ApplicationStatus } from '../types/application';

interface WorkflowChecklistProps {
  applicationId: string;
  status: ApplicationStatus;
  hasJobDescription: boolean;
  hasFitAnalysis?: boolean;
  fitScore?: number;
  hasCoverLetter?: boolean;
  hasResumeVariant?: boolean;
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
  hasResumeVariant = false,
}: WorkflowChecklistProps) {
  const items: ChecklistItem[] = [
    {
      label: 'Job Fit Analysis',
      completed: hasFitAnalysis,
      recommended: hasJobDescription && !hasFitAnalysis,
      link: hasFitAnalysis ? undefined : `/job-fit-analysis?appId=${applicationId}`,
      badge: fitScore ? `${fitScore}% match` : undefined,
    },
    {
      label: 'Cover Letter',
      completed: hasCoverLetter,
      recommended: hasFitAnalysis && !hasCoverLetter,
      link: hasCoverLetter ? undefined : `/cover-letters/new?appId=${applicationId}`,
    },
    {
      label: 'Tailored Resume',
      completed: hasResumeVariant,
      recommended: hasFitAnalysis && !hasResumeVariant,
      link: hasResumeVariant ? undefined : `/resume-variants/new?appId=${applicationId}`,
    },
    {
      label: 'Interview Prep',
      completed: false,
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
