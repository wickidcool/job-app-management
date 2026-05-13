import type { ReactNode } from 'react';

interface OnboardingStepProps {
  stepNumber: number;
  totalSteps: number;
  title: string;
  description?: string;
  illustration?: ReactNode;
  canProceed: boolean;
  onNext: () => void;
  onBack?: () => void;
  children: ReactNode;
  validationMessage?: string;
  formId?: string;
}

export function OnboardingStep({
  stepNumber,
  totalSteps,
  title,
  description,
  illustration,
  canProceed,
  onNext,
  onBack,
  children,
  validationMessage,
  formId,
}: OnboardingStepProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Illustration */}
      {illustration && (
        <div className="mb-6 flex justify-center">
          <div className="h-48 w-48 md:h-64 md:w-64">{illustration}</div>
        </div>
      )}

      {/* Title and Description */}
      <div className="mb-6 text-center">
        <h2 id="onboarding-title" className="text-2xl font-bold text-neutral-900 md:text-3xl">
          {title}
        </h2>
        {description && (
          <p id="onboarding-description" className="mt-3 text-base text-neutral-600 md:text-lg">
            {description}
          </p>
        )}
      </div>

      {/* Interactive Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

      {/* Validation Feedback */}
      {validationMessage && (
        <div className="mt-4 rounded-md border border-info-300 bg-info-50 p-3 text-sm text-info-800">
          <div className="flex items-start gap-2">
            <svg
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-info-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{validationMessage}</span>
          </div>
        </div>
      )}

      {/* Success indicator when step is complete */}
      {canProceed && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-success-700">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>Ready to continue</span>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="mt-6 flex items-center justify-between border-t border-neutral-200 pt-6">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back
          </button>
        ) : (
          <div />
        )}

        <button
          type={formId ? 'submit' : 'button'}
          form={formId}
          onClick={formId ? undefined : onNext}
          disabled={formId ? false : !canProceed}
          className={`inline-flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
            formId || canProceed
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'cursor-not-allowed bg-neutral-300 text-neutral-500'
          }`}
        >
          {stepNumber === totalSteps ? 'Complete' : 'Next Step'}
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
