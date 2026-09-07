import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectFileEditor } from './ProjectFileEditor';

/**
 * WIC-2229 — the WIC-2227 class on the project file editor, and the one member of the
 * cohort that can destroy data rather than only mislead.
 *
 * `ProjectFileEditor` read `const { data: content, isLoading }` and rendered
 * `{content || ''}`. `projectService.getProjectFile` does **not** map 404 to `null` the way
 * `applicationService.getById` does, so a missing or unreadable file arrives as `isError`
 * with `data` undefined and `isLoading` false — and the page fell through to the full
 * editor: the filename as an `<h1>` (taken from the URL param, so it renders with no fetch
 * at all), a breadcrumb naming it, and an empty content card. An affirmative claim that the
 * file exists and is blank.
 *
 * The `Edit` button is what makes it worse than a false claim. It seeded
 * `setEditedContent(content || '')` and `handleSave` PUTs that string back, so a user who
 * opened a file whose contents never loaded was one click from overwriting it with `''`.
 * That is why the failure assertion below is on the **absence of the Edit control**, not
 * merely on the presence of an error message: the message is the courtesy, the missing
 * button is the fix.
 *
 * Service mocked one layer below the real `useProjectFile`, and `queryFn` call counts
 * asserted — see `ProjectsList.unsettled.test.tsx` for why both are load-bearing.
 */

const GET_PROJECT_FILE = vi.fn();

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    projectService: {
      ...(actual.projectService as object),
      getProjectFile: (...args: unknown[]) => GET_PROJECT_FILE(...args),
    },
  };
});

const EDIT_BUTTON = { name: /^Edit$/ } as const;
const FAILURE_DISCLOSURE = /Failed to load this file/i;

function renderFileEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/quarterly-roadmap/files/README.md']}>
        <Routes>
          <Route path="/projects/:projectId/files/:fileName" element={<ProjectFileEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  GET_PROJECT_FILE.mockReset();
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('ProjectFileEditor — an unread file is not an empty one (WIC-2229)', () => {
  it('CONTROL: a successful response renders the file body and the Edit control', async () => {
    GET_PROJECT_FILE.mockResolvedValue('# Roadmap\n\nShip the thing.');

    renderFileEditor();

    expect(await screen.findByText(/Ship the thing/)).toBeTruthy();
    expect(screen.getByRole('button', EDIT_BUTTON)).toBeTruthy();
    expect(screen.queryByText(FAILURE_DISCLOSURE)).toBeNull();
    expect(GET_PROJECT_FILE).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a file that settles GENUINELY EMPTY still opens for editing', async () => {
    // The state the editor is ENTITLED to render blank. This is the whole reason the fix
    // could not simply be "treat empty content as an error": an empty file is a real,
    // editable file, and without this case the failure assertion below would also pass for
    // a page that had lost its editor entirely.
    GET_PROJECT_FILE.mockResolvedValue('');

    renderFileEditor();

    expect(await screen.findByRole('button', EDIT_BUTTON)).toBeTruthy();
    expect(screen.queryByText(FAILURE_DISCLOSURE)).toBeNull();
  });

  it('a FAILED request discloses the failure and withholds the Edit control', async () => {
    GET_PROJECT_FILE.mockRejectedValue(new Error('404'));

    renderFileEditor();

    expect(await screen.findByText(FAILURE_DISCLOSURE)).toBeTruthy();
    // The data-loss path, closed: with no Edit button there is no way to reach
    // `setEditedContent('')` and PUT it back over a file that was never read.
    expect(screen.queryByRole('button', EDIT_BUTTON)).toBeNull();
    expect(GET_PROJECT_FILE).toHaveBeenCalledTimes(1);
  });

  it('an offline-PAUSED query withholds the Edit control rather than offering an empty file', async () => {
    onlineManager.setOnline(false);
    // Deliberately resolvable: the file HAS content. Rendering an editable blank here would
    // contradict data the fixture proves exists.
    GET_PROJECT_FILE.mockResolvedValue('# Roadmap\n\nShip the thing.');

    renderFileEditor();

    await waitFor(() => {
      expect(screen.queryByRole('button', EDIT_BUTTON)).toBeNull();
    });
    expect(screen.queryByText(FAILURE_DISCLOSURE)).toBeNull();
    // 0 calls is what makes this a PAUSED query rather than a merely slow one.
    expect(GET_PROJECT_FILE).toHaveBeenCalledTimes(0);
  });
});
