import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link, useNavigate } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { EmptyState } from '../components/EmptyState';
import { useProjects, useCreateProject } from '../hooks/useProjects';
import { useDialogFocusRestore } from '../hooks/useDialogFocusRestore';
import { useLiveAnnouncer } from '../hooks/useLiveAnnouncer';

export function ProjectsList() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading } = useProjects();
  const createProject = useCreateProject();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  // The header "Create Project" button is the one trigger that survives the
  // create-success re-render; the empty-state button below unmounts the moment
  // the list stops being empty. It offers the same action, so it is where focus
  // belongs when the dialog was opened from the empty state and succeeded.
  const headerCreateRef = useRef<HTMLButtonElement | null>(null);
  // The Project Name input carries `autoFocus`, so Radix never dispatches
  // `onOpenAutoFocus` here — the hook's `focusin` fallback captures the trigger.
  const focusRestore = useDialogFocusRestore({ fallbackRef: headerCreateRef });
  // The other half of the same requirement. `useDialogFocusRestore` above sends
  // focus to the header button when the empty-state trigger is destroyed by the
  // refetch its own dialog caused — but a control the user did not press taking
  // focus is a context change they cannot see, so on its own it reads as
  // "Create Project, button" and nothing else. WIC-1304.
  const { announce, announcer } = useLiveAnnouncer();

  // Shared by the Cancel button, Escape, and outside-click, so every dismissal
  // path clears the draft rather than only the button.
  const handleCancelCreate = () => {
    setShowCreateModal(false);
    setNewProjectName('');
    setNewProjectDescription('');
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;

    try {
      await createProject.mutateAsync({
        name,
        description: newProjectDescription.trim() || undefined,
      });
      setShowCreateModal(false);
      setNewProjectName('');
      setNewProjectDescription('');
      // Read `name` rather than `newProjectName`, which the two lines above have
      // already emptied.
      announce(`Project "${name}" created.`);
    } catch (error) {
      console.error('Failed to create project:', error);
      alert('Failed to create project. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Rendered on this arm too: a live region only announces updates once it
            is already in the accessibility tree, so it must not appear at the
            same moment its first message does. */}
        {announcer}
        <div className="mb-6 animate-pulse">
          <div className="mb-2 h-8 w-48 rounded bg-neutral-200"></div>
          <div className="h-4 w-96 rounded bg-neutral-200"></div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-neutral-200"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Portalled to <body>, so it does not put #root on `aria-hidden`'s
          keep-list and defeat background hiding — see the hook, and
          MODAL_FOCUS_MANAGEMENT_SPEC.md §6. */}
      {announcer}
      <Breadcrumb
        trail={[
          { label: 'Dashboard', href: '/' },
          { label: 'Projects', href: '/projects' },
        ]}
      />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900">Projects</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Organize your work experience and interview prep materials
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/projects/new/dialogue?variant=create')}
            className="rounded-md bg-success-600 px-4 py-2 text-sm font-medium text-white hover:bg-success-700 flex items-center gap-2"
          >
            💬 Add New Project (Guided)
          </button>
          <button
            ref={headerCreateRef}
            onClick={() => setShowCreateModal(true)}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            Create Project
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          variant="no-documents"
          onAction={() => setShowCreateModal(true)}
          actionLabel="Create Your First Project"
        />
      ) : (
        <div className="space-y-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.slug}`}
              className="block rounded-lg border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:border-primary-300 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-neutral-900">{project.name}</h3>
                  {project.description && (
                    <p className="mt-1 text-sm text-neutral-500">{project.description}</p>
                  )}
                  <p className="mt-1 text-sm text-neutral-600">
                    {project.fileCount} {project.fileCount === 1 ? 'file' : 'files'}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-neutral-400">
                    Updated {project.updatedAt.toLocaleDateString()}
                  </span>
                  <svg
                    className="h-5 w-5 text-neutral-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Dialog.Root
        open={showCreateModal}
        onOpenChange={(next) => {
          if (!next) handleCancelCreate();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl"
            {...focusRestore}
          >
            <Dialog.Title className="mb-4 text-lg font-semibold text-neutral-900">
              Create New Project
            </Dialog.Title>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">
                  Project Name
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  placeholder="e.g., Acme Corp"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">
                  Description (optional)
                </label>
                <textarea
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  placeholder="Brief description of this project"
                  rows={3}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || createProject.isPending}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {createProject.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
