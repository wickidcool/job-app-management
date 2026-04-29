import { useNavigate } from 'react-router-dom';
import type { InterviewPrep, ApplicationSummary } from '../types/interviewPrep';

interface InterviewPrepCardProps {
  applicationId: string;
  application: ApplicationSummary & {
    interviewDate?: string;
    fitLevel?: 'strong' | 'moderate' | 'weak';
  };
  prep?: Pick<InterviewPrep, 'id' | 'completeness' | 'stories' | 'questions' | 'gapMitigations'> & {
    lastUpdated: string;
  };
  onGeneratePrep: () => void;
  onViewPrep: (prepId: string) => void;
  onExportQuickRef: (prepId: string) => void;
}

export function InterviewPrepCard({
  applicationId,
  application,
  prep,
  onGeneratePrep,
  onViewPrep,
  onExportQuickRef,
}: InterviewPrepCardProps) {
  const navigate = useNavigate();

  const getCountdownInfo = () => {
    if (!application.interviewDate) {
      return null;
    }

    const interviewDate = new Date(application.interviewDate);
    const now = new Date();
    const diffMs = interviewDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.ceil(diffMs / (1000 * 60));

    if (diffMs < 0) {
      return { text: 'Interview completed', urgency: 'past' as const };
    }

    if (diffMinutes < 120) {
      return { text: `In ${diffMinutes} minutes`, urgency: 'critical' as const };
    }

    if (diffHours < 24) {
      return { text: `In ${diffHours} hours`, urgency: 'high' as const };
    }

    if (diffDays === 1) {
      return { text: 'Tomorrow', urgency: 'medium' as const };
    }

    if (diffDays === 2) {
      return { text: 'In 2 days', urgency: 'medium' as const };
    }

    if (diffDays <= 7) {
      return { text: `In ${diffDays} days`, urgency: 'low' as const };
    }

    return { text: `In ${diffDays} days`, urgency: 'neutral' as const };
  };

  const countdown = getCountdownInfo();

  const urgencyStyles = {
    critical: 'border-red-500 bg-red-50',
    high: 'border-orange-500 bg-orange-50',
    medium: 'border-yellow-500 bg-yellow-50',
    low: 'border-blue-500 bg-blue-50',
    neutral: 'border-gray-300 bg-white',
    past: 'border-gray-300 bg-gray-50',
  };

  const urgencyTextStyles = {
    critical: 'text-red-700 font-bold animate-pulse',
    high: 'text-orange-700 font-semibold',
    medium: 'text-yellow-700 font-medium',
    low: 'text-blue-700',
    neutral: 'text-gray-700',
    past: 'text-gray-500',
  };

  if (!prep) {
    return (
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        <div className="text-gray-400 mb-4">
          <svg
            className="w-16 h-16 mx-auto"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No Interview Prep Yet</h3>
        <p className="text-sm text-gray-600 mb-4">
          Generate interview prep materials to practice for this role
        </p>
        <button
          onClick={onGeneratePrep}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Prepare for Interview
        </button>
      </div>
    );
  }

  const storyCount = prep.stories?.length || 0;
  const questionCount = prep.questions?.length || 0;
  const gapCount = prep.gapMitigations?.length || 0;

  return (
    <div
      className={`border-2 rounded-lg p-6 transition-all ${
        countdown ? urgencyStyles[countdown.urgency] : urgencyStyles.neutral
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">🎤</span>
            <h3 className="text-lg font-semibold text-gray-900">Interview Prep</h3>
          </div>
          <p className="text-sm font-medium text-gray-700">{application.jobTitle}</p>
          <p className="text-sm text-gray-600">{application.company}</p>
        </div>

        {countdown && (
          <div className="text-right">
            <div className={`text-sm ${urgencyTextStyles[countdown.urgency]}`}>
              ⏱️ {countdown.text}
            </div>
            {application.interviewDate && (
              <div className="text-xs text-gray-500 mt-1">
                📅 {new Date(application.interviewDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-6 mb-4">
        <div className="flex-shrink-0">
          <div className="relative w-24 h-24">
            <svg className="w-24 h-24 transform -rotate-90">
              <circle
                cx="48"
                cy="48"
                r="40"
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="8"
              />
              <circle
                cx="48"
                cy="48"
                r="40"
                fill="none"
                stroke={prep.completeness === 100 ? '#10b981' : '#3b82f6'}
                strokeWidth="8"
                strokeDasharray={`${(prep.completeness / 100) * 251.2} 251.2`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-gray-900">{prep.completeness}%</span>
              <span className="text-xs text-gray-600">Complete</span>
            </div>
          </div>
        </div>

        <div className="flex-1">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-900">{storyCount}</div>
              <div className="text-xs text-gray-600">📖 Stories</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{questionCount}</div>
              <div className="text-xs text-gray-600">❓ Questions</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{gapCount}</div>
              <div className="text-xs text-gray-600">⚠️ Gaps</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onViewPrep(prep.id)}
          className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
        >
          View Prep
        </button>
        <button
          onClick={() => onExportQuickRef(prep.id)}
          className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 transition-colors"
        >
          Quick Reference
        </button>
        <button
          onClick={() => navigate(`/applications/${applicationId}/prep/practice`)}
          className="flex-1 px-4 py-2 bg-green-100 text-green-700 text-sm font-medium rounded-md hover:bg-green-200 transition-colors"
        >
          Practice
        </button>
      </div>

      {prep.completeness === 100 && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm font-medium text-green-700">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span>Ready for Interview</span>
        </div>
      )}
    </div>
  );
}
