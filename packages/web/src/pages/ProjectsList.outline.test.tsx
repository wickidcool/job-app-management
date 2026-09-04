import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { projectService, type Project } from '../services/api';
import { describeOutline, findOutlineSkips, getOutline } from '../test/headingOutline';
import { ProjectsList } from './ProjectsList';

/**
 * Rendered heading outline for `/projects`, on **both** render branches (WIC-1827).
 *
 * The reason this file asserts each branch separately, rather than once on whichever
 * branch is cheapest to render, is the exact shape of the defect it was written for.
 * `EmptyState` gained a `headingLevel` prop defaulting to `2` under WIC-1417, which
 * fixed the *empty* branch of this page — so from 2026-08-26 the page rendered a clean
 * `h1 -> h2` with no fixture data at all, while the **populated** branch still went
 * `h1 "Projects" -> h3 "{project.name}"` and skipped level 2 (WCAG SC 1.3.1).
 *
 * That asymmetry is why the skip outlived WIC-1483, which was closed `done` with this
 * page still defective: the visible half of the fix looked like the whole fix. A check
 * that renders one branch — realistically the empty one, since it needs no fixture —
 * reports this page clean while a screen-reader user on the real page cannot navigate
 * it. So "both branches" is the load-bearing part of these tests, not boilerplate.
 *
 * Sibling coverage: `ResumeManager.outline.test.tsx`, `ProjectDetail.outline.test.tsx`.
 * Route-wide enforcement across every branch is WIC-1675.
 */

function project(overrides: Partial<Project> & Pick<Project, 'id' | 'name'>): Project {
  return {
    slug: overrides.name.toLowerCase().replace(/\s+/g, '-'),
    description: null,
    fileCount: 0,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-30T00:00:00Z'),
    version: 1,
    ...overrides,
  };
}

function renderProjectsList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects']}>
        <ProjectsList />
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

/**
 * Each test spies on the real service rather than declaring a `vi.mock` factory that
 * lists the two methods this page happens to call today. A hand-enumerated factory is
 * an allowlist: it keeps passing when the page starts calling a third method, because
 * the mock silently supplies `undefined` instead of failing. `restoreMocks: true` in
 * `vitest.config.ts` undoes each spy between tests.
 */
describe('ProjectsList heading outline', () => {
  it('has no level skip on the EMPTY branch', async () => {
    vi.spyOn(projectService, 'listProjects').mockResolvedValue([]);

    const { container } = renderProjectsList();
    await screen.findByRole('heading', { name: 'No documents found' }, OUTLINE_QUERY_TIMEOUT);

    const outline = getOutline(container);
    expect(findOutlineSkips(outline), describeOutline(outline)).toEqual([]);
    // Pinned as an exact sequence, not `skips === []`. An empty skip list is also what
    // a page with *no* headings returns, so on its own it would go green if the `<h1>`
    // or the empty-state heading were deleted outright.
    expect(outline).toEqual([
      { level: 1, text: 'Projects' },
      { level: 2, text: 'No documents found' },
    ]);
  });

  it('has no level skip on the POPULATED branch', async () => {
    vi.spyOn(projectService, 'listProjects').mockResolvedValue([
      project({ id: '1', name: 'Acme Corp' }),
      project({ id: '2', name: 'Globex' }),
    ]);

    const { container } = renderProjectsList();
    await screen.findByRole('heading', { name: 'Acme Corp' }, OUTLINE_QUERY_TIMEOUT);

    const outline = getOutline(container);
    expect(findOutlineSkips(outline), describeOutline(outline)).toEqual([]);
    // Two rows, so this also pins that every row title is a sibling section of the
    // page heading — one row promoted and the other left behind would not survive it.
    expect(outline).toEqual([
      { level: 1, text: 'Projects' },
      { level: 2, text: 'Acme Corp' },
      { level: 2, text: 'Globex' },
    ]);
  });
});
