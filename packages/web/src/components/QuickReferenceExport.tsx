import { useState } from 'react';
import type { PrepStory, GeneratedQuestion, GapMitigation, ExportFormat, ApplicationSummary } from '../types/interviewPrep';
import { useDownloadQuickReference } from '../hooks/useInterviewPrep';

interface QuickReferenceExportProps {
  prepId: string;
  application: ApplicationSummary & {
    interviewDate?: string;
  };
  topStories: PrepStory[];
  keyQuestions: GeneratedQuestion[];
  gapPoints: GapMitigation[];
  onClose: () => void;
}

export function QuickReferenceExport({
  prepId,
  application,
  topStories,
  keyQuestions,
  gapPoints,
  onClose,
}: QuickReferenceExportProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('pdf');
  const downloadMutation = useDownloadQuickReference();

  const handleExport = async () => {
    try {
      const filename = `interview-prep-${application.company.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.${selectedFormat === 'pdf' ? 'pdf' : 'md'}`;

      await downloadMutation.mutateAsync({
        id: prepId,
        format: selectedFormat,
        filename,
      });

      // Close modal after successful export
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Quick Reference Card</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preview Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="border rounded-lg p-6 bg-gray-50">
            {/* Header Section */}
            <div className="text-center mb-6 pb-4 border-b-2 border-gray-300">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                INTERVIEW QUICK REFERENCE
              </h1>
              <p className="text-lg font-semibold text-gray-800">
                {application.jobTitle} | {application.company}
              </p>
              {application.interviewDate && (
                <p className="text-sm text-gray-600 mt-1">
                  {new Date(application.interviewDate).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              )}
            </div>

            {/* Top Stories Section */}
            {topStories.length > 0 && (
              <div className="mb-6">
                <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b">
                  YOUR TOP {topStories.length} STORIES
                </h2>
                <div className="space-y-3">
                  {topStories.map((story, idx) => (
                    <div key={story.id} className="bg-white p-3 rounded border">
                      <div className="flex items-start gap-2">
                        <span className="font-bold text-blue-600">{idx + 1}.</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-gray-900">
                              {story.starEntryId.substring(0, 50)}
                            </span>
                            <span className="text-xs text-gray-600">
                              ({story.themes.join(', ')}, {story.relevanceScore}%)
                            </span>
                          </div>
                          <p className="text-sm text-gray-700">{story.oneMinVersion}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Key Questions Section */}
            {keyQuestions.length > 0 && (
              <div className="mb-6">
                <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b">
                  KEY QUESTIONS & SUGGESTED ANSWERS
                </h2>
                <div className="space-y-3">
                  {keyQuestions.map((question) => (
                    <div key={question.id} className="bg-white p-3 rounded border">
                      <p className="font-semibold text-gray-900 mb-2">Q: {question.text}</p>
                      {question.linkedStoryId && (
                        <p className="text-sm text-gray-700">
                          <span className="font-medium">A:</span> Use{' '}
                          {topStories.find((s) => s.id === question.linkedStoryId)?.starEntryId.substring(0, 40) || 'linked story'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Gap Talking Points Section */}
            {gapPoints.length > 0 && (
              <div className="mb-6">
                <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b">
                  GAP TALKING POINTS
                </h2>
                <div className="space-y-2">
                  {gapPoints.map((gap) => (
                    <div key={gap.id} className="bg-white p-3 rounded border">
                      <p className="font-semibold text-gray-900 mb-1">
                        • {gap.skill}:{' '}
                      </p>
                      {gap.selectedStrategy && (
                        <p className="text-sm text-gray-700 ml-4">
                          "{gap.strategies[gap.selectedStrategy].script}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="mt-6 pt-4 border-t text-center text-xs text-gray-500">
              <p>Generated with Job Application Manager • {new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* Export Controls */}
        <div className="px-6 py-4 border-t bg-gray-50">
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-3">
              <button
                onClick={() => setSelectedFormat('pdf')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedFormat === 'pdf'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 border hover:bg-gray-50'
                }`}
              >
                <span>📄</span>
                <span>PDF</span>
              </button>
              <button
                onClick={() => setSelectedFormat('markdown')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedFormat === 'markdown'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 border hover:bg-gray-50'
                }`}
              >
                <span>📝</span>
                <span>Markdown</span>
              </button>
              <button
                onClick={() => setSelectedFormat('print')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedFormat === 'print'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 border hover:bg-gray-50'
                }`}
              >
                <span>🖨️</span>
                <span>Print</span>
              </button>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-100"
                disabled={downloadMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={downloadMutation.isPending}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {downloadMutation.isPending ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Exporting...</span>
                  </>
                ) : (
                  <>
                    <span>⬇️</span>
                    <span>Download {selectedFormat.toUpperCase()}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {downloadMutation.isError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              Export failed. Please try again.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
