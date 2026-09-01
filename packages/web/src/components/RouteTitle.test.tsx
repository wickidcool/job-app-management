import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RouteTitle } from './RouteTitle';
import { NOT_FOUND_COPY } from '../pages/NotFound.copy';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** A stand-in for a page that titles itself, as the six hook-titled routes do. */
function SelfTitledPage({ title }: { title: string }) {
  useDocumentTitle(title);
  return <h1>{title}</h1>;
}

/**
 * The shell, reduced to the parts that matter: `RouteTitle` beside a `<Routes>`, exactly
 * as `App.tsx` mounts it. Page bodies are stubs — this is a test of the titling
 * mechanism, not of the pages.
 */
function Shell({ initialPath }: { initialPath: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <RouteTitle />
      <Routes>
        <Route path="/" element={<h1>Dashboard</h1>} />
        <Route path="/applications" element={<h1>Applications</h1>} />
        <Route path="/applications/:id" element={<SelfTitledPage title="Staff Engineer" />} />
        <Route path="*" element={<h1>{NOT_FOUND_COPY.heading}</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RouteTitle', () => {
  beforeEach(() => {
    document.title = 'Careerpin';
  });

  afterEach(() => {
    document.title = '';
  });

  it('titles a table-driven route from STATIC_ROUTE_TITLES (AC1)', () => {
    render(<Shell initialPath="/" />);
    expect(document.title).toBe('Dashboard — Careerpin');
  });

  it('leaves a hook-titled route to its own page, and does not overwrite it (AC4)', () => {
    // The ordering claim in RouteTitle's doc comment. Both effects run in the same commit;
    // if the shell wrote here it would either win or race, and `/applications/123` would
    // be titled by the catch-all instead of by the record it is showing.
    render(<Shell initialPath="/applications/123" />);
    expect(document.title).toBe('Staff Engineer — Careerpin');
  });

  it('does not let the catch-all outrank a dynamic route', () => {
    // The concrete failure the MATCHABLE_ROUTES comment describes. If `*` won here the
    // title would be the 404 heading on a page that loaded perfectly.
    render(<Shell initialPath="/applications/123" />);
    expect(document.title).not.toContain(NOT_FOUND_COPY.heading);
  });

  it('titles the 404 with the heading the page actually renders (AC5)', () => {
    // The guarantee the convention is for: title and <h1> name the same screen. Asserted
    // against the rendered DOM rather than against the constant, so a title that drifts
    // from the heading fails even if both sides were edited to agree with each other.
    render(<Shell initialPath="/no-such-page" />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(document.title).toBe(`${heading.textContent} — Careerpin`);
  });

  it('applies the new title on navigation and leaves nothing stale behind (AC3)', () => {
    const { unmount } = render(<Shell initialPath="/applications" />);
    expect(document.title).toBe('Applications — Careerpin');

    unmount();
    expect(document.title).toBe('Careerpin');
  });

  it('renders nothing into the DOM', () => {
    // It sits inside the shell's layout div; anything it emitted would land between the
    // navigation and <main>.
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <RouteTitle />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
