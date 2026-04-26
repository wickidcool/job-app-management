import { useState, useMemo } from 'react';
import type { CatalogDiff, Resolution } from '../../types/catalog';
import { ChangeListItem } from './ChangeListItem';
import { AmbiguityResolver } from './AmbiguityResolver';

interface DiffReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  diff: CatalogDiff;
  onApplyAll: () => Promise<void>;
  onApplySelected: (changeIds: string[], resolutions: Resolution[]) => Promise<void>;
  onRejectAll: () => void;
}

export function DiffReviewModal({
  isOpen,
  onClose,
  diff,
  onApplyAll,
  onApplySelected,
  onRejectAll,
}: DiffReviewModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [expandAll, setExpandAll] = useState(false);

  const changes = useMemo(
    () =>
      (diff.changes ?? []).map((change) => ({
        ...change,
        selected: selectedIds.has(change.id),
      })),
    [diff.changes, selectedIds]
  );

  const handleToggleChange = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleResolveAmbiguity = (itemId: string, selectedOptionId: string) => {
    setResolutions((prev) => [
      ...prev.filter((r) => r.ambiguityId !== itemId),
      { ambiguityId: itemId, selectedOptionId },
    ]);
  };

  const handleSkipAmbiguity = (itemId: string) => {
    setResolutions((prev) => prev.filter((r) => r.ambiguityId !== itemId));
  };

  const handleApplySelected = async () => {
    setIsApplying(true);
    try {
      const selectedIds = changes.filter((c) => c.selected).map((c) => c.id);
      await onApplySelected(selectedIds, resolutions);
      onClose();
    } catch (error) {
      console.error('Failed to apply changes:', error);
    } finally {
      setIsApplying(false);
    }
  };

  const handleApplyAll = async () => {
    setIsApplying(true);
    try {
      await onApplyAll();
      onClose();
    } catch (error) {
      console.error('Failed to apply all changes:', error);
    } finally {
      setIsApplying(false);
    }
  };

  const handleRejectAll = () => {
    if (confirm('Are you sure you want to reject all changes? This cannot be undone.')) {
      onRejectAll();
      onClose();
    }
  };

  const selectedCount = changes.filter((c) => c.selected).length;

  // Group changes by entity type
  const groupedChanges = changes.reduce(
    (acc, change) => {
      if (!acc[change.entity]) {
        acc[change.entity] = [];
      }
      acc[change.entity].push(change);
      return acc;
    },
    {} as Record<string, typeof changes>
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="diff-modal-title"
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <h2 id="diff-modal-title" className="text-h3 font-bold text-neutral-900">
            Catalog Change Review
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Summary */}
          <div className="bg-info-50 border border-info-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-2">
              <span className="text-xl" aria-hidden="true">
                📊
              </span>
              <div>
                <h3 className="font-bold text-neutral-900 mb-1">Summary</h3>
                <p className="text-sm text-neutral-700">{diff.summary?.summary ?? 'No changes'}</p>
                {(diff.summary?.pendingReviewCount ?? 0) > 0 && (
                  <p className="text-sm text-warning-700 mt-1">
                    {diff.summary?.pendingReviewCount ?? 0} pending review
                    {(diff.summary?.pendingReviewCount ?? 0) !== 1 ? 's' : ''} (ambiguous tags)
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mb-6 flex-wrap">
            <button
              type="button"
              onClick={handleApplyAll}
              disabled={isApplying}
              className="px-4 py-2 text-sm font-medium text-white bg-success-600 rounded hover:bg-success-700 disabled:opacity-50"
            >
              Apply All
            </button>
            <button
              type="button"
              onClick={handleApplySelected}
              disabled={isApplying || selectedCount === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50"
            >
              Apply Selected ({selectedCount})
            </button>
            <button
              type="button"
              onClick={handleRejectAll}
              disabled={isApplying}
              className="px-4 py-2 text-sm font-medium text-error-600 bg-white border border-error-300 rounded hover:bg-error-50 disabled:opacity-50"
            >
              Reject All
            </button>
          </div>

          {/* Pending Reviews */}
          {(diff.pendingReviews?.length ?? 0) > 0 && (
            <div className="mb-6">
              <h3 className="text-h4 font-bold text-neutral-900 mb-3 flex items-center gap-2">
                <span aria-hidden="true">⚠️</span>
                Pending Review ({diff.pendingReviews?.length ?? 0})
              </h3>
              {(diff.pendingReviews ?? []).map((item) => (
                <AmbiguityResolver
                  key={item.id}
                  item={item}
                  onResolve={handleResolveAmbiguity}
                  onSkip={handleSkipAmbiguity}
                />
              ))}
            </div>
          )}

          {/* Changes by Category */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-h4 font-bold text-neutral-900 flex items-center gap-2">
                <span aria-hidden="true">📦</span>
                Changes by Category
              </h3>
              <button
                type="button"
                onClick={() => setExpandAll(!expandAll)}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                {expandAll ? 'Collapse All' : 'Expand All'}
              </button>
            </div>

            {Object.entries(groupedChanges).map(([entity, entityChanges]) => {
              const createCount = entityChanges.filter((c) => c.action === 'create').length;
              const updateCount = entityChanges.filter((c) => c.action === 'update').length;
              const deleteCount = entityChanges.filter((c) => c.action === 'delete').length;

              return (
                <div key={entity} className="mb-4">
                  <h4 className="text-body-lg font-bold text-neutral-900 mb-2 capitalize">
                    ▼ {entity.replace(/_/g, ' ')} ({createCount > 0 && `${createCount} new`}
                    {createCount > 0 && updateCount > 0 && ', '}
                    {updateCount > 0 && `${updateCount} updated`}
                    {(createCount > 0 || updateCount > 0) && deleteCount > 0 && ', '}
                    {deleteCount > 0 && `${deleteCount} deleted`})
                  </h4>
                  <div className="space-y-2">
                    {entityChanges.map((change) => (
                      <ChangeListItem
                        key={change.id}
                        change={change}
                        onToggle={handleToggleChange}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-300 rounded hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApplySelected}
            disabled={isApplying || selectedCount === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {isApplying ? 'Applying...' : `Apply Selected Changes (${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
