import { useNavigate, useSearchParams } from 'react-router-dom';
import { WizardContainer, type ProjectFile } from '../components/wizard';
import { useCreateProjectFile } from '../hooks/useProjects';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import type { ProjectData } from '../components/wizard';

/**
 * The wizard names itself by variant in `WizardContainer.tsx:398-401`. Mirrored here
 * rather than read from the container because the variant is a *route* concern — it comes
 * off the query string — and because the container renders that string as a
 * `Dialog.Title`, which `ROUTE_TITLE_CONVENTION.md` §3.1 otherwise forbids from touching
 * `document.title`. That rule is about an overlay opening *on top of* a route; here the
 * dialog is the whole route, so the route still owes the user a title.
 */
const WIZARD_VARIANT_TITLES: Record<'create' | 'enrich' | 'correct', string> = {
  create: 'New Project',
  enrich: 'Enrich Project',
  correct: 'Correct Project',
};

/**
 * DialogueCapture Page
 * Entry point for the dialogue-based STAR file capture wizard (UC-1, UC-1a, UC-1b)
 */
export function DialogueCapture() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const variant = (searchParams.get('variant') as 'create' | 'enrich' | 'correct') || 'create';
  const existingFileId = searchParams.get('fileId') || undefined;
  const createProjectFile = useCreateProjectFile();

  useDocumentTitle(WIZARD_VARIANT_TITLES[variant] ?? WIZARD_VARIANT_TITLES.create);

  const handleComplete = async (generatedFile: ProjectFile) => {
    try {
      // First, create or get the "projects" project
      // For now, we'll use a default slug "projects"
      const projectSlug = 'projects';

      // Create the project file
      await createProjectFile.mutateAsync({
        projectId: projectSlug,
        fileName: generatedFile.filename,
        content: generatedFile.content,
      });

      // Navigate to the file editor
      navigate(`/projects/${projectSlug}/files/${generatedFile.filename}`);
    } catch (error) {
      console.error('Failed to create project file:', error);
      alert('Failed to create project file. Please try again.');
    }
  };

  const handleCancel = () => {
    // Navigate back to projects list
    navigate('/projects');
  };

  const handleSaveDraft = (draftData: Partial<ProjectData>) => {
    // Save draft to localStorage for now
    // In the future, this could be saved to .draft files via API
    const draftKey = `dialogue-wizard-draft-${variant}${existingFileId ? `-${existingFileId}` : ''}`;
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        data: draftData,
        timestamp: new Date().toISOString(),
      })
    );
    console.log('Draft saved:', draftKey);
  };

  return (
    <div className="min-h-screen bg-neutral-900 bg-opacity-50">
      <WizardContainer
        variant={variant}
        onComplete={handleComplete}
        onCancel={handleCancel}
        onSaveDraft={handleSaveDraft}
      />
    </div>
  );
}
