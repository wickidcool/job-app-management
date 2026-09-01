import { useNavigate, useSearchParams } from 'react-router-dom';
import { WizardContainer, type ProjectFile } from '../components/wizard';
import { useCreateProjectFile } from '../hooks/useProjects';
import { FOCUS_HANDOFF_TARGETS, focusHandoffState } from '../hooks/useRouteFocusHandoff';
import type { ProjectData } from '../components/wizard';

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
    // Navigate back to projects list, handing focus to the control that opened the
    // wizard. Dismissing this dialog is a *route change*, so the trigger the user
    // pressed is long unmounted by the time Radix restores focus and
    // `useDialogFocusRestore` has nothing to focus — see `useRouteFocusHandoff`
    // (WIC-1931). The button on the destination route is a new instance, so the
    // target has to travel with the navigation.
    navigate('/projects', {
      state: focusHandoffState(FOCUS_HANDOFF_TARGETS.projectsGuidedCreate),
    });
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
