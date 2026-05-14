import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type {
  CatalogEntry,
  CoverLetterVariant,
  CoverLetterResult,
  CoverLetterTone,
  CoverLetterLength,
  CoverLetterEmphasis,
} from '../services/api/types';
import { StarEntryPicker } from './StarEntryPicker';
import { CoverLetterPreview } from './CoverLetterPreview';
import { useGenerateCoverLetter, useUpdateCoverLetter } from '../hooks/useCoverLetters';

interface CoverLetterGeneratorProps {
  fitAnalysisId?: string;
  applicationId?: string;
  initialJobDescription?: string;
  initialCompany?: string;
  initialRole?: string;
  catalogEntries?: CatalogEntry[];
  onComplete?: (result: CoverLetterResult) => void;
  onCancel?: () => void;
}

interface Step1FormData {
  companyName: string;
  jobTitle: string;
  jobDescription: string;
  useFitAnalysis: boolean;
}

export function CoverLetterGenerator({
  fitAnalysisId,
  applicationId,
  initialJobDescription = '',
  initialCompany = '',
  initialRole = '',
  catalogEntries = [],
  onComplete,
  onCancel,
}: CoverLetterGeneratorProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [step1Data, setStep1Data] = useState<Step1FormData | null>(null);
  const [selectedSTARIds, setSelectedSTARIds] = useState<string[]>([]);
  const [variant, setVariant] = useState<CoverLetterVariant>({
    tone: 'professional',
    length: 'standard',
    emphasis: 'balanced',
  });
  const [editableContent, setEditableContent] = useState('');
  const [generatedCoverLetterId, setGeneratedCoverLetterId] = useState<string | null>(null);
  const [generatedCoverLetterVersion, setGeneratedCoverLetterVersion] = useState<number>(1);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const generateMutation = useGenerateCoverLetter();
  const updateMutation = useUpdateCoverLetter();

  const {
    register: registerStep1,
    handleSubmit: handleSubmitStep1,
    control: controlStep1,
    formState: { errors: errorsStep1 },
  } = useForm<Step1FormData>({
    defaultValues: {
      companyName: initialCompany,
      jobTitle: initialRole,
      jobDescription: initialJobDescription,
      useFitAnalysis: !!fitAnalysisId,
    },
  });

  const useFitAnalysisChecked = useWatch({ control: controlStep1, name: 'useFitAnalysis' });

  const handleStep1Submit = (data: Step1FormData) => {
    setStep1Data(data);
    setCurrentStep(2);
  };

  const handleStep2Next = () => {
    if (selectedSTARIds.length >= 1) {
      setCurrentStep(3);
    }
  };

  const handleStep3Generate = async () => {
    if (!step1Data) {
      setCurrentStep(1);
      return;
    }

    setGenerationError(null);
    setCurrentStep(4);

    try {
      const usingFitAnalysis = step1Data.useFitAnalysis && !!fitAnalysisId;
      const coverLetter = await generateMutation.mutateAsync({
        selectedStarEntryIds: selectedSTARIds,
        targetCompany: step1Data.companyName,
        targetRole: step1Data.jobTitle,
        tone: variant.tone,
        lengthVariant: variant.length,
        emphasis: variant.emphasis,
        jobFitAnalysisId: usingFitAnalysis ? fitAnalysisId : undefined,
        jobDescriptionText:
          !usingFitAnalysis && step1Data.jobDescription.trim()
            ? step1Data.jobDescription.trim()
            : undefined,
      });

      setGeneratedCoverLetterId(coverLetter.id);
      setGeneratedCoverLetterVersion(coverLetter.version);
      setEditableContent(coverLetter.content);
    } catch (error) {
      console.error('Generation failed:', error);
      setGenerationError(
        error instanceof Error
          ? error.message
          : 'Failed to generate cover letter. Please try again.'
      );
    }
  };

  const handleSave = async () => {
    if (!generatedCoverLetterId) {
      console.error('No cover letter ID available');
      return;
    }

    if (!editableContent.trim()) {
      setSaveError('Cover letter content cannot be empty');
      return;
    }

    setSaveError(null);

    try {
      // Persist edited content to the server
      await updateMutation.mutateAsync({
        id: generatedCoverLetterId,
        request: {
          content: editableContent,
          version: generatedCoverLetterVersion,
        },
      });

      const result: CoverLetterResult = {
        id: generatedCoverLetterId,
        content: editableContent,
        variant,
        selectedSTARs: selectedSTARIds,
        generatedAt: new Date().toISOString(),
        applicationId,
      };
      onComplete?.(result);
    } catch (error) {
      console.error('Failed to save cover letter:', error);
      setSaveError(
        error instanceof Error ? error.message : 'Failed to save cover letter. Please try again.'
      );
    }
  };

  const handleRegenerate = () => {
    setCurrentStep(3);
    setEditableContent('');
  };

  const goBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Progress Indicator */}
      <div className="px-6 py-4 border-b bg-gray-50">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <h2 className="text-xl font-bold text-gray-900">Generate Cover Letter</h2>
          <div className="flex items-center gap-4 text-sm">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${
                    step === currentStep
                      ? 'bg-blue-600 text-white'
                      : step < currentStep
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {step < currentStep ? '✓' : step}
                </div>
                {step < 4 && (
                  <div
                    className={`w-12 h-0.5 ${step < currentStep ? 'bg-green-600' : 'bg-gray-200'}`}
                  />
                )}
              </div>
            ))}
            <span className="text-gray-600 ml-2">Step {currentStep}/4</span>
          </div>
        </div>
      </div>

      {/* Step Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Step 1: Confirm Target */}
          {currentStep === 1 && (
            <form onSubmit={handleSubmitStep1(handleStep1Submit)} className="space-y-6">
              <div className="bg-white border rounded-lg p-6 space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Target Position</h3>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...registerStep1('companyName', {
                      required: 'Company name is required',
                      minLength: { value: 2, message: 'Minimum 2 characters' },
                      maxLength: { value: 100, message: 'Maximum 100 characters' },
                    })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="TechCorp Inc."
                  />
                  {errorsStep1.companyName && (
                    <p className="mt-1 text-sm text-red-600">{errorsStep1.companyName.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Job Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...registerStep1('jobTitle', {
                      required: 'Job title is required',
                      minLength: { value: 2, message: 'Minimum 2 characters' },
                      maxLength: { value: 100, message: 'Maximum 100 characters' },
                    })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Senior Full Stack Engineer"
                  />
                  {errorsStep1.jobTitle && (
                    <p className="mt-1 text-sm text-red-600">{errorsStep1.jobTitle.message}</p>
                  )}
                </div>

                {fitAnalysisId && (
                  <div className="flex items-center gap-2">
                    <input
                      {...registerStep1('useFitAnalysis')}
                      type="checkbox"
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <label className="text-sm text-gray-700">
                      Use job fit analysis results (includes job description)
                    </label>
                  </div>
                )}

                {!useFitAnalysisChecked && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Job Description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      {...registerStep1('jobDescription', {
                        validate: (val, values) =>
                          (values.useFitAnalysis && !!fitAnalysisId) ||
                          val.trim().length >= 50 ||
                          'Job description must be at least 50 characters',
                        maxLength: { value: 50000, message: 'Maximum 50,000 characters' },
                      })}
                      rows={8}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      placeholder="Paste the full job description here..."
                    />
                    {errorsStep1.jobDescription && (
                      <p className="mt-1 text-sm text-red-600">
                        {errorsStep1.jobDescription.message}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-gray-500">
                      The job description is used to tailor your cover letter to the specific role.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Next: Select Experiences →
                </button>
              </div>
            </form>
          )}

          {/* Step 2: Select STAR Entries */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="bg-white border rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Select experiences to highlight
                </h3>
                <p className="text-sm text-gray-600 mb-6">
                  Choose 3-5 STAR entries that best demonstrate your qualifications for this role.
                </p>

                <StarEntryPicker
                  entries={catalogEntries}
                  selectedIds={selectedSTARIds}
                  onSelectionChange={setSelectedSTARIds}
                  showRecommended={!!fitAnalysisId}
                  maxSelection={8}
                  minSelection={1}
                />
              </div>

              <div className="flex justify-between">
                <button
                  onClick={goBack}
                  className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={handleStep2Next}
                  disabled={selectedSTARIds.length < 1}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Next: Choose Style →
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Choose Tone & Length */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="bg-white border rounded-lg p-6 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Tone</h3>
                  <div className="space-y-3">
                    {[
                      {
                        value: 'professional' as CoverLetterTone,
                        label: 'Professional',
                        desc: 'Formal, direct, results-focused',
                        recommended: true,
                      },
                      {
                        value: 'conversational' as CoverLetterTone,
                        label: 'Conversational',
                        desc: 'Approachable, clear, warm but professional',
                      },
                      {
                        value: 'enthusiastic' as CoverLetterTone,
                        label: 'Enthusiastic',
                        desc: 'Energetic, passionate, forward-looking',
                      },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                      >
                        <input
                          type="radio"
                          checked={variant.tone === option.value}
                          onChange={() => setVariant({ ...variant, tone: option.value })}
                          className="mt-1 w-4 h-4 text-blue-600"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{option.label}</span>
                            {option.recommended && (
                              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded">
                                Recommended
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">{option.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Length</h3>
                  <div className="space-y-3">
                    {[
                      {
                        value: 'concise' as CoverLetterLength,
                        label: 'Concise',
                        range: '250-350 words',
                        desc: 'Quick read, highlights only',
                      },
                      {
                        value: 'standard' as CoverLetterLength,
                        label: 'Standard',
                        range: '400-550 words',
                        desc: 'Balanced depth and brevity',
                        recommended: true,
                      },
                      {
                        value: 'detailed' as CoverLetterLength,
                        label: 'Detailed',
                        range: '600-800 words',
                        desc: 'Comprehensive, includes context',
                      },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                      >
                        <input
                          type="radio"
                          checked={variant.length === option.value}
                          onChange={() => setVariant({ ...variant, length: option.value })}
                          className="mt-1 w-4 h-4 text-blue-600"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">
                              {option.label} ({option.range})
                            </span>
                            {option.recommended && (
                              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded">
                                Recommended
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">{option.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Emphasis</h3>
                  <div className="space-y-3">
                    {[
                      {
                        value: 'balanced' as CoverLetterEmphasis,
                        label: 'Balanced',
                        desc: 'Mix of technical and leadership',
                        recommended: true,
                      },
                      {
                        value: 'technical' as CoverLetterEmphasis,
                        label: 'Technical',
                        desc: 'Focus on stack, architecture, problem-solving',
                      },
                      {
                        value: 'leadership' as CoverLetterEmphasis,
                        label: 'Leadership',
                        desc: 'Emphasize team impact, mentoring, strategy',
                      },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                      >
                        <input
                          type="radio"
                          checked={variant.emphasis === option.value}
                          onChange={() => setVariant({ ...variant, emphasis: option.value })}
                          className="mt-1 w-4 h-4 text-blue-600"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{option.label}</span>
                            {option.recommended && (
                              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded">
                                Recommended
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">{option.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={goBack}
                  className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={handleStep3Generate}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Generate Letter →
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Review & Edit */}
          {currentStep === 4 && (
            <div className="space-y-6">
              {generateMutation.isPending ? (
                <div className="bg-white border rounded-lg p-12 text-center">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                  <p className="text-lg font-medium text-gray-900">
                    Generating your cover letter...
                  </p>
                  <p className="text-sm text-gray-600 mt-2">This usually takes 10-15 seconds</p>
                </div>
              ) : generationError ? (
                <div className="bg-white border border-red-200 rounded-lg p-8 text-center">
                  <div className="text-red-600 text-5xl mb-4">⚠️</div>
                  <p className="text-lg font-medium text-gray-900 mb-2">Generation Failed</p>
                  <p className="text-sm text-gray-600 mb-6">{generationError}</p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => setCurrentStep(3)}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={onCancel}
                      className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="bg-white border rounded-lg overflow-hidden"
                    style={{ height: '600px' }}
                  >
                    <div className="grid grid-cols-2 h-full">
                      {/* Editor */}
                      <div className="border-r flex flex-col">
                        <div className="px-4 py-3 bg-gray-50 border-b">
                          <h3 className="font-semibold text-gray-900">📝 Editor</h3>
                        </div>
                        <div className="flex-1 overflow-auto p-4">
                          <textarea
                            value={editableContent}
                            onChange={(e) => setEditableContent(e.target.value)}
                            className="w-full h-full p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                            style={{ minHeight: '500px' }}
                          />
                        </div>
                        <div className="px-4 py-3 bg-gray-50 border-t text-sm space-y-1">
                          <div className="flex items-center gap-2 text-green-600">
                            <span>✅</span>
                            <span>
                              {editableContent.trim() === ''
                                ? 0
                                : editableContent.trim().split(/\s+/).length}{' '}
                              words
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-green-600">
                            <span>✅</span>
                            <span className="capitalize">{variant.tone} tone</span>
                          </div>
                        </div>
                      </div>

                      {/* Preview */}
                      <div className="flex flex-col">
                        <CoverLetterPreview
                          content={editableContent}
                          variant={variant}
                          showExportActions={false}
                        />
                      </div>
                    </div>
                  </div>

                  {saveError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-red-600 text-xl">⚠️</span>
                        <div className="flex-1">
                          <p className="font-medium text-red-900">Save Failed</p>
                          <p className="text-sm text-red-700 mt-1">{saveError}</p>
                        </div>
                        <button
                          onClick={() => setSaveError(null)}
                          className="text-red-600 hover:text-red-800"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between">
                    <button
                      onClick={handleRegenerate}
                      className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      ← Back
                    </button>
                    <div className="flex gap-3">
                      <button
                        onClick={handleRegenerate}
                        className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Regenerate
                      </button>
                      <button
                        onClick={handleSave}
                        className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        Save & Close
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
