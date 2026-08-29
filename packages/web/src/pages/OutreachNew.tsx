import { useNavigate, useSearchParams } from 'react-router-dom';
import { OutreachComposer } from '../components/OutreachComposer';

export function OutreachNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const applicationId = searchParams.get('applicationId') || undefined;
  const fitAnalysisId = searchParams.get('jobFitAnalysisId') || undefined;
  const company = searchParams.get('company') || '';
  const jobTitle = searchParams.get('jobTitle') || '';

  const handleComplete = () => {
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

        {/*
          The page deliberately renders no platform picker. `OutreachComposer` owns the
          platform, because the platform is what decides the composer's character budget,
          its warning thresholds, and whether it shows a Subject field at all — the control
          belongs with the fields it governs. A second picker here previously wrote to a
          value the composer read once and then ignored, so the two silently disagreed and
          the visible one lost (WIC-1583).
        */}
        {/*
          The key covers every prop the composer seeds state from, so a change to any of
          them remounts it instead of being dropped by a mount-only initialiser. All three
          come from the query string, so today they only change on navigation — this makes
          the drop structurally impossible rather than merely unreachable.
        */}
        <OutreachComposer
          key={`${company}|${jobTitle}|${fitAnalysisId ?? ''}`}
          fitAnalysisId={fitAnalysisId}
          initialContext={
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
