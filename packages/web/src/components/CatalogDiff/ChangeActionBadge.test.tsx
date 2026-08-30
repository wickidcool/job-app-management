import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChangeActionBadge } from './ChangeActionBadge';
import { elementsWithProhibitedName } from '../../test/prohibitedName';
import type { CatalogChangeAction } from '../../types/catalog';

/**
 * Regression cover for WIC-1185, landed by PR #101 with no test harness available at the
 * time — `packages/web`'s vitest setup arrived afterwards. Backfilled here alongside the
 * WIC-1191 fix so the two halves of the class are pinned together.
 *
 * The badge used to carry `aria-label={`${config.label} action`}` on a role-less `<span>`
 * (ARIA `generic`, name from author prohibited). It was dropped rather than given a
 * naming-capable role, because `role="img"` would turn every row of a diff list into a
 * leaf graphic — hiding the real label text from AT and adding a per-row "graphic"
 * announcement — and `role="status"` would make every badge a live region.
 *
 * The label survives as a real text node, and `ChangeListItem` independently labels the
 * sibling checkbox `Include {action} change for {entity}`, so the dropped `" action"`
 * suffix added nothing that was not already announced.
 */

const ACTIONS: CatalogChangeAction[] = ['create', 'update', 'delete'];
const EXPECTED_LABEL: Record<CatalogChangeAction, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
};

describe('ChangeActionBadge — ARIA prohibited name (WIC-1185)', () => {
  it.each(ACTIONS)('carries no author name on any role-less element (%s)', (action) => {
    const { container } = render(<ChangeActionBadge action={action} />);

    expect(elementsWithProhibitedName(container)).toEqual([]);
  });

  it.each(ACTIONS)('announces the action as a real text node (%s)', (action) => {
    render(<ChangeActionBadge action={action} />);

    expect(screen.getByText(EXPECTED_LABEL[action])).toBeInTheDocument();
  });

  it.each(ACTIONS)('keeps the decorative icon out of the accessible tree (%s)', (action) => {
    const { container } = render(<ChangeActionBadge action={action} />);

    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden).toHaveLength(1);
    expect(hidden[0].textContent?.trim()).not.toBe('');
  });

  it('uppercases the label with CSS rather than baking caps into the DOM', () => {
    // The WIC-1069 Overline ruling: ALL-CAPS is presentation, so it must not reach the
    // accessible name. Guards the text node the aria-label removal now depends on.
    render(<ChangeActionBadge action="create" />);

    const label = screen.getByText('Create');
    expect(label.textContent).toBe('Create');
    expect(label.className).toContain('uppercase');
  });
});
