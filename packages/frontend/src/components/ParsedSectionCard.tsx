import type { ResumeSection } from '../api/client.js';
import { createProject } from '../api/client.js';
import { useNavigate } from 'react-router-dom';

interface Props {
  section: ResumeSection;
}

export default function ParsedSectionCard({ section }: Props) {
  const navigate = useNavigate();

  const handleAddAsProject = async (company: string, bullets: string[]) => {
    const content = `# ${company}\n\n${bullets.map(b => `- ${b}`).join('\n')}`;
    await createProject(company, content);
    navigate('/');
  };

  return (
    <div style={{ border: '1px solid #ccc', padding: 16, marginBottom: 16, borderRadius: 4 }}>
      <h3>{section.heading}</h3>
      {section.entries.map((entry, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          <strong>{entry.company}</strong> — {entry.title} ({entry.dates})
          <ul>
            {entry.bullets.map((b, j) => <li key={j}>{b}</li>)}
          </ul>
          {entry.company && (
            <button onClick={() => handleAddAsProject(entry.company, entry.bullets)}>Add as project</button>
          )}
        </div>
      ))}
    </div>
  );
}
