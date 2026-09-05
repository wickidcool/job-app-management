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
 * Mutation-checked against three mutants, each run after COMMITTING the fix — `git checkout`
 * on an uncommitted tree wipes the fix along with the mutant and grades a reverted file
 * (WIC-2076). Each mutant's anchor was asserted unique before writing, and each run's
 * `passed + failed` equals the 11 of the baseline, so none silently failed to apply or to
 * compile (WIC-2068, WIC-1610).
 *
 *   M1  revert the reveal to `showQuickActions && isHovered`          -> 8 of 11 red
 *   M2  drop the `relatedTarget` containment test in `handleBlur`     -> 1 of 11 red
 *   M3  drop the `e.target !== e.currentTarget` guard in handleKeyDown -> 4 of 11 red
 *
 * M1's 3 survivors are correct to survive: 'stays hidden at rest' pins the axe-preserving
 * half, which the mutant also satisfies; 'still activates the card when Enter is pressed on
 * the card itself' never involves the bar; and the `showQuickActions: false` case asserts an
 * absence the mutant also produces.
 *
 * ⚠️ M2 is the one worth reading, because it caught a false claim in this very comment. An
 * earlier revision asserted that dropping the containment test would red 'reaches Edit by
 * Tab'. It does not — measured, that mutant left all nine then-existing tests GREEN. jsdom
 * processes the `focusout`/`focusin` pair a Tab produces closely enough that React re-renders
 * once with the final state, so the intermediate `false` never unmounts anything. The guard
 * was real but unpinned, and the Tab-driven tests could not pin it in this environment. Hence
 * 'keeps the bar mounted when focus moves from the card to its own Edit button', which
 * asserts the intermediate state directly — it is the sole test M2 reds, and it exists only
 * because the mutant contradicted the prediction rather than confirming it.
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

    // WIC-2079 AC-4, third bullet. The two cases above pin the KEYDOWN guard
    // (`e.target !== e.currentTarget`); the `e.stopPropagation()` calls in `handleEdit` and
    // `handleDelete` are a separate mechanism covering the POINTER path.
    //
    // ⚠️ The two are NOT independent, and measuring that corrected a claim this comment
    // originally made. An earlier revision asserted that deleting either `stopPropagation`
    // left the suite green. That is true of `handleDelete`'s and false of `handleEdit`'s:
    // mutating `handleEdit` reds the two Enter/Space cases above as well as the click case
    // below. The reason is that `user.keyboard('{Enter}')` on a focused button dispatches a
    // synthetic CLICK, which bubbles to the card's `onClick` — so on the keyboard path the
    // keydown guard and `stopPropagation` each block a different one of two routes to the
    // same wrong outcome, and the keydown tests were unknowingly covering both.
    //
    // `handleDelete`'s was genuinely unpinned: mutating it reds only tests added by WIC-2079.
    // That asymmetry is the reason to keep BOTH cases below rather than just the Edit one.
    //
    // Pinned here rather than at the page level because this is the only place the two
    // handlers are distinguishable. In production `onEdit` and `onCardClick` navigate to the
    // same route (the AC-3 decision, recorded in `ApplicationsList.tsx`), so a leaked
    // propagation navigates twice to one destination and looks identical to working. Separable
    // spies are what make the leak observable at all.
    // The bar is revealed by FOCUS here, not by `user.hover`, and then clicked. Both halves
    // are deliberate. `user.hover` on the card followed by `user.click` on a button inside it
    // does not work in this environment — the reveal happens, but the synthesised pointer
    // sequence leaves the handler unfired and both spies at zero, which would read as a
    // passing "card did not activate" for entirely the wrong reason. Focus-then-click reaches
    // the same `onClick` path (`handleEdit` / `handleDelete` do not care how the bar appeared)
    // and is the pattern the rest of this file already uses.
    it('does not activate the card when Edit is CLICKED (stopPropagation)', async () => {
      const user = userEvent.setup();
      const onCardClick = vi.fn();
      const onEdit = vi.fn();
      renderCard({ onCardClick, onEdit });

      await user.tab(); // card — reveals the bar
      await user.click(editButton()!);

      expect(onEdit).toHaveBeenCalledExactlyOnceWith(APPLICATION.id);
      expect(onCardClick).not.toHaveBeenCalled();
    });

    it('does not activate the card when Delete is CLICKED (stopPropagation)', async () => {
      const user = userEvent.setup();
      const onCardClick = vi.fn();
      const onDelete = vi.fn();
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderCard({ onCardClick, onDelete });

      await user.tab(); // card — reveals the bar
      await user.click(deleteButton()!);

      expect(onDelete).toHaveBeenCalledExactlyOnceWith(APPLICATION.id);
      expect(onCardClick).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
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
