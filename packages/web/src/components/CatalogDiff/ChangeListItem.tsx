import { useState } from 'react';
import type { CatalogChange } from '../../types/catalog';
import { ChangeActionBadge } from './ChangeActionBadge';

interface ChangeListItemProps {
  change: CatalogChange;
  onToggle: (id: string) => void;
}

export function ChangeListItem({ change, onToggle }: ChangeListItemProps) {
  const [showDetails, setShowDetails] = useState(false);

  const renderChangeDetails = () => {
    if (change.action === 'create') {
      return (
        <dl className="mt-2 space-y-1 text-sm text-neutral-700">
          {Object.entries(change.data).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="font-medium">{key}:</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      );
    }

    if (change.action === 'update' && change.before && change.after) {
      const changedKeys = Object.keys(change.after).filter(
        (key) => change.before![key] !== change.after![key]
      );

      return (
        <dl className="mt-2 space-y-1 text-sm">
          {changedKeys.map((key) => (
            <div key={key} className="flex gap-2">
              <dt className="font-medium text-neutral-700">{key}:</dt>
              <dd>
                <span className="text-error-600 line-through">
                  {String(change.before![key])}
                </span>
                {' → '}
                <span className="text-success-600 font-medium">
                  {String(change.after![key])}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      );
    }

    return null;
  };

  const borderColor = change.selected
    ? 'border-success-300'
    : 'border-neutral-100';
  const opacity = change.selected ? 'opacity-100' : 'opacity-60';

  return (
    <div
      className={`bg-neutral-50 border ${borderColor} ${opacity} rounded-lg p-4 mb-3 transition-all hover:border-primary-300 hover:shadow-md`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={change.selected}
          onChange={() => onToggle(change.id)}
          className="mt-1 h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
          aria-label={`Include ${change.action} change for ${change.entity}`}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <ChangeActionBadge action={change.action} />
            <h3
              className={`text-body-lg font-bold text-neutral-900 ${
                !change.selected ? 'line-through' : ''
              }`}
            >
              {change.entity}
            </h3>
          </div>

          {renderChangeDetails()}

          <div className="mt-2 text-xs text-neutral-500">
            Source: {change.sourceName}
          </div>

          {showDetails && (
            <div className="mt-3 p-3 bg-white rounded border border-neutral-200">
              <h4 className="font-medium text-sm text-neutral-900 mb-2">
                Full Details
              </h4>
              <pre className="text-xs overflow-x-auto">
                {JSON.stringify(change, null, 2)}
              </pre>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              {showDetails ? 'Hide Details' : 'View Details'}
            </button>
            <button
              type="button"
              onClick={() => onToggle(change.id)}
              className="text-sm text-neutral-600 hover:text-neutral-700 font-medium"
            >
              {change.selected ? 'Skip' : 'Include'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
