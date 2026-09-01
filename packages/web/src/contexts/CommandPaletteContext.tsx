import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface CommandPaletteContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  openPalette: () => void;
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

  const value = useMemo(() => ({ open, setOpen, openPalette }), [open, openPalette]);

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
