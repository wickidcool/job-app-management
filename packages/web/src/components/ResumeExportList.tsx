import type { ResumeExport, ExportFormat } from '../types/resume';
import { formatDistance } from 'date-fns';

interface ResumeExportListProps {
  exports: ResumeExport[];
  onPreview: (exportId: string) => void;
  onDownload: (exportId: string, format: ExportFormat) => void;
  onDelete: (exportId: string) => void;
  onCreateNew: () => void;
  loading?: boolean;
}

export function ResumeExportList({
  exports,
  onPreview,
  onDownload,
  onDelete,
  onCreateNew,
  loading = false,
}: ResumeExportListProps) {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFormatIcon = (format: ExportFormat): string => {
    switch (format) {
      case 'pdf':
        return '📕';
      case 'docx':
        return '📘';
      case 'markdown':
        return '📝';
      default:
        return '📄';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-neutral-500 flex items-center gap-2">
          <span className="animate-spin text-2xl">⏳</span>
          <span>Loading exports...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-neutral-900">Resume Exports</h2>
        <button
          onClick={onCreateNew}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2"
        >
          <span className="text-lg">+</span>
          <span>Create New</span>
        </button>
      </div>

      {/* Empty State */}
      {exports.length === 0 && (
        <div className="border-2 border-dashed border-neutral-300 rounded-lg p-12 text-center">
          <div className="text-6xl mb-4">📄</div>
          <div className="text-lg font-medium text-neutral-700 mb-2">
            No resume exports yet
          </div>
          <div className="text-sm text-neutral-600 mb-6">
            Create tailored resumes for different job applications
          </div>
          <button
            onClick={onCreateNew}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Create Your First Export
          </button>
        </div>
      )}

      {/* Export List */}
      {exports.length > 0 && (
        <div className="space-y-4">
          {exports.map((exportItem) => (
            <div
              key={exportItem.id}
              className="border border-neutral-200 rounded-lg p-4 hover:border-neutral-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between">
                {/* Left: Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">{getFormatIcon(exportItem.format)}</span>
                    <div>
                      <h3 className="text-lg font-semibold text-neutral-900">
                        {exportItem.name}
                      </h3>
                      {exportItem.linkedApplicationTitle && (
                        <div className="text-sm text-neutral-600 flex items-center gap-1">
                          <span>🔗</span>
                          <span>Linked to: {exportItem.linkedApplicationTitle}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-neutral-500">
                    <span>
                      Created {formatDistance(exportItem.createdAt, new Date(), { addSuffix: true })}
                    </span>
                    <span>•</span>
                    <span>{formatFileSize(exportItem.fileSize)}</span>
                    <span>•</span>
                    <span className="uppercase">{exportItem.format}</span>
                    <span>•</span>
                    <span>{exportItem.experienceIds.length} experiences</span>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => onPreview(exportItem.id)}
                    className="px-3 py-1.5 text-sm border border-neutral-300 text-neutral-700 rounded hover:bg-neutral-50 transition-colors"
                    title="Preview"
                  >
                    👁️ Preview
                  </button>

                  <div className="relative group">
                    <button className="px-3 py-1.5 text-sm border border-neutral-300 text-neutral-700 rounded hover:bg-neutral-50 transition-colors">
                      ⬇️ Download
                    </button>

                    {/* Download Format Dropdown */}
                    <div className="absolute right-0 mt-1 w-32 bg-white border border-neutral-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                      <button
                        onClick={() => onDownload(exportItem.id, 'markdown')}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 first:rounded-t-lg"
                      >
                        📝 Markdown
                      </button>
                      <button
                        onClick={() => onDownload(exportItem.id, 'pdf')}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                      >
                        📕 PDF
                      </button>
                      <button
                        onClick={() => onDownload(exportItem.id, 'docx')}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 last:rounded-b-lg"
                      >
                        📘 DOCX
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => onDelete(exportItem.id)}
                    className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50 transition-colors"
                    title="Delete"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
