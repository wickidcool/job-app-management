import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CoverLetterPreview } from '../components/CoverLetterPreview';
import {
  useCoverLetter,
  useDeleteCoverLetter,
  useExportCoverLetter,
} from '../hooks/useCoverLetters';
import type { CoverLetterVariant } from '../services/api/types';

export function CoverLetterDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: coverLetter, isLoading, error } = useCoverLetter(id);
  const deleteMutation = useDeleteCoverLetter();
  const exportMutation = useExportCoverLetter();

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleCopy = () => {
    // Pure notification callback - CoverLetterPreview owns the clipboard write
  };

  const handleDownload = async (format: 'docx') => {
    if (!id) return;
    setExportError(null);
    try {
      const result = await exportMutation.mutateAsync({
        id,
        request: { format },
      });
      // Create download link from base64 content
      const blob = new Blob([Uint8Array.from(atob(result.base64Content), (c) => c.charCodeAt(0))], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      setExportError(
        error instanceof Error ? error.message : 'Failed to export cover letter. Please try again.'
      );
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm('Are you sure you want to delete this cover letter?')) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(id);
      navigate('/');
    } catch (error) {
      console.error('Delete failed:', error);
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete cover letter. Please try again.'
      );
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (error || !coverLetter) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-600">Failed to load cover letter</div>
      </div>
    );
  }

  const wordCount =
    coverLetter.content.trim() === '' ? 0 : coverLetter.content.trim().split(/\s+/).length;
  const variant: CoverLetterVariant = {
    tone: coverLetter.tone,
    length: coverLetter.lengthVariant,
    emphasis: coverLetter.emphasis,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate(-1)}
              className="text-sm text-gray-600 hover:text-gray-900 mb-2"
            >
              ← Back
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Cover Letter</h1>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto py-8">
        {/* Error Messages */}
        {deleteError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <span className="text-red-600 text-xl">⚠️</span>
              <div className="flex-1">
                <p className="font-medium text-red-900">Delete Failed</p>
                <p className="text-sm text-red-700 mt-1">{deleteError}</p>
              </div>
              <button
                onClick={() => setDeleteError(null)}
                className="text-red-600 hover:text-red-800"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {exportError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <span className="text-red-600 text-xl">⚠️</span>
              <div className="flex-1">
                <p className="font-medium text-red-900">Export Failed</p>
                <p className="text-sm text-red-700 mt-1">{exportError}</p>
              </div>
              <button
                onClick={() => setExportError(null)}
                className="text-red-600 hover:text-red-800"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <div
          className="bg-white border rounded-lg shadow-sm overflow-hidden"
          style={{ height: '800px' }}
        >
          <CoverLetterPreview
            content={coverLetter.content}
            variant={variant}
            wordCount={wordCount}
            showExportActions={true}
            isExporting={exportMutation.isPending}
            onCopy={handleCopy}
            onDownload={handleDownload}
          />
        </div>
      </div>
    </div>
  );
}
