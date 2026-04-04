import type { MatchResult } from '../api/client.js';

interface Props {
  jobDesc: string;
  onJobDescChange: (value: string) => void;
  result: MatchResult | null;
  loading: boolean;
  onMatch: () => void;
}

export default function JobMatcher({ jobDesc, onJobDescChange, result, loading, onMatch }: Props) {
  return (
    <div>
      <textarea
        value={jobDesc}
        onChange={e => onJobDescChange(e.target.value)}
        rows={8}
        style={{ width: '100%', marginBottom: 8 }}
        placeholder="Paste job description here..."
      />
      <button onClick={onMatch} disabled={loading}>{loading ? 'Matching...' : 'Match'}</button>
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
