import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StarEntryPicker } from './StarEntryPicker';
import { tabUntilFocused } from '../test/reportsKeyboardNav';
import type { CatalogEntry } from '../services/api/types';

/**
 * `StarEntryCard` selection is reachable by keyboard, and fires once (WIC-2073).
 *
 * The card wrapper was a `<div onClick={onToggle} className="cursor-pointer">` —
 * `click-events-have-key-events` + `no-static-element-interactions`. Unlike the other three
 * sites in that card there was nothing to ADD: the card already contained a real checkbox
 * wired to the same `onToggle`. So the wrapper simply went inert and the checkbox became the
 * control, named with `aria-label={entry.title}` (it had no accessible name at all before).
 *
 * That makes the checkbox's `onClick={(e) => e.stopPropagation()}` dead code, and deleting it
 * is the one part of this change that could regress behaviour that used to work — the same
 * call, deleted for the same reason, as in the `Reports*` fix. With the wrapper handler gone
 * there is nothing to stop propagating to; with it restored, a checkbox click would toggle
 * twice and cancel out. That is what 'fires exactly once' pins, and it is written against a
 * STATEFUL host on purpose: with `selectedIds` pinned by a static prop, a double toggle
 * computes the same value twice and the defect is invisible.
 *
 * Mutation-checked against restoring `onClick={onToggle}` to the wrapper: **3 of the 4 tests
 * below red** — 'fires exactly once', 'reaches the checkbox by Tab' (Space on the checkbox
 * dispatches a click that bubbles to the wrapper too, so the keyboard path double-fires
 * exactly as the pointer path does) and 'does not toggle from the inert card body'. Only
 * 'exposes each entry as a named checkbox' stays green, which is correct — the mutant does
 * not touch the accessible name. Recorded as measured rather than as the single red an
 * earlier draft of this comment predicted.
 */

const ENTRY: CatalogEntry = {
  id: 'entry-1',
  title: 'Rebuilt the CI pipeline',
  situation: 'Team was missing its release train',
  task: 'Get the release cadence back to weekly',
  action: 'Rebuilt the CI pipeline',
  result: 'Cut build time from 40 minutes to 6',
  tags: ['delivery'],
};

/** A host that APPLIES the selection, so a double-fire cancels out visibly. */
function StatefulPicker({ onChange }: { onChange: (ids: string[]) => void }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  return (
    <StarEntryPicker
      entries={[ENTRY]}
      selectedIds={selectedIds}
      onSelectionChange={(ids) => {
        onChange(ids);
        setSelectedIds(ids);
      }}
    />
  );
}

describe('StarEntryPicker keyboard navigation', () => {
  it('exposes each entry as a named checkbox in the accessibility tree', () => {
    render(<StarEntryPicker entries={[ENTRY]} selectedIds={[]} onSelectionChange={vi.fn()} />);

    // The name matters as much as the role: the checkbox rendered anonymously before, so a
    // screen-reader user heard "checkbox, unchecked" with nothing to say which entry it was.
    expect(screen.getByRole('checkbox', { name: ENTRY.title })).toBeVisible();
  });

  it('reaches the checkbox by Tab and selects it with Space', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatefulPicker onChange={onChange} />);

    const box = screen.getByRole('checkbox', { name: ENTRY.title });
    expect(await tabUntilFocused(user, box)).toBeGreaterThan(0);

    await user.keyboard(' ');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([ENTRY.id]);
    expect(box).toBeChecked();
  });

  it('fires exactly once on click, so the selection actually flips', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatefulPicker onChange={onChange} />);

    const box = screen.getByRole('checkbox', { name: ENTRY.title });
    await user.click(box);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(box).toBeChecked();
  });

  it('does not toggle from the inert card body', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatefulPicker onChange={onChange} />);

    // The deliberate behaviour change, pinned rather than left implicit: clicking the card
    // body no longer selects. That affordance was mouse-only and keyboard-unreachable, so it
    // was never part of the accessible contract — but it IS a change for pointer users, and a
    // silent revert to the wrapper handler should fail here rather than look like a feature.
    await user.click(screen.getByText(ENTRY.title));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: ENTRY.title })).not.toBeChecked();
  });
});
