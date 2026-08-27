import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ResumeExportList } from './ResumeExportList';
import type { ResumeExport } from '../types/resume';

/**
 * `ResumeExportList` is the sole body of `/resumes/exports`, whose page `<h1>` says
 * "Resume Exports". It shipped with its own `<h2>Resume Exports</h2>` — the second
 * instance of the WIC-1581 duplication, and the one the ticket did not find.
 *
 * The panel heading is gone rather than reworded: it named the route and nothing else.
 * See `docs/design/ROUTE_HEADING_OUTLINE.md` §1.1 and §4.
 *
 * Rendered here with rows because `ResumeExports.tsx` still hardcodes `exports = []`
 * pending the API wiring, so the row headings are unreachable from the page today.
 */
const exports: ResumeExport[] = [
  {
    id: 'exp-1',
    name: 'Backend Engineer — Acme',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    experienceIds: ['star-1'],
    format: 'pdf',
    fileSize: 245_000,
  },
  {
    id: 'exp-2',
    name: 'Platform Engineer — Globex',
    createdAt: new Date('2026-08-02T00:00:00Z'),
    experienceIds: ['star-2'],
    format: 'docx',
    fileSize: 98_000,
  },
];

function renderList(items: ResumeExport[] = exports) {
  const onCreateNew = vi.fn();
  render(
    <ResumeExportList
      exports={items}
      onPreview={vi.fn()}
      onDownload={vi.fn()}
      onDelete={vi.fn()}
      onCreateNew={onCreateNew}
    />
  );
  return { onCreateNew };
}

describe('ResumeExportList heading outline', () => {
  it('renders no heading naming the panel "Resume Exports"', () => {
    renderList();
    expect(screen.queryByRole('heading', { name: 'Resume Exports' })).not.toBeInTheDocument();
  });

  it('renders no heading at all when the list is empty', () => {
    renderList([]);
    // The empty state is plain text by design; the page <h1> is the only heading the
    // route needs in this state.
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
    expect(screen.getByText('No resume exports yet')).toBeInTheDocument();
  });

  it('names each export at <h2>, one level below the page <h1>', () => {
    renderList();

    const headings = screen.getAllByRole('heading');
    expect(headings.map((h) => h.textContent?.trim())).toEqual([
      'Backend Engineer — Acme',
      'Platform Engineer — Globex',
    ]);
    // <h2>, not the <h3> they shipped as: with the panel heading removed, an <h3>
    // would sit directly under the page <h1> and skip a level.
    for (const heading of headings) {
      expect(heading.tagName).toBe('H2');
    }
  });

  it('keeps the Create New action that shared the removed heading’s row', () => {
    const { onCreateNew } = renderList();
    // The row was `justify-between` to push the heading and button apart. Removing the
    // heading without changing that would have stranded the button on the left.
    expect(screen.getByRole('button', { name: /Create New/ })).toBeInTheDocument();
    expect(onCreateNew).not.toHaveBeenCalled();
  });
});
