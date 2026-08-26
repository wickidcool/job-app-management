import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { OnboardingModal } from './OnboardingModal';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useCreateApplication } from '../../hooks/useApplications';
import { usePersonalInfo, useUpdatePersonalInfo } from '../../hooks/usePersonalInfo';

/**
 * WIC-1383 — the two accepted WIC-238 criteria that were never implemented.
 *
 * D-6 / AC-5: the resume step's "Skip for now" wrote `resumeStepSkipped` and advanced
 * immediately. Two of the AC's three clauses (warn, then require confirmation) had no
 * code at all.
 *
 * D-8 / AC-7 + AC-8: step 5's "Create Application Now" called `handleCompleteStep(5)`
 * and nothing else — behaviourally identical to "I'll Do This Later" beneath it. As a
 * result `applicationStepCompleted` and `applicationStepSkipped` had no writer anywhere
 * in the client and were permanently false for every user.
 *
 * Why this file and not the API suite: `packages/api/test/onboarding.test.ts` already
 * has green tests named after AC-5 and AC-8. They assert the *endpoint* honours such a
 * payload. They cannot see that no client ever sends one, which is the actual defect.
 * Every assertion here is on what the client sends.
 */

vi.mock('../../contexts/OnboardingContext');
vi.mock('../../hooks/usePersonalInfo');
vi.mock('../../hooks/useApplications');
// ResumeUploadZone (step 3) imports the live service module at load time. Stubbed so
// the test needs no API client, matching the no-server rule of this harness.
vi.mock('../../services/api', () => ({
  resumeService: { upload: vi.fn() },
}));

type OnboardingContextValue = ReturnType<typeof useOnboarding>;

function mockOnboarding(overrides: Partial<OnboardingContextValue> = {}) {
  const updateProgress = vi.fn().mockResolvedValue(undefined);
  const nextStep = vi.fn();
  const createApplicationMutation = vi.fn().mockResolvedValue({ id: 'app-1' });

  vi.mocked(useOnboarding).mockReturnValue({
    status: null,
    loading: false,
    showOnboarding: true,
    currentStep: 5,
    totalSteps: 6,
    updateProgress,
    completeOnboarding: vi.fn().mockResolvedValue(undefined),
    dismissOnboarding: vi.fn(),
    goToStep: vi.fn(),
    nextStep,
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
    mutateAsync: createApplicationMutation,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateApplication>);

  return { updateProgress, nextStep, createApplication: createApplicationMutation };
}

function renderModal() {
  return render(
    <MemoryRouter>
      <OnboardingModal />
    </MemoryRouter>
  );
}

describe('OnboardingModal — resume skip warning (WIC-1383 / AC-5)', () => {
  it('warns instead of skipping when "Skip for now" is clicked', async () => {
    const { updateProgress, nextStep } = mockOnboarding({ currentStep: 3 });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName(/continue without a resume\?/i);
    // The AC asks for a warning "about reduced functionality" — assert the dialog
    // actually says what is lost, not merely that some dialog opened.
    expect(dialog).toHaveTextContent(/cover letter/i);
    expect(dialog).toHaveTextContent(/job-fit/i);

    // Neither clause of the write has happened yet.
    expect(updateProgress).not.toHaveBeenCalled();
    expect(nextStep).not.toHaveBeenCalled();
  });

  it('cancelling the warning neither advances the step nor writes resumeStepSkipped', async () => {
    const { updateProgress, nextStep } = mockOnboarding({ currentStep: 3 });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    await userEvent.click(screen.getByRole('button', { name: /go back/i }));

    // Back on the upload step, with nothing recorded. A cancelled warning is not a skip;
    // recording it as one would corrupt the spec's Skip Rate by Step metric.
    expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
    expect(updateProgress).not.toHaveBeenCalled();
    expect(nextStep).not.toHaveBeenCalled();
  });

  it('confirming the warning skips the step exactly once', async () => {
    const { updateProgress, nextStep } = mockOnboarding({ currentStep: 3 });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    await userEvent.click(screen.getByRole('button', { name: /skip anyway/i }));

    expect(updateProgress).toHaveBeenCalledTimes(1);
    expect(updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ resumeStepSkipped: true })
    );
    expect(updateProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ resumeStepCompleted: true })
    );
    expect(nextStep).toHaveBeenCalledTimes(1);
  });
});

