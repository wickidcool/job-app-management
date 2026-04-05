import { useRef } from 'react';
import { uploadMarkdown } from '../api/client.js';

interface Props {
  onUploaded: () => void;
}

export default function ResumeUpload({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    await uploadMarkdown(file);
    onUploaded();
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <input ref={inputRef} type="file" accept=".md" />
      <button onClick={handleUpload}>Upload</button>
    </div>
  );
}
