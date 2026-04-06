import { useState } from 'react';
import { matchJobDescription, type MatchResult } from '../api/client.js';
import JobMatcher from '../components/JobMatcher.js';

export default function MatchPage() {
  const [jobDesc, setJobDesc] = useState('');
  const [result, setResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleMatch = async () => {
    if (!jobDesc.trim()) return;
    setLoading(true);
    try {
      const res = await matchJobDescription(jobDesc);
      setResult(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Job Description Match</h1>
      <JobMatcher jobDesc={jobDesc} onJobDescChange={setJobDesc} result={result} loading={loading} onMatch={handleMatch} />
    </div>
  );
}
