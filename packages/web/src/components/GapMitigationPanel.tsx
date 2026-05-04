import { useState } from 'react';
import type { GapMitigation, MitigationStrategy, PrepStory } from '../types/interviewPrep';

interface GapMitigationPanelProps {
  gaps: GapMitigation[];
  stories: PrepStory[];
  onSelectStrategy: (gapId: string, strategy: MitigationStrategy) => void;
  onMarkAddressed: (gapId: string) => void;
  onPractice?: (gapId: string) => void;
}

export function GapMitigationPanel({
  gaps,
  stories,
  onSelectStrategy,
  onMarkAddressed,
  onPractice,
}: GapMitigationPanelProps) {
  const [expandedGapId, setExpandedGapId] = useState<string | null>(null);

  const sortedGaps = [...gaps].sort((a, b) => {
    // Not addressed first
    if (!a.isAddressed && b.isAddressed) return -1;
    if (a.isAddressed && !b.isAddressed) return 1;

    // Then by severity: critical > moderate > minor
    const severityOrder = { critical: 0, moderate: 1, minor: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  const getSeverityInfo = (severity: string) => {
    switch (severity) {
      case 'critical':
        return {
          icon: '🔴',
          color: 'border-red-500 bg-red-50',
          textColor: 'text-red-700',
          label: 'CRITICAL',
        };
      case 'moderate':
        return {
          icon: '🟠',
          color: 'border-orange-500 bg-orange-50',
          textColor: 'text-orange-700',
          label: 'MODERATE',
        };
      default:
        return {
          icon: '🟡',
          color: 'border-yellow-500 bg-yellow-50',
          textColor: 'text-yellow-700',
          label: 'MINOR',
        };
    }
  };

  const strategyKeyMap: Record<
    MitigationStrategy,
    'acknowledgePivot' | 'growthMindset' | 'adjacentExperience'
  > = {
    acknowledge_pivot: 'acknowledgePivot',
    growth_mindset: 'growthMindset',
    adjacent_experience: 'adjacentExperience',
  };

  const mitigationStrategies: MitigationStrategy[] = [
    'acknowledge_pivot',
    'growth_mindset',
    'adjacent_experience',
  ];

  const getStrategyInfo = (strategy: MitigationStrategy) => {
    switch (strategy) {
      case 'acknowledge_pivot':
        return { name: 'Acknowledge & Pivot', icon: '🔄' };
      case 'growth_mindset':
        return { name: 'Growth Mindset', icon: '📈' };
      case 'adjacent_experience':
        return { name: 'Adjacent Experience', icon: '🔗' };
    }
  };

  const handleCopyScript = (script: string) => {
    navigator.clipboard.writeText(script);
    // Could add a toast notification here
  };

  if (gaps.length === 0) {
    return (
      <div className="border-2 border-green-200 rounded-lg p-8 bg-green-50">
        <div className="text-center">
          <div className="text-6xl mb-4">✅</div>
          <h3 className="text-xl font-semibold text-green-900 mb-2">
            No Significant Gaps Identified!
          </h3>
          <p className="text-green-700 mb-6">
            Your profile strongly matches the role requirements.
          </p>
          <div className="text-left max-w-2xl mx-auto">
            <h4 className="font-semibold text-green-900 mb-3">KEY STRENGTHS TO HIGHLIGHT</h4>
            <ul className="space-y-2 text-sm text-green-800">
              <li className="flex items-start gap-2">
                <span>•</span>
                <span>Strong technical background with relevant experience</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span>Demonstrated leadership and collaboration skills</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span>Proven track record of delivering results</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sortedGaps.map((gap) => {
        const isExpanded = expandedGapId === gap.id;
        const severityInfo = getSeverityInfo(gap.severity);
        const isAddressed = gap.isAddressed;

        return (
          <div
            key={gap.id}
            className={`border-2 rounded-lg p-4 transition-all ${
              isAddressed ? 'border-gray-300 bg-gray-50 opacity-75' : severityInfo.color
            }`}
          >
            {/* Gap Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{severityInfo.icon}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${severityInfo.textColor}`}>
                        {severityInfo.label}
                      </span>
                      <h3 className="text-lg font-semibold text-gray-900">{gap.skill}</h3>
                      {isAddressed && <span className="text-green-600 text-sm">✓ Addressed</span>}
                    </div>
                    <p className="text-sm text-gray-700 mt-1">{gap.description}</p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setExpandedGapId(isExpanded ? null : gap.id)}
                className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded"
              >
                {isExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {/* Expanded View */}
            {isExpanded && (
              <div className="mt-4 space-y-4 border-t pt-4">
                <div className="p-3 bg-white rounded-lg border">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Why This Matters</h4>
                  <p className="text-sm text-gray-700">{gap.whyItMatters}</p>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Response Strategies</h4>
                  <div className="space-y-3">
                    {mitigationStrategies.map((strategyValue) => {
                      const strategyKey = strategyKeyMap[strategyValue];
                      const strategy = gap.strategies[strategyKey];
                      const strategyInfo = getStrategyInfo(strategyValue);
                      const isSelected = gap.selectedStrategy === strategyValue;

                      return (
                        <div
                          key={strategyKey}
                          className={`border-2 rounded-lg p-4 transition-all ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="radio"
                              checked={isSelected}
                              onChange={() => onSelectStrategy(gap.id, strategyValue)}
                              className="mt-1 h-4 w-4 text-blue-600"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span>{strategyInfo.icon}</span>
                                <h5 className="font-semibold text-gray-900">{strategyInfo.name}</h5>
                              </div>

                              {isSelected && (
                                <div className="space-y-3 mt-3">
                                  <div className="p-3 bg-white rounded border">
                                    <p className="text-sm text-gray-800 leading-relaxed italic">
                                      "{strategy.script}"
                                    </p>
                                  </div>

                                  <div>
                                    <p className="text-xs font-semibold text-gray-700 mb-2">
                                      KEY PHRASES:
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                      {strategy.keyPhrases.map((phrase: string, idx: number) => (
                                        <span
                                          key={idx}
                                          className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded"
                                        >
                                          {phrase}
                                        </span>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="p-3 bg-green-50 border border-green-200 rounded">
                                    <p className="text-xs font-semibold text-green-900 mb-1">
                                      REDIRECT TO:
                                    </p>
                                    <p className="text-sm text-green-800">
                                      {strategy.redirectToStrength}
                                    </p>
                                  </div>

                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleCopyScript(strategy.script)}
                                      className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                                    >
                                      📋 Copy Script
                                    </button>
                                    {onPractice && (
                                      <button
                                        onClick={() => onPractice(gap.id)}
                                        className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                                      >
                                        🎤 Practice
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}

                              {!isSelected && (
                                <p className="text-sm text-gray-600 line-clamp-2">
                                  {strategy.script}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Related Stories */}
                {gap.relatedStoryIds.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Related Stories</h4>
                    <div className="space-y-2">
                      {gap.relatedStoryIds.slice(0, 3).map((storyId) => {
                        const story = stories.find((s) => s.id === storyId);
                        if (!story) return null;

                        return (
                          <div key={storyId} className="p-3 bg-white border rounded-lg text-sm">
                            <p className="font-medium text-gray-900">
                              {story.starEntryId.substring(0, 60)}
                            </p>
                            <p className="text-gray-600 text-xs mt-1">
                              {story.themes.join(', ')} • {story.relevanceScore}% relevant
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-between items-center pt-3 border-t">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isAddressed}
                      onChange={() => onMarkAddressed(gap.id)}
                      className="h-4 w-4 text-blue-600 rounded"
                    />
                    <span className="text-sm text-gray-700">Mark as addressed</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
