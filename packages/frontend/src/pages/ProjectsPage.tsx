import { useEffect, useState, useCallback } from 'react';
import { getProject } from '../api/client.js';
import { useProjects } from '../hooks/useProjects.js';
import FileList from '../components/FileList.js';
import MarkdownEditor from '../components/MarkdownEditor.js';
import MarkdownUpload from '../components/ResumeUpload.js';

export default function ProjectsPage() {
  const { projects, refresh } = useProjects();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [content, setContent] = useState('');

  const refreshProjects = useCallback(async () => {
    await refresh();
  }, [refresh]);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  const handleSelect = async (slug: string) => {
    setSelectedSlug(slug);
    const proj = await getProject(slug);
    setContent(proj.content);
  };

  return (
    <div>
      <h1>Projects</h1>
      <MarkdownUpload onUploaded={refreshProjects} />
      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ width: 240, flexShrink: 0 }}>
          <FileList projects={projects} selectedSlug={selectedSlug} onSelect={handleSelect} onDeleted={() => { refreshProjects(); setSelectedSlug(null); }} />
        </div>
        <div style={{ flex: 1 }}>
          {selectedSlug ? (
            <MarkdownEditor key={selectedSlug} slug={selectedSlug} initialContent={content} onSaved={refreshProjects} />
          ) : (
            <p>Select a project to edit.</p>
          )}
        </div>
      </div>
    </div>
  );
}
