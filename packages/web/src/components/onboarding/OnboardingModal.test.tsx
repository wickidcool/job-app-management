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

// The step-6 shortcuts and step 5's CTA all go through handleFinishAndGo(), which
// is `await completeOnboarding(); navigate(to)` fired from onClick as a floating
// promise. userEvent.click() therefore returns while the navigation is still one
// microtask away, and asserting the path synchronously is a race — it failed on
// roughly 1 run in 4 (WIC-1795). Poll instead of sampling once.
async function expectPath(path: string) {
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(path));
}

// Where the router starts. Deliberately *not* one of the paths any shortcut
// navigates to — "Go to Dashboard" targets '/', so starting there would make its
// assertion pass whether the click navigated or did nothing at all.
const START_PATH = '/onboarding';

function renderModal() {
  // MemoryRouter is load-bearing now: PR #82 (WIC-1032) landed, so the step-6
  // shortcuts — and step 5's primary CTA — navigate via useNavigate(), which throws
  // outside a router.
  return render(
    <MemoryRouter initialEntries={[START_PATH]}>
      {/* Host wrapper so "renders nothing" can assert on the modal alone — the
          LocationProbe is a test fixture and is deliberately outside it. */}
      <div data-testid="modal-host">
        <OnboardingModal />
      </div>
      <LocationProbe />
    </MemoryRouter>
  );
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
    // Distinguishable from "never navigated" only because START_PATH is not "/".
    await expectPath('/');
  });

  it('finishes onboarding before the "View Applications" shortcut navigates', async () => {
    const { completeOnboarding } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /view applications/i }));

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    await expectPath('/applications');
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

    await expectPath('/applications/new');
    // Must complete first, or the provider re-fetches an untouched status and
    // reopens the modal on top of the form the user was just sent to.
    expect(completeOnboarding).toHaveBeenCalledTimes(1);
  });

  it('does not merely advance the wizard when the primary CTA is pressed', async () => {
    const nextStep = vi.fn();
    mockOnboarding({ currentStep: 5, nextStep });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));

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

    expect(nextStep).toHaveBeenCalledTimes(1);
    // Asserts the absence of navigation, so it stays a single synchronous sample:
    // waitFor would pass on the first poll no matter what the click did.
    expect(screen.getByTestId('location').textContent).toBe(START_PATH);
  });
});
