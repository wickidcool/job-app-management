import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type Location,
} from 'react-router-dom';
import {
  FOCUS_HANDOFF_TARGETS,
  focusHandoffState,
  readFocusHandoffState,
  useRouteFocusHandoff,
} from './useRouteFocusHandoff';

/**
 * Cover for WIC-1931 — focus handed across a route change.
 *
 * The defect this closes is a dialog that *is* a route: `WizardContainer` at
 * `/projects/new/dialogue`. Neither half of `useDialogFocusRestore` can reach across
 * the unmount, because both halves are refs — see that hook's header, and
 * `useRouteFocusHandoff`'s. These tests pin the replacement mechanism; the real
 * journey through the real components is `e2e/modal-focus-wizard.spec.ts`, which needs
 * a browser.
 *
 * The target here is deliberately the app's own key rather than a fixture one: a
 * mechanism that only works for a made-up target would pass every test below.
 */
const TARGET = FOCUS_HANDOFF_TARGETS.projectsGuidedCreate;

/** Reports the live handoff state, so "consumed" is asserted rather than inferred. */
function LocationProbe() {
  const location = useLocation() as Location;
  return (
    <>
      <p data-testid="handoff">{readFocusHandoffState(location.state) ?? 'none'}</p>
      <p data-testid="url">{`${location.pathname}${location.search}`}</p>
    </>
  );
}

/**
 * Stands in for `ProjectsList`: renders a loading branch first, then the control.
 *
 * `readyAfterMs === 0` is the immediate case. Anything higher reproduces the shape that
 * actually ships — `ProjectsList` renders a skeleton until `useProjects()` resolves, so
 * the control is absent on the destination route's first commit.
 */
function Destination({ readyAfterMs = 0 }: { readyAfterMs?: number }) {
  const ref = useRouteFocusHandoff(TARGET);
  const [ready, setReady] = useState(readyAfterMs === 0);

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setReady(true), readyAfterMs);
    return () => clearTimeout(timer);
  }, [ready, readyAfterMs]);

  return (
    <div>
      <LocationProbe />
      {ready ? <button ref={ref}>Add New Project (Guided)</button> : <p>Loading…</p>}
      <button>Some other control</button>
    </div>
  );
}

function Elsewhere() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>Back</button>;
}

function LeaveButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/elsewhere')}>Leave</button>;
}

function renderAt(state: unknown, { readyAfterMs = 0 }: { readyAfterMs?: number } = {}) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/projects', search: '?tab=all', state }]}>
      <Routes>
        <Route
          path="/projects"
          element={
            <>
              <Destination readyAfterMs={readyAfterMs} />
              <LeaveButton />
            </>
          }
        />
        <Route path="/elsewhere" element={<Elsewhere />} />
      </Routes>
    </MemoryRouter>
  );
}

const guidedButton = () => screen.getByRole('button', { name: 'Add New Project (Guided)' });

describe('useRouteFocusHandoff', () => {
  it('focuses the control the arriving navigation addressed', async () => {
    renderAt(focusHandoffState(TARGET));

    await waitFor(() => expect(guidedButton()).toHaveFocus());
  });

  it('focuses a control that only mounts once the destination has loaded', async () => {
    // The load-bearing case, and the reason the hook hands back a *callback* ref: an
    // effect reading `ref.current` on mount would read `null` here, focus nothing, and
    // leave the user on `<body>` — the exact defect this closes.
    renderAt(focusHandoffState(TARGET), { readyAfterMs: 25 });

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await waitFor(() => expect(guidedButton()).toHaveFocus(), { timeout: 2000 });
  });

  it('leaves focus alone when the navigation carries no handoff', async () => {
    // The control for both cases above: without this, a hook that focused
    // unconditionally on mount would pass them and still be wrong.
    renderAt(undefined);

    await screen.findByText('none');
    expect(guidedButton()).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves focus alone when the handoff names a different control', async () => {
    renderAt({ focusHandoff: 'some-other-control' });

    await screen.findByText('some-other-control');
    expect(guidedButton()).not.toHaveFocus();
  });

  it('clears the handoff from history state once it is honoured', async () => {
    renderAt(focusHandoffState(TARGET));

    await waitFor(() => expect(guidedButton()).toHaveFocus());
    await waitFor(() => expect(screen.getByTestId('handoff')).toHaveTextContent('none'));
  });

  it('does not re-focus when the user navigates Back into the same entry', async () => {
    // Why clearing matters, stated as behaviour rather than as an implementation
    // detail: history state outlives the navigation that carried it, so an unconsumed
    // handoff would yank focus again on every Back into this entry — and after a
    // reload — long after the user has moved on.
    const user = userEvent.setup();
    renderAt(focusHandoffState(TARGET));

    await waitFor(() => expect(guidedButton()).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));

    await screen.findByText('none');
    expect(guidedButton()).not.toHaveFocus();
  });

  it('preserves the path it was honoured on, rather than dropping the query string', async () => {
    // Clearing the state re-navigates, so it has to rebuild the current URL exactly. A
    // bare `navigate(location.pathname)` silently drops `?tab=all`, which on
    // `ApplicationsList` would reset the user's filter as a side effect of a focus fix.
    renderAt(focusHandoffState(TARGET));

    expect(screen.getByTestId('url')).toHaveTextContent('/projects?tab=all');
    await waitFor(() => expect(screen.getByTestId('handoff')).toHaveTextContent('none'));
    expect(screen.getByTestId('url')).toHaveTextContent('/projects?tab=all');
  });
});

describe('readFocusHandoffState', () => {
  // `location.state` is `unknown` by contract and survives a reload, so it can hold
  // anything at all — including state written by an older build of the app.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a bare string', 'projects-guided-create'],
    ['a number', 7],
    ['an object with no handoff key', { from: '/projects' }],
    ['a non-string value under the key', { focusHandoff: 42 }],
  ])('reads no handoff out of %s', (_label, state) => {
    expect(readFocusHandoffState(state)).toBeNull();
  });

  it('round-trips a target through focusHandoffState', () => {
    expect(readFocusHandoffState(focusHandoffState(TARGET))).toBe(TARGET);
  });

  it('keeps other keys on the same state object readable', () => {
    // Router state is one shared object per navigation. A caller that already carries
    // state must be able to keep it alongside the handoff.
    const state = { ...focusHandoffState(TARGET), from: '/projects/new/dialogue' };
    expect(readFocusHandoffState(state)).toBe(TARGET);
    expect(state.from).toBe('/projects/new/dialogue');
  });
});
