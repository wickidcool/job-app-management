import { type ReactNode } from 'react';
import { WizardButton } from './WizardButton';

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
        <WizardButton
          variant="secondary"
          onClick={onBack}
          disabled={isFirstStep}
          aria-label={`Go back to step ${stepNumber - 1}`}
        >
          ← {backLabel}
        </WizardButton>

        <WizardButton
          variant="primary"
          onClick={handleNext}
          disabled={!canProceed}
          aria-label={isLastStep ? 'Go to preview' : `Go to step ${stepNumber + 1}`}
        >
          {isLastStep ? 'Preview' : nextLabel} →
        </WizardButton>
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
