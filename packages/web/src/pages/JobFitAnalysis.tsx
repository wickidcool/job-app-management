import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useJobFitAnalysis } from '../hooks/useJobFitAnalysis';
import type { AnalyzeJobFitRequest, AnalyzeJobFitResponse } from '../types/jobFit';
import { APIError } from '../services/api/apiClient';

interface JobFitFormData {
  jobDescriptionText: string;
  jobDescriptionUrl: string;
}

type Stage = 'input' | 'analyzing' | 'results' | 'error';

export function JobFitAnalysis() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('input');
  const [results, setResults] = useState<AnalyzeJobFitResponse | null>(null);
  const { mutate: analyzeJobFit, isPending, error: mutationError } = useJobFitAnalysis();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    setError,
  } = useForm<JobFitFormData>({
    defaultValues: {
      jobDescriptionText: '',
      jobDescriptionUrl: '',
    },
  });

  const jobDescriptionText = watch('jobDescriptionText');
  const jobDescriptionUrl = watch('jobDescriptionUrl');

  // Character count for text input
  const charCount = jobDescriptionText.length;
  const isTextValid = charCount >= 100 && charCount <= 50000;
  const isUrlValid =
    jobDescriptionUrl.trim().length > 0 && /^https?:\/\/.+/.test(jobDescriptionUrl);

  // Enable submit if either text is valid OR URL is valid (but not both)
  const canSubmit =
    (isTextValid && !jobDescriptionUrl.trim()) || (isUrlValid && !jobDescriptionText.trim());

  const onSubmit = (data: JobFitFormData) => {
    // Build request with mutually exclusive fields
    const request: AnalyzeJobFitRequest = {};

    if (data.jobDescriptionText.trim() && !data.jobDescriptionUrl.trim()) {
      request.jobDescriptionText = data.jobDescriptionText.trim();
    } else if (data.jobDescriptionUrl.trim() && !data.jobDescriptionText.trim()) {
      request.jobDescriptionUrl = data.jobDescriptionUrl.trim();
    } else if (data.jobDescriptionText.trim() && data.jobDescriptionUrl.trim()) {
      setError('root', {
        message: 'Please provide either text OR URL, not both',
      });
      return;
    } else {
      setError('root', {
        message: 'Please provide job description text or URL',
      });
      return;
    }

    setStage('analyzing');

    analyzeJobFit(request, {
      onSuccess: (response) => {
        setResults(response);
        setStage('results');
      },
      onError: (error) => {
        console.error('Job Fit Analysis error:', error);
        setStage('error');
      },
    });
  };

  const handleReset = () => {
    setStage('input');
    setResults(null);
  };

  if (stage === 'analyzing') {
    return (
      <div className="min-h-screen bg-neutral-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <div className="text-6xl mb-6">🔍</div>
            <h2 className="text-2xl font-semibold text-neutral-900 mb-4">Analyzing Job Fit...</h2>
            <div className="space-y-3 text-left max-w-md mx-auto mb-6">
              <div className="flex items-center gap-3">
                <span className="text-green-600">✓</span>
                <span className="text-neutral-700">Parsing job description</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-blue-600 animate-pulse">⏳</span>
                <span className="text-neutral-700">Extracting requirements</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-neutral-400">⏳</span>
                <span className="text-neutral-500">Comparing against your catalog</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-neutral-400">⏳</span>
                <span className="text-neutral-500">Identifying matches and gaps</span>
              </div>
            </div>
            <div className="w-full bg-neutral-200 rounded-full h-2 mb-2">
              <div className="bg-primary-600 h-2 rounded-full w-1/4 transition-all duration-300 animate-pulse"></div>
            </div>
            <p className="text-sm text-neutral-500">Estimated time: ~10-15 seconds</p>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'results' && results) {
    return (
      <div className="min-h-screen bg-neutral-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <button
            onClick={() => navigate('/')}
            className="text-primary-600 hover:text-primary-700 mb-6 flex items-center gap-2"
          >
            ← Back
          </button>

          <h1 className="text-3xl font-bold text-neutral-900 mb-6">Job Fit Analysis Results</h1>

          {/* Overall Fit Card */}
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <div className="text-center">
              <div className="text-xl font-semibold text-neutral-900 mb-2">
                Overall Fit:{' '}
                {results.recommendation?.toUpperCase().replace('_', ' ') || 'NO RECOMMENDATION'}
              </div>
              <p className="text-neutral-700 mb-4">{results.summary}</p>
              <div className="text-sm text-neutral-500">Confidence: {results.confidence}</div>
            </div>
          </div>

          {/* Parsed Requirements */}
          {results.parsedJd.roleTitle && (
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h3 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
                📋 Parsed Requirements
              </h3>
              <div className="space-y-2 text-sm">
                {results.parsedJd.roleTitle && (
                  <div>
                    <span className="font-medium">Role:</span> {results.parsedJd.roleTitle}
                  </div>
                )}
                {results.parsedJd.seniority && (
                  <div>
                    <span className="font-medium">Seniority:</span> {results.parsedJd.seniority}
                  </div>
                )}
                {results.parsedJd.requiredStack.length > 0 && (
                  <div>
                    <span className="font-medium">Required Stack:</span>{' '}
                    {results.parsedJd.requiredStack.join(', ')}
                  </div>
                )}
                {results.parsedJd.niceToHaveStack.length > 0 && (
                  <div>
                    <span className="font-medium">Nice-to-have:</span>{' '}
                    {results.parsedJd.niceToHaveStack.join(', ')}
                  </div>
                )}
                {results.parsedJd.location && (
                  <div>
                    <span className="font-medium">Location:</span> {results.parsedJd.location}
                  </div>
                )}
                {results.parsedJd.compensation && (
                  <div>
                    <span className="font-medium">Compensation:</span>{' '}
                    {results.parsedJd.compensation}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Strong Matches */}
          {results.strongMatches.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h3 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
                ✅ Strong Matches ({results.strongMatches.length})
              </h3>
              <div className="space-y-3">
                {results.strongMatches.map((match, idx) => (
                  <div key={idx} className="border-l-4 border-green-500 pl-4 py-2">
                    <div className="font-medium text-neutral-900">{match.catalogEntry}</div>
                    <div className="text-sm text-neutral-600">
                      Matches: {match.jdRequirement} ({match.matchType})
                    </div>
                    {match.isRequired && (
                      <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">
                        Required
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Partial Matches */}
          {results.partialMatches.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h3 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
                ⚠️ Partial Matches ({results.partialMatches.length})
              </h3>
              <div className="space-y-3">
                {results.partialMatches.map((match, idx) => (
                  <div key={idx} className="border-l-4 border-yellow-500 pl-4 py-2">
                    <div className="font-medium text-neutral-900">{match.catalogEntry}</div>
                    <div className="text-sm text-neutral-600">
                      Partially matches: {match.jdRequirement} ({match.matchType})
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Gaps */}
          {results.gaps.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h3 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
                ❌ Gaps ({results.gaps.length})
              </h3>
              <div className="space-y-3">
                {results.gaps.map((gap, idx) => {
                  const severityColor =
                    gap.severity === 'critical'
                      ? 'border-red-500 bg-red-50'
                      : gap.severity === 'moderate'
                        ? 'border-orange-500 bg-orange-50'
                        : 'border-yellow-500 bg-yellow-50';

                  return (
                    <div key={idx} className={`border-l-4 ${severityColor} p-4 rounded`}>
                      <div className="font-medium text-neutral-900">
                        {gap.severity === 'critical'
                          ? '🔴'
                          : gap.severity === 'moderate'
                            ? '🟡'
                            : '🟢'}{' '}
                        {gap.jdRequirement}
                      </div>
                      <div className="text-sm text-neutral-700 mt-1">
                        {gap.severity.toUpperCase()} -{' '}
                        {gap.isRequired ? 'Required skill' : 'Nice-to-have skill'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recommended STAR Entries */}
          {results.recommendedStarEntries.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h3 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
                💡 Recommended STAR Entries
              </h3>
              <div className="space-y-3">
                {results.recommendedStarEntries.map((entry, idx) => (
                  <div key={idx} className="border-l-4 border-blue-500 pl-4 py-2">
                    <div className="text-sm text-neutral-800">{entry.rawText}</div>
                    <div className="text-xs text-neutral-500 mt-1">
                      Relevance: {Math.round(entry.relevanceScore * 100)}% | Category:{' '}
                      {entry.impactCategory}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty Catalog Warning */}
          {results.catalogEmpty && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6">
              <div className="flex items-start gap-3">
                <span className="text-2xl">📋</span>
                <div>
                  <h3 className="font-semibold text-neutral-900 mb-2">No Catalog Data Yet</h3>
                  <p className="text-neutral-700 mb-4">{results.summary}</p>
                  <button
                    onClick={() => navigate('/resumes/upload')}
                    className="text-primary-600 hover:text-primary-700 font-medium"
                  >
                    Upload Resume →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4 flex-wrap">
            <button
              onClick={() =>
                navigate('/cover-letters/new', {
                  state: {
                    jobDescriptionText: jobDescriptionText,
                    targetRole: results.parsedJd.roleTitle ?? undefined,
                  },
                })
              }
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Generate Cover Letter
            </button>
            <button
              onClick={handleReset}
              className="px-6 py-2 text-neutral-700 hover:text-neutral-900"
            >
              ← Analyze Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'error') {
    // Extract detailed error information
    let errorMessage = 'An unexpected error occurred';
    let errorDetails: string | undefined;

    if (mutationError instanceof APIError) {
      errorMessage = mutationError.message;

      // Add helpful context based on error code
      switch (mutationError.code) {
        case 'JD_TEXT_TOO_SHORT':
          errorMessage = 'Job description is too short. Please provide at least 100 characters.';
          break;
        case 'JD_TEXT_TOO_LONG':
          errorMessage = 'Job description exceeds maximum length of 50,000 characters.';
          break;
        case 'JD_URL_INVALID':
          errorMessage = 'The provided URL is not valid. Please check and try again.';
          break;
        case 'JD_PARSE_FAILED':
          errorMessage =
            'Unable to extract job requirements from the provided text. Please ensure it contains a valid job description.';
          break;
        case 'URL_FETCH_FAILED':
          errorMessage =
            'Could not retrieve job description from URL. The site may be blocking automated access. Please paste the job description text directly.';
          break;
        case 'URL_FETCH_TIMEOUT':
          errorMessage =
            'Request timed out while fetching job description from URL. Please try pasting the text directly.';
          break;
        case 'RATE_LIMIT_EXCEEDED':
          errorMessage = 'Too many requests. Please wait a moment and try again.';
          break;
        case 'NETWORK_ERROR':
          errorMessage =
            'Unable to connect to the server. Please check your connection and try again.';
          break;
      }

      if (mutationError.details) {
        errorDetails = JSON.stringify(mutationError.details, null, 2);
      }
    } else if (mutationError) {
      errorMessage = mutationError.message || errorMessage;
    }

    return (
      <div className="min-h-screen bg-neutral-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
            <div className="text-6xl mb-4">⚠️</div>
            <h2 className="text-2xl font-semibold text-red-900 mb-4">Analysis Failed</h2>
            <p className="text-red-700 mb-6">{errorMessage}</p>
            {errorDetails && (
              <details className="mb-6 text-left">
                <summary className="cursor-pointer text-sm text-red-600 hover:text-red-800">
                  Show technical details
                </summary>
                <pre className="mt-2 p-4 bg-red-100 rounded text-xs text-red-900 overflow-auto">
                  {errorDetails}
                </pre>
              </details>
            )}
            <button
              onClick={handleReset}
              className="px-6 py-2 bg-primary-600 text-white rounded hover:bg-primary-700"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Input Stage
  return (
    <div className="min-h-screen bg-neutral-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <button
          onClick={() => navigate('/')}
          className="text-primary-600 hover:text-primary-700 mb-6 flex items-center gap-2"
        >
          ← Back to Dashboard
        </button>

        <h1 className="text-3xl font-bold text-neutral-900 mb-2">Job Fit Analysis</h1>
        <p className="text-neutral-600 mb-8">
          Analyze how well a job posting matches your experience, skills, and achievements. We'll
          provide an honest assessment including any gaps.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-lg shadow-sm p-6">
          {/* Job Description Text Area */}
          <div className="mb-6">
            <label
              htmlFor="jobDescriptionText"
              className="block text-sm font-medium text-neutral-700 mb-2"
            >
              Job Description
            </label>
            <textarea
              id="jobDescriptionText"
              {...register('jobDescriptionText')}
              rows={8}
              placeholder="Paste the full job description here...

Include requirements, qualifications, responsibilities, tech stack, and any other relevant details"
              className="w-full px-4 py-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y min-h-[200px] max-h-[500px]"
            />
            <div className="mt-2 flex justify-between items-center text-sm">
              <span className={charCount < 100 ? 'text-red-600' : 'text-neutral-500'}>
                {charCount} / 50,000
                {charCount > 0 && charCount < 100 && ' ⚠️ Min 100 characters required'}
                {charCount > 50000 && ' ⚠️ Max 50,000 characters'}
              </span>
              {isTextValid && <span className="text-green-600">✓ Ready to analyze</span>}
            </div>
          </div>

          {/* OR Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-neutral-500">OR</span>
            </div>
          </div>

          {/* Job Posting URL */}
          <div className="mb-6">
            <label
              htmlFor="jobDescriptionUrl"
              className="block text-sm font-medium text-neutral-700 mb-2"
            >
              Job Posting URL
            </label>
            <input
              id="jobDescriptionUrl"
              type="url"
              {...register('jobDescriptionUrl')}
              placeholder="https://example.com/careers/senior-full-stack-engineer"
              className="w-full px-4 py-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            {jobDescriptionUrl && !isUrlValid && (
              <p className="mt-2 text-sm text-red-600">
                ❌ Please enter a valid URL starting with http:// or https://
              </p>
            )}
          </div>

          {/* Warning Notice */}
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              ⚠️ <strong>Note:</strong> This analysis will identify gaps in your profile. We provide
              honest assessments to help you make informed decisions.
            </p>
          </div>

          {/* Form Errors */}
          {errors.root && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{errors.root.message}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between items-center">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-6 py-2 text-neutral-700 hover:text-neutral-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit || isPending}
              className="px-6 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? 'Analyzing...' : 'Analyze Fit →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
