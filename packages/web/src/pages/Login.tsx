import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LOGIN_TITLES, PRODUCT_NAME } from '../constants/title';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

type AuthMode = 'login' | 'register';

export function Login() {
  const { user, login, register, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // `/login` is in the outer <Routes>, above ProtectedRoute, so the shell's `RouteTitle`
  // is not mounted for it — this page sets its own (ROUTE_TITLE_CONVENTION.md §5). Keyed
  // by mode so the tab title mirrors the `<h1>` below, which is mode-dependent (WIC-1099).
  useDocumentTitle(LOGIN_TITLES[mode]);

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        const result = await register(email, password);
        if (result.requiresConfirmation) {
          setMessage('Check your email for a confirmation link');
          setMode('login');
          setPassword('');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // The bootstrap branch is a route state a user can sit in, so it carries the route's h1
  // like every other branch does. Visually hidden because this screen is a spinner-in-prose
  // and a display heading over it would be chrome for something that is about to vanish —
  // but an outline with a hole in it is not a state a screen-reader user can orient in.
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <h1 className="sr-only">Sign in</h1>
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          {/*
            The wordmark keeps its size and its position and stops being a heading. It named
            the product, not the screen, and — since WIC-1675 AC-3 promoted it from h2 to
            h1 — it was the page's *only* heading, with nothing naming the screen at all: so
            heading navigation landed on a string that says nothing about what the user is
            being asked to do (WIC-1099). Its text is `PRODUCT_NAME`, the same constant that
            builds every page title (WIC-1089) — this element carried the rebrand from the
            hardcoded "Job Application Manager" independently of the markup change here.

            Note the new h1 below is the one place the "title mirrors the h1" rule
            (ROUTE_TITLE_CONVENTION.md §5) does not apply to the *wordmark*: mirroring it
            would yield "Careerpin — Careerpin". The route's title is the new copy
            `Sign in` / `Create an account` instead, because this element names the
            product rather than the screen — §5 and §6.1.
          */}
          <p className="mt-6 text-center text-3xl font-extrabold text-gray-900">{PRODUCT_NAME}</p>
          <h1 className="mt-4 text-center text-xl font-bold text-gray-900">
            {mode === 'login' ? 'Sign in' : 'Create an account'}
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            {mode === 'login'
              ? 'Sign in to manage your job applications'
              : 'Start tracking your job applications'}
          </p>
        </div>
        <div className="mt-8 bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {message && (
            <div className="mb-4 rounded-md bg-green-50 p-4">
              <p className="text-sm text-green-700">{message}</p>
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-gray-500">
                  {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
                </span>
              </div>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'register' : 'login');
                  setError(null);
                  setMessage(null);
                }}
                className="flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {mode === 'login' ? 'Create account' : 'Sign in'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
