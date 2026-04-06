import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
  loading: boolean;
  onRegenerate: () => void;
}

export default function IndexView({ content, loading, onRegenerate }: Props) {
  return (
    <div>
      <button onClick={onRegenerate} disabled={loading}>{loading ? 'Regenerating...' : 'Regenerate'}</button>
      <div style={{ marginTop: 16, border: '1px solid #ccc', padding: 16 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || '*No index yet. Add projects and regenerate.*'}</ReactMarkdown>
      </div>
    </div>
  );
}
