import { useNavigate, useSearchParams } from 'react-router-dom';
import { OutreachComposer } from '../components/OutreachComposer';
import type { OutreachMessage } from '../services/api/types';

export function OutreachNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const applicationId = searchParams.get('applicationId') || undefined;
  const fitAnalysisId = searchParams.get('jobFitAnalysisId') || undefined;
  const company = searchParams.get('company') || '';
  const jobTitle = searchParams.get('jobTitle') || '';

  const handleComplete = (_result: OutreachMessage) => {
    // Message generated successfully
    if (applicationId) {
      navigate(`/applications/${applicationId}`);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Compose Outreach Message</h1>
          <p className="text-gray-600 mt-2">
            Generate a personalized outreach message for LinkedIn or email
          </p>
        </div>

        <OutreachComposer
          platform="linkedin"
          fitAnalysisId={fitAnalysisId}
          prefillContext={
            company && jobTitle
              ? {
                  company,
                  jobTitle,
                }
              : undefined
          }
          onComplete={handleComplete}
        />
      </div>
    </div>
  );
}
