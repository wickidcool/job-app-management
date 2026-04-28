import { useState } from 'react';
import type { AmbiguityItem } from '../../types/catalog';

interface AmbiguityResolverProps {
  item: AmbiguityItem;
  onResolve: (itemId: string, selectedOptionId: string) => void;
  onSkip: (itemId: string) => void;
}

const typeConfig = {
  ambiguous_tag: {
    icon: '⚠️',
    title: 'AMBIGUOUS TAG',
    bgColor: 'bg-warning-50',
    borderColor: 'border-warning-300',
  },
  unresolved_wikilink: {
    icon: '🔗',
    title: 'UNRESOLVED WIKILINK',
    bgColor: 'bg-neutral-50',
    borderColor: 'border-neutral-300',
  },
  fuzzy_match: {
    icon: '🔍',
    title: 'FUZZY MATCH',
    bgColor: 'bg-info-50',
    borderColor: 'border-info-300',
  },
} as const;

export function AmbiguityResolver({ item, onResolve, onSkip }: AmbiguityResolverProps) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const config = typeConfig[item.type];

  const handleConfirm = () => {
    if (selectedOptionId) {
      onResolve(item.id, selectedOptionId);
    }
  };

  return (
    <div className={`${config.bgColor} border ${config.borderColor} rounded-lg p-4 mb-3`}>
      <div className="flex items-start gap-2 mb-3">
        <span className="text-xl" aria-hidden="true">
          {config.icon}
        </span>
        <div className="flex-1">
          <h3 className="font-bold text-neutral-900">
            {config.title} &quot;{item.value}&quot;
          </h3>
        </div>
      </div>

      <div className="mb-4">
        <p className="text-sm text-neutral-700 mb-1">
          <strong>Context:</strong> {item.context}
        </p>
        <p className="text-xs text-neutral-500">Source: {item.sourceName}</p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-neutral-900 mb-2">
          {item.type === 'ambiguous_tag' && 'Which meaning did you intend?'}
          {item.type === 'unresolved_wikilink' && 'Did you mean one of these?'}
          {item.type === 'fuzzy_match' && 'Select the best match:'}
        </legend>

        <div className="space-y-2">
          {item.options.map((option) => (
            <label
              key={option.id}
              className="flex items-start gap-3 p-3 border border-neutral-200 rounded hover:bg-white hover:border-primary-300 cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name={`ambiguity-${item.id}`}
                value={option.id}
                checked={selectedOptionId === option.id}
                onChange={(e) => setSelectedOptionId(e.target.value)}
                className="mt-0.5 h-4 w-4 border-neutral-300 text-primary-600 focus:ring-primary-500"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-neutral-900">
                  {option.label}
                  {option.confidence !== undefined && (
                    <span className="ml-2 text-xs text-neutral-500">
                      ({Math.round(option.confidence * 100)}% match)
                    </span>
                  )}
                </div>
                {option.description && (
                  <p className="text-sm text-neutral-600 mt-1">{option.description}</p>
                )}
              </div>
            </label>
          ))}

          <label className="flex items-start gap-3 p-3 border border-neutral-200 rounded hover:bg-white hover:border-neutral-300 cursor-pointer transition-colors">
            <input
              type="radio"
              name={`ambiguity-${item.id}`}
              value="skip"
              checked={selectedOptionId === 'skip'}
              onChange={() => setSelectedOptionId('skip')}
              className="mt-0.5 h-4 w-4 border-neutral-300 text-neutral-600 focus:ring-neutral-500"
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-neutral-700">
                Skip (I&apos;ll resolve this later)
              </div>
            </div>
          </label>
        </div>
      </fieldset>

      <div className="mt-4 flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => onSkip(item.id)}
          className="px-4 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-300 rounded hover:bg-neutral-50"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!selectedOptionId || selectedOptionId === 'skip'}
          className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
