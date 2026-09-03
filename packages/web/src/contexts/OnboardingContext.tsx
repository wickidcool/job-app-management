import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onboardingService } from '../services/api';
import { AUTH_TOKEN_KEY } from '../services/appStorage';
import type { OnboardingStatus, OnboardingStep, OnboardingProgress } from '../services/api';

interface OnboardingContextType {
  status: OnboardingStatus | null;
  loading: boolean;
  showOnboarding: boolean;
  currentStep: number;
  totalSteps: number;
  updateProgress: (progress: OnboardingProgress) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  dismissOnboarding: () => void;
  goToStep: (step: number) => void;
  nextStep: () => void;
  previousStep: () => void;
  refetch: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

const STEP_MAP: Record<number, OnboardingStep | undefined> = {
  1: 'welcome',
  2: 'personal_info',
  3: 'resume_upload',
  4: undefined, // App Overview - no DB update needed
  5: 'first_application',
  // step 6 calls completeOnboarding() directly, no STEP_MAP needed
};

const STEP_TO_NUMBER: Record<OnboardingStep, number> = {
  welcome: 1,
  personal_info: 2,
  resume_upload: 3,
  first_application: 5, // Step 4 is App Overview (no DB state)
  completed: 6,
};

const TOTAL_STEPS = 6; // Welcome, Personal Info, Resume Upload, App Overview, Create First App, Completion

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  // Initialize loading based on whether auth token exists
  const [loading, setLoading] = useState(() => !!localStorage.getItem(AUTH_TOKEN_KEY));
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  /**
   * Visibility is the server's answer, not one we derive here (WIC-1359).
   *
   * Reading `completedAt`/`currentStep` off the status row looks equivalent but is
   * not: `GET /status` auto-creates a `welcome` row for any user without one, and a
   * `welcome` row read locally is indistinguishable from a genuine new signup. That
   * put the modal over every established user's populated dashboard. `should-show`
   * is the only view that also knows their resume and application history, which is
   * what WIC-238 AC-10 turns on.
   *
   * The two requests race deliberately: if `should-show` lands before `/status` has
   * auto-created the row, it reads "no row" instead of "pristine row", and the
   * service answers the same either way.
   */
  const loadOnboarding = useCallback(async (isCancelled: () => boolean) => {
    try {
      const [result, { shouldShow }] = await Promise.all([
        onboardingService.getStatus(),
        onboardingService.shouldShow(),
      ]);
      if (isCancelled()) return;

      setStatus(result);

      // Convert DB step to UI step number
      const stepNumber = STEP_TO_NUMBER[result.currentStep] || 1;
      setCurrentStep(stepNumber);

      setShowOnboarding(shouldShow);
    } catch (error) {
      if (isCancelled()) return;
      console.error('Failed to fetch onboarding status:', error);
      // On error, default to not showing onboarding
      setShowOnboarding(false);
    } finally {
      if (!isCancelled()) {
        setLoading(false);
      }
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    await loadOnboarding(() => false);
  }, [loadOnboarding]);

  useEffect(() => {
    // Skip fetch if user is not authenticated
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      return;
    }

    // `loadOnboarding` rather than `fetchStatus`: the initial loading flag is already
    // set from the auth token, and setting it again here would be a synchronous
    // setState in an effect body. The mount and refetch paths otherwise share one
    // implementation — they used to be duplicated, and the copy that decided
    // visibility locally is what WIC-1359 was.
    let cancelled = false;
    void (async () => {
      await loadOnboarding(() => cancelled);
    })();

    return () => {
      cancelled = true;
    };
  }, [loadOnboarding]);

  const updateProgress = useCallback(async (progress: OnboardingProgress) => {
    try {
      const updated = await onboardingService.updateProgress(progress);
      setStatus(updated);

      // Update current step if provided
      if (progress.currentStep) {
        const stepNumber = STEP_TO_NUMBER[progress.currentStep] || 1;
        setCurrentStep(stepNumber);
      }
    } catch (error) {
      console.error('Failed to update onboarding progress:', error);
      throw error;
    }
  }, []);

  const completeOnboarding = useCallback(async () => {
    try {
      const completed = await onboardingService.complete();
      setStatus(completed);
      setShowOnboarding(false);
      setCurrentStep(TOTAL_STEPS);
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
      throw error;
    }
  }, []);

  const dismissOnboarding = useCallback(() => {
    // Just hide the modal for now, don't mark as completed
    setShowOnboarding(false);
  }, []);

  const goToStep = useCallback((step: number) => {
    if (step >= 1 && step <= TOTAL_STEPS) {
      setCurrentStep(step);
    }
  }, []);

  const nextStep = useCallback(async () => {
    const next = currentStep + 1;
    if (next <= TOTAL_STEPS) {
      setCurrentStep(next);

      // Update backend with new step
      const dbStep = STEP_MAP[next];
      if (dbStep) {
        try {
          await updateProgress({ currentStep: dbStep });
        } catch (error) {
          console.error('Failed to update step:', error);
        }
      }
    }
  }, [currentStep, updateProgress]);

  const previousStep = useCallback(() => {
    const prev = currentStep - 1;
    if (prev >= 1) {
      setCurrentStep(prev);
    }
  }, [currentStep]);

  const value = {
    status,
    loading,
    showOnboarding,
    currentStep,
    totalSteps: TOTAL_STEPS,
    updateProgress,
    completeOnboarding,
    dismissOnboarding,
    goToStep,
    nextStep,
    previousStep,
    refetch: fetchStatus,
  };

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}
