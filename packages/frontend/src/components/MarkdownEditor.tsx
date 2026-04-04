import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { updateProject, aiUpdateProject } from '../api/client.js';

interface Props {
  slug: string;
  initialContent: string;
  onSaved: () => void;
}

export default function MarkdownEditor({ slug, initialContent, onSaved }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!editorRef.current) return;
    const view = new EditorView({
      doc: initialContent,
      extensions: [basicSetup, markdown(), oneDark],
      parent: editorRef.current,
    });
    viewRef.current = view;
    return () => view.destroy();
  }, [initialContent]);

  const getContent = () => viewRef.current?.state.doc.toString() ?? '';

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProject(slug, getContent());
      setStatus('Saved!');
      onSaved();
    } catch (e) {
      setStatus(`Error: ${String(e)}`);
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  const handleAiUpdate = async () => {
    if (!instruction.trim()) return;
    setAiModalOpen(false);
    setSaving(true);
    try {
      const result = await aiUpdateProject(slug, instruction);
      // Replace editor content
      const view = viewRef.current;
      if (view) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.content } });
      }
      setStatus('AI update applied!');
      setInstruction('');
    } catch (e) {
      setStatus(`AI error: ${String(e)}`);
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={handleSave} disabled={saving}>Save</button>
        <button onClick={() => setPreview(p => !p)}>{preview ? 'Edit' : 'Preview'}</button>
        <button onClick={() => setAiModalOpen(true)}>Ask AI to update</button>
        {status && <span>{status}</span>}
      </div>
      {preview ? (
        <div style={{ border: '1px solid #ccc', padding: 16 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{getContent()}</ReactMarkdown>
        </div>
      ) : (
        <div ref={editorRef} style={{ border: '1px solid #ccc', minHeight: 300 }} />
      )}
      {aiModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', padding: 24, borderRadius: 8, minWidth: 400 }}>
            <h3>Ask AI to Update</h3>
            <textarea value={instruction} onChange={e => setInstruction(e.target.value)} rows={4} style={{ width: '100%' }} placeholder="Enter instruction for AI (e.g. Add a summary paragraph at the top)" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={handleAiUpdate}>Submit</button>
              <button onClick={() => setAiModalOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
