import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { OnboardingModal } from './OnboardingModal';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { usePersonalInfo, useUpdatePersonalInfo } from '../../hooks/usePersonalInfo';

// The modal reads onboarding state from context and personal-info state from
// react-query. Both are mocked so the test needs neither a provider tree nor a
// server — this is the pattern WIC-1037 exists to make available: one render,
// one click, no database.
vi.mock('../../contexts/OnboardingContext');
vi.mock('../../hooks/usePersonalInfo');

type OnboardingContextValue = ReturnType<typeof useOnboarding>;

function mockOnboarding(overrides: Partial<OnboardingContextValue> = {}) {
  const completeOnboarding = vi.fn().mockResolvedValue(undefined);

  vi.mocked(useOnboarding).mockReturnValue({
    status: null,
    loading: false,
    showOnboarding: true,
    currentStep: 6,
    totalSteps: 6,
    updateProgress: vi.fn().mockResolvedValue(undefined),
    completeOnboarding,
    dismissOnboarding: vi.fn(),
    goToStep: vi.fn(),
    nextStep: vi.fn(),
    previousStep: vi.fn(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as OnboardingContextValue);

  vi.mocked(usePersonalInfo).mockReturnValue({
    data: undefined,
  } as ReturnType<typeof usePersonalInfo>);
  vi.mocked(useUpdatePersonalInfo).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useUpdatePersonalInfo>);

  return { completeOnboarding };
}

// Reports the router's current path so a test can assert where a control actually
// went, rather than only that it was clicked.
function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

// WIC-1795. The entry must not be any of the paths a control navigates *to*. It used
// to be '/', which is where "Go to Dashboard" goes, so that test asserted the location
// still held its own starting value and passed identically whether the shortcut
// navigated or did nothing at all. Starting somewhere the modal never navigates to
// makes every destination below an observable transition, and makes the two
// "stayed put" assertions mean what they say.
const ENTRY = '/onboarding';

function renderModal() {
  // MemoryRouter is load-bearing now: PR #82 (WIC-1032) landed, so the step-6
  // shortcuts — and step 5's primary CTA — navigate via useNavigate(), which throws
  // outside a router.
  return render(
    <MemoryRouter initialEntries={[ENTRY]}>
      {/* Host wrapper so "renders nothing" can assert on the modal alone — the
          LocationProbe is a test fixture and is deliberately outside it. */}
      <div data-testid="modal-host">
        <OnboardingModal />
      </div>
      <LocationProbe />
    </MemoryRouter>
  );
}

// WIC-1795. handleFinishAndGo() calls navigate(to) in the continuation *after* an
// awaited completeOnboarding(), so the router commit lands on a later tick than the
// click. userEvent.click's act() flush does not guarantee both have settled, and a
// synchronous read of the probe therefore raced the router — 2 of 6 full-suite runs
// failed on the untouched base, always with `expected '<entry>' to be '<dest>'`, while
// the file passed 9/9 in isolation. Await the transition instead of assuming it.
//
// Exact equality, not toHaveTextContent: that matcher is a substring match, so
// '/applications' would be satisfied by '/applications/new' and the step-5 CTA test
// would stop distinguishing the two destinations.
async function expectNavigatedTo(pathname: string) {
  await waitFor(() => {
    expect(screen.getByTestId('location').textContent).toBe(pathname);
  });
}

describe('OnboardingModal — completion step', () => {
  it('renders nothing when onboarding is not being shown', () => {
    mockOnboarding({ showOnboarding: false });
    renderModal();

    expect(screen.getByTestId('modal-host')).toBeEmptyDOMElement();
  });

  it('labels the footer action "Complete" on the last step', () => {
    mockOnboarding();
    renderModal();

    expect(screen.getByRole('button', { name: /complete/i })).toBeInTheDocument();
  });

  // The regression that mattered: reaching step 6 only advances local state, so
  // anything that leaves the modal has to call completeOnboarding() first or the
  // server still reads `first_application` with a null completedAt and the modal
  // reopens on the next load.
  it('finishes onboarding when the footer Complete button is clicked', async () => {
    const { completeOnboarding } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /complete/i }));

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
  });

  // Previously two `it.todo`s parked on PR #82 (WIC-1032). That PR has landed — both
  // shortcuts now go through handleFinishAndGo() — so they are written out here, as
  // the note they replaced instructed.
  it('finishes onboarding before the "Go to Dashboard" shortcut navigates', async () => {
    const { completeOnboarding } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /go to dashboard/i }));

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    // "/" and not "/dashboard": the Dashboard is mounted at the index route.
    await expectNavigatedTo('/');
  });

  it('finishes onboarding before the "View Applications" shortcut navigates', async () => {
    const { completeOnboarding } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /view applications/i }));

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    await expectNavigatedTo('/applications');
  });
});

// WIC-1689. Step 5's primary CTA was `handleCompleteStep(5)` behind a
// "This would open the application form modal" comment — it advanced the wizard and
// created nothing, which is indistinguishable from success at the UI level on the
// first-run flow's terminal call to action.
describe('OnboardingModal — step 5 "create first application"', () => {
  it('sends the primary CTA to the real create form', async () => {
    const { completeOnboarding } = mockOnboarding({ currentStep: 5 });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));

    await expectNavigatedTo('/applications/new');
    // Must complete first, or the provider re-fetches an untouched status and
    // reopens the modal on top of the form the user was just sent to.
    expect(completeOnboarding).toHaveBeenCalledTimes(1);
  });

  it('does not merely advance the wizard when the primary CTA is pressed', async () => {
    const nextStep = vi.fn();
    mockOnboarding({ currentStep: 5, nextStep });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));

    // Anchor the "not called" read to after the handler's async continuation has
    // landed. Without this the assertion could pass simply because nothing had run
    // yet, which is the same race WIC-1795 fixed above wearing a negative sign.
    await expectNavigatedTo('/applications/new');
    expect(nextStep).not.toHaveBeenCalled();
  });

  // The step used to carry a second body button, "I'll Do This Later", whose handler
  // was byte-identical to the footer's "Next Step". Two differently-labelled controls
  // doing one thing is the defect, so the duplicate is gone and the footer is the
  // single way to decline.
  it('offers exactly one body control, with the footer as the only way to decline', () => {
    mockOnboarding({ currentStep: 5 });
    renderModal();

    expect(screen.queryByRole('button', { name: /i'll do this later/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next step/i })).toBeInTheDocument();
  });

  it('advances without creating anything when the footer is used to decline', async () => {
    const nextStep = vi.fn();
    mockOnboarding({ currentStep: 5, nextStep });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /next step/i }));

    // nextStep firing is the positive signal that the handler ran to completion, so
    // the location read below is not merely observing a click that has not landed yet.
    // Asserting the entry path — which is not a destination any control navigates to —
    // is what makes "did not navigate" falsifiable; waiting on an unchanged value
    // would prove nothing.
    expect(nextStep).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location').textContent).toBe(ENTRY);
  });
});
