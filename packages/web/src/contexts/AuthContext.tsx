import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { identify, reset } from '../services/analytics';
import { AUTH_TOKEN_KEY, clearAppStorage } from '../services/appStorage';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<{ requiresConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCurrentUser = useCallback(async (authToken: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        setToken(authToken);
        localStorage.setItem(AUTH_TOKEN_KEY, authToken);
        // Session-restore: alias the anonymous session onto the authed user so
        // pre-auth events stitch to their profile (WIC-825 / WIC-822 GAP-2).
        identify(data.user.id);
      } else {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        setUser(null);
        setToken(null);
      }
    } catch {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setUser(null);
      setToken(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (storedToken) {
      (async () => {
        await fetchCurrentUser(storedToken);
        if (!cancelled) setLoading(false);
      })();
    } else {
      queueMicrotask(() => {
        if (!cancelled) setLoading(false);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [fetchCurrentUser]);

  useEffect(() => {
    // An expired session ends the session just as a sign-out does, so it sweeps the
    // same keys: the shared-browser threat in WIC-1495 does not distinguish "chose to
    // log out" from "was logged out". Safe to sweep here because this listener is
    // strictly 401-driven — `auth:unauthorized` has exactly one dispatch site
    // (`services/api/apiClient.ts`), inside `!response.ok` behind `status === 401`.
    // An offline or parse failure never reaches it; it throws NETWORK_ERROR from the
    // catch below that check. Do NOT move this sweep into a request catch block,
    // which would wipe a still-valid session's data every time the network blips.
    const handleUnauthorized = () => {
      clearAppStorage();
      setToken(null);
      setUser(null);
      reset();
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const login = async (email: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Login failed');
    }

    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
    // Login: alias the anonymous pre-login session onto the authed user.
    identify(data.user.id);
  };

  const register = async (email: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Registration failed');
    }

    if (data.token) {
      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
      // Registration that returns a session (no email confirmation): identify now.
      identify(data.user.id);
      return { requiresConfirmation: false };
    }

    return { requiresConfirmation: true };
  };

  const signOut = async () => {
    const currentToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (currentToken) {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentToken}` },
      }).catch(() => {});
    }
    // Logout clears every app-owned localStorage key, not just the token. The
    // shared-browser case below is not only an analytics-identity problem: recent
    // searches, saved filters and onboarding progress are the previous user's data
    // and were readable by the next person with no session at all (WIC-1495).
    clearAppStorage();
    setToken(null);
    setUser(null);
    // Logout: drop the identity and rotate the anon session so a next user on a
    // shared browser doesn't alias onto this one.
    reset();
  };

  const value = {
    user,
    token,
    loading,
    login,
    register,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
