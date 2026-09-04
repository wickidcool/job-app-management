import { useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link, useNavigate } from 'react-router-dom';
import { Announcer } from '../components/Announcer';
import { Breadcrumb } from '../components/Breadcrumb';
import { EmptyState } from '../components/EmptyState';
import { useProjects, useCreateProject } from '../hooks/useProjects';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { useDialogFocusRestore } from '../hooks/useDialogFocusRestore';
import { FOCUS_HANDOFF_TARGETS, useRouteFocusHandoff } from '../hooks/useRouteFocusHandoff';

/**
 * This route's top-level heading, rendered on the loading branch as well as the loaded one
 * (WIC-2050).
 *
 * The skeleton below used to stand a grey block where the heading goes, so the route
 * opened at no heading at all while the request was in flight — the WCAG 2.1 AA
 * (SC 1.3.1) defect `routeOutline.render.test.tsx` inventories. A heading is static copy
 * that does not depend on the response, so there was never anything to wait for: it is
 * the *subtitle* skeleton that is load-bearing, and that one stays.
 *
 * Extracted as a component rather than duplicated because `routeOutline.source.test.ts`
 * pins this file at exactly one literal `h1` — two copies of the same markup would read
 * there as the page growing a second top-level heading.
 */
function ProjectsListHeading({ actions }: { actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold text-neutral-900">Projects</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Organize your work experience and interview prep materials
        </p>
      </div>
      {actions}
    </div>
  );
}

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
  // The dialogue wizard is a route, not a dialog rendered here, so nothing on this page
  // is mounted when it closes and no ref can carry the restore. It hands focus back to
  // this button by name instead — see `useRouteFocusHandoff` (WIC-1931).
  const guidedCreateRef = useRouteFocusHandoff(FOCUS_HANDOFF_TARGETS.projectsGuidedCreate);
  // Focus restore and outcome announcement are two halves of the same
  // requirement, and the fallback above is exactly what makes the second half
  // load-bearing: on the create-success path focus lands on the *header*
  // "Create Project" button, which is not the control the user activated. A
  // screen-reader user would otherwise hear only "Create Project, button" —
  // no confirmation that the project exists, and no account of why focus moved.
  const { message: announcement, announce, clear: clearAnnouncement } = useAnnouncer();

  // Emptying the region as the dialog opens keeps the previous outcome from
  // lingering in the accessibility tree while the user works on the next one.
  // Emptying is itself silent, so this announces nothing.
  const handleOpenCreate = () => {
    clearAnnouncement();
    setShowCreateModal(true);
  };

  // Shared by the Cancel button, Escape, and outside-click, so every dismissal
  // path clears the draft rather than only the button.
  const handleCancelCreate = () => {
    setShowCreateModal(false);
    setNewProjectName('');
    setNewProjectDescription('');
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    // Captured before the reset below clears it.
    const createdName = newProjectName.trim();

    try {
      await createProject.mutateAsync({
        name: createdName,
        description: newProjectDescription.trim() || undefined,
      });
      setShowCreateModal(false);
      setNewProjectName('');
      setNewProjectDescription('');
      announce(`Project ${createdName} created.`);
    } catch (error) {
      console.error('Failed to create project:', error);
      alert('Failed to create project. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <ProjectsListHeading />
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
      {/*
        Portalled to <body>, so its position in this tree is presentational only.
        Mounted here rather than in the `isLoading` branch above deliberately: the
        only announcement this page makes follows a create, which cannot happen
        before the list has loaded, so the region is always in the accessibility
        tree well ahead of its first update.
      */}
      <Announcer message={announcement} />

      <Breadcrumb
        trail={[
          { label: 'Dashboard', href: '/' },
          { label: 'Projects', href: '/projects' },
        ]}
      />

      <ProjectsListHeading
        actions={
          <div className="flex gap-3">
            <button
              ref={guidedCreateRef}
              onClick={() => navigate('/projects/new/dialogue?variant=create')}
              className="rounded-md bg-success-600 px-4 py-2 text-sm font-medium text-white hover:bg-success-700 flex items-center gap-2"
            >
              💬 Add New Project (Guided)
            </button>
            <button
              ref={headerCreateRef}
              onClick={handleOpenCreate}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Create Project
            </button>
          </div>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          variant="no-documents"
          onAction={handleOpenCreate}
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
                  <h2 className="text-lg font-semibold text-neutral-900">{project.name}</h2>
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
                <label
                  htmlFor="new-project-name"
                  className="mb-1 block text-sm font-medium text-neutral-700"
                >
                  Project Name
                </label>
                <input
                  id="new-project-name"
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  placeholder="e.g., Acme Corp"
                  autoFocus
                />
              </div>
              <div>
                <label
                  htmlFor="new-project-description"
                  className="mb-1 block text-sm font-medium text-neutral-700"
                >
                  Description (optional)
                </label>
                <textarea
                  id="new-project-description"
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
