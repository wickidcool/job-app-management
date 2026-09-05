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
    // WIC-2078, reviewed exception (site 3 of 3). The `onKeyDown` here is not this element's
    // own activation — it is a container-scoped shortcut for its focusable DESCENDANTS. The
    // panel is never itself focused; `keydown` fires on whichever input or button inside the
    // step has focus and bubbles up to here, which is precisely what scopes Ctrl+Enter to
    // "while the user is working in this step" and is why it is advertised in the hint below.
    //
    // Both alternatives are worse, which is what makes this an exception rather than a fix
    // deferred. Adding `tabIndex={0}` to satisfy the rule adds a tab stop that does nothing
    // when activated, and it is not owed: ARIA APG asks for a focusable `tabpanel` only when
    // the panel has no focusable children, and this one always renders the Back/Next buttons.
    // Hoisting the listener to `document` would silence the rule by widening the shortcut's
    // scope to the whole app — trading a lint finding for a real behaviour change, and for a
    // global key handler that fires on steps and pages that never advertised it.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="flex flex-col h-full"
      role="tabpanel"
      aria-labelledby={`step-${stepNumber}-title`}
      onKeyDown={handleKeyDown}
    >
      {/* Question Header */}
      <div className="mb-8">
        <h2 id={`step-${stepNumber}-title`} className="text-h2 text-primary-600 mb-2">
          {question}
        </h2>
        {hint && <p className="text-body-sm text-neutral-600">{hint}</p>}
      </div>

      {/* Input Area */}
      <div className="flex-1 mb-8">{children}</div>

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
          Press <kbd className="px-1 py-0.5 bg-neutral-200 rounded font-mono">Ctrl+Enter</kbd> to
          continue
        </p>
      </div>
    </div>
  );
}
