import { useNavigate, useSearchParams } from 'react-router-dom';
import { OutreachComposer } from '../components/OutreachComposer';

export function OutreachNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const applicationId = searchParams.get('applicationId') || undefined;
  const coverLetterId = searchParams.get('coverLetterId') || undefined;
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
          The page deliberately renders no platform picker (WIC-1583). `OutreachComposer`
          owns the platform, because the platform decides its character budget, its warning
          thresholds and whether it shows a Subject field at all — the control belongs with
          the fields it governs. A second picker here wrote to a value the composer read
          once and then ignored, so the two silently disagreed and the visible one lost.

          The key covers every prop *this page* passes that the composer seeds state from,
          so a change to any of them remounts it rather than being dropped by a mount-only
          initialiser. It does not cover `initialContext.hiringManager`, which seeds the
          Contact field — this page never passes it, and a caller that does must add it.

          All three come from the query string, so reaching the stale-seed case would need
          a link to /outreach/new from within /outreach/new, which does not exist. The key
          is defence-in-depth against a state that is unreachable today and kept so
          deliberately; nothing in the suite enforces it.
        */}
        <OutreachComposer
          key={`${company}|${jobTitle}|${fitAnalysisId ?? ''}`}
          coverLetterId={coverLetterId}
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
