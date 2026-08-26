import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

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

function renderModal() {
  // MemoryRouter is not required by the current step-6 markup, which navigates with
  // plain anchors. It is here because the WIC-1032 fix (PR #82) switches those to
  // useNavigate(), which throws outside a router.
  return render(
    <MemoryRouter>
      <OnboardingModal />
    </MemoryRouter>
  );
}

describe('OnboardingModal — completion step', () => {
  it('renders nothing when onboarding is not being shown', () => {
    mockOnboarding({ showOnboarding: false });
    const { container } = renderModal();

    expect(container).toBeEmptyDOMElement();
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

  // Cannot be written green on main: step 6's "Go to Dashboard" / "View Applications"
  // are still bare <a href> elements here, and the fix that routes them through
  // completeOnboarding() + useNavigate() lives in PR #82 (WIC-1032). Un-skip these two
  // as part of merging that PR — the harness above is everything they need.
  it.todo('finishes onboarding before the "Go to Dashboard" shortcut navigates (PR #82)');
  it.todo('finishes onboarding before the "View Applications" shortcut navigates (PR #82)');
});
