import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resumeService, type Resume } from '../services/api';
import { describeOutline, findOutlineSkips, getOutline } from '../test/headingOutline';
import { ResumeManager } from './ResumeManager';

/**
 * Rendered heading outline for `/resumes`, on both render branches (WIC-1827). See
 * `ProjectsList.outline.test.tsx` for why each branch is asserted separately.
 *
 * This page has two further branches — `isLoading` and `error` — that render no heading
 * below the `<h1>` at all and so cannot carry a skip. The two asserted here are the two
 * that render content under the page heading, which is where a skip can exist.
 */

function resume(id: string, fileName: string): Resume {
  return {
    id,
    fileName,
    fileSize: 148_000,
    mimeType: 'application/pdf',
    uploadedAt: new Date('2026-08-30T00:00:00Z'),
    version: 1,
  };
}

function renderResumeManager() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/resumes']}>
        <ResumeManager />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Headroom for the first `findBy*` in each file.
 *
 * Testing Library's `asyncUtilTimeout` defaults to **1000ms**, and this repo configures
 * it nowhere. That is a different knob from vitest's `testTimeout`, which WIC-1889 (PR
 * #322) raises to 15s — so that change does not cover this failure mode and this constant
 * does not duplicate it. Measured here: under 12x CPU load on a cold cache the empty-branch
 * query failed at 2279ms with `TestingLibraryElementError: Unable to find role="heading"`,
 * i.e. it blew the 1000ms async-util budget while staying far inside the 5000ms test
 * budget. The cost is the first test in a file paying module transform and import.
 */
const OUTLINE_QUERY_TIMEOUT = { timeout: 5_000 };

describe('ResumeManager heading outline', () => {
  it('has no level skip on the EMPTY branch', async () => {
    vi.spyOn(resumeService, 'getAll').mockResolvedValue([]);

    const { container } = renderResumeManager();
    await screen.findByRole('heading', { name: 'No documents found' }, OUTLINE_QUERY_TIMEOUT);

    const outline = getOutline(container);
    expect(findOutlineSkips(outline), describeOutline(outline)).toEqual([]);
    expect(outline).toEqual([
      { level: 1, text: 'Resume Manager' },
      { level: 2, text: 'No documents found' },
    ]);
  });

  it('has no level skip on the POPULATED branch', async () => {
    vi.spyOn(resumeService, 'getAll').mockResolvedValue([
      resume('1', 'senior-engineer.pdf'),
      resume('2', 'staff-engineer.pdf'),
    ]);

    const { container } = renderResumeManager();
    await screen.findByRole('heading', { name: 'senior-engineer.pdf' }, OUTLINE_QUERY_TIMEOUT);

    const outline = getOutline(container);
    expect(findOutlineSkips(outline), describeOutline(outline)).toEqual([]);
    expect(outline).toEqual([
      { level: 1, text: 'Resume Manager' },
      { level: 2, text: 'senior-engineer.pdf' },
      { level: 2, text: 'staff-engineer.pdf' },
    ]);
  });
});
