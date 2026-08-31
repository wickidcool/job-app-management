import { createPortal } from 'react-dom';

export interface AnnouncerProps {
  /** Text to announce. Empty renders an empty region, which is silent. */
  message: string;
  /**
   * `polite` (default) waits for a pause — correct for every success outcome.
   * `assertive` interrupts, and is only for errors the user must handle now.
   */
  politeness?: 'polite' | 'assertive';
}

/**
 * A screen-reader-only live region, portalled to `<body>` as a sibling of `#root`.
 *
 * ## Why the portal is load-bearing
 *
 * `aria-hidden` — the package Radix Dialog uses to hide the background behind a
 * modal — treats every `[aria-live]` element as something it must not hide, and
 * exempting a node keeps that node, all of its descendants **and its entire
 * ancestor chain** reachable. A live region rendered in place at
 * `#root > … > div[aria-live]` therefore puts `#root` itself on the keep-list,
 * and `#root` silently stops receiving `aria-hidden` when a dialog opens —
 * app-wide, for every dialog, with nothing visibly wrong. Rendered here as a
 * body-level sibling it is exempted on its own account and hides nothing.
 *
 * This is the WIC-1155 defect reached from the other side: there, the exempted
 * region *wrapped* `EmptyState`'s action button and left a live control operable
 * behind every dialog. This region deliberately wraps no element at all, so
 * there is nothing for the exemption to leak.
 *
 * See `ACCESSIBILITY.md` → *Where app-level live regions must be mounted*.
 *
 * ## Usage
 *
 * Mount it unconditionally and change only its text — a region that appears at
 * the same moment as its message may not be announced at all. `useAnnouncer`
 * (`../hooks/useAnnouncer`) holds the text and handles repeat announcements.
 */
export function Announcer({ message, politeness = 'polite' }: AnnouncerProps) {
  return createPortal(
    <div
      // `status` already implies polite and `alert` implies assertive; pairing
      // the matching role with the explicit `aria-live` keeps the two from ever
      // contradicting each other.
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>,
    document.body
  );
}
