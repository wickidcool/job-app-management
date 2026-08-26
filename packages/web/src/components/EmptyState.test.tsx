import { hideOthers } from 'aria-hidden';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState';

/**
 * Regression cover for WIC-1155.
 *
 * `EmptyState` used to carry `aria-live="polite"` on the container that wraps its
 * action button. The `aria-hidden` package — the same one Radix Dialog uses to hide
 * the background behind a modal — deliberately exempts `[aria-live]` elements, and
 * exempting a node keeps that node, all of its descendants **and its entire ancestor
 * chain** reachable to the screen-reader virtual cursor. The result was a live,
 * actionable control sitting behind every open dialog.
 *
 * These tests drive the real `aria-hidden` package against a DOM that mirrors the
 * `/projects` tree, rather than asserting on the attribute in isolation — the whole
 * point is the interaction between the attribute and the hiding library, so asserting
 * `not.toHaveAttribute('aria-live')` would pass even if the exemption rule changed.
 */

/** Mirrors the app shell: #root > main > (page content), plus a sibling dialog. */
function renderInAppShell() {
  const root = document.createElement('div');
  root.id = 'root';

  const header = document.createElement('header');
  header.textContent = 'App header';
  root.appendChild(header);

  const main = document.createElement('main');
  root.appendChild(main);

  document.body.appendChild(root);

  // Radix renders the dialog in a portal — a body-level sibling of #root, not inside it.
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const dialogBtn = document.createElement('button');
  dialogBtn.textContent = 'Create';
  dialog.appendChild(dialogBtn);
  document.body.appendChild(dialog);

  return { root, header, main, dialog };
}

/**
 * True when `el` is reachable to the screen-reader virtual cursor — i.e. neither it nor
 * any ancestor is `aria-hidden="true"`. This is what `hideOthers` is meant to guarantee
 * is false for everything outside the dialog.
 */
function isReachable(el: Element | null): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.getAttribute('aria-hidden') === 'true') return false;
  }
  return el !== null;
}

describe('EmptyState — background hiding behind an open modal (WIC-1155)', () => {
  it('lets the background be hidden, including its own action button', () => {
    const { root, main, dialog } = renderInAppShell();
    render(<EmptyState variant="no-documents" onAction={() => {}} />, { container: main });

    const cta = screen.getByRole('button', { name: 'Create Cover Letter' });
    expect(isReachable(cta)).toBe(true);

    // What Radix Dialog does on open.
    const undo = hideOthers(dialog);

    try {
      // The regression: with `aria-live` present, the exemption walked up from the empty
      // state and left #root — and therefore the whole page — unhidden.
      expect(root).toHaveAttribute('aria-hidden', 'true');
      expect(isReachable(cta)).toBe(false);

      // The dialog itself must stay reachable, or we have merely broken the modal.
      expect(isReachable(dialog.querySelector('button'))).toBe(true);
    } finally {
      undo();
    }
  });

  it('is not exempted from hiding for any variant', () => {
    // The exemption was a property of the shared container, so it applied to every
    // variant — including the two that have no call sites yet and would otherwise
    // reintroduce the bug the first time they are used.
    for (const variant of ['no-applications', 'no-results', 'no-documents'] as const) {
      const { root, main, dialog } = renderInAppShell();
      render(<EmptyState variant={variant} onAction={() => {}} />, { container: main });

      const undo = hideOthers(dialog);
      try {
        expect(root, `variant "${variant}" escaped background hiding`).toHaveAttribute(
          'aria-hidden',
          'true'
        );
      } finally {
        undo();
        document.body.innerHTML = '';
      }
    }
  });
});

describe('EmptyState — accessible structure (WIC-1155 design verdict)', () => {
  it('exposes no landmark, leaving the heading as the entry point', () => {
    render(<EmptyState variant="no-documents" onAction={() => {}} />);

    // The container used to be role="region" aria-label="Empty state": a landmark named
    // after the component, wrapping the only content inside <main>. The heading is what
    // users actually navigate by, and it describes the content.
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByLabelText('Empty state')).toBeNull();
    expect(screen.getByRole('heading', { name: 'No documents found' })).toBeInTheDocument();
  });

  it('hides the decorative icon from assistive tech', () => {
    const { container } = render(<EmptyState variant="no-documents" />);

    // The heading and message already say everything the emoji does.
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('📄');
  });

  it('does not steal focus when it appears', () => {
    // An empty state renders as the *result* of a user action (a filter edit, a delete).
    // Focusing its button on appearance would yank focus out of the control still in use.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    render(<EmptyState variant="no-results" onAction={() => {}} />);

    expect(document.activeElement).toBe(input);
  });
});