describe('OnboardingModal — first application quick-add (WIC-1383 / AC-7)', () => {
  it('renders a form rather than silently advancing, and creates a Saved application', async () => {
    const { updateProgress, nextStep, createApplication } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));

    // The stub's whole defect was that this click was indistinguishable from the skip.
    expect(createApplication).not.toHaveBeenCalled();
    expect(nextStep).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/company/i), 'Acme Corp');
    await userEvent.type(screen.getByLabelText(/job title/i), 'Staff Engineer');
    await userEvent.type(screen.getByLabelText(/job posting url/i), 'https://acme.test/jobs/1');
    await userEvent.click(screen.getByRole('button', { name: /save application/i }));

    expect(createApplication).toHaveBeenCalledTimes(1);
    expect(createApplication).toHaveBeenCalledWith({
      company: 'Acme Corp',
      jobTitle: 'Staff Engineer',
      url: 'https://acme.test/jobs/1',
      status: 'saved',
    });

    // AC-7: "application is created with status 'Saved' AND user proceeds to completion".
    expect(updateProgress).toHaveBeenCalledWith({
      applicationStepCompleted: true,
      applicationStepSkipped: false,
    });
    expect(nextStep).toHaveBeenCalledTimes(1);
  });

  it('omits the optional URL rather than sending an empty string', async () => {
    const { createApplication } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));
    await userEvent.type(screen.getByLabelText(/company/i), 'Acme Corp');
    await userEvent.type(screen.getByLabelText(/job title/i), 'Staff Engineer');
    await userEvent.click(screen.getByRole('button', { name: /save application/i }));

    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({ url: undefined, status: 'saved' })
    );
  });

  it('rejects whitespace-only required fields without creating or advancing', async () => {
    const { updateProgress, nextStep, createApplication } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));
    // Spaces satisfy the `required` attribute, so this is the case the browser will not
    // catch and the handler has to.
    await userEvent.type(screen.getByLabelText(/company/i), '   ');
    await userEvent.type(screen.getByLabelText(/job title/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: /save application/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/required/i);
    expect(createApplication).not.toHaveBeenCalled();
    expect(updateProgress).not.toHaveBeenCalled();
    expect(nextStep).not.toHaveBeenCalled();
  });

  it('does not mark the step completed when the create call fails', async () => {
    const { updateProgress, nextStep, createApplication } = mockOnboarding();
    createApplication.mockRejectedValueOnce(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));
    await userEvent.type(screen.getByLabelText(/company/i), 'Acme Corp');
    await userEvent.type(screen.getByLabelText(/job title/i), 'Staff Engineer');
    await userEvent.click(screen.getByRole('button', { name: /save application/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // The flag must never outrun the record it describes.
    expect(updateProgress).not.toHaveBeenCalled();
    expect(nextStep).not.toHaveBeenCalled();
  });
});

describe('OnboardingModal — first application skip (WIC-1383 / AC-8)', () => {
  it('"I\'ll Do This Later" sets applicationStepSkipped and creates nothing', async () => {
    const { updateProgress, nextStep, createApplication } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /i'll do this later/i }));

    expect(createApplication).not.toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledTimes(1);
    expect(updateProgress).toHaveBeenCalledWith({
      applicationStepSkipped: true,
      applicationStepCompleted: false,
    });
    expect(nextStep).toHaveBeenCalledTimes(1);
  });

  it('the footer "Next Step" records the skip too, rather than leaving both flags unwritten', async () => {
    const { updateProgress, createApplication } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /next step/i }));

    expect(createApplication).not.toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith({
      applicationStepSkipped: true,
      applicationStepCompleted: false,
    });
  });
});
