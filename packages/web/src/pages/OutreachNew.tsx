import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { OutreachComposer } from '../components/OutreachComposer';
import type { OutreachPlatform } from '../services/api/types';

export function OutreachNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [platform, setPlatform] = useState<OutreachPlatform>('linkedin');

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

        <div className="mb-6 bg-white border rounded-lg p-4">
          <label className="block text-sm font-medium text-gray-700 mb-3">Select Platform</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={platform === 'linkedin'}
                onChange={() => setPlatform('linkedin')}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-gray-900">LinkedIn InMail</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={platform === 'email'}
                onChange={() => setPlatform('email')}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-gray-900">Email</span>
            </label>
          </div>
        </div>

        <OutreachComposer
          platform={platform}
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
