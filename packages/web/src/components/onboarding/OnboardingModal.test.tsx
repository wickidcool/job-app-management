import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { OnboardingModal } from './OnboardingModal';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useCreateApplication } from '../../hooks/useApplications';
import { usePersonalInfo, useUpdatePersonalInfo } from '../../hooks/usePersonalInfo';

// The modal reads onboarding state from context and personal-info state from
// react-query. Both are mocked so the test needs neither a provider tree nor a
// server — this is the pattern WIC-1037 exists to make available: one render,
// one click, no database.
vi.mock('../../contexts/OnboardingContext');
vi.mock('../../hooks/usePersonalInfo');
// Step 5's quick-add (WIC-1383) put a second react-query hook at the top of the
// component. It is unconditional, so it runs on every step — without this mock these
// completion-step tests fail with "No QueryClient set". Step-5 behaviour itself is
// covered in OnboardingModal.step-actions.test.tsx.
vi.mock('../../hooks/useApplications');

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
  vi.mocked(useCreateApplication).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useCreateApplication>);

  return { completeOnboarding };
}

// Reports the router's current path so a test can assert where a control actually
// went, rather than only that it was clicked.
function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderModal() {
  // MemoryRouter is load-bearing now: PR #82 (WIC-1032) landed, so the step-6
  // shortcuts — and step 5's primary CTA — navigate via useNavigate(), which throws
  // outside a router.
  return render(
    <MemoryRouter initialEntries={['/']}>
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
    expect(screen.getByTestId('location').textContent).toBe('/');
  });

  it('finishes onboarding before the "View Applications" shortcut navigates', async () => {
    const { completeOnboarding } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /view applications/i }));

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location').textContent).toBe('/applications');
  });
});

// WIC-1689. Step 5's primary CTA was `handleCompleteStep(5)` behind a
// "This would open the application form modal" comment — it advanced the wizard and
// created nothing, which is indistinguishable from success at the UI level on the
// first-run flow's terminal call to action.
describe('OnboardingModal — step 5 "create first application"', () => {
  // Rewritten under the WIC-1715 ruling (f28d559), which struck the route-out this test
  // was written for: the CTA now reveals an inline quick-add in this same dialog, so the
  // user reaches the completion step instead of leaving the flow at its terminal step.
  // `completeOnboarding` is asserted alongside the path because the route-out's real cost
  // was that it ran completeOnboarding() *before* navigating — a one-way door out of
  // onboarding for anyone who thought better of the full form.
  it('reveals the inline quick-add rather than leaving the flow for the create form', async () => {
    const { completeOnboarding } = mockOnboarding({ currentStep: 5 });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));

    expect(screen.getByLabelText(/company/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/job title/i)).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/');
    expect(completeOnboarding).not.toHaveBeenCalled();
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
    expect(screen.getByTestId('location').textContent).toBe('/');
  });
});
