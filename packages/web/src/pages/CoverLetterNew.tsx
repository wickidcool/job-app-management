import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { CoverLetterGenerator } from '../components/CoverLetterGenerator';
import { useStarEntries } from '../hooks/useCatalog';
import type { CoverLetterResult } from '../services/api/types';

interface CoverLetterNewState {
  jobDescriptionText?: string;
  targetCompany?: string;
  targetRole?: string;
  applicationId?: string;
}

export function CoverLetterNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const state = (location.state as CoverLetterNewState) || {};

  const fitAnalysisId = searchParams.get('fitAnalysisId') || undefined;
  const applicationId = searchParams.get('applicationId') || state.applicationId || undefined;
  const jobDescriptionText = state.jobDescriptionText || '';
  const targetCompany = state.targetCompany || '';
  const targetRole = state.targetRole || '';

  const { data: catalogEntries = [], isLoading, error } = useStarEntries();

  const handleComplete = (result: CoverLetterResult) => {
    // Cover letter is already saved by the generation API
    // Navigate to cover letter detail or back to application
    if (applicationId) {
      navigate(`/applications/${applicationId}`);
    } else {
      navigate(`/cover-letters/${result.id}`);
    }
  };

  const handleCancel = () => {
    if (applicationId) {
      navigate(`/applications/${applicationId}`);
    } else {
      navigate('/');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-medium text-gray-700">Loading STAR entries...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-medium text-red-600">Failed to load STAR entries</div>
          <div className="text-sm text-gray-600 mt-2">
            {error instanceof Error ? error.message : 'Unknown error'}
          </div>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (catalogEntries.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-medium text-gray-700">No STAR entries found</div>
          <div className="text-sm text-gray-600 mt-2">
            Upload a resume to extract your achievements first.
          </div>
          <button
            onClick={() => navigate('/resumes')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Upload Resume
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <CoverLetterGenerator
        fitAnalysisId={fitAnalysisId}
        applicationId={applicationId}
        initialJobDescription={jobDescriptionText}
        initialCompany={targetCompany}
        initialRole={targetRole}
        catalogEntries={catalogEntries}
        onComplete={handleComplete}
        onCancel={handleCancel}
      />
    </div>
  );
}
