import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { OnboardingModal } from './OnboardingModal';
import { MAX_RESUME_SIZE_BYTES } from '../../constants/upload';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { usePersonalInfo, useUpdatePersonalInfo } from '../../hooks/usePersonalInfo';
import { resumeService } from '../../services/api';
import type { OnboardingProgress, Resume } from '../../services/api';

// The modal reads onboarding state from context and personal-info state from
// react-query. Both are mocked so the test needs neither a provider tree nor a
// server — this is the pattern WIC-1037 exists to make available: one render,
// one click, no database.
vi.mock('../../contexts/OnboardingContext');
vi.mock('../../hooks/usePersonalInfo');
vi.mock('../../services/api', () => ({
  resumeService: { upload: vi.fn() },
}));

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

// ---------------------------------------------------------------------------
// WIC-1382. The three defects below were all client-side, which is why the API's
// suite stayed green through every one of them.
// ---------------------------------------------------------------------------

/**
 * A stateful stand-in for OnboardingProvider. The mock implementation is invoked
 * during OnboardingModal's own render, so it is allowed to hold React state — that
 * is what lets a test drive real step transitions (skip -> Next -> Back) instead of
 * asserting against vi.fn() call arguments one handler at a time.
 *
 * Every progress patch the modal sends is recorded in `patches`, and folded onto
 * `flags` the way the server folds it: `updateOnboardingProgress` spreads the patch
 * over the existing row, so the final state of `flags` is what would actually be
 * persisted.
 */
function mockStatefulOnboarding(initialStep: number) {
  const patches: OnboardingProgress[] = [];
  const flags: Record<string, boolean> = {
    personalInfoStepCompleted: false,
    personalInfoStepSkipped: false,
    resumeStepCompleted: false,
    resumeStepSkipped: false,
  };

  vi.mocked(useOnboarding).mockImplementation(() => {
    const [currentStep, setCurrentStep] = useState(initialStep);

    return {
      status: null,
      loading: false,
      showOnboarding: true,
      currentStep,
      totalSteps: 6,
      updateProgress: async (progress: OnboardingProgress) => {
        patches.push(progress);
        Object.assign(flags, progress);
      },
      completeOnboarding: vi.fn().mockResolvedValue(undefined),
      dismissOnboarding: vi.fn(),
      goToStep: setCurrentStep,
      nextStep: () => setCurrentStep((step) => Math.min(step + 1, 6)),
      previousStep: () => setCurrentStep((step) => Math.max(step - 1, 1)),
      refetch: vi.fn().mockResolvedValue(undefined),
    } as unknown as OnboardingContextValue;
  });

  vi.mocked(usePersonalInfo).mockReturnValue({
    data: undefined,
  } as ReturnType<typeof usePersonalInfo>);
  vi.mocked(useUpdatePersonalInfo).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useUpdatePersonalInfo>);

  return { patches, flags };
}

