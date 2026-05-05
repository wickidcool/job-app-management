import { useState } from 'react';
import type { GeneratedQuestion, PrepStory, ConfidenceLevel } from '../types/interviewPrep';

interface QuestionsListProps {
  questions: GeneratedQuestion[];
  stories: PrepStory[];
  onLinkSTAR: (questionId: string, storyId: string | null) => void;
  onMarkPracticed: (questionId: string, rating: ConfidenceLevel) => void;
  onAddNotes?: (questionId: string, notes: string) => void;
}

const CATEGORIES = [
  { id: 'all', name: 'All', icon: '📋' },
  { id: 'behavioral', name: 'Behavioral', icon: '🗣️' },
  { id: 'technical', name: 'Technical', icon: '💻' },
  { id: 'situational', name: 'Situational', icon: '🤔' },
  { id: 'role_specific', name: 'Role-Specific', icon: '🎯' },
  { id: 'gap_probing', name: 'Gap-Probing', icon: '🔍' },
];

export function QuestionsList({
  questions,
  stories,
  onLinkSTAR,
  onMarkPracticed,
  onAddNotes,
}: QuestionsListProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');

  const filteredQuestions = questions.filter(
    (q) => activeCategory === 'all' || q.category === activeCategory
  );

  const sortedQuestions = [...filteredQuestions].sort((a, b) => {
    // Tough first, then challenging, then standard
    const difficultyOrder = { tough: 0, challenging: 1, standard: 2 };
    if (a.difficulty !== b.difficulty) {
      return difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
    }
    // Not practiced first
    if (a.practiceStatus === 'not_practiced' && b.practiceStatus !== 'not_practiced') return -1;
    if (a.practiceStatus !== 'not_practiced' && b.practiceStatus === 'not_practiced') return 1;
    return 0;
  });

  const getDifficultyInfo = (difficulty: string) => {
    switch (difficulty) {
      case 'tough':
        return { color: 'text-red-600', dot: '🔴', label: 'Tough' };
      case 'challenging':
        return { color: 'text-yellow-600', dot: '🟡', label: 'Challenging' };
      default:
        return { color: 'text-green-600', dot: '🟢', label: 'Standard' };
    }
  };

  const getPracticeBadge = (status: ConfidenceLevel) => {
    switch (status) {
      case 'confident':
        return { icon: '✅', label: 'Confident', color: 'text-green-700' };
      case 'comfortable':
        return { icon: '☑️', label: 'Comfortable', color: 'text-yellow-700' };
      case 'needs_work':
        return { icon: '⚠️', label: 'Needs Work', color: 'text-orange-700' };
      default:
        return null;
    }
  };

  const categoryCount = (categoryId: string) => {
    if (categoryId === 'all') return questions.length;
    return questions.filter((q) => q.category === categoryId).length;
  };

  const handleStartEditNotes = (question: GeneratedQuestion) => {
    setEditingNotesId(question.id);
    setNotesValue(question.personalNotes || '');
  };

  const handleSaveNotes = (questionId: string) => {
    if (onAddNotes) {
      onAddNotes(questionId, notesValue);
    }
    setEditingNotesId(null);
  };

  const getLinkedStory = (question: GeneratedQuestion) => {
    if (!question.linkedStoryId) return null;
    return stories.find((s) => s.id === question.linkedStoryId);
  };

  return (
    <div className="space-y-4">
      {/* Category Tabs */}
      <div className="flex gap-2 flex-wrap border-b border-gray-200 pb-2">
        {CATEGORIES.map((category) => {
          const count = categoryCount(category.id);
          if (count === 0 && category.id !== 'all') return null;

          return (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                activeCategory === category.id
                  ? 'bg-blue-100 text-blue-700 border-b-2 border-blue-600'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {category.icon} {category.name} ({count})
            </button>
          );
        })}
      </div>

      {/* Questions List */}
      <div className="space-y-3">
        {sortedQuestions.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg mb-2">No questions in this category</p>
            <p className="text-sm">Try selecting a different category</p>
          </div>
        ) : (
          sortedQuestions.map((question) => {
            const isExpanded = expandedQuestionId === question.id;
            const difficultyInfo = getDifficultyInfo(question.difficulty);
            const practiceBadge = getPracticeBadge(question.practiceStatus);
            const linkedStory = getLinkedStory(question);

            return (
              <div
                key={question.id}
                className={`border rounded-lg p-4 transition-all ${
                  isExpanded
                    ? 'border-blue-300 shadow-md bg-blue-50'
                    : 'border-gray-200 bg-white hover:shadow-sm'
                }`}
              >
                {/* Question Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-start gap-3">
                      <span className="text-xl flex-shrink-0">{difficultyInfo.dot}</span>
                      <div className="flex-1">
                        <button
                          onClick={() => setExpandedQuestionId(isExpanded ? null : question.id)}
                          className="text-left w-full"
                        >
                          <p className="font-medium text-gray-900 hover:text-blue-600">
                            "{question.text}"
                          </p>
                        </button>
                        <div className="flex flex-wrap gap-2 mt-2 text-xs">
                          <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded">
                            {question.category.replace('_', ' ')}
                          </span>
                          <span
                            className={`px-2 py-1 rounded ${difficultyInfo.color} bg-opacity-10`}
                          >
                            {difficultyInfo.label}
                          </span>
                          {question.personalNotes && (
                            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded">
                              📝 Has notes
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {practiceBadge && (
                    <span
                      className={`flex items-center gap-1 text-sm font-medium ${practiceBadge.color}`}
                    >
                      {practiceBadge.icon} {practiceBadge.label}
                    </span>
                  )}
                </div>

                {/* Expanded View */}
                {isExpanded && (
                  <div className="mt-4 space-y-4 border-t pt-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-2">Why They Ask</h4>
                          <p className="text-sm text-gray-700">{question.whyTheyAsk}</p>
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-2">
                            What They Want to Hear
                          </h4>
                          <p className="text-sm text-gray-700">{question.whatTheyWant}</p>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 mb-2">
                          Answer Framework
                        </h4>
                        <p className="text-sm text-gray-700 whitespace-pre-line">
                          {question.answerFramework}
                        </p>
                      </div>
                    </div>

                    {/* Suggested Stories */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">
                        Suggested Stories
                      </h4>
                      <div className="space-y-2">
                        {question.suggestedStoryIds.slice(0, 3).map((storyId) => {
                          const story = stories.find((s) => s.id === storyId);
                          if (!story) return null;

                          const isLinked = question.linkedStoryId === storyId;

                          return (
                            <div
                              key={storyId}
                              className={`flex items-center justify-between p-3 rounded-lg ${
                                isLinked ? 'bg-blue-100 border-2 border-blue-500' : 'bg-gray-50'
                              }`}
                            >
                              <div className="flex items-center gap-3 flex-1">
                                <input
                                  type="radio"
                                  checked={isLinked}
                                  onChange={() =>
                                    onLinkSTAR(question.id, isLinked ? null : storyId)
                                  }
                                  className="h-4 w-4 text-blue-600"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">
                                    {story.starEntryId.substring(0, 60)}
                                  </p>
                                  <p className="text-xs text-gray-600">
                                    {story.relevanceScore}% match
                                  </p>
                                </div>
                              </div>
                              <button
                                onClick={() => onLinkSTAR(question.id, isLinked ? null : storyId)}
                                className={`px-3 py-1 text-xs font-medium rounded ${
                                  isLinked
                                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                }`}
                              >
                                {isLinked ? 'Unlink' : 'Use'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Linked Story Display */}
                    {linkedStory && (
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-start gap-2">
                          <span className="text-green-600">✓</span>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-green-900">Linked Story</p>
                            <p className="text-xs text-green-700 mt-1">
                              {linkedStory.twoMinVersion}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Personal Notes */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-2">My Notes</h4>
                      {editingNotesId === question.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={notesValue}
                            onChange={(e) => setNotesValue(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            rows={3}
                            placeholder="Add your notes about how to answer this question..."
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveNotes(question.id)}
                              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingNotesId(null)}
                              className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          {question.personalNotes ? (
                            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                              <p className="text-sm text-gray-700">{question.personalNotes}</p>
                              <button
                                onClick={() => handleStartEditNotes(question)}
                                className="text-xs text-blue-600 hover:text-blue-700 mt-2"
                              >
                                Edit notes
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleStartEditNotes(question)}
                              className="text-sm text-blue-600 hover:text-blue-700"
                            >
                              + Add notes
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-3 border-t">
                      <div className="flex gap-2">
                        <button
                          onClick={() => onMarkPracticed(question.id, 'needs_work')}
                          className="px-3 py-1 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                        >
                          Needs Work
                        </button>
                        <button
                          onClick={() => onMarkPracticed(question.id, 'comfortable')}
                          className="px-3 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
                        >
                          Comfortable
                        </button>
                        <button
                          onClick={() => onMarkPracticed(question.id, 'confident')}
                          className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                        >
                          Confident
                        </button>
                      </div>
                      <button
                        onClick={() => setExpandedQuestionId(null)}
                        className="px-4 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
                      >
                        Collapse
                      </button>
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
