import { useEffect, useState } from 'react';
import { getIndex, regenerateIndex } from '../api/client.js';
import IndexView from '../components/IndexView.js';

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
      <IndexView content={content} loading={loading} onRegenerate={handleRegenerate} />
    </div>
  );
}
