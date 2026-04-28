import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import {
  useResumeVariant,
  useUpdateResumeVariant,
  useReviseResumeVariant,
  useExportResumeVariant,
} from '../hooks/useResumeVariants';
import type { ExportResumeVariantRequest } from '../services/api/types';

export function ResumeVariantDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useResumeVariant(id);
  const updateVariant = useUpdateResumeVariant();
  const reviseVariant = useReviseResumeVariant();
  const exportVariant = useExportResumeVariant();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [revisionInstructions, setRevisionInstructions] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">Failed to load resume variant. Please try again.</p>
          <button
            onClick={() => navigate('/resume-variants')}
            className="mt-2 text-sm font-medium text-red-600 hover:text-red-500"
          >
            ← Back to Resume Variants
          </button>
        </div>
      </div>
    );
  }

  const { variant } = data;

  const handleUpdateTitle = () => {
    if (!id) return;
    updateVariant.mutate(
      { id, request: { title, version: variant.version } },
      {
        onSuccess: () => setIsEditingTitle(false),
        onError: (error) => {
          console.error('Failed to update title:', error);
          alert('Failed to update title. Please try again.');
        },
      }
    );
  };

  const handleRevise = () => {
    if (!id || !revisionInstructions.trim()) return;
    reviseVariant.mutate(
      {
        id,
        request: { instructions: revisionInstructions, version: variant.version },
      },
      {
        onSuccess: () => {
          setRevisionInstructions('');
        },
        onError: (error) => {
          console.error('Failed to revise variant:', error);
          alert('Failed to revise resume variant. Please try again.');
        },
      }
    );
  };

  const handleExport = async (format: 'docx') => {
    if (!id) return;
    setIsExporting(true);

    const request: ExportResumeVariantRequest = {
      format,
      headerInfo: {
        name: 'Your Name', // TODO: Get from settings/profile
        email: 'email@example.com',
      },
    };

    try {
      const response = await exportVariant.mutateAsync({ id, request });

      // Download the file
      const blob = new Blob([Uint8Array.from(atob(response.base64Content), c => c.charCodeAt(0))], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export:', error);
      alert('Failed to export resume variant. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Resume Variants', href: '/resume-variants' },
    { label: variant.title },
  ];

  const statusColors = {
    draft: 'bg-yellow-100 text-yellow-800',
    finalized: 'bg-green-100 text-green-800',
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6 flex items-start justify-between">
        <div className="flex-1">
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-3xl font-bold text-neutral-900 border-b-2 border-blue-500 focus:outline-none"
                autoFocus
              />
              <button
                onClick={handleUpdateTitle}
                className="text-sm font-medium text-blue-600 hover:text-blue-500"
              >
                Save
              </button>
              <button
                onClick={() => setIsEditingTitle(false)}
                className="text-sm font-medium text-gray-600 hover:text-gray-500"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold text-neutral-900">{variant.title}</h1>
              <button
                onClick={() => {
                  setTitle(variant.title);
                  setIsEditingTitle(true);
                }}
                className="text-sm font-medium text-blue-600 hover:text-blue-500"
              >
                Edit
              </button>
            </div>
          )}
          <p className="mt-1 text-gray-600">
            {variant.targetRole} at {variant.targetCompany}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[variant.status]}`}>
            {variant.status}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Resume Content</h2>

            {variant.content.summary && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                  Summary
                </h3>
                <p className="text-gray-800">{variant.content.summary}</p>
              </div>
            )}

            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                Skills
              </h3>
              {variant.content.skills.categories.map((category, idx) => (
                <div key={idx} className="mb-3">
                  <h4 className="text-sm font-medium text-gray-700">{category.name}</h4>
                  <p className="text-gray-600">{category.skills.join(', ')}</p>
                </div>
              ))}
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                Experience
              </h3>
              {variant.content.experience.map((exp) => (
                <div key={exp.id} className="mb-4 pb-4 border-b border-gray-200 last:border-0">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-semibold text-gray-900">{exp.role}</h4>
                      <p className="text-gray-700">{exp.company}</p>
                    </div>
                    <p className="text-sm text-gray-500">
                      {exp.startDate} - {exp.endDate || 'Present'}
                    </p>
                  </div>
                  <ul className="list-disc list-inside space-y-1">
                    {exp.bullets.map((bullet) => (
                      <li key={bullet.id} className="text-gray-700">
                        {bullet.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {variant.content.education && variant.content.education.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                  Education
                </h3>
                {variant.content.education.map((edu, idx) => (
                  <div key={idx} className="mb-2">
                    <h4 className="font-semibold text-gray-900">
                      {edu.degree} {edu.field && `in ${edu.field}`}
                    </h4>
                    <p className="text-gray-700">{edu.institution}</p>
                    {edu.graduationDate && (
                      <p className="text-sm text-gray-500">{edu.graduationDate}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm mb-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Export</h3>
            <div className="space-y-2">
              <button
                disabled
                title="PDF export coming soon"
                className="w-full px-4 py-2 bg-gray-300 text-gray-500 rounded-md cursor-not-allowed"
              >
                Export as PDF — Coming Soon
              </button>
              <button
                onClick={() => handleExport('docx')}
                disabled={isExporting}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExporting ? 'Exporting...' : 'Export as DOCX'}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Revise</h3>
            <textarea
              value={revisionInstructions}
              onChange={(e) => setRevisionInstructions(e.target.value)}
              placeholder="Enter revision instructions (e.g., 'Make the summary more concise', 'Add more emphasis on leadership')"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              rows={4}
            />
            <button
              onClick={handleRevise}
              disabled={!revisionInstructions.trim() || reviseVariant.isPending}
              className="mt-2 w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {reviseVariant.isPending ? 'Revising...' : 'Apply Revisions'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
