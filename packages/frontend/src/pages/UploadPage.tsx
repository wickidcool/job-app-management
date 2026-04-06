import { useRef, useState } from 'react';
import { parseResume, type ParsedResume } from '../api/client.js';
import ParsedSectionCard from '../components/ParsedSectionCard.js';

export default function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ParsedResume | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleParse = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const parsed = await parseResume(file);
      setResult(parsed);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Upload Resume</h1>
      <div style={{ marginBottom: 16 }}>
        <input ref={inputRef} type="file" accept=".pdf,.txt,.md" />
        <button onClick={handleParse} disabled={loading}>
          {loading ? 'Parsing...' : 'Parse Resume'}
        </button>
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {result && (
        <div>
          {result.warnings.length > 0 && (
            <div style={{ background: '#fffbcc', padding: 8 }}>
              {result.warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}
          {result.sections.map((s, i) => <ParsedSectionCard key={i} section={s} />)}
        </div>
      )}
    </div>
  );
}
