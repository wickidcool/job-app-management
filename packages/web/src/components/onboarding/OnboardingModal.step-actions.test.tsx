import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { OnboardingModal } from './OnboardingModal';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useCreateApplication } from '../../hooks/useApplications';
import { usePersonalInfo, useUpdatePersonalInfo } from '../../hooks/usePersonalInfo';
import { resumeService } from '../../services/api';
import type { Resume } from '../../services/api';

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

/**
 * Starts a real upload through ResumeUploadZone and hands back the resolver, so a test
 * can hold one in flight across a click. The zone validates before calling the service —
 * `.pdf` and >= 1KB — so the file has to be a plausible one, not an empty stub.
 */
function startResumeUpload() {
  let resolveUpload!: (resume: Resume) => void;
  vi.mocked(resumeService.upload).mockReturnValue(
    new Promise<Resume>((resolve) => {
      resolveUpload = resolve;
    })
  );

  // Queried off the document, not `render`'s container: WIC-1141 made this component a
  // Radix Dialog and `Dialog.Portal` mounts the panel on document.body, outside the
  // container the test rendered into. Against the container this resolves to null, and
  // the guard below is what catches that — so it stays.
  const fileInput = document.querySelector('input[type="file"]');
  expect(fileInput).not.toBeNull();
  const file = new File([new Uint8Array(2048)], 'cv.pdf', { type: 'application/pdf' });
  fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });

  return async (resume: Resume = { id: 'resume-1' } as Resume) => {
    await act(async () => {
      resolveUpload(resume);
      await Promise.resolve();
    });
  };
}

describe('OnboardingModal — resume skip warning (WIC-1383 / AC-5)', () => {
  it('warns instead of skipping when "Skip for now" is clicked', async () => {
    const { updateProgress, nextStep } = mockOnboarding({ currentStep: 3 });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }));

    // Two dialogs are in the tree: the onboarding panel stays mounted and the warning
    // nests inside it (WIC-1141's Radix conversion). Take the innermost — selecting it
    // structurally rather than by name keeps the accessible-name assertion below able to
    // fail, which `getByRole('dialog', { name })` would not.
    const dialogs = screen.getAllByRole('dialog');
    const dialog = dialogs[dialogs.length - 1];
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

/**
 * WIC-1429 review, required 3. The race these cover survived the WIC-1141 merge, but its
 * mechanism changed and the original wording no longer describes the code: the warning
 * used to early-`return` in place of the whole modal, unmounting ResumeUploadZone. It is
 * now a nested Radix dialog, so the zone stays mounted and visible behind the warning.
 * That makes the race *wider*, not narrower — the zone has no AbortController and no
 * mount guard, so an upload in flight resolves into a live `onUploadSuccess` on either
 * side of the confirm click, and it can now also be *started* while the warning is open.
 * Both orders wrote a flag contradicting the other and advanced twice, silently stepping
 * over step 4.
 *
 * These are ordering assertions, so they observe the *sequence* of writes and the
 * `nextStep` count. Asserting only the end state cannot tell one advance from two.
 */
describe('OnboardingModal — resume skip races an in-flight upload (WIC-1429)', () => {
  it('an upload that lands while the warning is open is not overwritten by the confirmed skip', async () => {
    const { updateProgress, nextStep } = mockOnboarding({ currentStep: 3 });
    renderModal();

    const finishUpload = startResumeUpload();
    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    await finishUpload();

    // The upload won the race: it recorded the step as completed and advanced once.
    expect(updateProgress).toHaveBeenCalledTimes(1);
    expect(updateProgress).toHaveBeenCalledWith({
      resumeStepCompleted: true,
      resumeStepSkipped: false,
    });

    await userEvent.click(screen.getByRole('button', { name: /skip anyway/i }));

    // And confirming afterwards must add nothing — not a second, contradictory flag
    // write, and not a second advance.
    expect(updateProgress).toHaveBeenCalledTimes(1);
    expect(updateProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ resumeStepSkipped: true })
    );
    expect(nextStep).toHaveBeenCalledTimes(1);
  });

  it('an upload that resolves after the skip was confirmed does not advance a second time', async () => {
    const { updateProgress, nextStep } = mockOnboarding({ currentStep: 3 });
    renderModal();

    const finishUpload = startResumeUpload();
    await userEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    await userEvent.click(screen.getByRole('button', { name: /skip anyway/i }));

    expect(updateProgress).toHaveBeenCalledTimes(1);
    expect(updateProgress).toHaveBeenCalledWith({ resumeStepSkipped: true });

    await finishUpload();

    // The skip is the decision of record now. A late upload must not re-open the step.
    expect(updateProgress).toHaveBeenCalledTimes(1);
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

  /**
   * WIC-1429 review, required 1. `updateProgress` re-throws and sat outside the create's
   * try/catch, so a create that succeeded followed by a progress write that failed showed
   * the user nothing — and left the Save button as the only thing on screen to press.
   */
  it('surfaces a failed progress write instead of silently leaving the create unrecorded', async () => {
    const { updateProgress, nextStep, createApplication } = mockOnboarding();
    updateProgress.mockRejectedValueOnce(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));
    await userEvent.type(screen.getByLabelText(/company/i), 'Acme Corp');
    await userEvent.type(screen.getByLabelText(/job title/i), 'Staff Engineer');
    await userEvent.click(screen.getByRole('button', { name: /save application/i }));

    expect(createApplication).toHaveBeenCalledTimes(1);
    // The application exists; the step does not. Say so, rather than nothing.
    expect(await screen.findByRole('alert')).toHaveTextContent(/saved/i);
    expect(nextStep).not.toHaveBeenCalled();
  });

  it('retrying after a failed progress write creates no second application', async () => {
    const { updateProgress, nextStep, createApplication } = mockOnboarding();
    updateProgress.mockRejectedValueOnce(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));
    await userEvent.type(screen.getByLabelText(/company/i), 'Acme Corp');
    await userEvent.type(screen.getByLabelText(/job title/i), 'Staff Engineer');
    await userEvent.click(screen.getByRole('button', { name: /save application/i }));
    await screen.findByRole('alert');

    // The only affordance left on screen. Pressing it used to POST a duplicate.
    await userEvent.click(screen.getByRole('button', { name: /save application/i }));

    expect(createApplication).toHaveBeenCalledTimes(1);
    expect(updateProgress).toHaveBeenCalledTimes(2);
    expect(updateProgress).toHaveBeenLastCalledWith({
      applicationStepCompleted: true,
      applicationStepSkipped: false,
    });
    expect(nextStep).toHaveBeenCalledTimes(1);
  });

  /**
   * WIC-1429 round 2. The latch's *placement* is the whole fix, and nothing else pins it.
   * Set before the create resolves, a create that FAILED would still latch, and the retry
   * would skip straight to the progress write — marking the step completed for a user
   * with no application, which is precisely what the comment above that write forbids.
   *
   * The sibling "does not mark the step completed when the create call fails" cannot
   * catch that: it rejects once and never retries, so it never exercises the latch.
   */
  it('retrying after a failed create does create the application, rather than latching', async () => {
    const { updateProgress, nextStep, createApplication } = mockOnboarding();
    createApplication.mockRejectedValueOnce(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));
    await userEvent.type(screen.getByLabelText(/company/i), 'Acme Corp');
    await userEvent.type(screen.getByLabelText(/job title/i), 'Staff Engineer');
    await userEvent.click(screen.getByRole('button', { name: /save application/i }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: /save application/i }));

    expect(createApplication).toHaveBeenCalledTimes(2);
    expect(updateProgress).toHaveBeenCalledTimes(1);
    expect(updateProgress).toHaveBeenCalledWith({
      applicationStepCompleted: true,
      applicationStepSkipped: false,
    });
    expect(nextStep).toHaveBeenCalledTimes(1);
  });
});

