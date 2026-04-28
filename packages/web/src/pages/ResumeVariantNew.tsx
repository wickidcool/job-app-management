import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { useGenerateResumeVariant } from '../hooks/useResumeVariants';
import type { GenerateResumeVariantRequest, ResumeFormat, SectionEmphasis } from '../services/api/types';

export function ResumeVariantNew() {
  const navigate = useNavigate();
  const generateVariant = useGenerateResumeVariant();

  const [formData, setFormData] = useState({
    targetCompany: '',
    targetRole: '',
    jobDescriptionText: '',
    jobDescriptionUrl: '',
    format: 'chronological' as ResumeFormat,
    sectionEmphasis: 'balanced' as SectionEmphasis,
    atsOptimized: true,
    maxBulletsPerRole: 5,
    includeProjects: true,
    summaryInstructions: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    const newErrors: Record<string, string> = {};
    if (!formData.targetCompany.trim()) {
      newErrors.targetCompany = 'Company name is required';
    }
    if (!formData.targetRole.trim()) {
      newErrors.targetRole = 'Target role is required';
    }
    if (!formData.jobDescriptionText.trim() && !formData.jobDescriptionUrl.trim()) {
      newErrors.jobDescription = 'Either job description text or URL is required';
    }
    if (formData.jobDescriptionText.trim() && formData.jobDescriptionUrl.trim()) {
      newErrors.jobDescription = 'Provide either text or URL, not both';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const request: GenerateResumeVariantRequest = {
      targetCompany: formData.targetCompany,
      targetRole: formData.targetRole,
      jobDescriptionText: formData.jobDescriptionText || undefined,
      jobDescriptionUrl: formData.jobDescriptionUrl || undefined,
      format: formData.format,
      sectionEmphasis: formData.sectionEmphasis,
      atsOptimized: formData.atsOptimized,
      maxBulletsPerRole: formData.maxBulletsPerRole,
      includeProjects: formData.includeProjects,
      summaryInstructions: formData.summaryInstructions || undefined,
    };

    try {
      const response = await generateVariant.mutateAsync(request);
      navigate(`/resume-variants/${response.variant.id}`);
    } catch (error) {
      console.error('Failed to generate variant:', error);
      setErrors({ submit: 'Failed to generate resume variant. Please try again.' });
    }
  };

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Resume Variants', href: '/resume-variants' },
    { label: 'Generate New' },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-neutral-900">Generate Resume Variant</h1>
        <p className="mt-2 text-gray-600">
          Create a tailored resume optimized for a specific job opportunity
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Job Target</h2>

          <div className="space-y-4">
            <div>
              <label htmlFor="targetCompany" className="block text-sm font-medium text-gray-700">
                Company Name *
              </label>
              <input
                type="text"
                id="targetCompany"
                value={formData.targetCompany}
                onChange={(e) => setFormData({ ...formData, targetCompany: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="e.g., Acme Corp"
              />
              {errors.targetCompany && (
                <p className="mt-1 text-sm text-red-600">{errors.targetCompany}</p>
              )}
            </div>

            <div>
              <label htmlFor="targetRole" className="block text-sm font-medium text-gray-700">
                Target Role *
              </label>
              <input
                type="text"
                id="targetRole"
                value={formData.targetRole}
                onChange={(e) => setFormData({ ...formData, targetRole: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="e.g., Senior Software Engineer"
              />
              {errors.targetRole && (
                <p className="mt-1 text-sm text-red-600">{errors.targetRole}</p>
              )}
            </div>

            <div>
              <label htmlFor="jobDescriptionText" className="block text-sm font-medium text-gray-700">
                Job Description Text
              </label>
              <textarea
                id="jobDescriptionText"
                value={formData.jobDescriptionText}
                onChange={(e) => setFormData({ ...formData, jobDescriptionText: e.target.value })}
                rows={6}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Paste the full job description here..."
              />
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-gray-500">OR</span>
              </div>
            </div>

            <div>
              <label htmlFor="jobDescriptionUrl" className="block text-sm font-medium text-gray-700">
                Job Description URL
              </label>
              <input
                type="url"
                id="jobDescriptionUrl"
                value={formData.jobDescriptionUrl}
                onChange={(e) => setFormData({ ...formData, jobDescriptionUrl: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="https://..."
              />
              {errors.jobDescription && (
                <p className="mt-1 text-sm text-red-600">{errors.jobDescription}</p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Resume Configuration</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="format" className="block text-sm font-medium text-gray-700">
                Resume Format
              </label>
              <select
                id="format"
                value={formData.format}
                onChange={(e) => setFormData({ ...formData, format: e.target.value as ResumeFormat })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="chronological">Chronological</option>
                <option value="functional">Functional</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>

            <div>
              <label htmlFor="sectionEmphasis" className="block text-sm font-medium text-gray-700">
                Section Emphasis
              </label>
              <select
                id="sectionEmphasis"
                value={formData.sectionEmphasis}
                onChange={(e) =>
                  setFormData({ ...formData, sectionEmphasis: e.target.value as SectionEmphasis })
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="balanced">Balanced</option>
                <option value="experience_heavy">Experience Heavy</option>
                <option value="skills_heavy">Skills Heavy</option>
              </select>
            </div>

            <div>
              <label htmlFor="maxBulletsPerRole" className="block text-sm font-medium text-gray-700">
                Max Bullets per Role
              </label>
              <input
                type="number"
                id="maxBulletsPerRole"
                min="1"
                max="8"
                value={formData.maxBulletsPerRole}
                onChange={(e) =>
                  setFormData({ ...formData, maxBulletsPerRole: parseInt(e.target.value, 10) })
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.atsOptimized}
                  onChange={(e) => setFormData({ ...formData, atsOptimized: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">ATS Optimized</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.includeProjects}
                  onChange={(e) => setFormData({ ...formData, includeProjects: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Include Projects</span>
              </label>
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="summaryInstructions" className="block text-sm font-medium text-gray-700">
              Summary Instructions (Optional)
            </label>
            <textarea
              id="summaryInstructions"
              value={formData.summaryInstructions}
              onChange={(e) => setFormData({ ...formData, summaryInstructions: e.target.value })}
              rows={3}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="e.g., 'Emphasize cloud architecture and team leadership experience'"
              maxLength={500}
            />
            <p className="mt-1 text-xs text-gray-500">
              {formData.summaryInstructions.length}/500 characters
            </p>
          </div>
        </div>

        {errors.submit && (
          <div className="rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-800">{errors.submit}</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/resume-variants')}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={generateVariant.isPending}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generateVariant.isPending ? 'Generating...' : 'Generate Resume Variant'}
          </button>
        </div>
      </form>
    </div>
  );
}
