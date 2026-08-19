import { useEffect, useRef } from 'react';

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
 * Spread the result onto `Dialog.Content`:
 *
 * ```tsx
 * const focusRestore = useDialogFocusRestore();
 * <Dialog.Content {...focusRestore}>
 * ```
 *
 * Covered by `packages/web/e2e/modal-focus-projects.spec.ts`.
 */
export function useDialogFocusRestore() {
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      // Only track the page's own focus. While a dialog is open its focus
      // scope owns focus, and the trigger for any dialog opened from within
      // one is captured by `onOpenAutoFocus` instead.
      if (document.querySelector('[role="dialog"]')) return;

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
      triggerRef.current = document.activeElement as HTMLElement | null;
    },
    onCloseAutoFocus: (event: Event) => {
      // Also suppresses Radix's restore-to-`Dialog.Trigger` above, via
      // `composeEventHandlers`' `checkForDefaultPrevented`.
      event.preventDefault();
      triggerRef.current?.focus();
    },
  };
}
