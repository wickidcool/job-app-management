import { useState } from 'react';
import { matchJobDescription, type MatchResult } from '../api/client.js';

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
      <textarea
        value={jobDesc}
        onChange={e => setJobDesc(e.target.value)}
        rows={8}
        style={{ width: '100%', marginBottom: 8 }}
        placeholder="Paste job description here..."
      />
      <button onClick={handleMatch} disabled={loading}>{loading ? 'Matching...' : 'Match'}</button>
      {result && (
        <div style={{ marginTop: 24 }}>
          <h2>Overall Score: {(result.score * 100).toFixed(1)}%</h2>
          <p><strong>Matched keywords:</strong> {result.matchedKeywords.join(', ') || 'None'}</p>
          <p><strong>Missed keywords:</strong> {result.missedKeywords.join(', ') || 'None'}</p>
          <h3>Projects</h3>
          <ul>
            {result.projectScores.map(p => (
              <li key={p.slug}>
                <strong>{p.slug}</strong>: {(p.score * 100).toFixed(1)}% — matched: {p.matchedKeywords.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
