import { useState } from 'react';
import type { PrepStory } from '../types/interviewPrep';

interface STARStoryBankProps {
  stories: PrepStory[];
  onStorySelect?: (storyId: string) => void;
  onMarkFavorite: (storyId: string, favorite: boolean) => void;
  selectedStoryIds?: string[];
  showTimeVersions?: boolean;
}

const THEMES = [
  { id: 'all', name: 'All', icon: '📚' },
  { id: 'leadership', name: 'Leadership', icon: '👥' },
  { id: 'technical', name: 'Technical', icon: '💻' },
  { id: 'teamwork', name: 'Teamwork', icon: '🤝' },
  { id: 'problem_solving', name: 'Problem Solving', icon: '🔍' },
  { id: 'communication', name: 'Communication', icon: '💬' },
  { id: 'innovation', name: 'Innovation', icon: '💡' },
];

export function STARStoryBank({
  stories,
  onStorySelect,
  onMarkFavorite,
  selectedStoryIds = [],
  showTimeVersions = false,
}: STARStoryBankProps) {
  const [activeTheme, setActiveTheme] = useState('all');
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);
  const [timeVersionTab, setTimeVersionTab] = useState<'1min' | '2min' | '5min'>('2min');
  const [copiedStoryId, setCopiedStoryId] = useState<string | null>(null);

  const filteredStories = stories.filter(
    (story) => activeTheme === 'all' || story.themes.includes(activeTheme)
  );

  const sortedStories = [...filteredStories].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return b.relevanceScore - a.relevanceScore;
  });

  const getRelevanceBadge = (score: number) => {
    if (score >= 90) return { color: 'bg-green-100 text-green-800', label: 'Excellent', icon: '🟢' };
    if (score >= 80) return { color: 'bg-green-50 text-green-700', label: 'Strong', icon: '🟢' };
    if (score >= 70) return { color: 'bg-yellow-100 text-yellow-800', label: 'Good', icon: '🟡' };
    if (score >= 60) return { color: 'bg-orange-100 text-orange-800', label: 'Fair', icon: '🟠' };
    return { color: 'bg-gray-100 text-gray-600', label: 'Low', icon: '⚪' };
  };

  const getConfidenceBadge = (level: string) => {
    switch (level) {
      case 'confident':
        return '✅';
      case 'comfortable':
        return '☑️';
      case 'needs_work':
        return '⚠️';
      default:
        return '';
    }
  };

  const themeCount = (themeId: string) => {
    if (themeId === 'all') return stories.length;
    return stories.filter((s) => s.themes.includes(themeId)).length;
  };

  return (
    <div className="space-y-4">
      {/* Theme Tabs */}
      <div className="flex gap-2 flex-wrap border-b border-gray-200 pb-2">
        {THEMES.map((theme) => {
          const count = themeCount(theme.id);
          if (count === 0 && theme.id !== 'all') return null;

          return (
            <button
              key={theme.id}
              onClick={() => setActiveTheme(theme.id)}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                activeTheme === theme.id
                  ? 'bg-blue-100 text-blue-700 border-b-2 border-blue-600'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {theme.icon} {theme.name} ({count})
            </button>
          );
        })}
      </div>

      {/* Stories List */}
      <div className="space-y-3">
        {sortedStories.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg mb-2">No stories in this category</p>
            <p className="text-sm">Try selecting a different theme</p>
          </div>
        ) : (
          sortedStories.map((story) => {
            const isExpanded = expandedStoryId === story.id;
            const badge = getRelevanceBadge(story.relevanceScore);
            const isSelected = selectedStoryIds.includes(story.id);

            return (
              <div
                key={story.id}
                className={`border rounded-lg p-4 transition-all ${
                  isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                } ${isExpanded ? 'shadow-md' : 'hover:shadow-sm'}`}
              >
                {/* Story Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    {onStorySelect && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onStorySelect(story.id)}
                        className="mt-1 h-4 w-4 text-blue-600 rounded"
                      />
                    )}
                    <button
                      onClick={() => onMarkFavorite(story.id, !story.isFavorite)}
                      className="text-xl flex-shrink-0 transition-transform hover:scale-110"
                    >
                      {story.isFavorite ? '⭐' : '☆'}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3
                          className="font-medium text-gray-900 cursor-pointer hover:text-blue-600"
                          onClick={() =>
                            setExpandedStoryId(isExpanded ? null : story.id)
                          }
                        >
                          {story.starEntryId.substring(0, 50)}
                          {story.starEntryId.length > 50 ? '...' : ''}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {story.themes.map((theme) => (
                          <span
                            key={theme}
                            className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded"
                          >
                            {theme.replace('_', ' ')}
                          </span>
                        ))}
                      </div>
                      {!isExpanded && (
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {story.twoMinVersion}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${badge.color}`}>
                      {badge.icon} {story.relevanceScore}%
                    </span>
                    {story.confidenceLevel !== 'not_practiced' && (
                      <span className="text-sm">
                        {getConfidenceBadge(story.confidenceLevel)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded View */}
                {isExpanded && (
                  <div className="mt-4 space-y-4 border-t pt-4">
                    {showTimeVersions ? (
                      <div className="space-y-3">
                        <div className="flex gap-2 border-b">
                          {(['1min', '2min', '5min'] as const).map((tab) => (
                            <button
                              key={tab}
                              onClick={() => setTimeVersionTab(tab)}
                              className={`px-4 py-2 text-sm font-medium ${
                                timeVersionTab === tab
                                  ? 'border-b-2 border-blue-600 text-blue-600'
                                  : 'text-gray-600 hover:text-gray-900'
                              }`}
                            >
                              {tab === '1min' && '1 min ⏱'}
                              {tab === '2min' && '2 min ⏱'}
                              {tab === '5min' && '5 min ⏱'}
                            </button>
                          ))}
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg">
                          <p className="text-sm text-gray-800 leading-relaxed">
                            {timeVersionTab === '1min' && story.oneMinVersion}
                            {timeVersionTab === '2min' && story.twoMinVersion}
                            {timeVersionTab === '5min' && story.fiveMinVersion}
                          </p>
                          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                            <span>
                              {timeVersionTab === '1min' && `~${story.oneMinVersion.split(' ').length} words`}
                              {timeVersionTab === '2min' && `~${story.twoMinVersion.split(' ').length} words`}
                              {timeVersionTab === '5min' && `~${story.fiveMinVersion.split(' ').length} words`}
                            </span>
                            <button
                              className="text-blue-600 hover:text-blue-700 font-medium"
                              onClick={() => {
                                const text =
                                  timeVersionTab === '1min'
                                    ? story.oneMinVersion
                                    : timeVersionTab === '2min'
                                      ? story.twoMinVersion
                                      : story.fiveMinVersion;
                                navigator.clipboard.writeText(text).then(() => {
                                  setCopiedStoryId(story.id);
                                  setTimeout(() => setCopiedStoryId(null), 2000);
                                });
                              }}
                            >
                              {copiedStoryId === story.id ? 'Copied!' : 'Copy to Clipboard'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 text-sm">
                        <div className="p-4 bg-gray-50 rounded-lg">
                          <p className="text-gray-800 leading-relaxed">{story.fiveMinVersion}</p>
                        </div>
                      </div>
                    )}

                    {story.personalNotes && (
                      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <div className="flex items-start gap-2">
                          <span className="text-yellow-600">📝</span>
                          <p className="text-sm text-gray-700">{story.personalNotes}</p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <div className="flex items-center gap-4">
                        <span>🕐 Est. 2 min</span>
                        {story.lastPracticedAt && (
                          <span>
                            📅 Last practiced:{' '}
                            {new Date(story.lastPracticedAt).toLocaleDateString()}
                          </span>
                        )}
                        {story.practiceCount > 0 && (
                          <span>🔁 Practiced {story.practiceCount}x</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button className="px-3 py-1 text-blue-600 hover:bg-blue-50 rounded">
                          Practice
                        </button>
                        <button
                          onClick={() => setExpandedStoryId(null)}
                          className="px-3 py-1 text-gray-600 hover:bg-gray-100 rounded"
                        >
                          Collapse
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
