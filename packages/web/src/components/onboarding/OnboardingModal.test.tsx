import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { OnboardingModal } from './OnboardingModal';
import { MAX_RESUME_SIZE_BYTES } from '../../constants/upload';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useCreateApplication } from '../../hooks/useApplications';
import { usePersonalInfo, useUpdatePersonalInfo } from '../../hooks/usePersonalInfo';
import { resumeService } from '../../services/api';
import type { OnboardingProgress, Resume } from '../../services/api';

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
    expect(screen.getByTestId('location').textContent).toBe(START_PATH);
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
    // Asserts the absence of navigation, so it stays a single synchronous sample:
    // waitFor would pass on the first poll no matter what the click did.
    expect(screen.getByTestId('location').textContent).toBe(START_PATH);
  });
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

  // Queries `document.body` rather than the render `container`: `OnboardingModal`
  // renders through a Radix `Dialog.Content`, which portals to `document.body` and so
  // sits outside the container RTL returns from `render()`.
  function uploadInput() {
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    return input!;
  }

  // The defect: the zone defaulted to 5MB while the API accepted 10MB and the accepted
  // AC-3 called a <=10MB PDF valid, and the onboarding call site passed no override. A
  // 7MB resume was refused at the highest-drop-off moment in the product.
  it('accepts a 7MB PDF, which the API and AC-3 both call valid', async () => {
    mockStatefulOnboarding(3);
    render(
      <MemoryRouter>
        <OnboardingModal />
      </MemoryRouter>
    );

    await userEvent.upload(
      uploadInput(),
      sizedFile('resume.pdf', 'application/pdf', 7 * 1024 * 1024)
    );

    await waitFor(() => expect(resumeService.upload).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/file is too large/i)).not.toBeInTheDocument();
  });

  it('still refuses a file over the limit, and names the real limit when it does', async () => {
    mockStatefulOnboarding(3);
    render(
      <MemoryRouter>
        <OnboardingModal />
      </MemoryRouter>
    );

    await userEvent.upload(
      uploadInput(),
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

  // Originally pinned that upload -> Back -> Skip left both flags true, because the
  // success handler cleared its counterpart but the skip handler never did (fixed
  // alongside the rest of D-5). WIC-1383's confirm-to-skip flow (AC-5) closes the
  // scenario a level earlier: `handleConfirmSkipResume` no-ops once a resume is
  // already uploaded, specifically so confirming "Skip Anyway" on top of a completed
  // upload cannot contradict the flag that upload already wrote. So the bug this test
  // was written for is now unreachable rather than merely fixed — asserted here as
  // "skip changes nothing once uploaded", the stronger guarantee that subsumes it.
  it('a confirmed skip changes nothing once the resume step is already completed', async () => {
    vi.mocked(resumeService.upload).mockResolvedValue({
      id: 'resume-1',
      fileName: 'resume.pdf',
      fileSize: 2048,
    } as Resume);

    const { flags, patches } = mockStatefulOnboarding(3);
    render(
      <MemoryRouter>
        <OnboardingModal />
      </MemoryRouter>
    );

    // `OnboardingModal` renders through a Radix `Dialog.Content`, which portals to
    // `document.body` rather than the render container.
    await userEvent.upload(
      document.body.querySelector<HTMLInputElement>('input[type="file"]')!,
      sizedFile('resume.pdf', 'application/pdf', 2048)
    );
    await waitFor(() => expect(flags.resumeStepCompleted).toBe(true));
    expect(flags.resumeStepSkipped).toBe(false);

    // Step 4 (App Overview) -> back to step 3, then skip. AC-5 (WIC-1383) gates the
    // skip behind a confirmation dialog naming what is lost.
    await userEvent.click(await screen.findByRole('button', { name: /back/i }));
    await userEvent.click(await screen.findByRole('button', { name: /skip for now/i }));
    await userEvent.click(await screen.findByRole('button', { name: /skip anyway/i }));

    // The guard fires: no second patch, and the flags the upload wrote hold exactly.
    expect(patches).toHaveLength(1);
    expect(flags.resumeStepCompleted).toBe(true);
    expect(flags.resumeStepSkipped).toBe(false);
  });
});
