import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApplicationNew } from './ApplicationNew';
import { ApplicationForm } from '../components/ApplicationForm';

/**
 * `/applications/new` had no heading of any level — not an h1, not an h2 (WIC-1099 §1).
 * The route paints `ApplicationForm` as a dialog opened unconditionally, and neither file
 * emitted a top-level heading, so heading navigation on this screen had nothing to land on.
 *
 * The interesting part is why the obvious fix does not work, which is what the first test
 * below exists to pin. `ROUTE_HEADING_OUTLINE.md` §5.1 says the *page* owns the h1 and the
 * component starts at h2, and the ticket suggests exactly that: put `<h1>New application</h1>`
 * in `ApplicationNew.tsx`. But `ApplicationForm` is a Radix modal, and a Radix modal marks
 * every node outside its portal `aria-hidden="true"`. On this route the dialog is never
 * closed, so a page-level h1 would sit permanently inside that hidden subtree: present in
 * the DOM, absent from the accessibility tree, and invisible to the screen readers the
 * heading exists for. §5.1 assumes a page whose body a user can reach; this route has none.
 *
 * So the dialog's own title is this route's h1, via `ApplicationForm`'s `titleLevel`.
 *
 * Every assertion here goes through `getByRole`, never `querySelector`. That is the whole
 * design of the file: Testing Library's role queries read the accessibility tree and skip
 * `aria-hidden` subtrees, so they can tell the two arrangements apart. A `querySelector('h1')`
 * check cannot — it passes on the broken arrangement, which is how a heading that no screen
 * reader can reach ships with a green test.
 */
function renderApplicationNew(ui = <ApplicationNew />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/applications/new']}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('/applications/new heading outline (WIC-1099 §1)', () => {
  it('exposes exactly one h1, and it names the route', () => {
    renderApplicationNew();

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(/^New application$/);
  });

  it('opens the outline at level 1 and never skips a level below it', () => {
    renderApplicationNew();

    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName[1]));

    expect(levels[0]).toBe(1);
    let deepest = levels[0];
    for (const level of levels) {
      expect(level).toBeLessThanOrEqual(deepest + 1);
      deepest = Math.max(deepest, level);
    }
  });

  it('would not have been fixed by an h1 on the page behind the dialog', () => {
    // The negative control, and the reason `titleLevel` exists rather than a heading in
    // `ApplicationNew.tsx`. This is the ticket's literal suggestion, rendered: a page h1
    // beside the always-open modal. It is in the DOM…
    const { baseElement } = renderApplicationNew(
      <div>
        <h1>New application</h1>
        <ApplicationForm
          open={true}
          onOpenChange={() => {}}
          onSubmit={async () => {}}
          mode="create"
        />
      </div>
    );

    expect(baseElement.querySelectorAll('h1')).toHaveLength(1);

    // …and absent from the accessibility tree, because the modal hides everything outside
    // its portal. If this ever starts finding the heading — Radix changing its background
    // hiding, or the dialog ceasing to be modal — then §5.1's page-owns-the-h1 rule becomes
    // available on this route and `titleLevel` can be reconsidered.
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});

describe('ApplicationForm titleLevel (WIC-1099 §1)', () => {
  it('defaults to h2, so a dialog over a page does not compete with that page’s h1', () => {
    // `ApplicationDetail` mounts this form over a page that owns the route's h1
    // (`ApplicationDetail.tsx:113`). Taking the default is what keeps that outline right,
    // so the default is asserted rather than assumed.
    renderApplicationNew(
      <ApplicationForm open={true} onOpenChange={() => {}} onSubmit={async () => {}} mode="edit" />
    );

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Edit application$/);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('is asked for h1 by ApplicationNew and left at the default by ApplicationDetail', async () => {
    // `COMPONENT_SPECS.md` §10 earns a heading-level prop on "more than one nesting depth",
    // and §10 audits retire props whose call sites all pass the same value. Both call sites
    // are read from source here, because a render test of one page cannot see the other, and
    // a prop with two live depths in the tree is the thing that justifies this one existing.
    const [newPage, detailPage] = await Promise.all([
      import('./ApplicationNew.tsx?raw').then((m) => m.default as string),
      import('./ApplicationDetail.tsx?raw').then((m) => m.default as string),
    ]);

    const callSite = (src: string) => {
      const m = src.match(/<ApplicationForm\b[\s\S]*?\/>/);
      if (!m) throw new Error('no <ApplicationForm> call site found — did the mount move?');
      return m[0];
    };

    expect(callSite(newPage)).toMatch(/titleLevel=\{1\}/);
    expect(callSite(detailPage)).not.toMatch(/titleLevel=/);
  });
});
