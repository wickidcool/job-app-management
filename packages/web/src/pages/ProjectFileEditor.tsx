import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { Breadcrumb } from '../components/Breadcrumb';
import { useProjectFile, useUpdateProjectFile } from '../hooks/useProjects';

export function ProjectFileEditor() {
  const { projectId, fileName } = useParams<{ projectId: string; fileName: string }>();
  const { data: content, isLoading } = useProjectFile(projectId!, fileName!);
  const updateFile = useUpdateProjectFile();

  const [editMode, setEditMode] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const projectName = projectId ? decodeURIComponent(projectId).replace(/-/g, ' ') : '';

  const handleSave = async () => {
    if (!projectId || !fileName) return;

    try {
      await updateFile.mutateAsync({
        projectId,
        fileName,
        content: editedContent,
      });
      setEditMode(false);
    } catch (error) {
      console.error('Failed to save file:', error);
      alert('Failed to save file. Please try again.');
    }
  };

  const handleCancel = () => {
    setEditedContent(content || '');
    setEditMode(false);
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 animate-pulse">
          <div className="mb-2 h-8 w-48 rounded bg-neutral-200"></div>
          <div className="h-4 w-96 rounded bg-neutral-200"></div>
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-neutral-200"></div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Projects', href: '/projects' },
          { label: projectName, href: `/projects/${projectId}` },
          { label: fileName || '', href: `/projects/${projectId}/files/${fileName}` },
        ]}
      />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900">{fileName}</h1>
          <p className="mt-2 text-sm text-neutral-600">Project: {projectName}</p>
        </div>
        <div className="flex gap-2">
          {editMode ? (
            <>
              <button
                onClick={handleCancel}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                disabled={updateFile.isPending}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                disabled={updateFile.isPending}
              >
                {updateFile.isPending ? 'Saving...' : 'Save'}
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setEditedContent(content || '');
                setEditMode(true);
              }}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {editMode && (
        <div className="mb-4 flex items-center gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showPreview}
              onChange={(e) => setShowPreview(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm font-medium text-neutral-700">Show Preview</span>
          </label>
        </div>
      )}

      <div className={`grid gap-4 ${editMode && showPreview ? 'md:grid-cols-2' : ''}`}>
        {editMode ? (
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700">
              Markdown Content
            </label>
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              className="h-[600px] w-full rounded-lg border border-neutral-300 p-4 font-mono text-sm focus:border-primary-500 focus:ring-primary-500"
              placeholder="Enter markdown content..."
            />
          </div>
        ) : (
          <div>
            <Link
              to={`/projects/${projectId}`}
              className="mb-4 inline-flex items-center text-sm text-primary-600 hover:text-primary-700"
            >
              <svg
                className="mr-1 h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Back to {projectName}
            </Link>
            <div className="rounded-lg border border-neutral-200 bg-white p-6">
              <div className="prose prose-sm max-w-none">
                <Markdown remarkPlugins={[remarkFrontmatter, remarkGfm]}>{content || ''}</Markdown>
              </div>
            </div>
          </div>
        )}

        {editMode && showPreview && (
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700">Preview</label>
            <div className="h-[600px] overflow-auto rounded-lg border border-neutral-200 bg-white p-6">
              <div className="prose prose-sm max-w-none">
                <Markdown remarkPlugins={[remarkFrontmatter, remarkGfm]}>{editedContent}</Markdown>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
