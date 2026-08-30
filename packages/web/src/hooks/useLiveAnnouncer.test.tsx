import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLiveAnnouncer, type Politeness } from './useLiveAnnouncer';

/**
 * Unit cover for the shared announcer (WIC-1304).
 *
 * The E2E half lives in `e2e/modal-focus-projects.spec.ts`, which drives the real
 * `ProjectsList` create path. These are the assertions that do not need a browser:
 * where the region is mounted, what it is mounted as, and that a repeated message
 * still mutates the text node.
 */

function Harness({ politeness }: { politeness?: Politeness }) {
  const { announce, announcer } = useLiveAnnouncer(politeness);
  const [n, setN] = useState(0);

  return (
    <div id="root">
      {announcer}
      <button onClick={() => announce('Project "Acme Corp" created.')}>announce</button>
      <button onClick={() => announce(`unique ${n}`)}>announce unique</button>
      <button onClick={() => setN((v) => v + 1)}>rerender</button>
    </div>
  );
}

describe('useLiveAnnouncer', () => {
  it('mounts the region outside #root, so it cannot defeat #root background hiding', () => {
    const { container } = render(<Harness />);

    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();

    // The rule from MODAL_FOCUS_MANAGEMENT_SPEC.md §6: `aria-hidden` exempts every
    // [aria-live] node *and its whole ancestor chain*, so a region rendered inside
    // #root would stop #root ever receiving aria-hidden behind a dialog.
    const root = container.querySelector('#root');
    expect(root).not.toBeNull();
    expect(root!.contains(region)).toBe(false);
    expect(region.parentElement).toBe(document.body);
    expect(document.querySelectorAll('#root [aria-live]')).toHaveLength(0);
  });

  it('is mounted and empty before anything is announced', () => {
    render(<Harness />);

    // A region that appears at the same moment as its first message may not be
    // announced at all, so it has to already be there — and be silent.
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveTextContent('');
  });

  it('announces the outcome text', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'announce' }));

    expect(screen.getByRole('status')).toHaveTextContent('Project "Acme Corp" created.');
  });

  it('re-announces an identical message by emptying the region first', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const region = screen.getByRole('status');

    await user.click(screen.getByRole('button', { name: 'announce' }));
    expect(region).toHaveTextContent('Project "Acme Corp" created.');

    // Assigning the same string is a no-op for React (`Object.is`), so without the
    // clear-then-write the text node would never mutate and a screen reader would
    // stay silent on the second create. The end state is identical either way, so
    // the assertion has to be on the mutations — and on the records rather than on
    // `textContent` read inside the callback, which batches and would only ever
    // show the settled value.
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((rs) => records.push(...rs));
    observer.observe(region, { childList: true, characterData: true, subtree: true });

    await user.click(screen.getByRole('button', { name: 'announce' }));
    observer.disconnect();

    // Emptying the region drops the text node; writing the message adds a new one.
    const removed = records.flatMap((r) => [...r.removedNodes].map((n) => n.textContent));
    const added = records.flatMap((r) => [...r.addedNodes].map((n) => n.textContent));
    expect(removed).toEqual(['Project "Acme Corp" created.']);
    expect(added).toEqual(['Project "Acme Corp" created.']);
    expect(region).toHaveTextContent('Project "Acme Corp" created.');
  });

  it('survives an unrelated re-render without re-announcing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const region = screen.getByRole('status');

    await user.click(screen.getByRole('button', { name: 'announce' }));

    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(region.textContent ?? ''));
    observer.observe(region, { childList: true, characterData: true, subtree: true });

    await user.click(screen.getByRole('button', { name: 'rerender' }));
    observer.disconnect();

    // A parent re-render is not an announcement. If the two-commit write re-ran on
    // every render the region would clear and rewrite here, and assistive tech
    // would repeat the last outcome at unpredictable moments.
    expect(seen).toEqual([]);
    expect(region).toHaveTextContent('Project "Acme Corp" created.');
  });

  it('pairs assertive with role="alert" rather than a contradictory role="status"', () => {
    render(<Harness politeness="assertive" />);

    const region = screen.getByRole('alert');
    expect(region).toHaveAttribute('aria-live', 'assertive');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('unmounts the region with its owner, leaving nothing behind on <body>', () => {
    render(<Harness />);
    expect(document.body.querySelectorAll('[aria-live]')).toHaveLength(1);

    cleanup();
    expect(document.body.querySelectorAll('[aria-live]')).toHaveLength(0);
  });
});
