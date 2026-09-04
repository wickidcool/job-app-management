import type { ReactNode } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { CoverLetterGenerator } from '../components/CoverLetterGenerator';
import { useStarEntries } from '../hooks/useCatalog';
import { useApplication } from '../hooks/useApplications';
import type { CoverLetterResult } from '../services/api/types';

interface CoverLetterNewState {
  jobDescriptionText?: string;
  targetCompany?: string;
  targetRole?: string;
  applicationId?: string;
}

/**
 * The page shell, carrying the route's `<h1>` (WIC-1571).
 *
 * Two things about this heading are deliberate.
 *
 * **It lives on the page, not in `CoverLetterGenerator`.** The generator's step-bar
 * heading — an `h2` repeating this route's name — was previously the highest heading
 * on `/cover-letters/new`, so the outline started at `h2` with nothing above it.
 * Promoting that heading would have been the smaller diff and the wrong fix:
 * per `docs/design/COMPONENT_SPECS.md` §10 → "Heading level", naming the route
 * is the page's job ("The page `<h1>` names the route"), and a single-call-site
 * feature panel's heading "is effectively part of its page's outline". The
 * generator is a component; its headings are section headings beneath this one.
 *
 * That step-bar heading is now gone entirely, not demoted: `ROUTE_HEADING_OUTLINE.md`
 * §4 (WIC-1581) rules that a component which is the sole body of a route must not
 * name the route at all, and assigns that change to this ticket so the duplicate
 * never reaches `main`. The generator's step sections carry the `h2`s instead.
 *
 * Note for anyone editing the copy below: `routeHeadingOutline.test.ts` reads JSX
 * *and* comments as live source, so spelling a heading tag out in prose here
 * registers as a real heading. Describe them in words instead.
 *
 * **Every branch renders it.** The loading, error and empty-catalog states below
 * all return before `CoverLetterGenerator` mounts. A heading that sat next to the
 * generator would leave those three states with no heading at all — which is the
 * same defect this ticket closes, just in the states nobody screenshots.
 */
function CoverLetterNewLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 pt-8">
        <h1 className="text-3xl font-bold text-gray-900">Generate Cover Letter</h1>
      </div>
      {children}
    </div>
  );
}

/** Centred single-message body shared by the loading, error and empty-catalog states. */
function StatusBody({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-center py-24">{children}</div>;
}

export function CoverLetterNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const state = (location.state as CoverLetterNewState) || {};

  const fitAnalysisId = searchParams.get('fitAnalysisId') || undefined;
  const appId = searchParams.get('appId') || state.applicationId || undefined;
  const { data: application, isLoading: isLoadingApplication } = useApplication(appId);

  // Use application data if available, otherwise fall back to state
  const jobDescriptionText = application?.jobDescription || state.jobDescriptionText || '';
  const targetCompany = application?.company || state.targetCompany || '';
  const targetRole = application?.jobTitle || state.targetRole || '';
  const applicationId = appId;

  // Scored against the analysis when the URL names one. `CoverLetterGenerator` already gates
  // `showRecommended` on the same id, so before WIC-1820 that gate opened a section whose filter
  // could never match: nothing populated `relevanceScore`. Passing the id here is what supplies it.
  const { data: catalogEntries = [], isLoading, error } = useStarEntries(fitAnalysisId);

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

  if (isLoading || isLoadingApplication) {
    return (
      <CoverLetterNewLayout>
        <StatusBody>
          <div className="text-center">
            <div className="text-lg font-medium text-gray-700">
              {isLoadingApplication ? 'Loading application data...' : 'Loading STAR entries...'}
            </div>
          </div>
        </StatusBody>
      </CoverLetterNewLayout>
    );
  }

  if (error) {
    return (
      <CoverLetterNewLayout>
        <StatusBody>
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
        </StatusBody>
      </CoverLetterNewLayout>
    );
  }

  if (catalogEntries.length === 0) {
    return (
      <CoverLetterNewLayout>
        <StatusBody>
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
        </StatusBody>
      </CoverLetterNewLayout>
    );
  }

  return (
    <CoverLetterNewLayout>
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
    </CoverLetterNewLayout>
  );
}
