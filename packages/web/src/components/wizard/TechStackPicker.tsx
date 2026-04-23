import { useState, type KeyboardEvent } from 'react';

export interface TechStackPickerProps {
  value: string[];
  onChange: (tags: string[]) => void;
  maxTags?: number;
  placeholder?: string;
}

/**
 * TechStackPicker Component
 * Simple tag input for technologies - NO autocomplete per design requirements
 */
export function TechStackPicker({
  value,
  onChange,
  maxTags = 20,
  placeholder = 'Enter technology names (comma-separated or press Enter)',
}: TechStackPickerProps) {
  const [inputValue, setInputValue] = useState('');

  const normalizeTag = (tag: string): string => {
    return tag.trim().toLowerCase();
  };

  const addTags = (input: string) => {
    // Split by comma and process each tag
    const newTags = input
      .split(',')
      .map(normalizeTag)
      .filter((tag) => tag.length > 0)
      .filter((tag) => !value.includes(tag)); // Deduplicate

    if (newTags.length > 0) {
      const updatedTags = [...value, ...newTags].slice(0, maxTags);
      onChange(updatedTags);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim()) {
        addTags(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      // Remove last tag on backspace if input is empty
      onChange(value.slice(0, -1));
    }
  };

  const handleBlur = () => {
    if (inputValue.trim()) {
      addTags(inputValue);
    }
  };

  const removeTag = (tagToRemove: string) => {
    onChange(value.filter((tag) => tag !== tagToRemove));
  };

  const isAtMaxTags = value.length >= maxTags;

  return (
    <div className="space-y-2">
      {/* Tags Display */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2" role="list" aria-label="Selected technologies">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-body-sm font-medium"
              role="listitem"
            >
              <span>{tag}</span>
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="hover:text-primary-900 transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-primary-500 rounded"
                aria-label={`Remove ${tag}`}
              >
                <span aria-hidden="true">×</span>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input Field */}
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={isAtMaxTags}
          placeholder={isAtMaxTags ? `Maximum ${maxTags} technologies allowed` : placeholder}
          className="w-full px-4 py-2 border border-neutral-300 rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-neutral-100 disabled:cursor-not-allowed transition-all duration-base"
          aria-label="Technology input"
          aria-describedby="tech-stack-hint"
        />
      </div>

      {/* Hint */}
      <p id="tech-stack-hint" className="text-body-sm text-neutral-600">
        {isAtMaxTags ? (
          <span className="text-warning-700">Maximum {maxTags} technologies reached</span>
        ) : (
          <>
            Type technology names and press <kbd className="px-1 py-0.5 bg-neutral-200 rounded text-caption font-mono">Enter</kbd> or separate with commas. ({value.length}/{maxTags})
          </>
        )}
      </p>
    </div>
  );
}
