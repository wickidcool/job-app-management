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
 * These rows are now reachable from the page: WIC-1707 replaced the hardcoded
 * `exports = []` in `ResumeExports.tsx` with the API-backed list. Do not restore the
 * "unreachable from the page today" caveat that used to sit here.
 */
const exports: ResumeExport[] = [
  {
    id: 'exp-1',
    resumeId: 'resume-1',
    name: 'Backend Engineer — Acme',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    experienceIds: ['star-1'],
    format: 'pdf',
    fileSize: 245_000,
  },
  {
    id: 'exp-2',
    resumeId: 'resume-2',
    name: 'Platform Engineer — Globex',
    createdAt: new Date('2026-08-02T00:00:00Z'),
    experienceIds: ['star-2'],
    format: 'docx',
    fileSize: 98_000,
  },
];

function renderList(items: ResumeExport[] = exports) {
  const onCreateNew = vi.fn();
  const { container } = render(
    <ResumeExportList
      exports={items}
      onPreview={vi.fn()}
      onDownload={vi.fn()}
      onDelete={vi.fn()}
      onCreateNew={onCreateNew}
    />
  );
  return { onCreateNew, container };
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

/**
 * WIC-1707 — the shape the API actually returns.
 *
 * `resume_exports` stores no file size and no experience ids, so every row built by
 * `transformAPIResumeExport` leaves both undefined. The fixtures above set them, so
 * without this block the optional-chip branch would be the one shape the suite never
 * renders — and the production shape would be untested.
 *
 * Both absent-value failures are silent rather than throwing, which is why these
 * assert on the rendered text: `formatFileSize(undefined)` renders "NaN MB", and
 * defaulting to `0`/`[]` renders a confident, wrong "0 B" / "0 experiences".
 */
describe('ResumeExportList with no size or experience metadata', () => {
  const apiShaped: ResumeExport[] = [
    {
      id: 'exp-3',
      resumeId: 'resume-3',
      name: 'resume-3-star.md',
      createdAt: new Date('2026-08-03T00:00:00Z'),
      format: 'markdown',
    },
  ];

  it('still renders the export row and its format', () => {
    renderList(apiShaped);

    expect(screen.getByRole('heading', { name: 'resume-3-star.md' })).toBeInTheDocument();
    expect(screen.getByText('markdown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Preview/ })).toBeInTheDocument();
  });

  it('renders no file-size and no experience-count chip', () => {
    const { container } = renderList(apiShaped);
    const text = container.textContent ?? '';

    expect(text).not.toMatch(/NaN/);
    expect(text).not.toMatch(/\bB\b|KB|MB/);
    expect(text).not.toMatch(/experiences/);
  });
});
