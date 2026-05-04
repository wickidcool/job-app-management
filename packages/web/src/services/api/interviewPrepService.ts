import type { APIClient } from './apiClient';
import { APIError } from './apiClient';
import type {
  GenerateInterviewPrepRequest,
  GenerateInterviewPrepResponse,
  GetInterviewPrepResponse,
  UpdateInterviewPrepRequest,
  UpdateInterviewPrepResponse,
  LogPracticeSessionRequest,
  LogPracticeSessionResponse,
  ExportQuickReferenceResponse,
  ExportFormat,
} from '../../types/interviewPrep';

/**
 * Interview Prep Service for API operations
 */
export class InterviewPrepService {
  client: APIClient;

  constructor(client: APIClient) {
    this.client = client;
  }

  /**
   * Generate interview prep for an application
   */
  async generate(data: GenerateInterviewPrepRequest): Promise<GenerateInterviewPrepResponse> {
    return this.client.post<GenerateInterviewPrepResponse>('/interview-preps', data);
  }

  /**
   * Get interview prep by ID
   */
  async getById(id: string): Promise<GetInterviewPrepResponse | null> {
    try {
      return await this.client.get<GetInterviewPrepResponse>(`/interview-preps/${id}`);
    } catch (error) {
      if (error instanceof APIError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get interview prep by application ID
   */
  async getByApplicationId(applicationId: string): Promise<GetInterviewPrepResponse | null> {
    try {
      return await this.client.get<GetInterviewPrepResponse>(
        `/applications/${applicationId}/interview-prep`
      );
    } catch (error) {
      if (error instanceof APIError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update interview prep
   */
  async update(id: string, data: UpdateInterviewPrepRequest): Promise<UpdateInterviewPrepResponse> {
    return this.client.patch<UpdateInterviewPrepResponse>(`/interview-preps/${id}`, data);
  }

  /**
   * Delete interview prep
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/interview-preps/${id}`);
  }

  /**
   * Log a practice session
   */
  async logPracticeSession(
    id: string,
    data: LogPracticeSessionRequest
  ): Promise<LogPracticeSessionResponse> {
    return this.client.post<LogPracticeSessionResponse>(`/interview-preps/${id}/practice`, data);
  }

  /**
   * Export quick reference card
   */
  async exportQuickReference(
    id: string,
    format: ExportFormat,
    sections?: string
  ): Promise<ExportQuickReferenceResponse> {
    const params = new URLSearchParams({ format });
    if (sections) {
      params.append('sections', sections);
    }
    return this.client.get<ExportQuickReferenceResponse>(
      `/interview-preps/${id}/export?${params.toString()}`
    );
  }

  /**
   * Download quick reference card as file
   */
  async downloadQuickReference(id: string, format: ExportFormat, sections?: string): Promise<Blob> {
    const params = new URLSearchParams({ format });
    if (sections) {
      params.append('sections', sections);
    }

    const token = await this.client.config.getAuthToken();
    const response = await fetch(
      `${this.client.config.baseURL}/interview-preps/${id}/export?${params.toString()}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
    }

    return response.blob();
  }
}

/**
 * Create interview prep service instance
 */
export function createInterviewPrepService(client: APIClient): InterviewPrepService {
  return new InterviewPrepService(client);
}
