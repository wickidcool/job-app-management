import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { OnboardingProgressIndicator } from './OnboardingProgressIndicator';
import { OnboardingStep } from './OnboardingStep';
import { ResumeUploadZone } from './ResumeUploadZone';
import { PersonalInfoForm } from '../PersonalInfoForm';
import { usePersonalInfo, useUpdatePersonalInfo } from '../../hooks/usePersonalInfo';
import { useCreateApplication } from '../../hooks/useApplications';
import type { Resume } from '../../services/api';
import type { UpdatePersonalInfoRequest } from '../../services/api/types';

const STEP_LABELS = [
  'Welcome',
  'Personal Info',
  'Upload Resume',
  'App Overview',
  'Create First App',
  'All Set!',
];

export function OnboardingModal() {
  const {
    status,
    showOnboarding,
    currentStep,
    totalSteps,
    updateProgress,
    completeOnboarding,
    dismissOnboarding,
    nextStep,
    previousStep,
  } = useOnboarding();

  const navigate = useNavigate();

  const [uploadedResume, setUploadedResume] = useState<Resume | null>(null);
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  const [personalInfoCompleted, setPersonalInfoCompleted] = useState(false);
  const [showResumeSkipConfirm, setShowResumeSkipConfirm] = useState(false);
  const [showFirstApplicationForm, setShowFirstApplicationForm] = useState(false);
  const [firstApplicationCompany, setFirstApplicationCompany] = useState('');
  const [firstApplicationJobTitle, setFirstApplicationJobTitle] = useState('');
  const [firstApplicationUrl, setFirstApplicationUrl] = useState('');
  const [firstApplicationError, setFirstApplicationError] = useState<string | null>(null);
  const createApplication = useCreateApplication();

  // Two decisions that outlive a render and must not be re-derived from state, because
  // both guard against a *second* write that state alone cannot distinguish from a first.
  //
  // `resumeSkipConfirmed` — the resume step's outcome once the user confirms the warning.
  // `firstApplicationCreated` — that the application already exists on the server, so a
  // retry of the step's progress write is a retry and not a second create.
  const resumeSkipConfirmedRef = useRef(false);
  const firstApplicationCreatedRef = useRef(false);

  const { data: personalInfoData } = usePersonalInfo();
  const updatePersonalInfo = useUpdatePersonalInfo();

  // Auto-save progress to localStorage
  useEffect(() => {
    if (showOnboarding && currentStep > 0) {
      localStorage.setItem(
        'onboarding_progress',
        JSON.stringify({
          step: currentStep,
          timestamp: new Date().toISOString(),
          resumeUploaded: !!uploadedResume,
        })
      );
    }
  }, [currentStep, uploadedResume, showOnboarding]);

  if (!showOnboarding) {
    return null;
  }

  const handleClose = () => {
    setShowDismissConfirm(true);
  };

  const handleConfirmDismiss = () => {
    dismissOnboarding();
    setShowDismissConfirm(false);
  };

  const handleCancelDismiss = () => {
    setShowDismissConfirm(false);
  };

  const handleResumeUploadSuccess = async (resume: Resume) => {
    setUploadedResume(resume);
    // ResumeUploadZone has no AbortController and no mount guard, and this modal stays
    // mounted while the skip warning is open — so an upload started before the warning
    // still resolves here, into a live parent. If the user has already confirmed the
    // skip, the step's outcome is settled: writing `resumeStepCompleted` now would put
    // both flags true on the same row and advance a second time, stepping silently over
    // step 4. The resume itself is kept — it exists on the server either way.
    if (resumeSkipConfirmedRef.current) {
      return;
    }
    await updateProgress({
      resumeStepCompleted: true,
      resumeStepSkipped: false,
    });
    nextStep();
  };

  const handleResumeUploadError = (error: { code: string; message: string }) => {
    console.error('Resume upload error:', error);
  };

  const handleSkipResume = async () => {
    await updateProgress({
      resumeStepSkipped: true,
    });
    nextStep();
  };

  const handleCompleteStep = async (stepNumber: number) => {
    if (stepNumber === totalSteps) {
      await completeOnboarding();
    } else {
      nextStep();
    }
  };

  // WIC-1383 (D-6) — AC-5: "Skip for now" on the resume step must warn about reduced
  // functionality and only proceed once confirmed. `handleSkipResume` above is now the
  // *confirmed* path; the button opens the dialog instead of calling it. Cancelling has
  // to leave the step completely untouched — no `resumeStepSkipped` write, no advance —
  // because that flag feeds the spec's Skip Rate by Step metric, and a warning the user
  // backed out of is not a skip.
  const handleRequestSkipResume = () => {
    setShowResumeSkipConfirm(true);
  };

  const handleCancelSkipResume = () => {
    setShowResumeSkipConfirm(false);
  };

  const handleConfirmSkipResume = async () => {
    setShowResumeSkipConfirm(false);
    // The other half of the same race: an upload that landed while the warning was open
    // has already recorded the step as completed and advanced. Skipping on top of that
    // would contradict the flag it just wrote and discard a resume the user did provide.
    if (uploadedResume) {
      return;
    }
    resumeSkipConfirmedRef.current = true;
    await handleSkipResume();
  };

  // WIC-1383 (D-8) — AC-7/AC-8: step 5 used to be a stub. Both of its buttons called
  // handleCompleteStep(5) under a "this would open the application form modal" comment,
  // so `applicationStepCompleted` and `applicationStepSkipped` had no writer anywhere in
  // the client and were permanently false for every user — the two success metrics that
  // read them ("Skip Rate by Step", "First Application Time") reported a step nobody had
  // ever reached. Rather than a second modal on top of this one, the quick-add renders
  // inline: AC-7 only asks for company + job title, and the URL the accepted spec lists
  // as optional.
  const handleShowFirstApplicationForm = () => {
    setFirstApplicationError(null);
    setShowFirstApplicationForm(true);
  };

  const handleCreateFirstApplication = async () => {
    const company = firstApplicationCompany.trim();
    const jobTitle = firstApplicationJobTitle.trim();

    if (!company || !jobTitle) {
      setFirstApplicationError('Company and job title are both required.');
      return;
    }

    setFirstApplicationError(null);

    if (!firstApplicationCreatedRef.current) {
      try {
        await createApplication.mutateAsync({
          company,
          jobTitle,
          url: firstApplicationUrl.trim() || undefined,
          status: 'saved',
        });
      } catch (error) {
        console.error('Failed to create first application:', error);
        setFirstApplicationError("We couldn't save that application. Please try again.");
        return;
      }
      firstApplicationCreatedRef.current = true;
    }

    // Only after the application actually exists. Writing the flag first would report a
    // completed step for a user who has no application.
    //
    // `updateProgress` re-throws (OnboardingContext). Left outside a try, a progress write
    // that failed after a successful create showed nothing at all: no alert, no advance,
    // and the only affordance left on screen was the button that had just created the
    // application — so retrying created a second one, silently. The guard above makes the
    // retry a retry of the write alone.
    try {
      await updateProgress({
        applicationStepCompleted: true,
        applicationStepSkipped: false,
      });
    } catch (error) {
      console.error('Failed to record the first application step:', error);
      setFirstApplicationError(
        "Your application was saved, but we couldn't finish this step. Try again — we won't create a second one."
      );
      return;
    }
    nextStep();
  };

  // The footer "Next Step" is the only way to decline this step (WIC-1715 ruling, and
  // WIC-1689's single-body-control rule before it): the body renders one control in each
  // state — [Create Application Now] before disclosure, [Save Application] after. Before
  // WIC-1383 the footer wrote neither flag, which is the hole this defect was filed for.
  const handleSkipFirstApplication = async () => {
    // Same failure mode as the create path: an unguarded `updateProgress` here would
    // reject into nothing, leaving the user on a step whose button appears inert.
    try {
      await updateProgress({
        applicationStepSkipped: true,
        applicationStepCompleted: false,
      });
    } catch (error) {
      console.error('Failed to record the first application skip:', error);
      setFirstApplicationError("We couldn't save that just now. Please try again.");
      return;
    }
    nextStep();
  };

  // The completion step's two shortcuts have to finish onboarding the same way the
  // footer button does before they leave. Reaching step 6 only advances local state —
  // STEP_MAP has no entry for it, so the server still reads `first_application` with a
  // null `completedAt`. A plain link out of here therefore reloaded into a fresh
  // OnboardingProvider that re-fetched that untouched status and reopened the modal at
  // step 5. Navigating in-router also keeps the session's cache and auth state.
  const handleFinishAndGo = async (to: string) => {
    await completeOnboarding();
    navigate(to);
  };

  const handlePersonalInfoSubmit = async (formData: UpdatePersonalInfoRequest) => {
    try {
      await updatePersonalInfo.mutateAsync(formData);
      setPersonalInfoCompleted(true);
      await updateProgress({
        personalInfoStepCompleted: true,
      });
      nextStep();
    } catch (err) {
      console.error('Failed to save personal information:', err);
    }
  };

  const handleSkipPersonalInfo = async () => {
    await updateProgress({
      personalInfoStepSkipped: true,
    });
    nextStep();
  };

  // Dismiss confirmation modal
  if (showDismissConfirm) {
    return (
      <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/50 p-4">
        <div
          className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dismiss-title"
        >
          <h3 id="dismiss-title" className="text-lg font-semibold text-neutral-900">
            Save progress and exit?
          </h3>
          <p className="mt-2 text-sm text-neutral-600">
            Your progress will be saved. You can continue the setup later from your dashboard.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={handleCancelDismiss}
              className="flex-1 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmDismiss}
              className="flex-1 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Save & Exit
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Resume-skip warning (WIC-1383 / AC-5). Same shape as the dismiss confirmation above
  // — one dialog in the tree, so nothing has to hide a background modal from assistive
  // tech — with copy that names what is lost. The step's own state lives on the parent
  // (`uploadedResume`), so returning here and back does not discard an upload.
  if (showResumeSkipConfirm) {
    return (
      <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/50 p-4">
        <div
          className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="skip-resume-title"
          aria-describedby="skip-resume-description"
        >
          <h3 id="skip-resume-title" className="text-lg font-semibold text-neutral-900">
            Continue without a resume?
          </h3>
          <p id="skip-resume-description" className="mt-2 text-sm text-neutral-600">
            Your resume is what we read your experience from. Without one, tailored resume variants,
            cover letter drafting and job-fit scoring stay unavailable, and applications have to be
            filled in by hand. You can upload it any time from the Resumes page.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={handleCancelSkipResume}
              className="flex-1 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Go Back
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmSkipResume()}
              className="flex-1 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Skip Anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/50 p-4">
      <div
        className="relative flex h-full w-full flex-col overflow-hidden rounded-lg bg-white shadow-2xl md:h-[90vh] md:max-w-4xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
      >
        {/* Header */}
        <div className="border-b border-neutral-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <OnboardingProgressIndicator
              currentStep={currentStep}
              totalSteps={totalSteps}
              stepLabels={STEP_LABELS}
              allowSkipAhead={false}
            />
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
              aria-label="Close onboarding"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Welcome */}
          {currentStep === 1 && (
            <OnboardingStep
              stepNumber={1}
              totalSteps={totalSteps}
              title="Welcome to Your Job Application Manager"
              description="Let's get you set up in just a few minutes. We'll help you:"
              canProceed={true}
              onNext={() => handleCompleteStep(1)}
            >
              <div className="mx-auto max-w-md space-y-4 text-left">
                <div className="flex items-start gap-3">
                  <svg
                    className="mt-1 h-6 w-6 flex-shrink-0 text-primary-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <div>
                    <h4 className="font-medium text-neutral-900">Upload your resume</h4>
                    <p className="text-sm text-neutral-600">
                      We'll extract your experience to help with applications
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <svg
                    className="mt-1 h-6 w-6 flex-shrink-0 text-primary-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                  <div>
                    <h4 className="font-medium text-neutral-900">Learn the basics</h4>
                    <p className="text-sm text-neutral-600">
                      Quick tour of key features to track your job search
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <svg
                    className="mt-1 h-6 w-6 flex-shrink-0 text-primary-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                  <div>
                    <h4 className="font-medium text-neutral-900">Create your first application</h4>
                    <p className="text-sm text-neutral-600">
                      Add your first job application to get started
                    </p>
                  </div>
                </div>
              </div>
            </OnboardingStep>
          )}

          {/* Step 2: Personal Information */}
          {currentStep === 2 && (
            <OnboardingStep
              stepNumber={2}
              totalSteps={totalSteps}
              title="Tell Us About Yourself"
              description="Fill in your personal information. This will be used for resumes, cover letters, and applications."
              canProceed={personalInfoCompleted || personalInfoData?.isComplete || false}
              onNext={() => handleCompleteStep(2)}
              onBack={previousStep}
              formId="personal-info-form"
            >
              <div className="mx-auto max-w-2xl">
                <PersonalInfoForm
                  personalInfo={personalInfoData?.personalInfo}
                  onSubmit={handlePersonalInfoSubmit}
                  formId="personal-info-form"
                  hideActions
                />
                <button
                  type="button"
                  onClick={handleSkipPersonalInfo}
                  className="mt-4 w-full text-center text-sm text-neutral-500 hover:text-neutral-700 hover:underline"
                >
                  Skip for now
                </button>
              </div>
            </OnboardingStep>
          )}

          {/* Step 3: Upload Resume */}
          {currentStep === 3 && (
            <OnboardingStep
              stepNumber={3}
              totalSteps={totalSteps}
              title="Upload Your Resume"
              description="Your resume is the foundation of your profile. We'll extract your experience and achievements to help with applications later."
              canProceed={!!uploadedResume}
              onNext={() => handleCompleteStep(3)}
              onBack={previousStep}
              validationMessage={
                !uploadedResume ? 'Please upload your resume to continue' : undefined
              }
            >
              <div className="mx-auto max-w-lg">
                <ResumeUploadZone
                  onUploadSuccess={handleResumeUploadSuccess}
                  onUploadError={handleResumeUploadError}
                />
                <button
                  type="button"
                  onClick={handleRequestSkipResume}
                  className="mt-4 w-full text-center text-sm text-neutral-500 hover:text-neutral-700 hover:underline"
                >
                  Skip for now
                </button>
              </div>
            </OnboardingStep>
          )}

          {/* Step 4: App Overview / Feature Tour */}
          {currentStep === 4 && (
            <OnboardingStep
              stepNumber={4}
              totalSteps={totalSteps}
              title="Here's How It Works"
              description="Track applications through every stage of your job search."
              canProceed={true}
              onNext={() => handleCompleteStep(4)}
              onBack={previousStep}
            >
              <div className="mx-auto max-w-2xl space-y-6">
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-6">
                  <h4 className="mb-2 font-semibold text-neutral-900">Dashboard Stats</h4>
                  <p className="text-sm text-neutral-600">
                    See your progress at a glance with stats showing active applications, interview
                    stages, and offers.
                  </p>
                </div>

                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-6">
                  <h4 className="mb-2 font-semibold text-neutral-900">Kanban Board</h4>
                  <p className="text-sm text-neutral-600">
                    Drag applications between stages: Saved → Applied → Phone Screen → Interview →
                    Offer
                  </p>
                </div>

                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-6">
                  <h4 className="mb-2 font-semibold text-neutral-900">Manage Resumes</h4>
                  <p className="text-sm text-neutral-600">
                    Upload and manage your resumes. Create tailored versions for different roles.
                  </p>
                </div>
              </div>
            </OnboardingStep>
          )}

          {/* Step 5: Create First Application (Optional) */}
          {currentStep === 5 && (
            <OnboardingStep
              stepNumber={5}
              totalSteps={totalSteps}
              title="Ready to Add Your First Application?"
              description="You can create your first application now, or explore the app and add one later."
              canProceed={true}
              onNext={() => void handleSkipFirstApplication()}
              onBack={previousStep}
            >
              <div className="mx-auto max-w-md space-y-4">
                {showFirstApplicationForm ? (
                  <form
                    className="space-y-4 text-left"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleCreateFirstApplication();
                    }}
                  >
                    <div>
                      <label
                        htmlFor="first-application-company"
                        className="block text-sm font-medium text-neutral-700"
                      >
                        Company <span className="text-error-700">*</span>
                      </label>
                      <input
                        id="first-application-company"
                        name="company"
                        type="text"
                        required
                        value={firstApplicationCompany}
                        onChange={(event) => setFirstApplicationCompany(event.target.value)}
                        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="first-application-job-title"
                        className="block text-sm font-medium text-neutral-700"
                      >
                        Job title <span className="text-error-700">*</span>
                      </label>
                      <input
                        id="first-application-job-title"
                        name="jobTitle"
                        type="text"
                        required
                        value={firstApplicationJobTitle}
                        onChange={(event) => setFirstApplicationJobTitle(event.target.value)}
                        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="first-application-url"
                        className="block text-sm font-medium text-neutral-700"
                      >
                        Job posting URL <span className="text-neutral-400">(optional)</span>
                      </label>
                      <input
                        id="first-application-url"
                        name="url"
                        type="url"
                        value={firstApplicationUrl}
                        onChange={(event) => setFirstApplicationUrl(event.target.value)}
                        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                    </div>

                    {firstApplicationError && (
                      <p
                        role="alert"
                        className="rounded-md border border-error-100 bg-error-50 p-3 text-sm text-error-700"
                      >
                        {firstApplicationError}
                      </p>
                    )}

                    <p className="text-sm text-neutral-500">
                      We'll save this as <span className="font-medium">Saved</span> so you can move
                      it along the board once you apply.
                    </p>

                    <button
                      type="submit"
                      disabled={createApplication.isPending}
                      className="w-full rounded-md bg-primary-600 px-6 py-3 text-base font-medium text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500"
                    >
                      {createApplication.isPending ? 'Saving…' : 'Save Application'}
                    </button>
                  </form>
                ) : (
                  <>
                    {firstApplicationError && (
                      <p
                        role="alert"
                        className="rounded-md border border-error-100 bg-error-50 p-3 text-sm text-error-700"
                      >
                        {firstApplicationError}
                      </p>
                    )}
                    <button
                      type="button"
                      className="w-full rounded-md bg-primary-600 px-6 py-3 text-base font-medium text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                      onClick={handleShowFirstApplicationForm}
                    >
                      Create Application Now
                    </button>
                  </>
                )}
              </div>
            </OnboardingStep>
          )}

          {/* Step 6: Completion */}
          {currentStep === 6 && (
            <OnboardingStep
              stepNumber={6}
              totalSteps={totalSteps}
              title="You're All Set! 🎉"
              description={
                status?.resumeStepCompleted
                  ? "Your resume is uploaded and you're ready to start tracking applications."
                  : "You're ready to start tracking applications. You can upload your resume anytime from the Resumes page."
              }
              canProceed={true}
              onNext={() => handleCompleteStep(6)}
              onBack={previousStep}
            >
              <div className="mx-auto max-w-md space-y-6 text-left">
                <div className="rounded-lg bg-success-50 p-4">
                  <h4 className="mb-3 font-semibold text-success-900">Quick Tips:</h4>
                  <ul className="space-y-2 text-sm text-success-800">
                    <li className="flex items-start gap-2">
                      <svg
                        className="mt-0.5 h-5 w-5 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span>Add applications as you apply to jobs</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg
                        className="mt-0.5 h-5 w-5 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span>Drag cards to update status as you progress</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg
                        className="mt-0.5 h-5 w-5 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span>Link cover letters and resumes to applications</span>
                    </li>
                  </ul>
                </div>

                <div className="flex gap-3">
                  {/* Dashboard is mounted at "/" (App.tsx), not "/dashboard" — that path
                      matches no route and renders an empty content area. */}
                  <button
                    type="button"
                    onClick={() => void handleFinishAndGo('/')}
                    className="flex-1 rounded-md bg-primary-600 px-6 py-3 text-center text-sm font-medium text-white hover:bg-primary-700"
                  >
                    Go to Dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleFinishAndGo('/applications')}
                    className="flex-1 rounded-md border border-neutral-300 bg-white px-6 py-3 text-center text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    View Applications
                  </button>
                </div>
              </div>
            </OnboardingStep>
          )}
        </div>
      </div>
    </div>
  );
}
