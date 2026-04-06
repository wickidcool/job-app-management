import { type ProjectMeta, deleteProject } from '../api/client.js';

interface Props {
  projects: ProjectMeta[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onDeleted: () => void;
}

export default function FileList({ projects, selectedSlug, onSelect, onDeleted }: Props) {
  const handleDelete = async (slug: string) => {
    if (!confirm(`Delete ${slug}?`)) return;
    await deleteProject(slug);
    onDeleted();
  };
  return (
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {projects.map(p => (
        <li key={p.slug} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', background: p.slug === selectedSlug ? '#eef' : 'transparent' }}>
          <button style={{ border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', flex: 1 }} onClick={() => onSelect(p.slug)}>
            {p.slug}
          </button>
          <button onClick={() => handleDelete(p.slug)} style={{ color: 'red', border: 'none', background: 'none', cursor: 'pointer' }}>Delete</button>
        </li>
      ))}
    </ul>
  );
}
