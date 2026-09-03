import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useDocumentTitle } from './useDocumentTitle';

function Titled({ page }: { page: string | undefined }) {
  useDocumentTitle(page);
  return null;
}

describe('useDocumentTitle', () => {
  beforeEach(() => {
    document.title = 'Careerpin';
  });

  afterEach(() => {
    document.title = '';
  });

  it('sets the formatted title while mounted', () => {
    render(<Titled page="Dashboard" />);
    expect(document.title).toBe('Dashboard — Careerpin');
  });

  it('restores the previous title on unmount (AC3)', () => {
    // The stale-title defect: without this, a route that unmounts during a transition
    // leaves its own name up over whatever renders next.
    const { unmount } = render(<Titled page="Reports" />);
    expect(document.title).toBe('Reports — Careerpin');

    unmount();
    expect(document.title).toBe('Careerpin');
  });

  it('swaps cleanly when the title changes in place, without leaking the fallback', () => {
    // The dynamic-route sequence: a detail page renders `Application` while its record
    // loads, then the real job title. The restore must not reinstate the fallback, and
    // unmounting after the swap must still land on the title from before the route.
    const { rerender, unmount } = render(<Titled page="Application" />);
    expect(document.title).toBe('Application — Careerpin');

    rerender(<Titled page="Staff Engineer" />);
    expect(document.title).toBe('Staff Engineer — Careerpin');

    unmount();
    expect(document.title).toBe('Careerpin');
  });

  it('leaves the title alone when passed undefined', () => {
    // How the shell declines to title a route that sets its own. If this wrote anything,
    // every hook-titled route would flash the shell's answer first.
    render(<Titled page={undefined} />);
    expect(document.title).toBe('Careerpin');
  });

  it('survives StrictMode double invocation (AC: write in an effect, not in render)', () => {
    // StrictMode mounts, unmounts and remounts every effect in development. A render-phase
    // `document.title =` assignment passes the plain-render tests above and lands on the
    // *restored* title here, because the extra cleanup runs after the render body has
    // already fired. That is the whole reason the convention specifies an effect.
    render(
      <StrictMode>
        <Titled page="Settings" />
      </StrictMode>
    );
    expect(document.title).toBe('Settings — Careerpin');
  });

  it('nests: an inner title wins and unwinds to the outer one', () => {
    // Not a shape the router produces today, but it pins the restore semantics as a
    // stack rather than a single remembered value — which is what makes the shell effect
    // and a page effect safe to coexist in one commit.
    const { unmount } = render(<Titled page="Projects" />);
    const inner = render(<Titled page="Acme Rebrand" />);
    expect(document.title).toBe('Acme Rebrand — Careerpin');

    inner.unmount();
    expect(document.title).toBe('Projects — Careerpin');

    unmount();
    expect(document.title).toBe('Careerpin');
  });
});
