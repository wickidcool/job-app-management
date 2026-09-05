import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { STARStoryBank } from './STARStoryBank';
import { tabUntilFocused } from '../test/reportsKeyboardNav';
import type { PrepStory } from '../types/interviewPrep';
import { percent } from '../types/units';

/**
 * The story-bank expand toggle is reachable by keyboard (WIC-2073).
 *
 * The story title was an `<h3 className="cursor-pointer" onClick={…}>` — literally the shape
 * WIC-2062 fixed on the four `Reports*` pages, and `jsx-a11y` recorded it as
 * `click-events-have-key-events` + `no-noninteractive-element-interactions`. A heading is not
 * in the tab order and exposes no action to assistive tech, so the only way to expand a story
 * was to click it with a mouse: WCAG 2.1.1 (Keyboard) and 4.1.2 (Name, Role, Value).
 *
 * The fix is the established one — a real `<button>` INSIDE the existing `<h3>`, never a
 * `role=` on the heading itself. `aria-expanded` is what makes the state readable, and it is
 * asserted in both positions rather than only after expanding: a button that never updates it
 * announces "collapsed" forever, which is a distinct defect from one that cannot be reached.
 *
 * Mutation-checked against restoring the `onClick` to the bare `<h3>` — every test below reds.
 */

function story(overrides: Partial<PrepStory> = {}): PrepStory {
  return {
    id: 'story-1',
    starEntryId: 'Led the migration off the legacy queue',
    themes: ['leadership'],
    relevanceScorePct: percent(88),
    oneMinVersion: 'One minute version.',
    twoMinVersion: 'Two minute version of the story.',
    fiveMinVersion: 'Five minute version.',
    isFavorite: false,
    practiceCount: 0,
    confidenceLevel: 'comfortable',
    displayOrder: 0,
    ...overrides,
  };
}

function renderBank() {
  return render(<STARStoryBank stories={[story()]} onMarkFavorite={vi.fn()} />);
}

const TITLE = 'Led the migration off the legacy queue';

/**
 * Read expansion off the expanded BODY, not off `twoMinVersion`.
 *
 * A collapsed card already previews `twoMinVersion` in a `line-clamp-2` paragraph, so that
 * string is on screen in both states and an assertion on it passes collapsed — a test that
 * cannot fail. With `showTimeVersions` false (the default) the expanded branch renders
 * `fiveMinVersion` instead, which appears in exactly one state.
 */
const EXPANDED_BODY = 'Five minute version.';

describe('STARStoryBank keyboard navigation', () => {
  it('exposes the story title as a button in the accessibility tree', () => {
    renderBank();

    expect(screen.getByRole('button', { name: TITLE })).toBeVisible();
    // Still a heading, not merely a button: the fix must not cost the outline.
    expect(screen.getByRole('heading', { name: TITLE })).toBeVisible();
  });

  it('reaches the toggle by Tab and expands it with Enter', async () => {
    const user = userEvent.setup();
    renderBank();

    const toggle = screen.getByRole('button', { name: TITLE });
    expect(await tabUntilFocused(user, toggle)).toBeGreaterThan(0);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(EXPANDED_BODY)).toBeVisible();
  });

  it('still expands and collapses on click', async () => {
    const user = userEvent.setup();
    renderBank();

    const toggle = screen.getByRole('button', { name: TITLE });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(EXPANDED_BODY)).not.toBeInTheDocument();
  });

  it('does not expand from the inert card body', async () => {
    const user = userEvent.setup();
    renderBank();

    // The theme chip sits inside the card but outside the toggle. Before the fix the
    // wrapper carried no handler either, so this passes on both trees — it is here to stop
    // a future "just put the onClick back on the card" from reading as an improvement.
    await user.click(screen.getByText('leadership'));

    expect(screen.getByRole('button', { name: TITLE })).toHaveAttribute('aria-expanded', 'false');
  });
});