describe('OnboardingModal — first application skip (WIC-1383 / AC-8)', () => {
  // WIC-1715 ruling: the body carries no second button, so the footer "Next Step" is the
  // only way to decline this step. The sibling test that clicked "I'll Do This Later"
  // folds in here — but its `updateProgress` call-count and `nextStep` assertions were
  // *not* already present below, so they are carried across rather than dropped with it.
  it('the footer "Next Step" records the skip, rather than leaving both flags unwritten', async () => {
    const { updateProgress, nextStep, createApplication } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /next step/i }));

    expect(createApplication).not.toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledTimes(1);
    expect(updateProgress).toHaveBeenCalledWith({
      applicationStepSkipped: true,
      applicationStepCompleted: false,
    });
    expect(nextStep).toHaveBeenCalledTimes(1);
  });

  // WIC-1715, "Scope held": the footer decline is *unconditional* and writes
  // applicationStepSkipped even over a half-typed form. Discarding a partial draft
  // without a confirm is an accepted cost on an optional step — the flag is honest (the
  // user left without an application) and AC-8 asks for no gate.
  //
  // This replaces a round-1 test asserting the opposite (footer submits when the form
  // holds input). That predicate did not merely contradict the ruling: with only one
  // required field typed it routed the footer into the create path, which early-returns
  // on "Company and job title are both required" — leaving step 5 with no forward exit
  // at all. Hence one field here, not two: it is the case that had no way out.
  it('the footer "Next Step" still skips when the quick-add form holds typed data', async () => {
    const { updateProgress, nextStep, createApplication } = mockOnboarding();
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));
    await userEvent.type(screen.getByLabelText(/company/i), 'Acme Corp');
    await userEvent.click(screen.getByRole('button', { name: /next step/i }));

    expect(createApplication).not.toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith({
      applicationStepSkipped: true,
      applicationStepCompleted: false,
    });
    expect(nextStep).toHaveBeenCalledTimes(1);
  });

  it('the footer "Next Step" still skips when the quick-add form was opened but left empty', async () => {
    const { updateProgress, createApplication } = mockOnboarding();
    renderModal();

    // Opening the form is not a commitment to fill it.
    await userEvent.click(screen.getByRole('button', { name: /create application now/i }));
    await userEvent.click(screen.getByRole('button', { name: /next step/i }));

    expect(createApplication).not.toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith({
      applicationStepSkipped: true,
      applicationStepCompleted: false,
    });
  });

  // Re-pointed at the footer under the WIC-1715 ruling — with the second body button
  // gone, the footer is the only remaining route into handleSkipFirstApplication, so
  // this is the same coverage rather than an approximation of it.
  it('surfaces a failed skip write rather than leaving the control inert', async () => {
    const { updateProgress, nextStep } = mockOnboarding();
    updateProgress.mockRejectedValueOnce(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /next step/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(nextStep).not.toHaveBeenCalled();
  });
});
