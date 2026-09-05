import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApplicationCard } from './ApplicationCard';
import type { Application } from '../types/application';

/**
 * `ApplicationCard`'s quick actions are reachable by keyboard (WIC-2078, AC-2).
 *
 * The bar holding Edit and Delete was gated on `isHovered` alone, so neither button existed
 * in the DOM unless a mouse was over the card. On the kanban board that is the ONLY path to
 * either action, so both were unavailable to a keyboard user outright — WCAG 2.1.1, and a
 * larger gap than the `jsx-a11y` finding that sat beside it on the same element.
 *
 * ⚠️ This defect is invisible to BOTH existing ratchets, which is why it needed its own file
 * and why WIC-2078 was split out rather than folded into the lint burndown:
 *
 *   - `jsxA11yBaseline.test.ts` is a per-file static lint. It cannot see a control that is
 *     absent from the DOM, so no baseline number moves when this is fixed — measured, not
 *     assumed: the suite is green before and after.
 *   - `routeAxe.render.test.tsx` renders at rest, where the bar is still (correctly) absent.
 *     Nothing to audit, so nothing to report.
 *
 * The reveal is deliberately React state rather than a CSS `group-focus-within` variant, and
 * this suite is the reason. jsdom applies no Tailwind, so under a CSS-only reveal the buttons
 * would be queryable whether or not the fix were present and every assertion below would pass
 * against the unfixed component — a test that cannot fail. Conditional rendering also keeps
 * the buttons out of the DOM at rest, which is what keeps `routeAxe` clean: a real `<button>`
 * inside this card nests inside dnd-kit's `div[role="button"]` wrapper on
 * `SortableApplicationCard` and trips `nested-interactive` (the finding that reverted
 * WIC-2077's attempt on this file).
 *
 * Mutation-checked, after committing the fix — `git checkout` on an uncommitted tree wipes the
 * fix along with the mutant and grades a reverted file (WIC-2076). Reverting
 * `showQuickActions && (isHovered || isFocusWithin)` to `showQuickActions && isHovered` reds
 * **3 of the 5** below: 'reveals the quick actions when the card receives focus', 'reaches
 * Edit by Tab' and 'reaches Delete by Tab'. The two that stay green are correct to stay green
 * — 'stays hidden at rest' pins the axe-preserving half, which the mutant also satisfies, and
 * 'hides again once focus leaves' passes vacuously when the bar never appeared. Recorded as
 * measured rather than as the "all 5" a first draft of this comment predicted.
 *
 * The `relatedTarget` containment test in `handleBlur` gets its own mutant: dropping it (so
 * any `blur` collapses the bar) reds 'reaches Edit by Tab', because focus moving card -> Edit
 * fires `blur` on the card and would unmount the very button receiving the focus.
 */

const APPLICATION: Application = {
  id: 'app-1',
  jobTitle: 'Staff Engineer',
  company: 'Northwind',
  status: 'applied',
  hasDocuments: false,
  version: 1,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
};

/** The card as `SortableApplicationCard` mounts it on desktop, where the gap was live. */
function renderCard(overrides: Partial<Parameters<typeof ApplicationCard>[0]> = {}) {
  return render(<ApplicationCard application={APPLICATION} variant="kanban" {...overrides} />);
}

const editButton = () => screen.queryByRole('button', { name: `Edit ${APPLICATION.jobTitle}` });
const deleteButton = () => screen.queryByRole('button', { name: `Delete ${APPLICATION.jobTitle}` });

