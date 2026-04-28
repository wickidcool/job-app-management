import { useState } from 'react';
import {
  useCompanyCatalog,
  useTechStackTags,
  useJobFitTags,
  useQuantifiedBullets,
  useCatalogDiffs,
  useApplyDiff,
  useDiscardDiff,
} from '../../hooks/useCatalog';
import { CatalogBrowseTable } from './CatalogBrowseTable';
import { DiffReviewModal } from '../CatalogDiff/DiffReviewModal';
import type { CatalogDiff, Resolution, CatalogEntry } from '../../types/catalog';

type TabType = 'pendingDiffs' | 'companies' | 'techStackTags' | 'jobFitTags' | 'quantifiedBullets';

const tabs = [
  { id: 'pendingDiffs' as const, label: 'Pending Diffs' },
  { id: 'companies' as const, label: 'Companies' },
  { id: 'techStackTags' as const, label: 'Tech Stack Tags' },
  { id: 'jobFitTags' as const, label: 'Job Fit Tags' },
  { id: 'quantifiedBullets' as const, label: 'Quantified Bullets' },
];

export function CatalogBrowseView() {
  const [activeTab, setActiveTab] = useState<TabType>('pendingDiffs');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [selectedDiff, setSelectedDiff] = useState<CatalogDiff | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const diffsQuery = useCatalogDiffs();
  const applyDiffMutation = useApplyDiff();
  const discardDiffMutation = useDiscardDiff();

  const companiesQuery = useCompanyCatalog({
    search: searchQuery,
  });

  const techStackTagsQuery = useTechStackTags({
    search: searchQuery,
    category: categoryFilter || undefined,
  });

  const jobFitTagsQuery = useJobFitTags({
    search: searchQuery,
    category: categoryFilter || undefined,
  });

  const quantifiedBulletsQuery = useQuantifiedBullets({
    search: searchQuery,
    impact: categoryFilter || undefined,
  });

  const getActiveQuery = () => {
    switch (activeTab) {
      case 'companies':
        return companiesQuery;
      case 'techStackTags':
        return techStackTagsQuery;
      case 'jobFitTags':
        return jobFitTagsQuery;
      case 'quantifiedBullets':
        return quantifiedBulletsQuery;
      default:
        return companiesQuery;
    }
  };

  const activeQuery = activeTab === 'pendingDiffs' ? diffsQuery : getActiveQuery();
  const diffs = diffsQuery.data || [];
  const catalogData = activeTab === 'pendingDiffs' ? [] : activeQuery.data || [];
  const isLoading = activeQuery.isLoading;
  const error = activeQuery.error;

  const handleDiffClick = (diff: CatalogDiff) => {
    setSelectedDiff(diff);
    setIsModalOpen(true);
  };

  const handleApplyAll = async () => {
    if (!selectedDiff) return;
    const allChangeIds = selectedDiff.changes.map((c) => c.id);
    await applyDiffMutation.mutateAsync({
      diffId: selectedDiff.id,
      request: {
        changeIds: allChangeIds,
        resolutions: {},
      },
    });
  };

  const handleApplySelected = async (changeIds: string[], resolutions: Resolution[]) => {
    if (!selectedDiff) return;
    const resolutionsMap = resolutions.reduce(
      (acc, r) => ({ ...acc, [r.ambiguityId]: r.selectedOptionId }),
      {}
    );
    await applyDiffMutation.mutateAsync({
      diffId: selectedDiff.id,
      request: {
        changeIds,
        resolutions: resolutionsMap,
      },
    });
  };

  const handleRejectAll = async () => {
    if (!selectedDiff) return;
    await discardDiffMutation.mutateAsync(selectedDiff.id);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-h2 font-bold text-neutral-900 mb-2">Master Catalog Index</h1>
        <p className="text-body text-neutral-600">
          Browse and search your complete catalog of companies, skills, and achievements
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-neutral-200 mb-6">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSearchQuery('');
                  setCategoryFilter('');
                }}
                className={`
                  whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${
                    isActive
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
                  }
                `}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Search and Filters */}
      {activeTab !== 'pendingDiffs' && (
        <div className="mb-6 flex gap-4 items-center">
          <div className="flex-1">
            <input
              type="search"
              placeholder={`Search ${tabs.find((t) => t.id === activeTab)?.label.toLowerCase()}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {(activeTab === 'techStackTags' || activeTab === 'jobFitTags') && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-4 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Categories</option>
              {activeTab === 'techStackTags' && (
                <>
                  <option value="language">Language</option>
                  <option value="frontend">Frontend</option>
                  <option value="backend">Backend</option>
                  <option value="database">Database</option>
                  <option value="cloud">Cloud</option>
                  <option value="devops">DevOps</option>
                  <option value="ai_ml">AI/ML</option>
                  <option value="uncategorized">Uncategorized</option>
                </>
              )}
              {activeTab === 'jobFitTags' && (
                <>
                  <option value="role">Role</option>
                  <option value="industry">Industry</option>
                  <option value="seniority">Seniority</option>
                  <option value="work_style">Work Style</option>
                  <option value="uncategorized">Uncategorized</option>
                </>
              )}
            </select>
          )}

          {activeTab === 'quantifiedBullets' && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-4 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Impact</option>
              <option value="revenue">Revenue</option>
              <option value="efficiency">Efficiency</option>
              <option value="team-leadership">Team Leadership</option>
              <option value="growth">Growth</option>
            </select>
          )}
        </div>
      )}

      {/* Content */}
      {isLoading && (
        <div className="text-center py-12">
          <p className="text-neutral-500">Loading...</p>
        </div>
      )}

      {error && (
        <div className="bg-error-50 border border-error-200 rounded-lg p-4 mb-6">
          <p className="text-error-700">
            Error loading catalog: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {!isLoading && !error && activeTab === 'pendingDiffs' && diffs.length === 0 && (
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-8 text-center">
          <p className="text-h4 font-bold text-neutral-900 mb-2">✅ No Pending Diffs</p>
          <p className="text-neutral-600">
            All changes have been reviewed. Upload a new resume or add an application to generate
            diffs.
          </p>
        </div>
      )}

      {!isLoading && !error && activeTab !== 'pendingDiffs' && catalogData.length === 0 && (
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-8 text-center">
          <p className="text-h4 font-bold text-neutral-900 mb-2">📚 Your Catalog is Empty</p>
          <p className="text-neutral-600">Upload a resume to start building your catalog.</p>
        </div>
      )}

      {!isLoading && !error && activeTab === 'pendingDiffs' && diffs.length > 0 && (
        <div className="space-y-4">
          {diffs.map((diff) => (
            <div
              key={diff.id}
              className="bg-white border border-neutral-200 rounded-lg p-6 hover:border-primary-300 cursor-pointer transition-colors"
              onClick={() => handleDiffClick(diff)}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-h4 font-bold text-neutral-900 mb-1">
                    {diff.sourceType === 'resume' ? '📄' : '💼'}{' '}
                    {diff.sourceType === 'resume' ? 'Resume' : 'Application'} Update
                  </h3>
                  <p className="text-sm text-neutral-500">
                    {new Date(diff.createdAt).toLocaleDateString()} at{' '}
                    {new Date(diff.createdAt).toLocaleTimeString()}
                  </p>
                </div>
                <button
                  type="button"
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded hover:bg-primary-700"
                >
                  Review Changes
                </button>
              </div>
              <p className="text-neutral-700 mb-3">{diff.summary.summary}</p>
              <div className="flex gap-4 text-sm">
                <span className="text-success-700">➕ {diff.summary.newCount} new</span>
                <span className="text-info-700">✏️ {diff.summary.updatedCount} updated</span>
                <span className="text-error-700">➖ {diff.summary.deletedCount} deleted</span>
                {diff.summary.pendingReviewCount > 0 && (
                  <span className="text-warning-700">
                    ⚠️ {diff.summary.pendingReviewCount} pending review
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && activeTab !== 'pendingDiffs' && catalogData.length > 0 && (
        <>
          <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden mb-4">
            <CatalogBrowseTable
              catalogType={activeTab}
              data={catalogData as CatalogEntry[]}
              onRowClick={(id) => {
                console.log('Row clicked:', id);
              }}
            />
          </div>

          <div className="text-sm text-neutral-500 text-center">
            Showing {catalogData.length} of {catalogData.length} entries
          </div>
        </>
      )}

      {selectedDiff && (
        <DiffReviewModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          diff={selectedDiff}
          onApplyAll={handleApplyAll}
          onApplySelected={handleApplySelected}
          onRejectAll={handleRejectAll}
        />
      )}
    </div>
  );
}
