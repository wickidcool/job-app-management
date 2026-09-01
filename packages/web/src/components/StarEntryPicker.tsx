import { useState } from 'react';
import type { CatalogEntry } from '../services/api/types';
import { formatRatioAsPercent, ratio } from '../types/units';

/**
 * An entry is "recommended" at 80% relevance or better.
 *
 * `CatalogEntry.relevanceScore` is a ratio in `[0, 1]` (ADR-008 §1), so the threshold is
 * `0.8`, not `80`. It used to be `80`: no ratio can ever reach it, so the Recommended
 * section was structurally always empty and every badge rendered `0.85%` (WIC-1521 / the
 * latent instance ADR-008 §Context records). It never fired in production only because
 * the sole producer — `catalog.service.ts` — still hardcodes `relevanceScore: undefined`.
 *
 * Declared through `ratio()` so the constant is range-checked once, at module load, and
 * carries the `Ratio` brand rather than being a bare number that means nothing on its own.
 */
const RECOMMENDED_MIN_RELEVANCE = ratio(0.8);

interface StarEntryPickerProps {
  entries: CatalogEntry[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  showRecommended?: boolean;
  maxSelection?: number;
  minSelection?: number;
}

export function StarEntryPicker({
  entries,
  selectedIds,
  onSelectionChange,
  showRecommended = true,
  maxSelection = 8,
  minSelection = 1,
}: StarEntryPickerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // `!= null` rather than a truthiness test: `0` is a legitimate relevance ratio, and a
  // truthy check would silently reclassify it as "unscored".
  const recommendedEntries = entries.filter(
    (e) => e.relevanceScore != null && e.relevanceScore >= RECOMMENDED_MIN_RELEVANCE
  );
  const otherEntries = entries.filter(
    (e) => e.relevanceScore == null || e.relevanceScore < RECOMMENDED_MIN_RELEVANCE
  );

  const handleToggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((i) => i !== id));
    } else if (selectedIds.length < maxSelection) {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const filterEntries = (entryList: CatalogEntry[]) => {
    return entryList.filter((entry) => {
      const matchesSearch =
        searchTerm === '' ||
        entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.tags.some((t) => t.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesTags =
        selectedTags.length === 0 || selectedTags.some((tag) => entry.tags.includes(tag));

      return matchesSearch && matchesTags;
    });
  };

  const allTags = Array.from(new Set(entries.flatMap((e) => e.tags)));

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const selectedCount = selectedIds.length;
  const isValid = selectedCount >= minSelection && selectedCount <= maxSelection;
  const isOptimal = selectedCount >= 3 && selectedCount <= 5;

  return (
    <div className="space-y-4">
      {/* Search and Filter */}
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Search experiences..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  selectedTags.includes(tag)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selection Counter */}
      <div
        className={`px-4 py-2 rounded-lg text-sm ${
          !isValid
            ? 'bg-red-50 text-red-700 border border-red-200'
            : isOptimal
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
        }`}
      >
        {!isValid && selectedCount < minSelection && (
          <span>⚠️ Select at least {minSelection} entry to continue</span>
        )}
        {!isValid && selectedCount > maxSelection && (
          <span>⚠️ Maximum {maxSelection} entries allowed</span>
        )}
        {isValid && !isOptimal && (
          <span>
            Currently selected: {selectedCount}. 3-5 entries recommended for best results.
          </span>
        )}
        {isOptimal && <span>✓ {selectedCount} entries selected. Great selection!</span>}
      </div>

      {/* Recommended Entries */}
      {showRecommended && recommendedEntries.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <span className="text-blue-600">🎯</span>
            Recommended (from fit analysis)
          </h3>
          <div className="space-y-2">
            {filterEntries(recommendedEntries).map((entry) => (
              <StarEntryCard
                key={entry.id}
                entry={entry}
                isSelected={selectedIds.includes(entry.id)}
                onToggle={() => handleToggle(entry.id)}
                showRelevance={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* All Catalog Entries */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <span>📋</span>
          {showRecommended && recommendedEntries.length > 0
            ? 'All Catalog Entries'
            : 'Catalog Entries'}
        </h3>
        <div className="space-y-2">
          {filterEntries(otherEntries).map((entry) => (
            <StarEntryCard
              key={entry.id}
              entry={entry}
              isSelected={selectedIds.includes(entry.id)}
              onToggle={() => handleToggle(entry.id)}
              showRelevance={false}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface StarEntryCardProps {
  entry: CatalogEntry;
  isSelected: boolean;
  onToggle: () => void;
  showRelevance: boolean;
}

function StarEntryCard({ entry, isSelected, onToggle, showRelevance }: StarEntryCardProps) {
  return (
    <div
      onClick={onToggle}
      className={`p-4 border rounded-lg cursor-pointer transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-50 shadow-md'
          : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          className="mt-1 w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
          onClick={(e) => e.stopPropagation()}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="font-medium text-gray-900">{entry.title}</h4>
            {/*
              `!= null`, not truthiness: a `0` score would otherwise make this expression
              evaluate to `0`, which React renders as a literal "0" next to the title. Not
              reachable today — `showRelevance` is only true inside Recommended, and no
              recommended entry can score 0 — so it is defensive, not a fixed defect.
            */}
            {showRelevance && entry.relevanceScore != null && (
              <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-800 rounded">
                {formatRatioAsPercent(entry.relevanceScore)}
              </span>
            )}
          </div>

          {entry.timeframe && <p className="text-xs text-gray-500 mb-2">{entry.timeframe}</p>}

          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {entry.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {showRelevance && entry.relevanceReasoning && (
            <p className="text-sm text-gray-600 mt-2 pl-3 border-l-2 border-blue-300">
              → {entry.relevanceReasoning}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