describe('ApplicationCard quick actions — keyboard reachability (WIC-2078)', () => {
  it('stays hidden at rest, so the card contributes no nested interactive control to axe', () => {
    renderCard();

    expect(editButton()).toBeNull();
    expect(deleteButton()).toBeNull();
  });

  it('reveals the quick actions when the card receives focus', async () => {
    const user = userEvent.setup();
    renderCard();

    // The card is the tab stop; focusing it is what a keyboard user does first.
    await user.tab();
    expect(screen.getByRole('article')).toHaveFocus();

    expect(editButton()).not.toBeNull();
    expect(deleteButton()).not.toBeNull();
  });

  it('reaches Edit by Tab and activates it from the keyboard', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderCard({ onEdit });

    await user.tab(); // card
    await user.tab(); // Edit — only exists because the card is focused

    expect(editButton()).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(APPLICATION.id);
  });

  it('reaches Delete by Tab and activates it from the keyboard', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    // `handleDelete` gates on `confirm`, which jsdom does not implement.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderCard({ onDelete });

    await user.tab(); // card
    await user.tab(); // Edit
    await user.tab(); // Delete

    expect(deleteButton()).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(APPLICATION.id);

    confirmSpy.mockRestore();
  });

  // Pins `handleBlur`'s containment test on its own, because the Tab-driven cases above do
  // NOT — measured: deleting the `relatedTarget` check leaves all of them green. In jsdom the
  // `focusout` and `focusin` that a Tab produces are processed close enough together that
  // React re-renders once with the final state, so the bar never observably unmounts. A real
  // browser dispatches them as separate tasks, where React 18's automatic batching does not
  // apply across the boundary and the intermediate `false` would unmount the button that is
  // about to receive focus.
  //
  // So this asserts the intermediate state directly instead of hoping the environment
  // reproduces the ordering: a `focusout` whose `relatedTarget` is inside the card must not
  // collapse the bar.
  it('keeps the bar mounted when focus moves from the card to its own Edit button', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.tab();
    const edit = editButton();
    expect(edit).not.toBeNull();

    fireEvent.focusOut(screen.getByRole('article'), { relatedTarget: edit });

    expect(editButton()).not.toBeNull();
    expect(deleteButton()).not.toBeNull();
  });

  it('collapses the bar when focusout leads somewhere outside the card', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ApplicationCard application={APPLICATION} variant="kanban" />
        <button type="button">Somewhere else</button>
      </>
    );

    await user.tab();
    expect(editButton()).not.toBeNull();

    fireEvent.focusOut(screen.getByRole('article'), {
      relatedTarget: screen.getByRole('button', { name: 'Somewhere else' }),
    });

    expect(editButton()).toBeNull();
  });

  it('hides the quick actions again once focus leaves the card entirely', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ApplicationCard application={APPLICATION} variant="kanban" />
        <button type="button">Somewhere else</button>
      </>
    );

    await user.tab();
    expect(editButton()).not.toBeNull();

    // Past the card, past Edit, past Delete, onto the sibling button.
    await user.tab();
    await user.tab();
    await user.tab();

    expect(screen.getByRole('button', { name: 'Somewhere else' })).toHaveFocus();
    expect(editButton()).toBeNull();
    expect(deleteButton()).toBeNull();
  });

  // The card's own Enter/Space activation, and the guard that keeps it from eating its
  // children's. `keydown` bubbles, so before WIC-2078 the article's handler ran for events
  // originating on the quick-action buttons too — and it calls `preventDefault()`, which
  // CANCELS the button's activation. Enter on Edit navigated to the application instead of
  // editing it; Space did nothing.
  //
  // This was latent, not pre-existing-and-missed: with the bar mouse-only, no keyboard event
  // could originate below the article at all. Making the buttons reachable is what created
  // the bug, so it belongs to this card and not to the one that shipped the handler.
  describe('the card’s own activation does not swallow its children’s', () => {
    it('still activates the card when Enter is pressed on the card itself', async () => {
      const user = userEvent.setup();
      const onCardClick = vi.fn();
      renderCard({ onCardClick });

      await user.tab();
      await user.keyboard('{Enter}');

      expect(onCardClick).toHaveBeenCalledExactlyOnceWith(APPLICATION.id);
    });

    it('does not activate the card when Enter is pressed on a quick-action button', async () => {
      const user = userEvent.setup();
      const onCardClick = vi.fn();
      const onEdit = vi.fn();
      renderCard({ onCardClick, onEdit });

      await user.tab(); // card
      await user.tab(); // Edit
      await user.keyboard('{Enter}');

      // Exactly one thing happened, and it was the button's job, not the card's.
      expect(onEdit).toHaveBeenCalledExactlyOnceWith(APPLICATION.id);
      expect(onCardClick).not.toHaveBeenCalled();
    });

    it('does not activate the card when Space is pressed on a quick-action button', async () => {
      const user = userEvent.setup();
      const onCardClick = vi.fn();
      const onEdit = vi.fn();
      renderCard({ onCardClick, onEdit });

      await user.tab(); // card
      await user.tab(); // Edit
      await user.keyboard(' ');

      expect(onEdit).toHaveBeenCalledExactlyOnceWith(APPLICATION.id);
      expect(onCardClick).not.toHaveBeenCalled();
    });
  });

  it('renders no quick actions at all when the host disables them (mobile swipe path)', async () => {
    const user = userEvent.setup();
    renderCard({ showQuickActions: false });

    await user.tab();
    expect(screen.getByRole('article')).toHaveFocus();

    // Focus must not conjure a bar the host asked for suppression of — on mobile,
    // `SortableApplicationCard` passes `showQuickActions={false}` and delete lives on the
    // swipe gesture instead.
    expect(editButton()).toBeNull();
    expect(deleteButton()).toBeNull();
  });
});
