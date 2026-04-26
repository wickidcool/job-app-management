import { useParams, useNavigate } from 'react-router-dom';
import { CoverLetterPreview } from '../components/CoverLetterPreview';
import { useCoverLetter, useDeleteCoverLetter, useExportCoverLetter } from '../hooks/useCoverLetters';
import type { CoverLetterVariant } from '../services/api/types';

export function CoverLetterDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: coverLetter, isLoading, error } = useCoverLetter(id);
  const deleteMutation = useDeleteCoverLetter();
  const exportMutation = useExportCoverLetter();

  const handleCopy = () => {
    // Pure notification callback - CoverLetterPreview owns the clipboard write
  };

  const handleDownload = async (format: 'docx') => {
    if (!id) return;
    try {
      const result = await exportMutation.mutateAsync({
        id,
        request: { format },
      });
      // Create download link from base64 content
      const blob = new Blob([Uint8Array.from(atob(result.base64Content), c => c.charCodeAt(0))], {
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
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm('Are you sure you want to delete this cover letter?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      navigate('/');
    } catch (error) {
      console.error('Delete failed:', error);
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

  const wordCount = coverLetter.content.split(/\s+/).length;
  const variant: CoverLetterVariant = {
    tone: coverLetter.tone,
    length: coverLetter.lengthVariant,
    // API does not persist/return emphasis field, fallback to 'balanced'
    emphasis: 'balanced',
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
            <p className="text-sm text-gray-600">ID: {id}</p>
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
        <div className="bg-white border rounded-lg shadow-sm overflow-hidden" style={{ height: '800px' }}>
          <CoverLetterPreview
            content={coverLetter.content}
            variant={variant}
            wordCount={wordCount}
            showExportActions={true}
            onCopy={handleCopy}
            onDownload={handleDownload}
          />
        </div>
      </div>
    </div>
  );
}
