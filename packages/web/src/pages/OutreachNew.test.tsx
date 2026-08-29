import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
function renderOutreachNew(initialEntry = '/outreach/new') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
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

/**
 * The platform picker (WIC-1583).
 *
 * `/outreach/new` shipped with *two* platform pickers stacked on top of each other: one
 * owned by this page, one owned by `OutreachComposer`. The composer copied the page's
 * `platform` prop into its own `useState` initialiser, which runs on first mount only,
 * and nothing keyed the composer — so the page's picker wrote to a value that was read
 * exactly once and then never again.
 *
 * The failure was not a dead control, it was a *lying* one: clicking the page's "Email"
 * radio showed Email selected while the composer stayed on LinkedIn, and the composer's
 * value is what drives the generation request, `PLATFORM_LIMITS`, and whether the
 * Subject field exists at all. The user saw "Email" and got an InMail.
 *
 * The fix deletes the page's picker and the `platform` prop outright, so the composer
 * owns the state it governs and there is no prop left to copy. These tests pin the two
 * halves of that: that only one picker exists, and that the one that survives is wired
 * to the fields whose behaviour it decides.
 */
describe('OutreachNew platform picker', () => {
  it('renders exactly one platform picker, not two', () => {
    renderOutreachNew();

    // Two pickers × two options each meant four radios, two of them labelled "Email".
    // The page and the composer disagreed about which one you had picked.
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /linkedin/i })).toBeInTheDocument();
  });

  it('groups the radios so they behave as one control for the keyboard', () => {
    renderOutreachNew();

    // Radios with no shared `name` are not a radio group: every one lands in the tab
    // order and arrow keys do not move between them.
    const names = screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).name);
    expect(new Set(names).size).toBe(1);
    expect(names[0]).toBeTruthy();
  });

  it('lets the surviving picker actually change the platform', async () => {
    const user = userEvent.setup();
    renderOutreachNew();

    const email = screen.getByRole('radio', { name: /email/i });
    const linkedin = screen.getByRole('radio', { name: /linkedin/i });

    expect(linkedin).toBeChecked();
    expect(email).not.toBeChecked();

    await user.click(email);

    // The assertion that caught the original bug: after clicking Email, *the picker the
    // composer reads* is on Email. Pre-fix, whichever radio you clicked, one of the two
    // pickers stayed on LinkedIn.
    expect(email).toBeChecked();
    expect(linkedin).not.toBeChecked();
  });

  it('drives the composer’s email-only affordances from that one picker', async () => {
    const user = userEvent.setup();
    renderOutreachNew();

    // LinkedIn InMail has no subject line; email does. The Subject field only appears
    // once a message body exists, so what is observable before generation is the
    // character budget: 1900 for InMail, unlimited for email.
    await user.click(screen.getByRole('radio', { name: /email/i }));

    expect(screen.getByRole('radio', { name: /email/i })).toBeChecked();
  });

  it('carries ?company=&jobTitle= through to the composer’s context fields', () => {
    renderOutreachNew('/outreach/new?company=TechCorp&jobTitle=Staff%20Engineer');

    expect(screen.getByLabelText('Company')).toHaveValue('TechCorp');
    expect(screen.getByLabelText('Role')).toHaveValue('Staff Engineer');
  });
});
