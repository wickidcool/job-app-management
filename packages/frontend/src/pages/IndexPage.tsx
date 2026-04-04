import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getIndex, regenerateIndex } from '../api/client.js';

export default function IndexPage() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const loadIndex = async () => {
    const res = await getIndex();
    setContent(res.content);
  };

  useEffect(() => { loadIndex(); }, []);

  const handleRegenerate = async () => {
    setLoading(true);
    try {
      const res = await regenerateIndex();
      setContent(res.content);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Project Index</h1>
      <button onClick={handleRegenerate} disabled={loading}>{loading ? 'Regenerating...' : 'Regenerate'}</button>
      <div style={{ marginTop: 16, border: '1px solid #ccc', padding: 16 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || '*No index yet. Add projects and regenerate.*'}</ReactMarkdown>
      </div>
    </div>
  );
}
