import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { InterviewPrepCard } from '../components/InterviewPrepCard';
import { STARStoryBank } from '../components/STARStoryBank';
import { QuestionsList } from '../components/QuestionsList';
import { GapMitigationPanel } from '../components/GapMitigationPanel';
import { QuickReferenceExport } from '../components/QuickReferenceExport';
import {
  useInterviewPrepByApplication,
  useGenerateInterviewPrep,
  useUpdateInterviewPrep,
  useLogPracticeSession,
} from '../hooks/useInterviewPrep';
import type {
  MitigationStrategy,
  ConfidenceLevel,
  ApplicationSummary,
  PrepStory,
  GeneratedQuestion,
  GapMitigation,
} from '../types/interviewPrep';

type TabId = 'stories' | 'questions' | 'gaps';

const TABS = [
  { id: 'stories' as const, label: 'Stories', icon: '📖' },
  { id: 'questions' as const, label: 'Questions', icon: '❓' },
  { id: 'gaps' as const, label: 'Gaps', icon: '⚠️' },
];

export function InterviewPrepPage() {
  const { id: applicationId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('stories');
  const [showExportModal, setShowExportModal] = useState(false);

  const {
    data: prepData,
    isLoading,
    isError,
    error,
  } = useInterviewPrepByApplication(applicationId!);

  const generateMutation = useGenerateInterviewPrep();
  const updateMutation = useUpdateInterviewPrep();
  const logPracticeMutation = useLogPracticeSession();

  if (!applicationId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg">Invalid application ID</p>
          <button
            onClick={() => navigate('/applications')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Return to Applications
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Loading interview prep...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg mb-2">Failed to load interview prep</p>
          <p className="text-gray-600 text-sm mb-4">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <button
            onClick={() => navigate(`/applications/${applicationId}`)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Return to Application
          </button>
        </div>
      </div>
    );
  }

  if (!prepData?.interviewPrep) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">🎯</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No Interview Prep Yet</h2>
          <p className="text-gray-600 mb-6">
            Generate tailored interview prep materials from your catalog and job fit analysis.
          </p>
          <button
            onClick={() =>
              generateMutation.mutate({ applicationId: applicationId! }, { onSuccess: () => {} })
            }
            disabled={generateMutation.isPending}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium mb-3"
          >
            {generateMutation.isPending ? 'Generating...' : 'Generate Interview Prep'}
          </button>
          {generateMutation.isError && (
            <p className="text-sm text-red-600 mb-3">
              {generateMutation.error instanceof Error
                ? generateMutation.error.message
                : 'Generation failed. Please try again.'}
            </p>
          )}
          <button
            onClick={() => navigate(`/applications/${applicationId}`)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Return to Application
          </button>
        </div>
      </div>
    );
  }

  const { interviewPrep: prep, application } = prepData;

  // Handler: Mark story as favorite
  const handleMarkStoryFavorite = async (storyId: string, favorite: boolean) => {
    await updateMutation.mutateAsync({
      id: prep.id,
      data: {
        storyUpdates: [{ storyId, isFavorite: favorite }],
        version: prep.version,
      },
    });
  };

  // Handler: Link question to STAR story
  const handleLinkSTAR = async (questionId: string, storyId: string | null) => {
    await updateMutation.mutateAsync({
      id: prep.id,
      data: {
        questionUpdates: [{ questionId, linkedStoryId: storyId }],
        version: prep.version,
      },
    });
  };

  // Handler: Mark question as practiced
  const handleMarkQuestionPracticed = async (
    questionId: string,
    confidenceLevel: ConfidenceLevel
  ) => {
    await updateMutation.mutateAsync({
      id: prep.id,
      data: {
        questionUpdates: [{ questionId, practiceStatus: confidenceLevel }],
        version: prep.version,
      },
    });
  };

  // Handler: Add notes to question
  const handleAddQuestionNotes = async (questionId: string, notes: string) => {
    await updateMutation.mutateAsync({
      id: prep.id,
      data: {
        questionUpdates: [{ questionId, personalNotes: notes }],
        version: prep.version,
      },
    });
  };

  // Handler: Select mitigation strategy for gap
  const handleSelectGapStrategy = async (gapId: string, strategy: MitigationStrategy) => {
    await updateMutation.mutateAsync({
      id: prep.id,
      data: {
        gapUpdates: [{ gapId, selectedStrategy: strategy }],
        version: prep.version,
      },
    });
  };

  // Handler: Mark gap as addressed
  const handleMarkGapAddressed = async (gapId: string) => {
    const gap = prep.gapMitigations.find((g) => g.id === gapId);
    if (!gap) return;

    await updateMutation.mutateAsync({
      id: prep.id,
      data: {
        gapUpdates: [{ gapId, isAddressed: !gap.isAddressed }],
        version: prep.version,
      },
    });
  };

  // Handler: Practice gap response
  const handlePracticeGap = async (gapId: string) => {
    // Log practice session
    const gap = prep.gapMitigations.find((g) => g.id === gapId);
    if (!gap || !gap.selectedStrategy) return;

    const now = new Date().toISOString();
    await logPracticeMutation.mutateAsync({
      id: prep.id,
      data: {
        type: 'single_question',
        startedAt: now,
        endedAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        gapResults: [{ gapId, strategyUsed: gap.selectedStrategy, confidenceRating: 'needs_work' }],
        version: prep.version,
      },
    });
  };

  const applicationSummary: ApplicationSummary = {
    id: application.id,
    company: application.company,
    jobTitle: application.jobTitle,
    status: application.status,
  };

  const topStories = prep.stories
    .filter((s: PrepStory) => s.isFavorite || s.relevanceScore >= 80)
    .slice(0, 5);

  const keyQuestions = prep.questions
    .filter((q: GeneratedQuestion) => q.difficulty === 'tough' || q.difficulty === 'challenging')
    .slice(0, 10);

  const gapPoints = prep.gapMitigations.filter(
    (g: GapMitigation) => g.severity === 'critical' || g.severity === 'moderate'
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(`/applications/${applicationId}`)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Interview Preparation</h1>
                <p className="text-sm text-gray-600 mt-1">
                  {application.jobTitle} at {application.company}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowExportModal(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              <span>⬇️</span>
              <span>Export Quick Reference</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Prep Card */}
          <InterviewPrepCard
            applicationId={applicationId}
            application={{
              ...applicationSummary,
              interviewDate: application.interviewDate,
            }}
            prep={{
              id: prep.id,
              completeness: prep.completeness,
              stories: prep.stories,
              questions: prep.questions,
              gapMitigations: prep.gapMitigations,
              lastUpdated: prep.updatedAt,
            }}
            onGeneratePrep={() => {
              // This would trigger generation - handled on application detail page
              navigate(`/applications/${applicationId}`);
            }}
            onViewPrep={() => {
              // Already on this page
            }}
            onExportQuickRef={() => setShowExportModal(true)}
          />

          {/* Tabs */}
          <div className="bg-white rounded-lg shadow">
            <div className="border-b border-gray-200">
              <nav className="flex -mb-px">
                {TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 py-4 px-6 text-center border-b-2 font-medium text-sm transition-colors ${
                        isActive
                          ? 'border-blue-600 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <span className="mr-2">{tab.icon}</span>
                      {tab.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="p-6">
              {activeTab === 'stories' && (
                <STARStoryBank
                  stories={prep.stories}
                  onMarkFavorite={handleMarkStoryFavorite}
                  showTimeVersions={true}
                />
              )}

              {activeTab === 'questions' && (
                <QuestionsList
                  questions={prep.questions}
                  stories={prep.stories}
                  onLinkSTAR={handleLinkSTAR}
                  onMarkPracticed={handleMarkQuestionPracticed}
                  onAddNotes={handleAddQuestionNotes}
                />
              )}

              {activeTab === 'gaps' && (
                <GapMitigationPanel
                  gaps={prep.gapMitigations}
                  stories={prep.stories}
                  onSelectStrategy={handleSelectGapStrategy}
                  onMarkAddressed={handleMarkGapAddressed}
                  onPractice={handlePracticeGap}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <QuickReferenceExport
          prepId={prep.id}
          application={{
            ...applicationSummary,
            interviewDate: application.interviewDate,
          }}
          topStories={topStories}
          keyQuestions={keyQuestions}
          gapPoints={gapPoints}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}
