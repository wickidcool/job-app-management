import { useState } from 'react';

interface OnboardingBannerProps {
  onResume: () => void;
  onDismissPermanently?: () => void;
  dismissible: boolean;
}

export function OnboardingBanner({
  onResume,
  onDismissPermanently,
  dismissible,
}: OnboardingBannerProps) {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) {
    return null;
  }

  const handleDismiss = () => {
    setIsVisible(false);
  };

  const handlePermanentDismiss = () => {
    if (onDismissPermanently) {
      onDismissPermanently();
    }
    setIsVisible(false);
  };

  return (
    <div className="relative border-b border-primary-200 bg-primary-50 px-4 py-3">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        {/* Icon and Message */}
        <div className="flex items-center gap-3">
          <svg
            className="h-6 w-6 flex-shrink-0 text-primary-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-primary-900">
              Get started by uploading your resume
            </p>
            <p className="text-xs text-primary-700">
              Complete your profile to unlock all features
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onResume}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          >
            Resume Setup
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>

          {dismissible && (
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-md p-1.5 text-primary-600 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              aria-label="Dismiss banner"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Permanent dismiss option (shown in settings or after multiple dismissals) */}
      {onDismissPermanently && (
        <button
          type="button"
          onClick={handlePermanentDismiss}
          className="absolute bottom-1 right-4 text-xs text-primary-600 hover:underline"
        >
          Don't show again
        </button>
      )}
    </div>
  );
}