/** A File that reports `size` bytes without allocating them. */
function sizedFile(name: string, type: string, size: number) {
  const file = new File(['resume'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('OnboardingModal — resume size limit (WIC-1382 D-7)', () => {
  beforeEach(() => {
    // `restoreMocks` does not clear a vi.fn() that came from a module factory, so call
    // history would otherwise leak into the next test's not.toHaveBeenCalled().
    vi.mocked(resumeService.upload)
      .mockReset()
      .mockResolvedValue({
        id: 'resume-1',
        fileName: 'resume.pdf',
        fileSize: 7 * 1024 * 1024,
      } as Resume);
  });

  function uploadInput(container: HTMLElement) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    return input!;
  }

  // The defect: the zone defaulted to 5MB while the API accepted 10MB and the accepted
  // AC-3 called a <=10MB PDF valid, and the onboarding call site passed no override. A
  // 7MB resume was refused at the highest-drop-off moment in the product.
  it('accepts a 7MB PDF, which the API and AC-3 both call valid', async () => {
    mockStatefulOnboarding(3);
    const { container } = render(
      <MemoryRouter>
        <OnboardingModal />
      </MemoryRouter>
    );

    await userEvent.upload(
      uploadInput(container),
      sizedFile('resume.pdf', 'application/pdf', 7 * 1024 * 1024)
    );

    await waitFor(() => expect(resumeService.upload).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/file is too large/i)).not.toBeInTheDocument();
  });

  it('still refuses a file over the limit, and names the real limit when it does', async () => {
    mockStatefulOnboarding(3);
    const { container } = render(
      <MemoryRouter>
        <OnboardingModal />
      </MemoryRouter>
    );

    await userEvent.upload(
      uploadInput(container),
      sizedFile('resume.pdf', 'application/pdf', MAX_RESUME_SIZE_BYTES + 1)
    );

    expect(await screen.findByText(/maximum size is 10MB/i)).toBeInTheDocument();
    expect(resumeService.upload).not.toHaveBeenCalled();
  });

  it('advertises the same limit in the format hint', () => {
    mockStatefulOnboarding(3);
    render(
      <MemoryRouter>
        <OnboardingModal />
      </MemoryRouter>
    );

    expect(screen.getByText(/max 10MB/i)).toBeInTheDocument();
  });
});

describe('OnboardingModal — no second source of truth for the current step (WIC-1382 D-9)', () => {
  // D-9 was a deletion, so there is nothing to assert about the new behaviour — but the
  // key it wrote (`onboarding_progress`) was never read back, and the risk the deletion
  // addresses is a future reader wiring it up as a resume mechanism. This fails if the
  // effect comes back, which is the only thing worth guarding here.
  it('writes no onboarding_progress key while stepping through', async () => {
    localStorage.removeItem('onboarding_progress');
    mockStatefulOnboarding(2);
    render(
      <MemoryRouter>
        <OnboardingModal />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    await screen.findByRole('button', { name: /back/i });

    expect(localStorage.getItem('onboarding_progress')).toBeNull();
  });
});

describe('OnboardingModal — completed and skipped are mutually exclusive (WIC-1382 D-5)', () => {
  async function fillPersonalInfo() {
    await userEvent.type(screen.getByLabelText(/first name/i), 'Alex');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Johnson');
    await userEvent.type(screen.getByLabelText(/^email/i), 'alex@example.com');
    // Required by personalInfoFormSchema alongside the three above; without it the
    // resolver rejects and handlePersonalInfoSubmit never runs.
    await userEvent.type(screen.getByLabelText(/linkedin/i), 'https://linkedin.com/in/alex');
  }

  // The reachable path from the report: steps 2 and 3 both render onBack={previousStep},
  // so skip Personal Info -> Next -> Back -> fill the form -> submit. Before this fix the
  // submit patch set personalInfoStepCompleted without clearing personalInfoStepSkipped,
  // leaving both true and collapsing the six-boolean model to a single "touched" bit.
  it('leaves exactly one personal-info flag true after skip -> back -> submit', async () => {
    const { flags, patches } = mockStatefulOnboarding(2);
    render(
      <MemoryRouter>
        <OnboardingModal />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(flags.personalInfoStepSkipped).toBe(true);

    // Now on step 3 (Upload Resume). Go back to Personal Info and complete it.
    await userEvent.click(await screen.findByRole('button', { name: /back/i }));
    await screen.findByLabelText(/first name/i);

    await fillPersonalInfo();
    await userEvent.click(screen.getByRole('button', { name: /next step/i }));

    await waitFor(() => expect(flags.personalInfoStepCompleted).toBe(true));
    expect(flags.personalInfoStepSkipped).toBe(false);

    // Belt and braces: the fix is that the patch itself carries the clear, so it holds
    // even against a server that spreads the patch verbatim (which this one does).
    expect(patches.at(-1)).toMatchObject({
      personalInfoStepCompleted: true,
      personalInfoStepSkipped: false,
    });
  });

  // The same hole in reverse, which the report notes on the resume step: the success
  // handler always cleared its counterpart but the skip handler never did, so upload
  // -> Back -> Skip left both true.
  it('leaves exactly one resume flag true after upload -> back -> skip', async () => {
    vi.mocked(resumeService.upload).mockResolvedValue({
      id: 'resume-1',
      fileName: 'resume.pdf',
      fileSize: 2048,
    } as Resume);

    const { flags } = mockStatefulOnboarding(3);
    const { container } = render(
      <MemoryRouter>
        <OnboardingModal />
      </MemoryRouter>
    );

    await userEvent.upload(
      container.querySelector<HTMLInputElement>('input[type="file"]')!,
      sizedFile('resume.pdf', 'application/pdf', 2048)
    );
    await waitFor(() => expect(flags.resumeStepCompleted).toBe(true));

    // Step 4 (App Overview) -> back to step 3, then skip.
    await userEvent.click(await screen.findByRole('button', { name: /back/i }));
    await userEvent.click(await screen.findByRole('button', { name: /skip for now/i }));

    await waitFor(() => expect(flags.resumeStepSkipped).toBe(true));
    expect(flags.resumeStepCompleted).toBe(false);
  });
});
