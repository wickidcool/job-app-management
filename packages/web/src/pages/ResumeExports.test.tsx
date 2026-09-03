import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import resumeExportsSource from './ResumeExports.tsx?raw';

/**
 * WIC-1707 — `export_viewed` was structurally unreachable.
 *
 * `ResumeExports.tsx` hardcoded `const exports: ResumeExport[] = []`. `ResumeExportList`
 * only ever calls `onPreview` from inside `exports.map(...)`, so with zero rows there was
 * no Preview control to click, `handlePreview` never ran, and `handlePreview` is the only
 * `export_viewed` callsite in the bundle. Dashboard tile B1 (Export View Rate) was pinned
 * at 0% by construction rather than by user behaviour.
 *
 * The assertion that matters is therefore **reachability**: driving the real page with a
 * stubbed API must produce a clickable Preview that emits the event. A test that rendered
 * `ResumeExportList` with its own fixture rows would pass just as happily against the
 * hardcoded empty array — it would certify the component, not the fix.
 *
 * The source guard below exists for the same reason: `exports` arriving from a hook is the
 * property under test, and a future refactor that reintroduces a literal empty list would
 * still satisfy every rendered assertion here if the hook were stubbed away.
 */

const listExports = vi.fn();
const listAllExports = vi.fn();
const track = vi.fn();

vi.mock('../services/api', () => ({
  resumeService: {
    listExports: (resumeId: string) => listExports(resumeId),
    listAllExports: () => listAllExports(),
  },
}));

vi.mock('../services/analytics', async (importOriginal) => {
  // Spread the original so unrelated exports (getSessionId, the event-name types)
  // keep working; only `track` is observed. A hand-enumerated mock here would be an
  // allowlist that silently breaks when the module grows.
  const actual = await importOriginal<typeof import('../services/analytics')>();
  return { ...actual, track: (...args: unknown[]) => track(...args) };
});

const { ResumeExports } = await import('./ResumeExports');

function makeExport(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'export-1',
    resumeId: 'resume-42',
    name: 'resume-42-star.md',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    format: 'markdown' as const,
    ...overrides,
  };
}

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/resumes/exports" element={<ResumeExports />} />
          <Route path="/resumes/:resumeId/exports" element={<ResumeExports />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  listExports.mockReset();
  listAllExports.mockReset();
  track.mockReset();
  listExports.mockResolvedValue([]);
  listAllExports.mockResolvedValue([]);
});

describe('ResumeExports export_viewed reachability', () => {
  it('renders a Preview control for each export returned by the API', async () => {
    listExports.mockResolvedValue([
      makeExport(),
      makeExport({ id: 'export-2', name: 'resume-42-v2.md' }),
    ]);

    renderAt('/resumes/resume-42/exports');

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Preview/ })).toHaveLength(2);
    });
  });

  it('emits export_viewed when Preview is clicked', async () => {
    listExports.mockResolvedValue([makeExport()]);

    renderAt('/resumes/resume-42/exports');
    const preview = await screen.findByRole('button', { name: /Preview/ });
    await userEvent.click(preview);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('export_viewed', {
      resume_id: 'resume-42',
      export_id: 'export-1',
      export_type: 'star_markdown',
    });
  });

  it('requests exports for the resume named in the route', async () => {
    renderAt('/resumes/resume-42/exports');

    await waitFor(() => expect(listExports).toHaveBeenCalledWith('resume-42'));
    expect(listAllExports).not.toHaveBeenCalled();
  });

  it('falls back to every resume’s exports on the flat /resumes/exports route', async () => {
    renderAt('/resumes/exports');

    await waitFor(() => expect(listAllExports).toHaveBeenCalled());
    expect(listExports).not.toHaveBeenCalled();
  });

  /**
   * The flat route supplies no `:resumeId`. The page used to send `resume_id: resumeId ?? ''`,
   * which would land an empty string in PostHog as a real breakdown bucket rather than as a
   * missing value. The id is read off the export row instead, which always carries one.
   */
  it('sends the row’s own resume_id on the flat route, never an empty string', async () => {
    listAllExports.mockResolvedValue([makeExport({ resumeId: 'resume-99' })]);

    renderAt('/resumes/exports');
    await userEvent.click(await screen.findByRole('button', { name: /Preview/ }));

    expect(track).toHaveBeenCalledWith(
      'export_viewed',
      expect.objectContaining({ resume_id: 'resume-99' })
    );
    const [, props] = track.mock.calls[0] as [string, { resume_id: string }];
    expect(props.resume_id).not.toBe('');
  });

  it('surfaces a failed load instead of rendering an empty list', async () => {
    listExports.mockRejectedValue(new Error('boom'));

    renderAt('/resumes/resume-42/exports');

    expect(await screen.findByText(/Failed to load resume exports/)).toBeInTheDocument();
  });
});

describe('ResumeExports source guard', () => {
  /** Strips comments so this file's own prose and the page's cannot satisfy the check. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  const source = stripComments(resumeExportsSource);

  it('takes its export list from the hook, not a literal', () => {
    expect(source).toMatch(/useResumeExports\(\s*resumeId\s*\)/);
    // The exact defect: a hardcoded empty list assigned to `exports`.
    expect(source).not.toMatch(/const\s+exports\s*(:[^=]+)?=\s*\[\s*\]/);
  });

  it('does not reintroduce the empty-string resume_id fallback', () => {
    expect(source).not.toMatch(/resume_id:\s*resumeId\s*\?\?\s*''/);
  });
});
