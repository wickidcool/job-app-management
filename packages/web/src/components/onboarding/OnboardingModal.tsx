import { useEffect, useState } from 'react';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { OnboardingProgressIndicator } from './OnboardingProgressIndicator';
import { OnboardingStep } from './OnboardingStep';
import { ResumeUploadZone } from './ResumeUploadZone';
import type { Resume } from '../../services/api';

const STEP_LABELS = [
  'Welcome',
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

  const [uploadedResume, setUploadedResume] = useState<Resume | null>(null);
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);

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

          {/* Step 2: Upload Resume */}
          {currentStep === 2 && (
            <OnboardingStep
              stepNumber={2}
              totalSteps={totalSteps}
              title="Upload Your Resume"
              description="Your resume is the foundation of your profile. We'll extract your experience and achievements to help with applications later."
              canProceed={!!uploadedResume}
              onNext={() => handleCompleteStep(2)}
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
                  onClick={handleSkipResume}
                  className="mt-4 w-full text-center text-sm text-neutral-500 hover:text-neutral-700 hover:underline"
                >
                  Skip for now
                </button>
              </div>
            </OnboardingStep>
          )}

          {/* Step 3: App Overview / Feature Tour */}
          {currentStep === 3 && (
            <OnboardingStep
              stepNumber={3}
              totalSteps={totalSteps}
              title="Here's How It Works"
              description="Track applications through every stage of your job search."
              canProceed={true}
              onNext={() => handleCompleteStep(3)}
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

          {/* Step 4: Create First Application (Optional) */}
          {currentStep === 4 && (
            <OnboardingStep
              stepNumber={4}
              totalSteps={totalSteps}
              title="Ready to Add Your First Application?"
              description="You can create your first application now, or explore the app and add one later."
              canProceed={true}
              onNext={() => handleCompleteStep(4)}
              onBack={previousStep}
            >
              <div className="mx-auto max-w-md space-y-4">
                <button
                  type="button"
                  className="w-full rounded-md bg-primary-600 px-6 py-3 text-base font-medium text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                  onClick={() => {
                    // This would open the application form modal
                    // For now, just proceed to next step
                    handleCompleteStep(4);
                  }}
                >
                  Create Application Now
                </button>
                <button
                  type="button"
                  className="w-full rounded-md border border-neutral-300 bg-white px-6 py-3 text-base font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                  onClick={() => handleCompleteStep(4)}
                >
                  I'll Do This Later
                </button>
              </div>
            </OnboardingStep>
          )}

          {/* Step 5: Completion */}
          {currentStep === 5 && (
            <OnboardingStep
              stepNumber={5}
              totalSteps={totalSteps}
              title="You're All Set! 🎉"
              description={
                status?.resumeStepCompleted
                  ? "Your resume is uploaded and you're ready to start tracking applications."
                  : "You're ready to start tracking applications. You can upload your resume anytime from the Resumes page."
              }
              canProceed={true}
              onNext={() => handleCompleteStep(5)}
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
                  <a
                    href="/dashboard"
                    className="flex-1 rounded-md bg-primary-600 px-6 py-3 text-center text-sm font-medium text-white hover:bg-primary-700"
                  >
                    Go to Dashboard
                  </a>
                  <a
                    href="/applications"
                    className="flex-1 rounded-md border border-neutral-300 bg-white px-6 py-3 text-center text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    View Applications
                  </a>
                </div>
              </div>
            </OnboardingStep>
          )}
        </div>
      </div>
    </div>
  );
}
