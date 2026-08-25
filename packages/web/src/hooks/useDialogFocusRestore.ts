import { useEffect, useRef, type RefObject } from 'react';

export interface UseDialogFocusRestoreOptions {
  /**
   * Where to send focus when the captured trigger is gone from the document by
   * the time the dialog closes.
   *
   * Required for any dialog whose trigger is rendered conditionally on state
   * the dialog itself mutates — `ProjectsList`'s empty-state button unmounts on
   * the create-success path, and without a fallback focus lands on `<body>`.
   * Point it at a stable control offering the same action.
   */
  fallbackRef?: RefObject<HTMLElement | null>;
}

/**
 * How long to keep watching a restored trigger for removal, in ms.
 *
 * Covers the re-render that follows an already-resolved mutation. Kept short on
 * purpose: moving focus long after the dialog closed would yank a user who has
 * since started interacting, and staying put is the lesser evil at that point.
 */
const RESTORE_WATCH_MS = 1000;

/**
 * Restores focus to the control that opened a *controlled* Radix dialog.
 *
 * Radix's modal `Dialog.Content` cancels the focus scope's own restore and
 * focuses `context.triggerRef.current` instead:
 *
 * ```js
 * onCloseAutoFocus: composeEventHandlers(props.onCloseAutoFocus, (event) => {
 *   event.preventDefault();
 *   context.triggerRef.current?.focus();
 * })
 * ```
 *
 * That ref is only populated by a rendered `Dialog.Trigger`. Every dialog in
 * this app is driven by an `isOpen`-style prop with its trigger in the parent,
 * so the ref is always `null`, the `?.` no-ops, and focus silently lands on
 * `<body>` — breaking `ACCESSIBILITY.md` §Focus Management Patterns, which
 * requires focus to return to the trigger.
 *
 * Capturing the trigger takes two mechanisms because one alone has a blind
 * spot, and the two blind spots do not overlap:
 *
 * 1. `onOpenAutoFocus`. When it fires, `document.activeElement` is still the
 *    trigger, so it is the exact capture point. But `FocusScope` only
 *    dispatches it when focus is *outside* the panel
 *    (`@radix-ui/react-focus-scope`: `hasFocusedCandidate`), and React's
 *    `autoFocus` runs in the commit phase — before that passive effect. So
 *    a dialog containing an `autoFocus` field never sees this event.
 * 2. A `focusin` note of the last element focused while no dialog was open.
 *    That covers the `autoFocus` dialogs, but not a dialog opened from inside
 *    another dialog (the onboarding dismiss-confirm), whose trigger is never
 *    "outside a dialog" — which is precisely the case mechanism 1 handles.
 *
 * A trigger rendered conditionally on the state its own dialog mutates needs
 * one more mechanism (`options.fallbackRef`). `ProjectsList`'s empty-state
 * "Create Your First Project" button is the case. Measured sequence on the
 * create-success path — note that the restore *succeeds* first:
 *
 * ```
 * focusin  active=BUTTON[Create Your First Project]  emptyBtn=present
 * focusout active=BODY                               emptyBtn=present
 * t+0      active=BODY                               emptyBtn=GONE
 * ```
 *
 * The list stops being empty on the refetch commit, which lands *after* the
 * restore, so the button is removed while focused and the browser drops focus
 * to `<body>`. An `isConnected` test at restore time therefore cannot see this,
 * and neither can declining to `preventDefault()`: `composeEventHandlers`
 * defaults to `checkForDefaultPrevented: true`, so falling through just runs
 * Radix's handler above, which `preventDefault()`s anyway and focuses its own
 * always-`null` `triggerRef` — cancelling `FocusScope`'s
 * `focus(previouslyFocusedElement ?? document.body)` fallback too. Every route
 * ends on `<body>`. So the restore is watched instead: if the element it landed
 * on leaves the document while still holding focus, focus moves to the
 * fallback.
 *
 * Spread the result onto `Dialog.Content`:
 *
 * ```tsx
 * const focusRestore = useDialogFocusRestore();
 * <Dialog.Content {...focusRestore}>
 * ```
 *
 * Covered by `packages/web/e2e/modal-focus-projects.spec.ts`.
 */
export function useDialogFocusRestore(options: UseDialogFocusRestoreOptions = {}) {
  const { fallbackRef } = options;
  const triggerRef = useRef<HTMLElement | null>(null);
  const stopWatchRef = useRef<(() => void) | null>(null);

  // Any in-flight watch dies with the component.
  useEffect(() => () => stopWatchRef.current?.(), []);

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      // Only track the page's own focus. While a dialog is open its focus
      // scope owns focus, and the trigger for any dialog opened from within
      // one is captured by `onOpenAutoFocus` instead.
      //
      // `alertdialog` is matched too: no dependency renders that role today
      // (`react-dialog`/`react-dropdown-menu`/`react-select` only), but the
      // destructive-confirm work is one `@radix-ui/react-alert-dialog` import
      // away from silently falling out of this guard.
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) return;

      const target = event.target;
      if (!(target instanceof HTMLElement) || target === document.body) return;
      triggerRef.current = target;
    };

    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, []);

  return {
    onOpenAutoFocus: () => {
      // Deliberately does not `preventDefault()`: when this fires at all,
      // nothing inside the panel has claimed focus, so Radix focusing the
      // first tabbable child is the behaviour we want.
      //
      // Same `document.body` rejection as the `focusin` path: a dialog opened
      // programmatically rather than from a control has `<body>` as the active
      // element, and overwriting a good trigger with it would be a downgrade.
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active === document.body) return;
      triggerRef.current = active;
    },
    onCloseAutoFocus: (event: Event) => {
      stopWatchRef.current?.();

      const trigger = triggerRef.current;
      const fallback = fallbackRef?.current ?? null;
      // Prefer the trigger, but a trigger already gone at this point (a slower
      // re-render than the one measured above) goes straight to the fallback.
      const target = trigger?.isConnected ? trigger : fallback;
      if (!target?.isConnected) return;

      // Also suppresses Radix's restore-to-`Dialog.Trigger` above, via
      // `composeEventHandlers`' `checkForDefaultPrevented`.
      event.preventDefault();
      target.focus();

      // The restore can be undone a tick later by the re-render the dialog's
      // own action triggered — see the measured sequence above. Watch for the
      // element leaving the document while it still holds focus.
      if (!fallback || target === fallback) return;
      stopWatchRef.current = watchRestore(target, fallback);
    },
  };
}

/**
 * Redirects focus to `fallback` if `target` is removed from the document while
 * still focused. Returns a cancel function; it also self-cancels once the
 * question is settled, so nothing outlives `RESTORE_WATCH_MS`.
 */
function watchRestore(target: HTMLElement, fallback: HTMLElement): () => void {
  let done = false;

  const stop = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    clearTimeout(timer);
    document.removeEventListener('focusin', onFocusIn, true);
  };

  // The user moved on under their own steam — leave them alone.
  const onFocusIn = (event: FocusEvent) => {
    if (event.target !== target) stop();
  };

  const observer = new MutationObserver(() => {
    if (target.isConnected) return;
    // Only step in if the removal actually cost the document its focus;
    // something else may have legitimately claimed it in the same commit.
    const active = document.activeElement;
    if ((active === null || active === document.body) && fallback.isConnected) {
      fallback.focus();
    }
    stop();
  });

  const timer = setTimeout(stop, RESTORE_WATCH_MS);
  document.addEventListener('focusin', onFocusIn, true);
  observer.observe(document.body, { childList: true, subtree: true });

  return stop;
}
