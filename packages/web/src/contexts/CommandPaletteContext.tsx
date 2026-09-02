import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * Returns `true` if the guard has taken the navigation over (it will perform or
 * abandon it itself), `false` to let the caller navigate as normal.
 */
export type NavigationGuard = (href: string) => boolean;

interface CommandPaletteContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  openPalette: () => void;
  /**
   * Registers the single active navigation guard, or clears it with `null`.
   *
   * Why this lives on the palette's context rather than in its own provider:
   * the palette is the app's only *programmatic* in-app navigator, and — as of
   * WIC-1181, which made the dialogue wizard a modal Radix dialog — it is the
   * only in-app navigation that can still fire over an open modal. Its ⌘/Ctrl+K
   * listener is on `window`, so it is unaffected by the modal, while every nav
   * anchor is behind `aria-hidden` and inert. `useInAppNavigationGuard` already
   * intercepts anchor clicks on its own; this covers the one path a click
   * listener structurally cannot see. A separate app-shell provider for a
   * single consumer would be more wiring for the same behaviour.
   *
   * Deliberately a single slot, not a stack: only one modal-with-unsaved-work
   * can be open at a time, and a stack would quietly let a stale guard from an
   * unmounted component win.
   */
  registerNavigationGuard: (guard: NavigationGuard | null) => void;
  /** Consulted by the palette immediately before it navigates. */
  requestNavigation: NavigationGuard;
}

const CommandPaletteContext = createContext<CommandPaletteContextType | undefined>(undefined);

/**
 * Owns the command palette's open state and its Ctrl/⌘+K shortcut.
 *
 * Previously both lived as local state in `App`, which meant search was reachable
 * only by keyboard: no descendant could open it. That is fine on a desktop and a
 * dead end on a phone — most visibly on the 404 page, whose only other recovery
 * affordance is a link to the dashboard.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openPalette = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // A ref, not state: registering a guard must not re-render the whole shell,
  // and the palette only ever reads it at the instant it navigates.
  const navigationGuardRef = useRef<NavigationGuard | null>(null);

  const registerNavigationGuard = useCallback((guard: NavigationGuard | null) => {
    navigationGuardRef.current = guard;
  }, []);

  const requestNavigation = useCallback(
    (href: string) => navigationGuardRef.current?.(href) ?? false,
    []
  );

  const value = useMemo(
    () => ({ open, setOpen, openPalette, registerNavigationGuard, requestNavigation }),
    [open, openPalette, registerNavigationGuard, requestNavigation]
  );

  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>;
}

/**
 * Throws with no provider above, unlike `useRouteUnmatched`. The asymmetry is
 * deliberate: a nav tab that fails to highlight is cosmetic, but a "Search
 * applications" button that silently does nothing when tapped is the exact
 * "is this app broken?" signal the 404 page exists to remove.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useCommandPalette() {
  const context = useContext(CommandPaletteContext);
  if (context === undefined) {
    throw new Error('useCommandPalette must be used within a CommandPaletteProvider');
  }
  return context;
}

/**
 * The navigation-guard half of the context, and — unlike `useCommandPalette` —
 * it does **not** throw without a provider.
 *
 * The asymmetry is the same one documented above, applied to a different
 * failure: a missing guard degrades to today's behaviour (the palette navigates
 * straight away), which is survivable. Throwing instead would mean the wizard
 * and the palette could only ever be rendered under the full app shell, which
 * would make every existing standalone test of either one fail for a reason
 * that has nothing to do with what it is testing.
 *
 * The no-op is a stable module-level constant so it does not re-trigger the
 * registration effect on every render.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useNavigationGuardControls() {
  return useContext(CommandPaletteContext) ?? NAVIGATION_GUARD_NOOP;
}

const NAVIGATION_GUARD_NOOP = {
  registerNavigationGuard: () => {},
  requestNavigation: () => false,
} as const;
