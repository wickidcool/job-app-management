import { type ReactNode } from 'react';

export interface WizardStepProps {
  stepNumber: number;
  totalSteps: number;
  question: string;
  hint?: string;
  children: ReactNode;
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  nextLabel?: string;
  backLabel?: string;
}

/**
 * WizardStep Component
 * Container for individual wizard step with question, input area, and navigation
 */
export function WizardStep({
  stepNumber,
  totalSteps,
  question,
  hint,
  children,
  onNext,
  onBack,
  canProceed,
  nextLabel = 'Next',
  backLabel = 'Back',
}: WizardStepProps) {
  const isFirstStep = stepNumber === 1;
  const isLastStep = stepNumber === totalSteps;

  const handleNext = () => {
    if (canProceed) {
      onNext();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey && canProceed) {
      handleNext();
    }
  };

  return (
    <div
      className="flex flex-col h-full"
      role="tabpanel"
      aria-labelledby={`step-${stepNumber}-title`}
      onKeyDown={handleKeyDown}
    >
      {/* Question Header */}
      <div className="mb-8">
        <h2
          id={`step-${stepNumber}-title`}
          className="text-h2 text-primary-600 mb-2"
        >
          {question}
        </h2>
        {hint && (
          <p className="text-body-sm text-neutral-600">
            {hint}
          </p>
        )}
      </div>

      {/* Input Area */}
      <div className="flex-1 mb-8">
        {children}
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between pt-6 border-t border-neutral-200">
        <button
          type="button"
          onClick={onBack}
          disabled={isFirstStep}
          className={`px-6 py-2 border border-neutral-300 rounded-lg text-body font-medium transition-all duration-base ${
            isFirstStep
              ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
              : 'bg-white text-neutral-700 hover:bg-neutral-50 hover:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500'
          }`}
          aria-label={`Go back to step ${stepNumber - 1}`}
        >
          ← {backLabel}
        </button>

        <button
          type="button"
          onClick={handleNext}
          disabled={!canProceed}
          className={`px-6 py-2 rounded-lg text-body font-semibold transition-all duration-base ${
            canProceed
              ? 'bg-primary-600 text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2'
              : 'bg-neutral-300 text-neutral-500 cursor-not-allowed'
          }`}
          aria-label={isLastStep ? 'Go to preview' : `Go to step ${stepNumber + 1}`}
          title={!canProceed ? 'Complete required fields to continue' : undefined}
        >
          {isLastStep ? 'Preview' : nextLabel} →
        </button>
      </div>

      {/* Keyboard Shortcut Hint */}
      <div className="mt-2 text-center">
        <p className="text-caption text-neutral-500">
          Press <kbd className="px-1 py-0.5 bg-neutral-200 rounded font-mono">Ctrl+Enter</kbd> to continue
        </p>
      </div>
    </div>
  );
}
