import { useState } from 'react';
import { generateCoverLetter } from '../api/client.js';

export default function CoverLetterPage() {
  const [jobDesc, setJobDesc] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');
  const [coverLetter, setCoverLetter] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!jobDesc.trim()) return;
    setLoading(true);
    try {
      const res = await generateCoverLetter(jobDesc, additionalContext || undefined);
      setCoverLetter(res.coverLetter);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(coverLetter);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <h1>Generate Cover Letter</h1>
      <h3>Job Description</h3>
      <textarea
        value={jobDesc}
        onChange={e => setJobDesc(e.target.value)}
        rows={8}
        style={{ width: '100%', marginBottom: 8 }}
        placeholder="Paste job description here..."
      />
      <h3>Additional Context (optional)</h3>
      <textarea
        value={additionalContext}
        onChange={e => setAdditionalContext(e.target.value)}
        rows={3}
        style={{ width: '100%', marginBottom: 8 }}
        placeholder="e.g. I am applying for a senior role..."
      />
      <button onClick={handleGenerate} disabled={loading}>{loading ? 'Generating...' : 'Generate Cover Letter'}</button>
      {coverLetter && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Cover Letter</h3>
            <button onClick={handleCopy}>{copied ? 'Copied!' : 'Copy to Clipboard'}</button>
          </div>
          <textarea
            readOnly
            value={coverLetter}
            rows={20}
            style={{ width: '100%', fontFamily: 'serif', lineHeight: '1.6' }}
          />
        </div>
      )}
    </div>
  );
}
