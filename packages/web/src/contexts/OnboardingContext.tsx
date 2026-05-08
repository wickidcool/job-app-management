import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onboardingService } from '../services/api';
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
  2: 'resume_upload',
  3: undefined, // App Overview - no DB update needed
  4: 'first_application',
  // step 5 calls completeOnboarding() directly, no STEP_MAP needed
};

const STEP_TO_NUMBER: Record<OnboardingStep, number> = {
  welcome: 1,
  resume_upload: 2,
  first_application: 4, // Step 3 is App Overview (no DB state)
  completed: 5,
};

const TOTAL_STEPS = 5; // Welcome, Resume Upload, App Overview (Feature Tour), Create First App, Completion

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  // Initialize loading based on whether auth token exists
  const [loading, setLoading] = useState(() => !!localStorage.getItem('auth_token'));
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = await onboardingService.getStatus();
      setStatus(result);

      // Convert DB step to UI step number
      const stepNumber = STEP_TO_NUMBER[result.currentStep] || 1;
      setCurrentStep(stepNumber);

      // Determine if onboarding should be shown
      if (result.completedAt !== null || result.currentStep === 'completed') {
        setShowOnboarding(false);
      } else {
        setShowOnboarding(true);
      }
    } catch (error) {
      console.error('Failed to fetch onboarding status:', error);
      // On error, default to not showing onboarding
      setShowOnboarding(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Skip fetch if user is not authenticated
    const token = localStorage.getItem('auth_token');
    if (!token) {
      return;
    }

    let cancelled = false;

    const initFetch = async () => {
      try {
        const result = await onboardingService.getStatus();
        if (cancelled) return;

        setStatus(result);
        const stepNumber = STEP_TO_NUMBER[result.currentStep] || 1;
        setCurrentStep(stepNumber);

        if (result.completedAt !== null || result.currentStep === 'completed') {
          setShowOnboarding(false);
        } else {
          setShowOnboarding(true);
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to fetch onboarding status:', error);
        setShowOnboarding(false);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void initFetch();

    return () => {
      cancelled = true;
    };
  }, []);

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
