import type { ReactElement } from 'react';
import { hideOthers } from 'aria-hidden';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Announcer } from './Announcer';
import { useAnnouncer } from '../hooks/useAnnouncer';

/**
 * Cover for WIC-1304 — the shared outcome announcer.
 *
 * The interesting assertions here are not "does it have `aria-live`". They are the
 * three rules that a hand-rolled region keeps getting wrong, each of which has
 * already cost this repo a defect or a test run:
 *
 * 1. it must be portalled out of `#root`, or it silently defeats `#root[aria-hidden]`
 *    behind every dialog, app-wide (the PR #115 / `ResumeManager` failure);
 * 2. it must wrap nothing focusable, or the `aria-hidden` exemption leaks a live
 *    control behind every dialog (WIC-1155, `EmptyState`);
 * 3. re-setting an identical string must still register as an update, or the second
 *    of two identical outcomes is announced as nothing at all.
 *
 * Rules 1 and 2 are tested against the real `aria-hidden` package rather than by
 * asserting on attributes, because the whole point is the interaction between the
 * attribute and the hiding library — an attribute-only assertion would still pass if
 * the exemption rule changed underneath us.
 */

/**
 * Nodes this file appended to `<body>` itself. Removed individually rather than by
 * clearing `body.innerHTML`, which would yank Testing Library's own container out
 * from under its cleanup — the portal then fails to unmount.
 */
const shellNodes: Element[] = [];

afterEach(() => {
  while (shellNodes.length) shellNodes.pop()?.remove();
});

/** Mirrors the app shell: #root holding the page, plus a body-level dialog. */
function renderAppShell() {
  const root = document.createElement('div');
  root.id = 'root';
  const page = document.createElement('main');
  const pageButton = document.createElement('button');
  pageButton.textContent = 'Create Project';
  page.appendChild(pageButton);
  root.appendChild(page);

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');

  document.body.append(root, dialog);
  shellNodes.push(root, dialog);
  return { root, dialog, page, pageButton };
}

/**
 * Renders *into the page element inside `#root`* — the position a page component
 * actually occupies.
 *
 * This is load-bearing, not incidental. Testing Library's default container is a
 * fresh `<div>` appended straight to `<body>`, so a component rendered the default
 * way is already a body-level sibling of `#root` whether it portals or not — and
 * the `#root[aria-hidden]` assertion below then passes even against an announcer
 * with the portal deleted. Verified by doing exactly that. Rendering inside `#root`
 * is what makes the portal the thing under test.
 */
function renderInPage(ui: ReactElement) {
  const shell = renderAppShell();
  render(ui, { container: shell.page });
  return shell;
}

describe('Announcer', () => {
  it('renders the live region as a sibling of #root, not inside it', () => {
    const { root } = renderInPage(<Announcer message="Project Acme Corp created." />);

    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Project Acme Corp created.');
    expect(region.parentElement).toBe(document.body);
    expect(root.contains(region)).toBe(false);
  });

  it('leaves #root hideable behind a dialog', () => {
    // The regression this exists for: `aria-hidden` exempts every `[aria-live]`
    // element *and its entire ancestor chain*. Rendered in place, the region would
    // put `#root` on the keep-list and `#root[aria-hidden]` would silently stop
    // being set — for every dialog in the app, with nothing visibly wrong.
    const { root, dialog } = renderInPage(<Announcer message="Project Acme Corp created." />);

    const undo = hideOthers(dialog);
    try {
      expect(root).toHaveAttribute('aria-hidden', 'true');
    } finally {
      undo();
    }
  });

  it('exposes no focusable element inside the exempted region', () => {
    // WIC-1155 reached from the other side: the exemption keeps the region and all
    // of its descendants reachable behind an open dialog, so anything focusable in
    // there is a focus-trap escape. The region must wrap only text.
    const { dialog } = renderInPage(<Announcer message="Project Acme Corp created." />);

    const region = screen.getByRole('status');
    const undo = hideOthers(dialog);
    try {
      expect(
        region.querySelectorAll('a, button, input, select, textarea, [tabindex]')
      ).toHaveLength(0);
    } finally {
      undo();
    }
  });

  it('is visually hidden but not hidden from assistive tech', () => {
    render(<Announcer message="Project Acme Corp created." />);
    const region = screen.getByRole('status');

    expect(region).toHaveClass('sr-only');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).not.toHaveAttribute('aria-hidden');
  });

  it('pairs an assertive region with role=alert rather than a contradictory status', () => {
    render(<Announcer message="Could not save." politeness="assertive" />);

    const region = screen.getByRole('alert');
    expect(region).toHaveAttribute('aria-live', 'assertive');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('useAnnouncer', () => {
  it('starts empty, so nothing is announced on mount', () => {
    const { result } = renderHook(() => useAnnouncer());
    expect(result.current.message).toBe('');
  });

  it('changes the rendered text when the same outcome happens twice', () => {
    // Two projects can legitimately be given the same name, and assistive tech
    // announces *changes* — re-setting an identical string is silent. The second
    // create must still produce a different DOM string.
    const { result } = renderHook(() => useAnnouncer());

    act(() => result.current.announce('Project Acme created.'));
    const first = result.current.message;

    act(() => result.current.announce('Project Acme created.'));
    const second = result.current.message;

    expect(second).not.toBe(first);
    // ...while remaining the same announcement as far as a listener is concerned.
    expect(second.replace(/\u200B/g, '')).toBe('Project Acme created.');
  });

  it('alternates rather than accumulating markers across repeats', () => {
    const { result } = renderHook(() => useAnnouncer());

    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      act(() => result.current.announce('Project Acme created.'));
      seen.push(result.current.message);
    }

    // Every announcement differs from the one before it...
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).not.toBe(seen[i - 1]);
    }
    // ...and the text never grows without bound.
    expect(new Set(seen).size).toBe(2);
    expect(seen.every((m) => m.replace(/\u200B/g, '') === 'Project Acme created.')).toBe(true);
  });

  it('does not carry a marker into a genuinely different message', () => {
    const { result } = renderHook(() => useAnnouncer());

    act(() => result.current.announce('Project Acme created.'));
    act(() => result.current.announce('Project Acme created.'));
    act(() => result.current.announce('Project Globex created.'));

    expect(result.current.message).toBe('Project Globex created.');
  });

  it('clears to empty, which is silent', () => {
    const { result } = renderHook(() => useAnnouncer());

    act(() => result.current.announce('Project Acme created.'));
    act(() => result.current.clear());

    expect(result.current.message).toBe('');
  });
});
