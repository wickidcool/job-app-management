import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectDetail } from './ProjectDetail';

/**
 * WIC-2308. This page rendered file sizes with a private, KB-only expression:
 *
 * ```
 * {(file.size / 1024).toFixed(1)} KB
 * ```
 *
 * so a 7MB attachment read **7168.0 KB** — arithmetically correct and unreadable — while
 * `formatFileSize` (WIC-2299) rendered the same bytes as `7.0 MB` three components away.
 *
 * WHY THIS FILE EXISTS AT ALL (WIC-2310)
 * --------------------------------------
 * The existing `ProjectDetail` suites pass identically before and after the migration, so
 * they are not coverage — they are silence. `ProjectDetail.unsettled.test.tsx` builds its
 * fixture with `size: 1024`, and 1024 is the single value in the whole domain where the
 * old expression and the new helper agree:
 *
 * |   bytes | inline `(size/1024).toFixed(1)` | `formatFileSize` |
 * |--------:|--------------------------------|------------------|
 * |     512 | `0.5 KB`                       | `512 B`          |
 * |    1024 | `1.0 KB`                       | `1.0 KB`   <- the fixture |
 * |   43008 | `42.0 KB`                      | `42.0 KB`        |
 * | 7340032 | `7168.0 KB`                    | `7.0 MB`         |
 *
 * A fixture parked on the one coordinate where both arms agree cannot fail for either
 * one. So the sizes below are chosen off the boundary deliberately: they are the values
 * that can tell the two implementations apart.
 */

const LIST_PROJECT_FILES = vi.fn();

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    projectService: { listProjectFiles: (...args: unknown[]) => LIST_PROJECT_FILES(...args) },
  };
});

function aFile(fileName: string, size: number) {
  return { fileName, size, updatedAt: new Date() };
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

describe('ProjectDetail renders file sizes through the shared formatter (WIC-2308)', () => {
  it('renders a multi-megabyte attachment in MB, not four digits of KB', async () => {
    LIST_PROJECT_FILES.mockResolvedValue([aFile('deck.pdf', 7 * 1024 * 1024)]);

    renderProjectDetail();

    expect(await screen.findByText('deck.pdf')).toBeTruthy();
    expect(screen.getByText('7.0 MB')).toBeTruthy();
    // The exact string the inline expression produced. Asserting its absence is what
    // makes this test fail on the unmigrated component rather than merely pass on the
    // migrated one.
    expect(screen.queryByText('7168.0 KB')).toBeNull();
  });

  it('renders a sub-kilobyte attachment in B, not a fractional KB', async () => {
    LIST_PROJECT_FILES.mockResolvedValue([aFile('notes.txt', 512)]);

    renderProjectDetail();

    expect(await screen.findByText('notes.txt')).toBeTruthy();
    expect(screen.getByText('512 B')).toBeTruthy();
    expect(screen.queryByText('0.5 KB')).toBeNull();
  });

  it('CONTROL: the KB band is unchanged by the migration', async () => {
    // Both implementations render this identically. It passes on either side of the
    // change, which is what keeps the two assertions above honest about their scope —
    // this was a formatter swap, not a re-spec of the KB rung.
    LIST_PROJECT_FILES.mockResolvedValue([aFile('resume.docx', 42 * 1024)]);

    renderProjectDetail();

    expect(await screen.findByText('resume.docx')).toBeTruthy();
    expect(screen.getByText('42.0 KB')).toBeTruthy();
  });
});
