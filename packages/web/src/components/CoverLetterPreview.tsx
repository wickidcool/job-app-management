import { useState } from 'react';
import type { CoverLetterVariant } from '../services/api/types';

interface CoverLetterPreviewProps {
  content: string;
  variant?: CoverLetterVariant;
  wordCount?: number;
  showExportActions?: boolean;
  onCopy?: () => void;
  onDownload?: (format: 'docx') => void;
}

export function CoverLetterPreview({
  content,
  variant,
  wordCount,
  showExportActions = true,
  onCopy,
  onDownload,
}: CoverLetterPreviewProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  const handleCopy = async () => {
    if (!onCopy) return;

    try {
      await navigator.clipboard.writeText(content);
      setCopyStatus('copied');
      onCopy();
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const calculatedWordCount = wordCount || content.trim().split(/\s+/).length;

  const formatContent = () => {
    return content.split('\n').map((paragraph, idx) => {
      if (paragraph.trim() === '') return null;
      return (
        <p key={idx} className="mb-4">
          {paragraph}
        </p>
      );
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {showExportActions && (
        <div className="flex items-center justify-between p-4 border-b bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">Cover Letter Preview</h3>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                copyStatus === 'copied'
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
              disabled={copyStatus === 'copied'}
            >
              {copyStatus === 'copied' ? '✓ Copied!' : '📋 Copy'}
            </button>
            {onDownload && (
              <button
                onClick={() => onDownload('docx')}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                ⬇ Download DOCX
              </button>
            )}
          </div>
        </div>
      )}

      {/* Preview Content */}
      <div className="flex-1 overflow-auto bg-white p-8">
        <div className="max-w-3xl mx-auto">
          <div
            className="cover-letter-preview"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: '11pt',
              lineHeight: '1.6',
              color: '#1a1a1a',
            }}
          >
            {content ? formatContent() : (
              <div className="text-center text-gray-400 py-12">
                No content to preview
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Stats */}
      {(wordCount || variant) && (
        <div className="px-8 py-4 border-t bg-gray-50 text-sm text-gray-600">
          <div className="max-w-3xl mx-auto flex items-center gap-4">
            {wordCount && (
              <span className="flex items-center gap-2">
                📊 {calculatedWordCount} words
              </span>
            )}
            {variant && (
              <>
                <span>•</span>
                <span className="capitalize">{variant.tone} tone</span>
                <span>•</span>
                <span className="capitalize">{variant.length} length</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
