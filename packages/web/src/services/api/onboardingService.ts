import type { APIClient } from './apiClient';

export type OnboardingStep = 'welcome' | 'resume_upload' | 'first_application' | 'completed';

export interface OnboardingStatus {
  id: string;
  userId: string;
  currentStep: OnboardingStep;
  resumeStepCompleted: boolean;
  resumeStepSkipped: boolean;
  applicationStepCompleted: boolean;
  applicationStepSkipped: boolean;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface OnboardingProgress {
  currentStep?: OnboardingStep;
  resumeStepCompleted?: boolean;
  resumeStepSkipped?: boolean;
  applicationStepCompleted?: boolean;
  applicationStepSkipped?: boolean;
}

export interface OnboardingService {
  getStatus: () => Promise<OnboardingStatus>;
  updateProgress: (progress: OnboardingProgress) => Promise<OnboardingStatus>;
  complete: () => Promise<OnboardingStatus>;
  shouldShow: () => Promise<{ shouldShow: boolean }>;
}

export function createOnboardingService(client: APIClient): OnboardingService {
  return {
    async getStatus() {
      return client.get<OnboardingStatus>('/users/me/onboarding/status');
    },

    async updateProgress(progress: OnboardingProgress) {
      return client.post<OnboardingStatus>('/users/me/onboarding/progress', progress);
    },

    async complete() {
      return client.post<OnboardingStatus>('/users/me/onboarding/complete');
    },

    async shouldShow() {
      return client.get<{ shouldShow: boolean }>('/users/me/onboarding/should-show');
    },
  };
}
