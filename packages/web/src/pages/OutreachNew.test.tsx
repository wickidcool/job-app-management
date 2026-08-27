import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OutreachNew } from './OutreachNew';

/**
 * The rendered heading outline of `/outreach/new` (WIC-1581).
 *
 * The page shipped with `<h1>Compose Outreach Message</h1>` and, ~200px below it,
 * `OutreachComposer`'s `<h2>Compose Outreach Message</h2>` — the same words twice, at
 * two levels, both above the fold. `docs/design/ROUTE_HEADING_OUTLINE.md` rules that
 * the page owns the route's name and the panel's sections start at `<h2>`.
 *
 * `/outreach/new` had no test cover of any kind before this file, which is the other
 * half of why the duplication survived.
 */
function renderOutreachNew() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/outreach/new']}>
        <OutreachNew />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OutreachNew heading outline', () => {
  it('names the route exactly once, in the page <h1>', () => {
    renderOutreachNew();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Compose Outreach Message');
    // The assertion that would have failed before the fix: the string appears once in
    // the whole outline, not once per heading level.
    expect(
      screen
        .getAllByRole('heading')
        .filter((h) => h.textContent?.trim() === 'Compose Outreach Message')
    ).toHaveLength(1);
  });

  it('starts the composer’s sections at <h2>, so the outline never skips a level', () => {
    renderOutreachNew();

    expect(screen.getByRole('heading', { level: 2, name: 'Context' })).toBeInTheDocument();

    const levels = screen
      .getAllByRole('heading')
      .map((h) => Number(h.tagName[1]))
      .filter((n) => Number.isFinite(n));

    expect(levels[0]).toBe(1);
    // Every level is at most one deeper than the deepest seen so far — the definition
    // of "no skip", and what WIC-1563 is closing elsewhere in this codebase.
    let deepest = levels[0];
    for (const level of levels) {
      expect(level).toBeLessThanOrEqual(deepest + 1);
      deepest = Math.max(deepest, level);
    }
  });

  it('keeps exactly one <h1>', () => {
    renderOutreachNew();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
