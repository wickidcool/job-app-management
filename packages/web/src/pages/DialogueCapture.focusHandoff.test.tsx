import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listProjects = vi.fn();

vi.mock('../services/api', () => ({
  projectService: {
    listProjects: () => listProjects(),
    createProject: vi.fn(),
    createProjectFile: vi.fn(),
  },
}));

const { DialogueCapture } = await import('./DialogueCapture');
const { ProjectsList } = await import('./ProjectsList');

/**
 * Cover for WIC-1931 — the two halves of the wizard's focus handoff are actually wired.
 *
 * `useRouteFocusHandoff.test.tsx` pins the mechanism against a stand-in destination.
 * This file pins the *binding*: that `DialogueCapture`'s dismissal names a target, that
 * `ProjectsList`'s "Add New Project (Guided)" button claims that same target, and that
 * the two agree. A mechanism nobody called would pass every test in the other file.
 *
 * The browser-level journey — real keyboard, real Radix focus scope, real
 * `onCloseAutoFocus` ordering — is `e2e/modal-focus-wizard.spec.ts`. jsdom cannot settle
 * that ordering, so this file deliberately asserts the outcome and not the timing.
 */
function renderWizardRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects/new/dialogue?variant=create']}>
        <Routes>
          <Route path="/projects" element={<ProjectsList />} />
          <Route path="/projects/new/dialogue" element={<DialogueCapture />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const guidedButton = () => screen.getByRole('button', { name: /Add New Project \(Guided\)/i });

describe('dialogue wizard → projects focus handoff', () => {
  it('lands focus on the Guided button after the wizard is dismissed', async () => {
    listProjects.mockResolvedValue([]);
    const user = userEvent.setup();

    renderWizardRoute();
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Close wizard' }));

    // Note this is a *new* button instance, mounted by `/projects` after the
    // navigation — the reason no `fallbackRef` could have carried the restore.
    await waitFor(() => expect(guidedButton()).toHaveFocus());
  });

  it('waits for the projects list to load rather than giving up on the skeleton', async () => {
    // `/projects` renders a loading skeleton first, so the button does not exist on the
    // destination's first commit. Holding `listProjects` open makes that gap wide enough
    // to be a real fixture rather than a race that happens to resolve in time.
    let resolveProjects: (value: unknown[]) => void = () => {};
    listProjects.mockReturnValue(
      new Promise<unknown[]>((resolve) => {
        resolveProjects = resolve;
      })
    );
    const user = userEvent.setup();

    renderWizardRoute();
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Close wizard' }));

    // The destination is mounted but still loading: nothing to focus yet.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Add New Project \(Guided\)/i })).toBeNull();

    resolveProjects([]);

    await waitFor(() => expect(guidedButton()).toHaveFocus());
  });

  it('does not focus the Guided button when /projects is reached directly', async () => {
    // The control. Without it, a `ProjectsList` that autofocused that button on every
    // mount would satisfy both cases above while being plainly wrong — it would steal
    // focus from anyone who simply navigated to the page.
    listProjects.mockResolvedValue([]);

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MemoryRouter initialEntries={['/projects']}>
          <Routes>
            <Route path="/projects" element={<ProjectsList />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => expect(guidedButton()).toBeInTheDocument());
    expect(guidedButton()).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });
});
