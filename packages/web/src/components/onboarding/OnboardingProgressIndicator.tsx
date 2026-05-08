interface OnboardingProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
  onStepClick?: (step: number) => void;
  allowSkipAhead: boolean;
}

export function OnboardingProgressIndicator({
  currentStep,
  totalSteps,
  stepLabels,
  onStepClick,
  allowSkipAhead,
}: OnboardingProgressIndicatorProps) {
  const handleStepClick = (step: number) => {
    if (!onStepClick) return;
    if (step < currentStep || (allowSkipAhead && step <= currentStep)) {
      onStepClick(step);
    }
  };

  return (
    <div className="w-full px-4 py-6">
      {/* Mobile: Simple dots */}
      <div className="block md:hidden">
        <div className="flex items-center justify-center gap-2 mb-2">
          {Array.from({ length: totalSteps }, (_, i) => {
            const step = i + 1;
            const isCompleted = step < currentStep;
            const isCurrent = step === currentStep;

            return (
              <div
                key={step}
                className={`h-3 w-3 rounded-full transition-all ${
                  isCompleted
                    ? 'bg-primary-600'
                    : isCurrent
                      ? 'bg-primary-500 ring-2 ring-primary-300 ring-offset-2'
                      : 'bg-neutral-300'
                }`}
                role="progressbar"
                aria-valuenow={currentStep}
                aria-valuemin={1}
                aria-valuemax={totalSteps}
                aria-label={`Onboarding progress: Step ${currentStep} of ${totalSteps}`}
              />
            );
          })}
        </div>
        <p className="text-center text-sm text-neutral-600">
          Step {currentStep} of {totalSteps}
        </p>
        <p className="text-center text-sm font-medium text-neutral-900 mt-1">
          {stepLabels[currentStep - 1]}
        </p>
      </div>

      {/* Desktop: Full progress bar with labels */}
      <div className="hidden md:block">
        <div className="relative">
          {/* Progress line */}
          <div className="absolute top-6 left-0 right-0 h-0.5 bg-neutral-200">
            <div
              className="h-full bg-primary-600 transition-all duration-300"
              style={{ width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%` }}
            />
          </div>

          {/* Steps */}
          <div className="relative flex justify-between">
            {Array.from({ length: totalSteps }, (_, i) => {
              const step = i + 1;
              const isCompleted = step < currentStep;
              const isCurrent = step === currentStep;
              const isFuture = step > currentStep;
              const isClickable =
                onStepClick && (step < currentStep || (allowSkipAhead && step <= currentStep));

              return (
                <div key={step} className="flex flex-col items-center" style={{ flex: 1 }}>
                  <button
                    type="button"
                    onClick={() => handleStepClick(step)}
                    disabled={!isClickable}
                    className={`relative z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all ${
                      isCompleted
                        ? 'border-primary-600 bg-primary-600 text-white'
                        : isCurrent
                          ? 'border-primary-500 bg-white text-primary-600 ring-2 ring-primary-300 ring-offset-2'
                          : 'border-neutral-300 bg-white text-neutral-400'
                    } ${isClickable ? 'cursor-pointer hover:scale-110' : 'cursor-default'}`}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    {isCompleted ? (
                      <svg
                        className="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      <span className="text-sm font-semibold">{step}</span>
                    )}
                  </button>
                  <p
                    className={`mt-3 text-center text-xs font-medium ${
                      isFuture ? 'text-neutral-400' : 'text-neutral-900'
                    }`}
                    style={{ maxWidth: '120px' }}
                  >
                    {stepLabels[i]}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="sr-only" role="status" aria-live="polite">
          Step {currentStep} of {totalSteps}: {stepLabels[currentStep - 1]}
        </div>
      </div>
    </div>
  );
}
