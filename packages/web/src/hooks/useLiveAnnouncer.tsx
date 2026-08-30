import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type Politeness = 'polite' | 'assertive';

/**
 * A screen-reader announcer for page-level outcomes, portalled to `<body>`.
 *
 * Use it when an action's outcome is only visible on screen — a create that
 * empties an empty state, a delete that removes a row, a focus move to a control
 * the user did not press. `MODAL_FOCUS_MANAGEMENT_SPEC.md` §5.2 requires the
 * outcome to be announced on those paths; moving focus is not the same as saying
 * what happened.
 *
 * ```tsx
 * const { announce, announcer } = useLiveAnnouncer();
 * // ...
 * await createProject.mutateAsync(input);
 * announce(`Project "${name}" created.`);
 * // ...
 * return <div>{announcer}…</div>;
 * ```
 *
 * Three things this exists to get right, each of which has already been got
 * wrong somewhere in this repo or its open PRs:
 *
 * 1. **It is portalled to `document.body`, not rendered in place.**
 *    `MODAL_FOCUS_MANAGEMENT_SPEC.md` §6 / `ACCESSIBILITY.md` §Live Regions:
 *    `aria-hidden` — the package Radix uses to hide the background behind a
 *    modal — collects every `[aria-live]` element into its keep-list and then
 *    walks each one up its *entire* `parentNode` chain. An announcer rendered at
 *    `#root > … > div[aria-live]` therefore puts `#root` on the keep-list, and
 *    `#root` silently stops receiving `aria-hidden` when a dialog opens. Nothing
 *    looks wrong — sibling subtrees still hide correctly — but the assertion
 *    most people reach for to prove the background is hidden stops holding. As a
 *    body-level sibling of `#root` the region is exempted on its own account and
 *    hides nothing. (PR #115 hit exactly this and had to portal to fix it.)
 *
 * 2. **The region is mounted for the component's whole life and only its text
 *    changes.** Assistive tech announces *updates* to a region already in the
 *    accessibility tree; one that mounts at the same moment its message appears
 *    may not be announced at all. So render `announcer` unconditionally —
 *    including in early-return arms — rather than gating it on having a message.
 *
 * 3. **Announcing the same string twice announces twice.** Assigning a message
 *    identical to the one already displayed is a no-op: React bails on
 *    `Object.is`, no text node mutates, and assistive tech says nothing. That is
 *    not hypothetical — resumes dedupe on content hash rather than file name, so
 *    deleting the second of two files both called `resume.pdf` produces a
 *    repeat, and the silent one is an irreversible action. `announce` clears the
 *    region and writes the message in two separate commits, so the text node
 *    always mutates and the caller never has to think about it.
 *
 * Never put a focusable element inside a live region (WIC-1155). This one takes
 * a string, so there is nothing to put.
 */
export function useLiveAnnouncer(politeness: Politeness = 'polite') {
  // `tick` is what makes the two-commit write below reliable. Storing the text
  // alone would let `setText('')` bail when the region is already empty, and the
  // effect that writes the real message would then never run.
  const [state, setState] = useState({ text: '', tick: 0 });
  const pendingRef = useRef<string | null>(null);

  const announce = useCallback((message: string) => {
    if (!message) return;
    pendingRef.current = message;
    // Commit 1 — empty the region.
    setState((prev) => ({ text: '', tick: prev.tick + 1 }));
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending === null) return;
    pendingRef.current = null;
    // Commit 2 — write the message. Separate from commit 1, so the text node
    // mutates even when `pending` equals what was last announced.
    setState((prev) => ({ text: pending, tick: prev.tick + 1 }));
  }, [state.tick]);

  // `status` and `alert` are the roles whose implicit live-region politeness
  // already matches, so the explicit `aria-live` reinforces the role rather than
  // contradicting it. Pairing `role="status"` with `aria-live="assertive"` would
  // ship a live region that says two different things about its own urgency.
  const announcer = createPortal(
    <div
      className="sr-only"
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic="true"
    >
      {state.text}
    </div>,
    document.body
  );

  return { announce, announcer };
}
