import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Focus handoff across a route change — the case `useDialogFocusRestore` cannot serve.
 *
 * `useDialogFocusRestore` restores focus to a control that is still mounted when the
 * dialog closes, and its `fallbackRef` escape hatch covers a trigger the dialog's own
 * action destroys. Both mechanisms are *refs*, so both are confined to one mounted
 * component tree. Neither can survive an unmount/remount boundary.
 *
 * `WizardContainer` is exactly that boundary, and it is why its `useDialogFocusRestore`
 * was inert (WIC-1931, the third instance of the WIC-1181 / WIC-1222 class). The wizard
 * is a *route*: the only way in is `navigate('/projects/new/dialogue?variant=create')`
 * from `ProjectsList`, so
 *
 * 1. the hook captures the "Add New Project (Guided)" button on open;
 * 2. the route change unmounts `ProjectsList`, detaching that button;
 * 3. on close the wizard navigates back, `onCloseAutoFocus` runs, `trigger.isConnected`
 *    is `false`, and with no `fallbackRef` the hook returns without focusing anything;
 * 4. Radix's own restore was already suppressed, so focus lands on `<body>`.
 *
 * A `fallbackRef` cannot fix step 3 here: every candidate lives on the *other* route and
 * is unmounted at that moment, so `fallbackRef.current` would be `null`. The button the
 * user should land on is not the one they pressed — it is a **new instance** of it,
 * mounted by the destination route after the navigation. So the handoff has to travel
 * with the navigation rather than in a ref.
 *
 * Two halves, and they must name the same target:
 *
 * ```tsx
 * // the dialog side — closing navigates, and says where focus belongs when it lands
 * navigate('/projects', { state: focusHandoffState(FOCUS_HANDOFF_TARGETS.projectsGuidedCreate) });
 *
 * // the destination side — the control claims the handoff addressed to it
 * const guidedCreateRef = useRouteFocusHandoff(FOCUS_HANDOFF_TARGETS.projectsGuidedCreate);
 * <button ref={guidedCreateRef} …>
 * ```
 *
 * The target keys below are the shared vocabulary that keeps the two halves in step; a
 * typo on either side is a type error rather than a silently inert handoff, which is the
 * failure mode this whole card is about.
 *
 * Covered by `useRouteFocusHandoff.test.tsx` (the mechanism) and
 * `e2e/modal-focus-wizard.spec.ts` (the real journey, in Chromium).
 */
export const FOCUS_HANDOFF_TARGETS = {
  /**
   * `ProjectsList`'s "Add New Project (Guided)" button — the dialogue wizard's only
   * entry point, and therefore the control a user who dismisses the wizard pressed.
   */
  projectsGuidedCreate: 'projects-guided-create',
} as const;

export type FocusHandoffTarget = (typeof FOCUS_HANDOFF_TARGETS)[keyof typeof FOCUS_HANDOFF_TARGETS];

/**
 * The `location.state` key the handoff travels under.
 *
 * Namespaced rather than bare (`target`, `focus`) because router state is a single
 * shared object per navigation: a page that already carries state through this
 * navigation must be able to keep it.
 */
const STATE_KEY = 'focusHandoff';

/** Builds the `location.state` for a navigation that should hand focus to `target`. */
export function focusHandoffState(target: FocusHandoffTarget): Record<string, string> {
  return { [STATE_KEY]: target };
}

/**
 * Reads a handoff target out of an opaque `location.state`.
 *
 * `location.state` is `unknown` by contract and survives a reload, so it can be
 * anything at all — including state written by an older build of the app. Everything
 * that is not a string under our own key reads as "no handoff".
 */
export function readFocusHandoffState(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const value = (state as Record<string, unknown>)[STATE_KEY];
  return typeof value === 'string' ? value : null;
}

/**
 * Claims a focus handoff addressed to `target`, returning a ref to put on the control.
 *
 * Returns a **callback ref**, not a `useRef` object, and that is load-bearing: the
 * control is usually not in the tree on the destination route's first commit.
 * `ProjectsList` renders a loading skeleton until `useProjects()` resolves, so an effect
 * that read `ref.current` on mount would read `null`, focus nothing, and leave the user
 * on `<body>` — the very outcome this exists to prevent. A callback ref fires when the
 * node actually attaches, whenever that is, with no polling and no timer.
 *
 * The handoff is consumed once: it is cleared from history state as soon as it is
 * honoured, so a later reload or a Back into this entry does not yank focus again from
 * under a user who has since moved on.
 */
export function useRouteFocusHandoff(target: FocusHandoffTarget) {
  const location = useLocation();
  const navigate = useNavigate();
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (node === null) return;
    if (readFocusHandoffState(location.state) !== target) return;

    node.focus();
    // Replace rather than push: the handoff is a detail of the navigation that just
    // happened, not a destination of its own, and `replace` keeps Back pointing where
    // the user expects. Clearing it is what makes the handoff single-use.
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: null,
    });
  }, [node, location.state, location.pathname, location.search, location.hash, navigate, target]);

  return useCallback((instance: HTMLElement | null) => {
    setNode(instance);
  }, []);
}
