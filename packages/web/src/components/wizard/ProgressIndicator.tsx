export interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
  onStepClick?: (step: number) => void;
}

/**
 * ProgressIndicator Component
 * Visual progress indicator for wizard steps with step labels and progress bar
 */
export function ProgressIndicator({
  currentStep,
  totalSteps,
  stepLabels,
  onStepClick,
}: ProgressIndicatorProps) {
  const progressPercentage = ((currentStep - 1) / (totalSteps - 1)) * 100;

  const getStepState = (step: number): 'completed' | 'current' | 'upcoming' => {
    if (step < currentStep) return 'completed';
    if (step === currentStep) return 'current';
    return 'upcoming';
  };

  const getStepIcon = (step: number): string => {
    const state = getStepState(step);
    if (state === 'completed') return '✓';
    if (state === 'current') return '•';
    return '○';
  };

  const getStepClasses = (step: number): string => {
    const state = getStepState(step);
    const baseClasses = 'flex items-center gap-2 text-body-sm transition-colors duration-base';

    if (state === 'completed') {
      return `${baseClasses} text-success-700 font-semibold`;
    }
    if (state === 'current') {
      return `${baseClasses} text-primary-600 font-bold`;
    }
    return `${baseClasses} text-neutral-400 font-normal`;
  };

  return (
    <div className="w-full space-y-4" role="progressbar" aria-valuenow={currentStep} aria-valuemin={1} aria-valuemax={totalSteps}>
      {/* Step Labels */}
      <div className="flex items-center justify-between gap-2">
        {stepLabels.map((label, index) => {
          const step = index + 1;
          const state = getStepState(step);
          const isClickable = onStepClick && step < currentStep;

          return (
            <button
              key={step}
              onClick={() => isClickable && onStepClick(step)}
              disabled={!isClickable}
              className={`${getStepClasses(step)} ${isClickable ? 'cursor-pointer hover:text-primary-700' : 'cursor-default'} disabled:cursor-default`}
              aria-label={`Step ${step}: ${label}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className="text-h4" aria-hidden="true">
                {getStepIcon(step)}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Progress Bar */}
      <div className="w-full h-2 bg-neutral-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary-500 transition-all duration-slow ease-out"
          style={{ width: `${progressPercentage}%` }}
          role="presentation"
        />
      </div>

      {/* Progress Text */}
      <p className="text-body-sm text-neutral-600 text-center" aria-live="polite">
        Step {currentStep} of {totalSteps} ({Math.round(progressPercentage)}%)
      </p>
    </div>
  );
}
