import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { projectService, type ProjectFile } from '../services/api';
import { describeOutline, findOutlineSkips, getOutline } from '../test/headingOutline';
import { ProjectDetail } from './ProjectDetail';

/**
 * Rendered heading outline for `/projects/:projectId`, on both render branches
 * (WIC-1827). See `ProjectsList.outline.test.tsx` for why each branch is asserted
 * separately: `EmptyState`'s `headingLevel` default (WIC-1417) fixed the empty branch
 * of all three of these pages, leaving the populated branch skipping `h1 -> h3` behind
 * a green-looking check.
 */

function file(fileName: string): ProjectFile {
  return { fileName, size: 2048, updatedAt: new Date('2026-08-30T00:00:00Z') };
}

/** Rendered through a real route so `useParams().projectId` resolves as it does in the app. */
function renderProjectDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects/acme-corp']}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProjectDetail heading outline', () => {
  it('has no level skip on the EMPTY branch', async () => {
    vi.spyOn(projectService, 'listProjectFiles').mockResolvedValue([]);

    const { container } = renderProjectDetail();
    await screen.findByRole('heading', { name: 'No documents found' });

    const outline = getOutline(container);
    expect(findOutlineSkips(outline), describeOutline(outline)).toEqual([]);
    // The `<h1>` is the de-slugified route param, so this also pins that the page
    // heading is still derived from the URL rather than hardcoded.
    expect(outline).toEqual([
      { level: 1, text: 'acme corp' },
      { level: 2, text: 'No documents found' },
    ]);
  });

  it('has no level skip on the POPULATED branch', async () => {
    vi.spyOn(projectService, 'listProjectFiles').mockResolvedValue([
      file('resume.md'),
      file('notes.md'),
    ]);

    const { container } = renderProjectDetail();
    await screen.findByRole('heading', { name: 'resume.md' });

    const outline = getOutline(container);
    expect(findOutlineSkips(outline), describeOutline(outline)).toEqual([]);
    expect(outline).toEqual([
      { level: 1, text: 'acme corp' },
      { level: 2, text: 'resume.md' },
      { level: 2, text: 'notes.md' },
    ]);
  });
});
