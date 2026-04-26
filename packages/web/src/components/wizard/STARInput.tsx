export interface STARData {
  headline: string;
  situation: string;
  task: string;
  action: string;
  result: string;
}

export interface STARInputProps {
  value: STARData;
  onChange: (data: STARData) => void;
  errors?: Partial<Record<keyof STARData, string>>;
}

interface FieldConfig {
  key: keyof STARData;
  label: string;
  placeholder: string;
  hint: string;
  maxLength: number;
  minLength: number;
  rows: number;
}

/**
 * STARInput Component
 * Multi-field STAR breakdown editor with validation and character counts
 */
export function STARInput({ value, onChange, errors = {} }: STARInputProps) {
  const fields: FieldConfig[] = [
    {
      key: 'headline',
      label: 'Describe this accomplishment in one sentence',
      placeholder: 'e.g., Payment system redesign for high scale',
      hint: 'A brief summary that captures the essence of your accomplishment',
      maxLength: 200,
      minLength: 10,
      rows: 2,
    },
    {
      key: 'situation',
      label: 'Situation: What was the context or challenge you faced?',
      placeholder: 'Describe the background, problem, or challenge...',
      hint: 'Set the scene. What was happening? What problem needed solving?',
      maxLength: 500,
      minLength: 10,
      rows: 4,
    },
    {
      key: 'task',
      label: 'Task: What was your specific responsibility?',
      placeholder: 'What were you asked to do or what goal did you set?',
      hint: 'Focus on YOUR role. What were you responsible for?',
      maxLength: 500,
      minLength: 10,
      rows: 3,
    },
    {
      key: 'action',
      label: 'Action: What specific actions did you take?',
      placeholder: 'Describe the concrete steps you took...',
      hint: 'Be specific about what YOU did (use "I" not "we"). Include technical details.',
      maxLength: 1000,
      minLength: 10,
      rows: 5,
    },
    {
      key: 'result',
      label: 'Result: What was the outcome?',
      placeholder: 'Describe the measurable impact...',
      hint: 'Include metrics when possible (%, $, time saved, improvement). What changed?',
      maxLength: 500,
      minLength: 10,
      rows: 4,
    },
  ];

  const handleChange = (key: keyof STARData, newValue: string) => {
    onChange({
      ...value,
      [key]: newValue,
    });
  };

  const getCharacterCount = (key: keyof STARData, maxLength: number) => {
    const currentLength = value[key]?.length || 0;
    const remaining = maxLength - currentLength;
    const isNearLimit = remaining < 50;
    const isOverLimit = remaining < 0;

    return {
      text: `${currentLength} / ${maxLength}`,
      color: isOverLimit ? 'text-error-700' : isNearLimit ? 'text-warning-700' : 'text-neutral-500',
    };
  };

  const isFieldValid = (key: keyof STARData, minLength: number) => {
    const length = value[key]?.length || 0;
    return length >= minLength;
  };

  return (
    <div className="space-y-6">
      {fields.map((field) => {
        const charCount = getCharacterCount(field.key, field.maxLength);
        const isValid = isFieldValid(field.key, field.minLength);
        const hasError = errors[field.key];

        return (
          <div key={field.key} className="space-y-2">
            {/* Label */}
            <label
              htmlFor={`star-${field.key}`}
              className="block text-body font-medium text-neutral-800"
            >
              {field.label}
              {isValid && (
                <span className="ml-2 text-success-700" aria-label="Field valid">
                  ✓
                </span>
              )}
            </label>

            {/* Textarea */}
            <div className="relative">
              <textarea
                id={`star-${field.key}`}
                value={value[field.key] || ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                rows={field.rows}
                maxLength={field.maxLength}
                className={`w-full px-4 py-3 border rounded-lg text-body resize-none focus:outline-none focus:ring-2 transition-all duration-base ${
                  hasError
                    ? 'border-error-500 focus:ring-error-500'
                    : isValid
                      ? 'border-success-500 focus:ring-primary-500'
                      : 'border-neutral-300 focus:ring-primary-500'
                }`}
                aria-describedby={`${field.key}-hint ${field.key}-count ${hasError ? `${field.key}-error` : ''}`}
                aria-invalid={!!hasError}
              />
            </div>

            {/* Hint and Character Count */}
            <div className="flex items-start justify-between gap-4">
              <p id={`${field.key}-hint`} className="text-body-sm text-neutral-600 flex-1">
                💡 {field.hint}
              </p>
              <span
                id={`${field.key}-count`}
                className={`text-caption font-mono ${charCount.color} shrink-0`}
              >
                {charCount.text}
              </span>
            </div>

            {/* Error Message */}
            {hasError && (
              <p id={`${field.key}-error`} className="text-body-sm text-error-700" role="alert">
                {hasError}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
