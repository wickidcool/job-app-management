import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectDetail } from './ProjectDetail';

/**
 * WIC-2227 — the same defect as `ProjectsList.unsettled.test.tsx`, but with a sharper
 * surface: this page renders the file count **as prose**.
 *
 * ```
 * subtitle={`${files.length} ${files.length === 1 ? 'file' : 'files'} in this project`}
 * ```
 *
 * With `const { data: files = [], isLoading }` and no `error` read at all, a failed or
 * offline-paused request produced the sentence **"0 files in this project"** — a specific
 * numeric fact about a project whose file list was never successfully read. An empty state
 * is a wrong claim; a fabricated count is a wrong claim wearing a number, which is worse
 * because it looks measured.
 *
 * See the sibling file's header for why the service is mocked rather than the hook, and
 * why the `queryFn` call counts are asserted (0 is what proves *paused* rather than slow).
 *
 * The count assertion below is deliberately `/\d+ files? in this project/` rather than
 * `"0 files"`: pinning the literal zero would go green the day someone changed the
 * fallback to `-1` or `NaN`. What must not appear is a count of ANY value.
 */

const LIST_PROJECT_FILES = vi.fn();

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    projectService: { listProjectFiles: (...args: unknown[]) => LIST_PROJECT_FILES(...args) },
  };
});

/** Any rendered file count, not just the zero the bug happened to produce. */
const ANY_FILE_COUNT = /\d+ files? in this project/i;

function aFile(fileName = 'roadmap.md') {
  return { fileName, size: 1024, updatedAt: new Date() };
}

function renderProjectDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/quarterly-roadmap']}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  LIST_PROJECT_FILES.mockReset();
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('ProjectDetail — an unread file list yields no file count (WIC-2227)', () => {
  it('CONTROL: a successful response renders the file and a real count', async () => {
    LIST_PROJECT_FILES.mockResolvedValue([aFile()]);

    renderProjectDetail();

    expect(await screen.findByText('roadmap.md')).toBeTruthy();
    // The count matcher must be able to MATCH when a count is legitimately rendered,
    // otherwise its absence below would prove nothing.
    expect(screen.getByText(ANY_FILE_COUNT)).toBeTruthy();
    expect(LIST_PROJECT_FILES).toHaveBeenCalledTimes(1);
  });

  it('a FAILED request renders no file count and discloses the failure', async () => {
    LIST_PROJECT_FILES.mockRejectedValue(new Error('500'));

    renderProjectDetail();

    expect(await screen.findByText(/Failed to load project files/i)).toBeTruthy();
    // The fabricated fact this card is about.
    expect(screen.queryByText(ANY_FILE_COUNT)).toBeNull();
    expect(LIST_PROJECT_FILES).toHaveBeenCalledTimes(1);
  });

  it('an offline-PAUSED query renders no file count', async () => {
    onlineManager.setOnline(false);
    // The project HAS a file. Rendering "0 files in this project" would contradict the
    // fixture, which is the point.
    LIST_PROJECT_FILES.mockResolvedValue([aFile()]);

    renderProjectDetail();

    await waitFor(() => {
      expect(screen.queryByText(ANY_FILE_COUNT)).toBeNull();
    });
    // 0 calls is what makes this PAUSED rather than slow.
    expect(LIST_PROJECT_FILES).toHaveBeenCalledTimes(0);
  });
});
