import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listProjects = vi.fn();
const createProject = vi.fn();

vi.mock('../services/api', () => ({
  projectService: {
    listProjects: () => listProjects(),
    createProject: (input: unknown) => createProject(input),
  },
}));

const { ProjectsList } = await import('./ProjectsList');

/**
 * Cover for WIC-1304 — the create-success announcement.
 *
 * PR #97 (WIC-1141) fixed *focus* on this path: when the empty-state "Create Your
 * First Project" trigger is destroyed by the refetch its own dialog caused, focus is
 * redirected to the header "Create Project" button instead of falling to `<body>`.
 * That is the right target, but on its own it means a screen-reader user who creates
 * their first project hears only *"Create Project, button"* — no confirmation that
 * anything was created, and no account of why focus is now on a control they did not
 * activate.
 *
 * `MODAL_FOCUS_MANAGEMENT_SPEC.md` has required both halves for the destroyed-trigger
 * class since 2026-08-19. These tests cover the announcement half; the focus half is
 * covered by `e2e/modal-focus-projects.spec.ts`, which needs a real browser.
 */
function renderProjectsList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects']}>
        <ProjectsList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** The polite live region, wherever it was portalled to. */
function liveRegion() {
  return screen.getByRole('status');
}

async function createFirstProject(name: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Create Your First Project' }));
  await user.type(screen.getByPlaceholderText('e.g., Acme Corp'), name);
  await user.click(screen.getByRole('button', { name: 'Create' }));
  return user;
}

describe('ProjectsList create-success announcement', () => {
  it('announces the created project by name in a polite live region', async () => {
    listProjects.mockResolvedValue([]);
    createProject.mockResolvedValue({
      id: '1',
      name: 'Acme Corp',
      slug: 'acme-corp',
      fileCount: 0,
      updatedAt: new Date('2026-08-30T00:00:00Z'),
    });

    renderProjectsList();
    await createFirstProject('Acme Corp');

    await waitFor(() => expect(liveRegion()).toHaveTextContent('Project "Acme Corp" created.'));
    expect(liveRegion()).toHaveAttribute('aria-live', 'polite');
  });

  it('mounts the region before the announcement, so the text is an update to it', async () => {
    // Assistive tech announces *updates* to a region already in the accessibility
    // tree. A region that first appears carrying its message may not be announced at
    // all, so the empty region has to be present from the loaded page's first paint.
    listProjects.mockResolvedValue([]);

    renderProjectsList();

    await screen.findByRole('button', { name: 'Create Your First Project' });
    expect(liveRegion()).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('');
  });

  it('says nothing when the create fails', async () => {
    listProjects.mockResolvedValue([]);
    createProject.mockRejectedValue(new Error('nope'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    renderProjectsList();
    await createFirstProject('Acme Corp');

    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    // The announcement is on the success path only — a failed create must not claim
    // the project exists.
    expect(liveRegion()).toHaveTextContent('');
  });
});
